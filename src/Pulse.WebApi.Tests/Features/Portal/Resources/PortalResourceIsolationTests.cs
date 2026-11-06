namespace Pulse.WebApi.Tests.Features.Portal.Resources;

using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// XC-001 (always-Critical) over the Resources shelf (exercise-portal story 04), in the standing isolation-suite style:
/// two exercises on one real database. A reads none of B's resources, an id of A presented in B is the unknown-id answer
/// on every route, and a write aimed at it touches nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PortalResourceIsolationTests
{
    private const string Route = PortalResourceTestHost.Route;

    private readonly MsSqlContainerFixture _fixture;

    public PortalResourceIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ExerciseB_ReadsNoneOfExerciseAsResources_AndAnAIdIsTheUnknown404()
    {
        await using var host = await PortalResourceTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var aRow = await host.AddResourceAsync(a.ExerciseId, "A only", sortOrder: 1);
        var bRow = await host.AddResourceAsync(b.ExerciseId, "B own", sortOrder: 1);

        host.ActAs(b.ExerciseId, staffUserId: null);
        var list = (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireResource>>())!;
        list.Should().ContainSingle().Which.Id.Should().Be(bRow.Id.ToString(), "B sees only B's resources (COR-001)");

        var unknown = await host.GetAsync($"{Route}/{Guid.NewGuid()}");
        var crossExercise = await host.GetAsync($"{Route}/{aRow.Id}");
        crossExercise.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());

        host.ActAs(b.ExerciseId, b.StaffUserId);
        var staffList = (await (await host.GetAsync(Route)).Content.ReadFromJsonAsync<List<WireStaffResource>>())!;
        staffList.Should().ContainSingle().Which.Id.Should().Be(bRow.Id.ToString());
        (await host.GetAsync($"{Route}/{aRow.Id}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseId_IsNotFoundOnEveryWrite_AndTouchesNothing()
    {
        await using var host = await PortalResourceTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var aRow = await host.AddResourceAsync(a.ExerciseId, "A only", sortOrder: 1);
        var bRow = await host.AddResourceAsync(b.ExerciseId, "B own", sortOrder: 1);
        host.ActAs(b.ExerciseId, b.StaffUserId);

        (await host.PutAsync(aRow.Id, PortalResourceTestHost.Body(title: "Hijacked", version: 1)))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.DeleteAsync(aRow.Id)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await host.PostAsync($"{Route}/reorder", new { orderedIds = new[] { aRow.Id, bRow.Id } }))
            .StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await using var db = host.Db(a.ExerciseId);
        var untouched = await db.PortalResources.AsNoTracking().SingleAsync(r => r.Id == aRow.Id);
        untouched.Title.Should().Be("A only");
        untouched.Version.Should().Be(1);
        untouched.DeletedAt.Should().BeNull();
        untouched.SortOrder.Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task AStaffMemberOfA_ActingInB_IsRefused()
    {
        await using var host = await PortalResourceTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        await host.AddResourceAsync(b.ExerciseId, "B own", sortOrder: 1);
        host.ActAs(b.ExerciseId, a.StaffUserId);

        (await host.PostAsync(Route, PortalResourceTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var read = await host.GetAsync(Route);
        read.StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        (await read.Content.ReadAsStringAsync()).Should().NotContain("B own");

        await using var db = host.Db(b.ExerciseId);
        (await db.PortalResources.CountAsync()).Should().Be(1);
    }
}
