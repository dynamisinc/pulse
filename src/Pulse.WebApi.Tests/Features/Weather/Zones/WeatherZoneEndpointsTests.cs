namespace Pulse.WebApi.Tests.Features.Weather.Zones;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Weather.Zones;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Weather story 02 (#753) over HTTP on real SQL: the participant read behind <c>RequireChannelEnabled("weather")</c>, the
/// staff CRUD behind the shipped staff and controller gates, the 409s (stale version, race at the save, the real unique
/// slug index), the change and its <c>weather_zone_changed</c> event in one <c>SaveChanges</c>, and no auto-created zone.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class WeatherZoneEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public WeatherZoneEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TheParticipantRead_ServesTheFourFieldList_OnlyWhileWeatherIsEnabled()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var on = await host.SeedExerciseAsync();
        var off = await host.SeedExerciseAsync(enabledChannels: "social,news");
        await host.AddZoneAsync(on.ExerciseId, "harbor-point", sortOrder: 2);
        await host.AddZoneAsync(on.ExerciseId, "kestrel-county-north", sortOrder: 1, isDefault: true);
        await host.AddZoneAsync(off.ExerciseId, "kestrel-county-north", isDefault: true);

        host.ActAs(on.ExerciseId, staffUserId: null);
        var response = await host.GetAsync("/api/weather/zones");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()))
        {
            json.RootElement.EnumerateArray().Select(z => z.GetProperty("slug").GetString()).Should().Equal("kestrel-county-north", "harbor-point");
            json.RootElement[0].EnumerateObject().Select(p => p.Name).Should().Equal(
                ["slug", "name", "kind", "isDefault"], "no exerciseId, id, version, acting human or wall clock (XC-002)");
        }

        host.ActAs(off.ExerciseId, staffUserId: null);
        var disabled = await host.GetAsync("/api/weather/zones");
        var unknownRoute = await host.GetAsync("/api/weather/no-such-route");
        disabled.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (disabled.StatusCode, await disabled.Content.ReadAsStringAsync())
            .Should().Be((unknownRoute.StatusCode, await unknownRoute.Content.ReadAsStringAsync()),
                "a disabled channel is indistinguishable from an unknown route");
    }

    [RequiresDockerFact]
    public async Task TheStaffRoutes_RefuseParticipants401_UnassignedStaff403_AndNonControllerWrites403()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        var elsewhere = await host.SeedExerciseAsync();
        var evaluator = await host.AddStaffAsync(seeded.ExerciseId, "evaluator");
        var zone = await host.AddZoneAsync(seeded.ExerciseId, "kestrel-county-north", isDefault: true);

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await host.GetAsync("/api/weather/zones/staff")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "p"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PutAsync(zone.Id, WeatherZoneTestHost.Body(version: 1))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.DeleteAsync(zone.Id, 1)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        host.ActAs(seeded.ExerciseId, elsewhere.StaffUserId);
        (await host.GetAsync("/api/weather/zones/staff")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "u"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(seeded.ExerciseId, evaluator);
        (await host.GetAsync("/api/weather/zones/staff")).StatusCode.Should().Be(HttpStatusCode.OK, "any assigned staff role reads");
        (await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "e"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.DeleteAsync(zone.Id, 1)).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        await using var db = host.Db(seeded.ExerciseId);
        (await db.WeatherZones.CountAsync()).Should().Be(1, "no refused write touched anything");
        (await host.ZoneEventsAsync(seeded.ExerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Crud_OverHttp_KeepsOneDefault_AndEachChangeSavesWithItsEvent()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var empty = (await (await host.GetAsync("/api/weather/zones/staff")).Content.ReadFromJsonAsync<WireZoneStaffList>())!;
        empty.Should().BeEquivalentTo(new WireZoneStaffList([], false, "no_zones"));

        host.Saves.Clear();
        var north = await host.CreateOkAsync(new
        {
            exerciseId = Guid.NewGuid(), // ignored: scope comes only from the session (COR-001)
            slug = "kestrel-county-north",
            name = "Kestrel County (North)",
            kind = "county",
        });
        north.IsDefault.Should().BeTrue("the first zone is the default");
        host.Saves.All.Should().ContainSingle(save => save.Any(e => e.Entity == nameof(WeatherZone)))
            .Which.Should().Contain((nameof(WeatherZone), "Added")).And.Contain((nameof(TelemetryEvent), "Added"), "XC-004: same unit of work");

        var harbor = await host.CreateOkAsync(WeatherZoneTestHost.Body(slug: "harbor-point", name: "Harbor Point", kind: "city"));
        harbor.IsDefault.Should().BeFalse();

        var moved = await host.PutAsync(harbor.Guid, WeatherZoneTestHost.Body(slug: "harbor-point", name: "Harbor Point", kind: "city", isDefault: true, version: 1));
        moved.StatusCode.Should().Be(HttpStatusCode.OK);
        (await moved.Content.ReadFromJsonAsync<WireZoneStaff>())!.Should().Match<WireZoneStaff>(z => z.IsDefault && z.Version == 2);

        var stale = await WeatherZoneTestHost.ProblemAsync(await host.PutAsync(north.Guid, WeatherZoneTestHost.Body(name: "x", version: 1)));
        stale.Status.Should().Be(409, "moving the default bumped the old default's version");
        stale.Item!.Version.Should().Be(2);
        stale.Item.IsDefault.Should().BeFalse();

        host.Saves.Clear();
        (await host.DeleteAsync(harbor.Guid, 2)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        host.Saves.All.Should().ContainSingle(save => save.Any(e => e.Entity == nameof(WeatherZone)))
            .Which.Should().Contain((nameof(WeatherZone), "Modified")).And.Contain((nameof(TelemetryEvent), "Added"));

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var list = (await (await host.GetAsync("/api/weather/zones")).Content.ReadFromJsonAsync<List<WireZone>>())!;
        list.Should().Equal(new WireZone("kestrel-county-north", "Kestrel County (North)", "county", true));

        await using var db = host.Db(seeded.ExerciseId);
        (await db.IncludingSoftDeleted<WeatherZone>().SingleAsync(z => z.Id == harbor.Guid)).DeletedAt.Should().NotBeNull("XC-010: retained");
        (await host.ZoneEventsAsync(seeded.ExerciseId)).Select(e => JsonDocument.Parse(e.Payload!).RootElement.GetProperty("action").GetString())
            .Should().Equal("create", "create", "edit", "delete");
    }

    [RequiresDockerFact]
    public async Task ATakenSlug_LiveOrDeleted_Is409()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        await host.AddZoneAsync(seeded.ExerciseId, "retired", deleted: true);
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        await host.CreateOkAsync(WeatherZoneTestHost.Body());

        var live = await WeatherZoneTestHost.ProblemAsync(await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body()));
        var deleted = await WeatherZoneTestHost.ProblemAsync(await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "retired")));
        var invalid = await WeatherZoneTestHost.ProblemAsync(await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: "Not A Slug", kind: "state")));

        live.Status.Should().Be(409);
        deleted.Status.Should().Be(409);
        deleted.Detail.Should().Contain("stays reserved");
        invalid.Status.Should().Be(400);
        invalid.Detail.Should().Contain("slug").And.Contain("kind");
    }

    [RequiresDockerFact]
    public async Task ACreate_ThatLosesTheSlugRaceAtTheUniqueIndex_Is409()
    {
        var writer = new ConcurrentZoneSlugWriter();
        await using var host = await WeatherZoneTestHost.StartAsync(
            _fixture.ConnectionString!, services => services.AddSingleton<IInterceptor>(writer));
        writer.ConnectionString = host.ConnectionString;
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        var problem = await WeatherZoneTestHost.ProblemAsync(
            await host.PostAsync("/api/weather/zones", WeatherZoneTestHost.Body(slug: ConcurrentZoneSlugWriter.RacedSlug)));

        problem.Status.Should().Be(409);
        problem.Detail.Should().Contain("already used");
        (await host.ZoneEventsAsync(seeded.ExerciseId)).Should().BeEmpty("the losing create's event rolled back with it");
    }

    [RequiresDockerFact]
    public async Task AnEdit_ThatLosesTheRaceAtTheSave_Is409WithTheZoneAsTheOtherWriterLeftIt()
    {
        var bumper = new ConcurrentZoneVersionBumper();
        await using var host = await WeatherZoneTestHost.StartAsync(
            _fixture.ConnectionString!, services => services.AddSingleton<IInterceptor>(bumper));
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var zone = await host.CreateOkAsync(WeatherZoneTestHost.Body());
        bumper.Arm(zone.Guid, host.ConnectionString);

        var problem = await WeatherZoneTestHost.ProblemAsync(await host.PutAsync(zone.Guid, WeatherZoneTestHost.Body(name: "Lost edit", version: 1)));

        problem.Status.Should().Be(409);
        problem.Detail.Should().Be(WeatherZoneService.StaleVersionMessage);
        problem.Item!.Name.Should().Be(ConcurrentZoneVersionBumper.OtherName);
        problem.Item.Version.Should().Be(2);
        (await host.ZoneEventsAsync(seeded.ExerciseId)).Should().ContainSingle("only the create");
    }

    [RequiresDockerFact]
    public async Task AddingTheDefaultWeatherOutlet_CreatesNoZone()
    {
        await using var host = await WeatherZoneTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        (await host.PostAsync("/api/outlets/defaults", new { channelId = "weather" })).StatusCode.Should().Be(HttpStatusCode.OK);

        var list = (await (await host.GetAsync("/api/weather/zones/staff")).Content.ReadFromJsonAsync<WireZoneStaffList>())!;
        list.Zones.Should().BeEmpty("no zone is auto-created with the Weather Desk outlet (Q6)");
        list.AuthoringBlockedReason.Should().Be("no_zones");
    }
}
