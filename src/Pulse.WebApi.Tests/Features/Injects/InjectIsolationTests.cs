namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// COR-001 / XC-001 for the inject queue — the always-Critical guarantee. Exercise B can neither see nor touch
/// exercise A's queue; every cross-exercise id (item, persona, scripted reply target) gets EXACTLY the response an
/// unknown id gets; and at the data layer the central filter fails closed (zero rows for another or an unset scope,
/// while <c>IgnoreQueryFilters</c> proves the rows exist).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public InjectIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ExerciseB_SeesNoneOfExerciseAsQueue()
    {
        await using var host = await StartAsync();
        var (a, b, aItem) = await TwoExercisesAsync(host);

        host.ActAs(b.ExerciseId, b.StaffUserId);
        var queue = await host.GetQueueAsync();

        queue.Items.Should().BeEmpty("another exercise's scripted posts must never be visible (COR-001)");
        host.ActAs(a.ExerciseId, a.StaffUserId);
        (await host.GetQueueAsync()).Items.Should().ContainSingle().Which.Id.Should().Be(aItem.Id);
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseItemId_GetsTheUnknownIdResponse_OnEveryRoute_AndTouchesNothing()
    {
        await using var host = await StartAsync();
        var (a, b, aItem) = await TwoExercisesAsync(host);
        var unknown = Guid.NewGuid();
        host.ActAs(b.ExerciseId, b.StaffUserId);

        foreach (var action in new[] { "fire", "hold", "release", "skip", "unskip", "retry" })
        {
            var crossBody = await ProblemAsync(await host.ActionAsync(aItem.Guid, action));
            var unknownBody = await ProblemAsync(await host.ActionAsync(unknown, action));
            crossBody.Should().Be(unknownBody, "{0} on another exercise's item must be indistinguishable from an unknown id", action);
            crossBody.Status.Should().Be(404);
        }

        var edit = new { kind = "post", title = "hijack", version = 1, posts = new[] { new { personaId = b.PersonaIds[0].ToString(), text = "x" } } };
        (await ProblemAsync(await host.PutAsync(aItem.Id, edit))).Should().Be(await ProblemAsync(await host.PutAsync(unknown.ToString(), edit)));
        (await ProblemAsync(await host.DeleteAsync(aItem.Id, 1))).Should().Be(await ProblemAsync(await host.DeleteAsync(unknown.ToString(), 1)));

        await using var aDb = host.Db(a.ExerciseId);
        var untouched = await aDb.InjectItems.Include(i => i.Posts).SingleAsync(i => i.Id == aItem.Guid);
        untouched.Version.Should().Be(1);
        untouched.Status.Should().Be("pending");
        untouched.DeletedAt.Should().BeNull();
        (await aDb.Posts.CountAsync()).Should().Be(0, "nothing was published into exercise A");
        (await aDb.TelemetryEvents.CountAsync(e => e.EventType == "inject_action")).Should().Be(1, "only A's own create");
    }

    [RequiresDockerFact]
    public async Task ACrossExercisePersona_GetsTheUnknownPersonaResponse()
    {
        await using var host = await StartAsync();
        var (a, b, _) = await TwoExercisesAsync(host);
        host.ActAs(b.ExerciseId, b.StaffUserId);

        var cross = await host.CreateAsync(InjectTestHost.PostItem(a.PersonaIds[0]));
        var unknown = await host.CreateAsync(InjectTestHost.PostItem(Guid.NewGuid()));

        cross.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemAsync(cross)).Should().Be(await ProblemAsync(unknown), "the same 400 for an unknown and a cross-exercise persona");
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseScriptedReplyTarget_GetsTheUnknownTargetResponse()
    {
        await using var host = await StartAsync();
        var (_, b, aItem) = await TwoExercisesAsync(host);
        host.ActAs(b.ExerciseId, b.StaffUserId);

        var cross = await host.CreateAsync(InjectTestHost.PostItem(b.PersonaIds[0], "reply", new { injectPostId = aItem.Posts[0].Id }));
        var unknown = await host.CreateAsync(InjectTestHost.PostItem(b.PersonaIds[0], "reply", new { injectPostId = Guid.NewGuid().ToString() }));

        cross.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await ProblemAsync(cross)).Should().Be(await ProblemAsync(unknown));
    }

    [RequiresDockerFact]
    public async Task AReorderNamingAnotherExercisesItem_IsRefused()
    {
        await using var host = await StartAsync();
        var (_, b, aItem) = await TwoExercisesAsync(host);
        host.ActAs(b.ExerciseId, b.StaffUserId);
        var bItem = await host.CreateOkAsync(InjectTestHost.PostItem(b.PersonaIds[0]));

        var response = await host.Client.PostAsJsonAsync(new Uri("/api/injects/reorder", UriKind.Relative), new { ids = new[] { bItem.Id, aItem.Id } });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task TheCentralFilter_FailsClosed_ForAnotherAndAnUnsetScope_AndTheRowsDoExist()
    {
        await using var host = await StartAsync();
        var (a, b, aItem) = await TwoExercisesAsync(host);

        await using (var bDb = host.Db(b.ExerciseId))
        {
            (await bDb.InjectItems.CountAsync()).Should().Be(0, "another exercise's scope sees zero items");
            (await bDb.InjectItemPosts.CountAsync()).Should().Be(0, "and zero scripted posts");
            (await bDb.InjectItems.FindAsync(aItem.Guid)).Should().BeNull("an IDOR by known id resolves to nothing");
            (await bDb.InjectItemPosts.SingleOrDefaultAsync(p => p.Id == Guid.Parse(aItem.Posts[0].Id))).Should().BeNull();
            (await bDb.InjectItems.IgnoreQueryFilters().CountAsync(i => i.Id == aItem.Guid))
                .Should().Be(1, "the row exists — the zero above is the filter closing the door, not an empty table");
        }

        await using (var unscoped = host.Db(exerciseId: null))
        {
            (await unscoped.InjectItems.CountAsync()).Should().Be(0, "an unset scope collapses to Guid.Empty and matches nothing");
            (await unscoped.InjectItemPosts.CountAsync()).Should().Be(0);
        }

        await using (var emptyScope = host.Db(Guid.Empty))
        {
            (await emptyScope.InjectItems.CountAsync()).Should().Be(0);
        }

        await using var aDb = host.Db(a.ExerciseId);
        (await aDb.InjectItems.CountAsync()).Should().Be(1);
        (await aDb.InjectItemPosts.CountAsync()).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task TheWriteGuard_RefusesAnInjectRowWithNoExercise()
    {
        await using var host = await StartAsync();
        await using var db = host.Db(exerciseId: null);
        db.InjectItems.Add(new InjectItem
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.Empty,
            Kind = "post",
            Title = "orphan",
            Status = "pending",
        });

        var act = () => db.SaveChangesAsync();

        await act.Should().ThrowAsync<Pulse.WebApi.Data.ExerciseScopeViolationException>();
    }

    // ---- helpers ----

    private async Task<InjectTestHost> StartAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(_fixture.ConnectionString!);
    }

    private static async Task<(SeededExercise A, SeededExercise B, WireItem AItem)> TwoExercisesAsync(InjectTestHost host)
    {
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        host.ActAs(a.ExerciseId, a.StaffUserId);
        var aItem = await host.CreateOkAsync(InjectTestHost.PostItem(a.PersonaIds[0]));
        return (a, b, aItem);
    }

    private static async Task<(int Status, string? Detail, bool HasItem)> ProblemAsync(System.Net.Http.HttpResponseMessage response)
    {
        var problem = await InjectTestHost.ReadProblemAsync(response);
        return (problem.Status, problem.Detail, problem.Item is not null);
    }
}
