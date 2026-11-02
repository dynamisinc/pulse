namespace Pulse.WebApi.Tests.Features.Weather.Zones;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Weather.Zones;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// COR-001 / XC-001 for the weather zone API on real SQL, the always-Critical guarantee. Exercise B can neither read nor
/// touch exercise A's zones; every cross-exercise zone id gets EXACTLY the response an unknown id gets; at the data layer the
/// central filter fails closed (zero rows for another or an unset scope, while <c>IgnoreQueryFilters</c> proves the rows
/// exist). The F20 conformance kit is not built yet (foundation wave 5); weather story 14 registers these routes with it.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class WeatherZoneIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public WeatherZoneIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ExerciseB_ReadsNoneOfExerciseAsZones_OnEitherList()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        await host.AddZoneAsync(a.ExerciseId, "a-only-zone", isDefault: true);
        await host.AddZoneAsync(a.ExerciseId, "shared-slug");
        await host.AddZoneAsync(b.ExerciseId, "shared-slug", isDefault: true);

        host.ActAs(b.ExerciseId, staffUserId: null);
        var list = (await (await host.GetAsync("/api/weather/zones")).Content.ReadFromJsonAsync<List<WireZone>>())!;
        list.Should().ContainSingle().Which.Should().Be(new WireZone("shared-slug", "shared-slug", "county", true));

        host.ActAs(b.ExerciseId, b.StaffUserId);
        var staff = (await (await host.GetAsync("/api/weather/zones/staff")).Content.ReadFromJsonAsync<WireZoneStaffList>())!;
        staff.Zones.Should().ContainSingle().Which.Slug.Should().Be("shared-slug");
    }

    [RequiresDockerFact]
    public async Task ACrossExerciseZoneId_GetsTheUnknownIdResponse_OnEveryWrite_AndTouchesNothing()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var b = await host.SeedExerciseAsync();
        var aZone = await host.AddZoneAsync(a.ExerciseId, "kestrel-county-north", isDefault: true);
        var unknown = Guid.NewGuid();
        host.ActAs(b.ExerciseId, b.StaffUserId);

        var edit = WeatherZoneTestHost.Body(name: "hijack", version: 1);
        var crossEdit = await WeatherZoneTestHost.ProblemAsync(await host.PutAsync(aZone.Id, edit));
        crossEdit.Should().Be(await WeatherZoneTestHost.ProblemAsync(await host.PutAsync(unknown, edit)));
        crossEdit.Status.Should().Be(404);
        crossEdit.Detail.Should().Be(WeatherZoneResult.NotFoundMessage);
        (await WeatherZoneTestHost.ProblemAsync(await host.DeleteAsync(aZone.Id, 1)))
            .Should().Be(await WeatherZoneTestHost.ProblemAsync(await host.DeleteAsync(unknown, 1)));

        // A's slug is free in B: slugs are unique per exercise, and B's create must not reveal A's zone.
        (await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body())).StatusCode.Should().Be(HttpStatusCode.Created);

        await using var aDb = host.Db(a.ExerciseId);
        var untouched = await aDb.WeatherZones.SingleAsync(z => z.Id == aZone.Id);
        untouched.Name.Should().Be("kestrel-county-north");
        untouched.Version.Should().Be(1);
        untouched.IsDefault.Should().BeTrue("B's first zone never cleared A's default");
        untouched.DeletedAt.Should().BeNull();
        (await host.ZoneEventsAsync(a.ExerciseId)).Should().BeEmpty();
        (await host.ZoneEventsAsync(b.ExerciseId)).Should().ContainSingle().Which.ExerciseId.Should().Be(b.ExerciseId);
    }

    [RequiresDockerFact]
    public async Task TheCentralFilter_FailsClosed_ForAnotherOrAnUnsetScope_WhileTheRowsExist()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var a = await host.SeedExerciseAsync();
        var zone = await host.AddZoneAsync(a.ExerciseId, "kestrel-county-north", isDefault: true);
        await host.AddZoneAsync(a.ExerciseId, "retired", sortOrder: 2, deleted: true);

        await using (var other = host.Db(Guid.NewGuid()))
        {
            (await other.WeatherZones.CountAsync()).Should().Be(0);
            (await other.WeatherZones.FindAsync(zone.Id)).Should().BeNull("an IDOR by a known id finds nothing");
            (await other.IncludingSoftDeleted<WeatherZone>().CountAsync()).Should().Be(0, "the deleted-rows view keeps the exercise scope");
        }

        await using (var unset = host.Db(exerciseId: null))
        {
            (await unset.WeatherZones.CountAsync()).Should().Be(0, "an unset scope sees zero rows, never all exercises");
            (await unset.WeatherZones.IgnoreQueryFilters().AnyAsync(z => z.Id == zone.Id)).Should().BeTrue("the zero is the filter, not an empty table");
        }

        await using (var own = host.Db(a.ExerciseId))
        {
            (await own.WeatherZones.CountAsync()).Should().Be(1, "the soft-delete filter hides the retired zone");
            (await own.IncludingSoftDeleted<WeatherZone>().CountAsync()).Should().Be(2);
        }

        host.ActAs(exerciseId: null, staffUserId: a.StaffUserId);
        (await host.GetAsync("/api/weather/zones")).StatusCode.Should().Be(HttpStatusCode.NotFound, "no scope: the channel gate fails closed");
        (await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "x"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
