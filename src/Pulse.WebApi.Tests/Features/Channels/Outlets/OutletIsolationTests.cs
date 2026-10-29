namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// COR-001 / XC-001 for the outlet registry, the always-Critical guarantee. Exercise B can neither read nor touch
/// exercise A's outlets; every cross-exercise id (outlet, persona, parent, logo) gets EXACTLY the response an unknown
/// id gets; and at the data layer the central filter fails closed (zero rows for another or an unset scope, while
/// <c>IgnoreQueryFilters</c> proves the rows exist).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OutletIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OutletIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ExerciseB_ReadsNoneOfExerciseAsOutlets_AndAnotherExercisesSlugIsTheUnknown404()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        await host.AddOutletAsync(a.ExerciseId, "news", "a-only-outlet");
        await host.AddOutletAsync(a.ExerciseId, "news", "shared-name");
        var bOwn = await host.AddOutletAsync(b.ExerciseId, "news", "shared-name");

        host.ActAs(b.ExerciseId, staffUserId: null);
        var list = (await (await host.GetAsync("/api/outlets?channel=news")).Content.ReadFromJsonAsync<List<WireOutlet>>())!;
        list.Should().ContainSingle().Which.Id.Should().Be(bOwn.Id.ToString(), "B sees only B's outlet (COR-001)");

        var unknown = await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets/never-existed"));
        var crossExercise = await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets/a-only-outlet"));
        crossExercise.Should().Be(unknown, "another exercise's outlet is indistinguishable from an unknown one");
        crossExercise.Status.Should().Be(404);

        host.ActAs(b.ExerciseId, b.StaffUserId);
        var staffList = (await (await host.GetAsync("/api/outlets/staff")).Content.ReadFromJsonAsync<List<WireStaffOutlet>>())!;
        staffList.Should().ContainSingle().Which.Id.Should().Be(bOwn.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseOutletId_GetsTheUnknownIdResponse_OnEveryWrite_AndTouchesNothing()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var aOutlet = await host.AddOutletAsync(a.ExerciseId, "news", "metro-desk-9");
        var unknown = Guid.NewGuid();
        host.ActAs(b.ExerciseId, b.StaffUserId);

        var edit = OutletTestHost.Body(name: "hijack", version: 1);
        (await OutletTestHost.ProblemAsync(await host.PutAsync(aOutlet.Id, edit)))
            .Should().Be(await OutletTestHost.ProblemAsync(await host.PutAsync(unknown, edit)));
        (await OutletTestHost.ProblemAsync(await host.DeleteAsync(aOutlet.Id, 1)))
            .Should().Be(await OutletTestHost.ProblemAsync(await host.DeleteAsync(unknown, 1)));
        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids = new[] { aOutlet.Id } })))
            .Should().Be(await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids = new[] { unknown } })));

        await using var aDb = host.Db(a.ExerciseId);
        var untouched = await aDb.Outlets.SingleAsync(o => o.Id == aOutlet.Id);
        untouched.Name.Should().Be("metro-desk-9");
        untouched.Version.Should().Be(1);
        untouched.DeletedAt.Should().BeNull();
        (await host.OutletEventsAsync(a.ExerciseId)).Should().BeEmpty();
        (await host.OutletEventsAsync(b.ExerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task ACrossExercisePersonaParentOrLogo_AnswersExactlyLikeAnUnknownId()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var aPersona = await host.AddPersonaAsync(a.ExerciseId, "MetroDesk9");
        var aPress = await host.AddOutletAsync(a.ExerciseId, "press", "wire-room");
        var aLogo = await host.AddMediaAssetAsync(a.ExerciseId);
        host.ActAs(b.ExerciseId, b.StaffUserId);

        var cases = new (object Cross, object Unknown, string Message)[]
        {
            (OutletTestHost.Body(pairedPersonaId: aPersona.ToString()), OutletTestHost.Body(pairedPersonaId: Guid.NewGuid().ToString()), OutletService.PersonaNotFoundMessage),
            (OutletTestHost.Body(channelId: "press", parentOutletId: aPress.Id.ToString()), OutletTestHost.Body(channelId: "press", parentOutletId: Guid.NewGuid().ToString()), OutletService.ParentNotFoundMessage),
            (OutletTestHost.Body(logoMediaId: aLogo.ToString()), OutletTestHost.Body(logoMediaId: Guid.NewGuid().ToString()), OutletService.LogoNotFoundMessage),
        };

        foreach (var (cross, unknownBody, message) in cases)
        {
            var crossProblem = await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", cross));
            var unknownProblem = await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", unknownBody));
            crossProblem.Should().Be(unknownProblem, "a foreign id must be indistinguishable from an unknown one (COR-001)");
            crossProblem.Status.Should().Be(400);
            crossProblem.Detail.Should().Be(message);
        }

        await using var bDb = host.Db(b.ExerciseId);
        (await bDb.Outlets.CountAsync()).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task TheCentralFilter_FailsClosed_ForAnotherOrAnUnsetScope_WhileTheRowsExist()
    {
        await using var host = await OutletTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var outlet = await host.AddOutletAsync(a.ExerciseId, "news", "metro-desk-9");

        await using (var other = host.Db(Guid.NewGuid()))
        {
            (await other.Outlets.CountAsync()).Should().Be(0);
            (await other.Outlets.FindAsync(outlet.Id)).Should().BeNull("an IDOR by a known id finds nothing");
            (await other.IncludingSoftDeleted<Outlet>().CountAsync()).Should().Be(0, "the deleted-rows view keeps the exercise scope");
        }

        await using (var unset = host.Db(exerciseId: null))
        {
            (await unset.Outlets.CountAsync()).Should().Be(0, "an unset scope sees zero rows, never all exercises");
            (await unset.Outlets.IgnoreQueryFilters().AnyAsync(o => o.Id == outlet.Id)).Should().BeTrue("the zero is the filter, not an empty table");
        }

        host.ActAs(exerciseId: null, staffUserId: a.StaffUserId);
        (await host.GetAsync("/api/outlets?channel=news")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "x"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
