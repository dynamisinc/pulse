namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

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
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// The <c>/api/outlets*</c> contract over HTTP (channels-foundation story 03), real SQL: the participant reads and
/// their one 404, the channel gate, the staff/controller gate, create/edit/stale/delete/reorder with their one
/// <c>outlet_action</c> event in the same save, the validation 400s and the slug 409. Cross-exercise isolation has its
/// own class (<see cref="OutletIsolationTests"/>); defaults have <see cref="OutletDefaultsTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OutletEndpointsTests
{
    private readonly MsSqlContainerFixture _fixture;

    public OutletEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- participant reads (AC "Read", "Channel gate", "No exercise-identifying leakage") -------------

    [RequiresDockerFact]
    public async Task List_ReturnsTheChannelsEnabledOutlets_OrderedBySortOrderThenName()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        await host.AddOutletAsync(seeded.ExerciseId, "news", "zeta", "Zeta", sortOrder: 1);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "alpha", "Alpha", sortOrder: 1);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "first", "First", sortOrder: 0);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "hidden", enabled: false);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "gone", deleted: true);
        await host.AddOutletAsync(seeded.ExerciseId, "press", "wire-room");
        host.ActAs(seeded.ExerciseId, staffUserId: null); // a participant: scope only, no staff session

        var response = await host.GetAsync("/api/outlets?channel=news");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var outlets = (await response.Content.ReadFromJsonAsync<List<WireOutlet>>())!;
        outlets.Select(o => o.Slug).Should().Equal(["first", "alpha", "zeta"], "enabled, non-deleted, this channel only, by sortOrder then name");
        outlets[0].HomeRoute.Should().Be("/news/first");
        outlets[0].Categories.Should().Equal("Local");
    }

    [RequiresDockerFact]
    public async Task TheParticipantWireShape_CarriesNoStaffOrExerciseField_AndAHostRelativeHomeRoute()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        await host.AddOutletAsync(seeded.ExerciseId, "news", "metro-desk-9");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        foreach (var path in new[] { "/api/outlets?channel=news", "/api/outlets/metro-desk-9" })
        {
            var json = await (await host.GetAsync(path)).Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(json);
            var item = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement[0] : document.RootElement;
            item.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                ["id", "channelId", "slug", "name", "tagline", "parentOutletId", "pairedPersonaId", "logo", "categories", "skinKey",
                 "skinOverrides", "homeRoute"],
                "XC-002: {0} carries no exerciseId, enabled, version, sortOrder, logoMediaId, deletedAt or wall clock", path);
            json.Should().NotContain(seeded.ExerciseId.ToString(), "no exercise id anywhere in a participant body");
            ChannelVocabulary.IsHostRelativePath(item.GetProperty("homeRoute").GetString()).Should().BeTrue("FC-9.3");
        }
    }

    [RequiresDockerFact]
    public async Task GetBySlug_ReturnsOne_AndChannelDisambiguatesASharedSlug()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var press = await host.AddOutletAsync(seeded.ExerciseId, "press", "daily", "Press Daily");
        var news = await host.AddOutletAsync(seeded.ExerciseId, "news", "daily", "News Daily");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        (await ReadOutletAsync(host, "/api/outlets/daily")).Id.Should().Be(news.Id.ToString(), "without ?channel=, the first channel in ChannelIds order (news) wins");
        (await ReadOutletAsync(host, "/api/outlets/daily?channel=press")).Id.Should().Be(press.Id.ToString());
        (await ReadOutletAsync(host, "/api/outlets/daily?channel=news")).HomeRoute.Should().Be("/news/daily");
    }

    [RequiresDockerFact]
    public async Task DisabledDeletedAndUnknownOutlets_AndUnknownChannels_AllAnswerTheOneIdentical404()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        await host.AddOutletAsync(seeded.ExerciseId, "news", "hidden", enabled: false);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "gone", deleted: true);
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        var unknown = await host.GetAsync("/api/outlets/never-existed");
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        var expected = await OutletTestHost.ProblemAsync(unknown);
        expected.Detail.Should().Be(OutletResult.NotFoundMessage);

        foreach (var path in new[]
                 {
                     "/api/outlets/hidden", "/api/outlets/gone", "/api/outlets/hidden?channel=news", "/api/outlets/NOT_A_SLUG",
                     "/api/outlets/never-existed?channel=tv", "/api/outlets?channel=tv", "/api/outlets?channel=social",
                     "/api/outlets?channel=portal", "/api/outlets", "/api/outlets?channel=News", "/api/outlets/hidden?channel=NEWS",
                 })
        {
            (await OutletTestHost.ProblemAsync(await host.GetAsync(path))).Should().Be(expected, "{0} must be indistinguishable from an unknown outlet", path);
        }
    }

    [RequiresDockerFact]
    public async Task ADisabledChannel_Is404_OnTheListAndTheSlugRead()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync(enabledChannels: "social,press");
        await host.AddOutletAsync(seeded.ExerciseId, "news", "metro-desk-9");
        await host.AddOutletAsync(seeded.ExerciseId, "press", "wire-room");
        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var expected = await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets/never-existed"));

        (await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets?channel=news"))).Should().Be(expected, "news is not enabled");
        (await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets/metro-desk-9"))).Should().Be(expected);
        (await host.GetAsync("/api/outlets?channel=press")).StatusCode.Should().Be(HttpStatusCode.OK, "press is enabled");
    }

    [RequiresDockerFact]
    public async Task AnUnconfiguredExercise_EnablesOnlySocial_SoEveryOutletReadIs404()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync(enabledChannels: null);
        await host.AddOutletAsync(seeded.ExerciseId, "news", "metro-desk-9");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        (await host.GetAsync("/api/outlets?channel=news")).StatusCode.Should().Be(HttpStatusCode.NotFound, "ChannelCatalog.DefaultEnabledIds is social only");
    }

    [RequiresDockerFact]
    public async Task AResolvedScopeWithNoExerciseRow_FallsBackToTheDefaultSet_SoNewsIs404()
    {
        await using var host = await StartAsync();
        host.ActAs(Guid.NewGuid(), staffUserId: null);

        (await host.GetAsync("/api/outlets?channel=news")).StatusCode.Should().Be(
            HttpStatusCode.NotFound, "the F08 rule: no exercise row means ChannelCatalog.DefaultEnabledIds (social only), never an empty 200");
    }

    [RequiresDockerFact]
    public async Task AnUnresolvedScope_Is401_OnTheReads()
    {
        await using var host = await StartAsync();
        host.ActAs(exerciseId: null, staffUserId: null);

        (await host.GetAsync("/api/outlets?channel=news")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.GetAsync("/api/outlets/metro-desk-9")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---- the staff gate (AC "Staff write") ------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ParticipantsAndAnonymousCallers_Get401_OnEveryStaffRoute()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var outlet = await host.AddOutletAsync(seeded.ExerciseId, "news", "metro-desk-9");
        host.ActAs(seeded.ExerciseId, staffUserId: null);

        (await host.GetAsync("/api/outlets/staff")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "x"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PutAsync(outlet.Id, OutletTestHost.Body(version: 1))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.DeleteAsync(outlet.Id, 1)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids = new[] { outlet.Id } })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await host.PostAsync("/api/outlets/defaults", new { channelId = "news" })).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await using var db = host.Db(seeded.ExerciseId);
        (await db.Outlets.CountAsync()).Should().Be(1, "nothing was written");
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnEvaluator_MayListTheStaffView_ButNotWrite_AndAnUnassignedStaffUserIs403()
    {
        await using var host = await StartAsync();
        var seeded = await host.SeedExerciseAsync();
        var other = await host.SeedExerciseAsync();
        var outlet = await host.AddOutletAsync(seeded.ExerciseId, "news", "metro-desk-9", enabled: false);
        var evaluator = await host.AddStaffAsync(seeded.ExerciseId, "evaluator");
        host.ActAs(seeded.ExerciseId, evaluator);

        var staffList = await host.GetAsync("/api/outlets/staff?channel=news");
        staffList.StatusCode.Should().Be(HttpStatusCode.OK);
        (await staffList.Content.ReadFromJsonAsync<List<WireStaffOutlet>>())!.Should().ContainSingle()
            .Which.Enabled.Should().BeFalse("the staff view includes disabled outlets");
        (await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "x"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PutAsync(outlet.Id, OutletTestHost.Body(version: 1))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.DeleteAsync(outlet.Id, 1)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids = new[] { outlet.Id } })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await host.PostAsync("/api/outlets/defaults", new { channelId = "news" })).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(seeded.ExerciseId, other.StaffUserId);
        (await host.GetAsync("/api/outlets/staff")).StatusCode.Should().Be(HttpStatusCode.Forbidden, "not assigned to this exercise");
        (await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "x"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task TheStaffList_RejectsANonContentChannel()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);

        (await OutletTestHost.ProblemAsync(await host.GetAsync("/api/outlets/staff?channel=social"))).Status.Should().Be(400);
        (await host.GetAsync("/api/outlets/staff")).StatusCode.Should().Be(HttpStatusCode.OK, "without a channel it lists every content channel");
    }

    // ---- create / edit / delete (AC "Staff write", "Telemetry") ---------------------------------------

    [RequiresDockerFact]
    public async Task Create_Returns201_StampsScopeFromTheSession_AndEmitsOneEventInTheSameSave()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var foreignExercise = Guid.NewGuid();
        await host.AddOutletAsync(seeded.ExerciseId, "news", "existing", sortOrder: 4);
        host.Saves.Clear();

        var response = await host.PostAsync("/api/outlets", new
        {
            exerciseId = foreignExercise, // ignored: scope comes only from the session (COR-001)
            channelId = "news",
            slug = "metro-desk-9",
            name = " Metro Desk 9 ",
            tagline = "On your side.",
            categories = new[] { "Local", "Traffic" },
            skinKey = "newsline7",
            skinOverrides = new { palette = new { accent = "#c8102e" } },
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        var created = (await response.Content.ReadFromJsonAsync<WireStaffOutlet>())!;
        created.Name.Should().Be("Metro Desk 9");
        created.Version.Should().Be(1);
        created.Enabled.Should().BeTrue("a new outlet is enabled by default");
        created.SortOrder.Should().Be(5, "after the channel's last outlet");
        created.Categories.Should().Equal("Local", "Traffic");
        created.SkinOverrides!.Value.GetProperty("palette").GetProperty("accent").GetString().Should().Be("#c8102e");
        created.HomeRoute.Should().Be("/news/metro-desk-9");

        await using (var db = host.Db(seeded.ExerciseId))
        {
            var row = await db.Outlets.SingleAsync(o => o.Id == created.Guid);
            row.ExerciseId.Should().Be(seeded.ExerciseId, "stamped from the resolved scope, never the body");
            row.SkinOverridesJson.Should().Be("""{"palette":{"accent":"#c8102e"}}""");
        }

        await using (var foreign = host.Db(foreignExercise))
        {
            (await foreign.Outlets.CountAsync()).Should().Be(0);
        }

        var events = await host.OutletEventsAsync(seeded.ExerciseId);
        var created1 = events.Should().ContainSingle().Subject;
        created1.Channel.Should().Be("system");
        created1.Actor.Kind.Should().Be("system");
        created1.Actor.ActingHumanId.Should().Be(seeded.StaffUserId.ToString(), "the staff user from the session (COR-018)");
        created1.Target!.EntityType.Should().Be("outlet");
        created1.Target.EntityId.Should().Be(created.Id);
        created1.Origin.Should().BeNull();
        created1.TimeZone.Should().Be("America/Chicago");
        PayloadOf(created1).Should().BeEquivalentTo(new Dictionary<string, string> { ["action"] = "create", ["channelId"] = "news" });

        host.Saves.All.Should().ContainSingle(save => save.Any(e => e.Entity == nameof(Outlet)))
            .Which.Should().Contain((nameof(Outlet), "Added")).And.Contain((nameof(TelemetryEvent), "Added"), "XC-004: same unit of work");
    }

    [RequiresDockerFact]
    public async Task Edit_ReplacesFields_BumpsTheVersion_AndEmitsOneEditEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());
        host.Saves.Clear();

        var response = await host.PutAsync(outlet.Guid, new
        {
            slug = "metro-desk-9",
            name = "Metro Desk Nine",
            skinKey = "newsline7",
            categories = new[] { "Local" },
            enabled = false,
            version = 1,
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var edited = (await response.Content.ReadFromJsonAsync<WireStaffOutlet>())!;
        edited.Version.Should().Be(2);
        edited.Name.Should().Be("Metro Desk Nine");
        edited.Tagline.Should().BeNull("an omitted optional field is cleared by the PUT");
        edited.Enabled.Should().BeFalse();
        edited.SortOrder.Should().Be(outlet.SortOrder, "an omitted sortOrder keeps its value");
        edited.ChannelId.Should().Be("news");

        var events = await host.OutletEventsAsync(seeded.ExerciseId);
        events.Should().HaveCount(2);
        PayloadOf(events[1])["action"].Should().Be("edit");
        host.Saves.All.Should().ContainSingle(save => save.Any(e => e.Entity == nameof(Outlet)))
            .Which.Should().Contain((nameof(TelemetryEvent), "Added"));

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await host.GetAsync("/api/outlets/metro-desk-9")).StatusCode.Should().Be(HttpStatusCode.NotFound, "now disabled");
    }

    [RequiresDockerFact]
    public async Task Edit_ThatChangesTheSlug_Is400_AndChangesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());

        var problem = await OutletTestHost.ProblemAsync(await host.PutAsync(outlet.Guid, OutletTestHost.Body(slug: "metro-desk-nine", version: 1)));

        problem.Status.Should().Be(400);
        problem.Detail.Should().Be("slug cannot be changed after the outlet is created (permalink stability, NWS-011).");
        await using var db = host.Db(seeded.ExerciseId);
        (await db.Outlets.SingleAsync(o => o.Id == outlet.Guid)).Should().Match<Outlet>(o => o.Slug == "metro-desk-9" && o.Version == 1);
    }

    [RequiresDockerFact]
    public async Task Edit_ThatLosesTheRaceAtTheSave_Is409_WithTheCurrentItem()
    {
        // The version check passes, then another writer bumps the row before the UPDATE runs: the EF concurrency token
        // (Version) matches no row, and the service answers 409 with the outlet as the other writer left it.
        var bumper = new ConcurrentVersionBumper();
        await using var host = await StartAsync(services => services.AddSingleton<IInterceptor>(bumper));
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());
        bumper.Arm(outlet.Guid, host.ConnectionString);

        var problem = await OutletTestHost.ProblemAsync(await host.PutAsync(outlet.Guid, OutletTestHost.Body(name: "Lost edit", version: 1)));

        problem.Status.Should().Be(409);
        problem.Detail.Should().Be(OutletService.StaleVersionMessage);
        problem.Item!.Name.Should().Be(ConcurrentVersionBumper.OtherName);
        problem.Item.Version.Should().Be(2);
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().ContainSingle("only the create; the losing edit's event rolled back with it");
    }

    [RequiresDockerFact]
    public async Task Delete_ThatLosesTheRaceAtTheSave_Is409_AndDeletesNothing()
    {
        var bumper = new ConcurrentVersionBumper();
        await using var host = await StartAsync(services => services.AddSingleton<IInterceptor>(bumper));
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());
        bumper.Arm(outlet.Guid, host.ConnectionString);

        var problem = await OutletTestHost.ProblemAsync(await host.DeleteAsync(outlet.Guid, version: 1));

        problem.Status.Should().Be(409);
        problem.Item!.Version.Should().Be(2);
        await using var db = host.Db(seeded.ExerciseId);
        (await db.Outlets.AnyAsync(o => o.Id == outlet.Guid)).Should().BeTrue("the losing delete wrote nothing");
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().ContainSingle("only the create; the losing delete's event rolled back with it");
    }

    [RequiresDockerFact]
    public async Task Edit_WithAStaleVersion_Is409_WithTheCurrentItem_AndWritesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());
        (await host.PutAsync(outlet.Guid, OutletTestHost.Body(name: "First edit", version: 1))).StatusCode.Should().Be(HttpStatusCode.OK);

        var stale = await host.PutAsync(outlet.Guid, OutletTestHost.Body(name: "Lost edit", version: 1));

        var problem = await OutletTestHost.ProblemAsync(stale);
        problem.Status.Should().Be(409);
        problem.Detail.Should().Be(OutletService.StaleVersionMessage);
        problem.Item!.Name.Should().Be("First edit");
        problem.Item.Version.Should().Be(2);
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().HaveCount(2, "create + the first edit only");
    }

    [RequiresDockerFact]
    public async Task Edit_MissingVersion_OrAChannelChange_Is400()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());

        (await OutletTestHost.ProblemAsync(await host.PutAsync(outlet.Guid, OutletTestHost.Body()))).Detail.Should().Be("version is required.");
        (await OutletTestHost.ProblemAsync(await host.PutAsync(outlet.Guid, OutletTestHost.Body(channelId: "press", version: 1))))
            .Detail.Should().Be("channelId cannot be changed after the outlet is created.");
    }

    [RequiresDockerFact]
    public async Task Delete_SoftDeletes_HidesTheOutlet_KeepsTheSlugReserved_AndEmitsOneEvent()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var outlet = await host.CreateOkAsync(OutletTestHost.Body());

        (await OutletTestHost.ProblemAsync(await host.DeleteAsync(outlet.Guid, version: null))).Detail.Should().Be("version is required.");
        var stale = await OutletTestHost.ProblemAsync(await host.DeleteAsync(outlet.Guid, version: 7));
        stale.Status.Should().Be(409);
        stale.Item!.Version.Should().Be(1);

        (await host.DeleteAsync(outlet.Guid, version: 1)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        await using (var db = host.Db(seeded.ExerciseId))
        {
            (await db.Outlets.AnyAsync(o => o.Id == outlet.Guid)).Should().BeFalse("the soft-delete filter hides it");
            var row = await db.IncludingSoftDeleted<Outlet>().SingleAsync(o => o.Id == outlet.Guid);
            row.DeletedAt.Should().NotBeNull("XC-010: soft delete, never a hard delete");
            row.Version.Should().Be(2);
        }

        PayloadOf((await host.OutletEventsAsync(seeded.ExerciseId)).Last())["action"].Should().Be("delete");
        (await OutletTestHost.ProblemAsync(await host.PutAsync(outlet.Guid, OutletTestHost.Body(version: 2)))).Status.Should().Be(404);

        var recreate = await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body()));
        recreate.Status.Should().Be(409, "F01's slug index covers deleted rows: a permalink is never reused (NWS-011)");
        recreate.Detail.Should().Contain("stays reserved");
    }

    [RequiresDockerFact]
    public async Task ADuplicateSlugOnTheSameChannel_Is409_ButTheSameSlugOnAnotherChannelIsFine()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        await host.CreateOkAsync(OutletTestHost.Body());

        var duplicate = await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(name: "Copy")));
        duplicate.Status.Should().Be(409);
        duplicate.Detail.Should().Be("slug 'metro-desk-9' is already used by another news outlet in this exercise.");

        (await host.PostAsync("/api/outlets", OutletTestHost.Body(channelId: "press", skinKey: "wire-room"))).StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [RequiresDockerFact]
    public async Task ASlugLostToAConcurrentWriterAtTheIndex_IsTheSame409()
    {
        // Plays the race: just before the create's save, another writer inserts the same (exercise, channel, slug).
        // The service's pre-check passed; the UNIQUE index refuses the save; the service answers the slug 409.
        Guid? exerciseId = null;
        var injector = new ConcurrentSlugWriter(() => exerciseId);
        await using var host = await StartAsync(services => services.AddSingleton<IInterceptor>(injector));
        var seeded = await ActAsControllerAsync(host);
        exerciseId = seeded.ExerciseId;
        injector.ConnectionString = host.ConnectionString;

        var problem = await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: ConcurrentSlugWriter.RacedSlug)));

        problem.Status.Should().Be(409);
        problem.Detail.Should().Be($"slug '{ConcurrentSlugWriter.RacedSlug}' is already used by another news outlet in this exercise.");
        (await host.OutletEventsAsync(seeded.ExerciseId)).Should().BeEmpty("the losing save, event included, rolled back together");
    }

    // ---- reorder --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Reorder_SetsSortOrderByPosition_AndEmitsOneEventTargetingTheFirstOutlet()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var a = await host.CreateOkAsync(OutletTestHost.Body(slug: "a", name: "A"));
        var b = await host.CreateOkAsync(OutletTestHost.Body(slug: "b", name: "B"));
        var c = await host.CreateOkAsync(OutletTestHost.Body(slug: "c", name: "C"));
        await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "p", skinKey: "wire-room"));

        var response = await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids = new[] { c.Id, a.Id, b.Id } });

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var list = (await response.Content.ReadFromJsonAsync<List<WireStaffOutlet>>())!;
        list.Select(o => (o.Slug, o.SortOrder)).Should().Equal(("c", 1), ("a", 2), ("b", 3));
        list.Single(o => o.Slug == "a").Version.Should().Be(2, "its order changed, so its version moved");

        var reorder = (await host.OutletEventsAsync(seeded.ExerciseId)).Last();
        reorder.Target!.EntityType.Should().Be("outlet");
        reorder.Target.EntityId.Should().Be(c.Id, "the first outlet of the new order");
        using var payload = JsonDocument.Parse(reorder.Payload!);
        payload.RootElement.GetProperty("action").GetString().Should().Be("reorder");
        payload.RootElement.GetProperty("channelId").GetString().Should().Be("news");
        payload.RootElement.GetProperty("ids").EnumerateArray().Select(e => e.GetString()).Should().Equal(c.Id, a.Id, b.Id);
        (await host.OutletEventsAsync(seeded.ExerciseId)).Count(e => PayloadOf(e)["action"] == "reorder").Should().Be(1);

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await (await host.GetAsync("/api/outlets?channel=news")).Content.ReadFromJsonAsync<List<WireOutlet>>())!
            .Select(o => o.Slug).Should().Equal("c", "a", "b");
    }

    [RequiresDockerFact]
    public async Task Reorder_MustNameExactlyTheChannelsOutlets()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        var a = await host.CreateOkAsync(OutletTestHost.Body(slug: "a"));
        var b = await host.CreateOkAsync(OutletTestHost.Body(slug: "b"));
        var p = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "p", skinKey: "wire-room"));

        foreach (var ids in new[] { new[] { a.Id }, new[] { a.Id, a.Id }, new[] { a.Id, b.Id, p.Id }, new[] { a.Id, p.Id }, new[] { a.Id, "nope" } })
        {
            (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets/reorder", new { channelId = "news", ids })))
                .Detail.Should().Be(OutletService.ReorderListMessage);
        }

        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets/reorder", new { channelId = "social", ids = Array.Empty<string>() })))
            .Detail.Should().Be("channelId must be one of news, press, weather.");
    }

    // ---- validation (AC "Validation", "Scoop-only clutter") -------------------------------------------

    [RequiresDockerFact]
    public async Task Validation_ShapeErrors_AreReadable400s()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);

        async Task<string?> DetailAsync(object body) => (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", body))).Detail;

        (await DetailAsync(OutletTestHost.Body(categories: Enumerable.Range(0, 21).Select(i => $"c{i}"))))
            .Should().Be("categories may hold at most 20 entries.");
        (await DetailAsync(OutletTestHost.Body(skinOverrides: new { clutter = new[] { "SHOCKING" } })))
            .Should().Be("skinOverrides.clutter is only allowed for the tabloid skin ('the-scoop').");
        (await DetailAsync(OutletTestHost.Body(skinOverrides: new { ext = new { foo = new { a = 1 } } })))
            .Should().Be("skinOverrides.ext.foo is not an allowed namespace (news, press, weather, portal).");
        var oversized = new Dictionary<string, Dictionary<string, string>>
        {
            ["news"] = Enumerable.Range(0, 21).ToDictionary(i => $"k{i}", _ => new string('x', SkinOverridesValidator.MaxStringLength)),
        };
        (await DetailAsync(OutletTestHost.Body(skinOverrides: new { ext = oversized })))
            .Should().Be("skinOverrides exceeds the 4 KB cap.");
        (await DetailAsync(OutletTestHost.Body(slug: "Bad Slug"))).Should().Be("slug must be 1-80 characters of a-z, 0-9 and '-'.");
        (await DetailAsync(OutletTestHost.Body(channelId: "social"))).Should().Be("channelId must be one of news, press, weather.");

        (await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "the-scoop", skinKey: SkinOverridesValidator.TabloidSkinKey, skinOverrides: new { clutter = new[] { "SHOCKING" } })))
            .StatusCode.Should().Be(HttpStatusCode.Created, "clutter is the tabloid's");
    }

    [RequiresDockerFact]
    public async Task AParentMustBeAPressOutletOfThisExercise_AndNotItself()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        var wireRoom = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "wire-room", skinKey: "wire-room"));
        var news = await host.CreateOkAsync(OutletTestHost.Body(slug: "metro"));

        (await host.PostAsync("/api/outlets", OutletTestHost.Body(channelId: "press", slug: "kestrel-em", skinKey: "wire-room", parentOutletId: wireRoom.Id)))
            .StatusCode.Should().Be(HttpStatusCode.Created, "an org newsroom under The Wire Room");
        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(channelId: "press", slug: "child", skinKey: "wire-room", parentOutletId: news.Id))))
            .Detail.Should().Be(OutletService.ParentNotFoundMessage, "a news outlet cannot be a parent");
        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "news-child", parentOutletId: wireRoom.Id))))
            .Detail.Should().Be("parentOutletId is only allowed on a press outlet.", "the child must be on press too");
        (await OutletTestHost.ProblemAsync(await host.PutAsync(wireRoom.Guid, OutletTestHost.Body(channelId: "press", slug: "wire-room", skinKey: "wire-room", parentOutletId: wireRoom.Id, version: 1))))
            .Detail.Should().Be(OutletService.ParentCycleMessage);
    }

    [RequiresDockerFact]
    public async Task AnIndirectParentCycle_Is400()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        var b = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "b", skinKey: "wire-room"));
        var a = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "a", skinKey: "wire-room", parentOutletId: b.Id)); // A -> B

        var problem = await OutletTestHost.ProblemAsync(
            await host.PutAsync(b.Guid, OutletTestHost.Body(channelId: "press", slug: "b", skinKey: "wire-room", parentOutletId: a.Id, version: 1)));

        problem.Status.Should().Be(400);
        problem.Detail.Should().Be(OutletService.ParentCycleMessage, "B -> A would close the loop A -> B -> A");
    }

    [RequiresDockerFact]
    public async Task DeletingAnOutletWithLiveChildren_Is409_UntilTheChildrenAreGone()
    {
        await using var host = await StartAsync();
        await ActAsControllerAsync(host);
        var wireRoom = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "wire-room", skinKey: "wire-room"));
        var child = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "kestrel-em", skinKey: "wire-room", parentOutletId: wireRoom.Id));

        var problem = await OutletTestHost.ProblemAsync(await host.DeleteAsync(wireRoom.Guid, version: 1));
        problem.Status.Should().Be(409);
        problem.Detail.Should().Be("outlet has child outlets; delete or re-parent them first.");

        (await host.DeleteAsync(child.Guid, child.Version)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        (await host.DeleteAsync(wireRoom.Guid, version: 1)).StatusCode.Should().Be(HttpStatusCode.NoContent, "a deleted child no longer blocks");
    }

    [RequiresDockerFact]
    public async Task AParticipantNeverSeesAParentItCannotOpen()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var wireRoom = await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "wire-room", skinKey: "wire-room"));
        await host.CreateOkAsync(OutletTestHost.Body(channelId: "press", slug: "kestrel-em", skinKey: "wire-room", parentOutletId: wireRoom.Id));

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await ReadOutletAsync(host, "/api/outlets/kestrel-em")).ParentOutletId.Should().Be(wireRoom.Id, "the parent is served");

        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        (await host.PutAsync(wireRoom.Guid, OutletTestHost.Body(channelId: "press", slug: "wire-room", skinKey: "wire-room", enabled: false, version: 1)))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        (await ReadOutletAsync(host, "/api/outlets/kestrel-em")).ParentOutletId.Should().BeNull("a disabled parent would be a 404");
        (await (await host.GetAsync("/api/outlets?channel=press")).Content.ReadFromJsonAsync<List<WireOutlet>>())!
            .Should().ContainSingle().Which.ParentOutletId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task ALogo_MustBeAnImageOfThisExercise_AndIsServedAsASignedContentMedia()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var logo = await host.AddMediaAssetAsync(seeded.ExerciseId);
        var video = await host.AddMediaAssetAsync(seeded.ExerciseId, MediaKinds.Video);

        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(logoMediaId: video.ToString()))))
            .Detail.Should().Be(OutletService.LogoNotFoundMessage);

        var created = await host.CreateOkAsync(OutletTestHost.Body(logoMediaId: logo.ToString()));
        created.LogoMediaId.Should().Be(logo.ToString());
        created.Logo!.Url.Should().Be(FakeMediaUrlSigner.UrlFor(logo), "the existing media URL signing");

        host.ActAs(seeded.ExerciseId, staffUserId: null);
        var read = await ReadOutletAsync(host, "/api/outlets/metro-desk-9");
        read.Logo.Should().BeEquivalentTo(new WireLogo(logo.ToString(), "image", "inline", FakeMediaUrlSigner.UrlFor(logo), "image/png", 400, 120, "Metro Desk 9"));
    }

    [RequiresDockerFact]
    public async Task APairedPersona_MustBeOfThisExercise()
    {
        await using var host = await StartAsync();
        var seeded = await ActAsControllerAsync(host);
        var persona = await host.AddPersonaAsync(seeded.ExerciseId, "MetroDesk9");

        var created = await host.CreateOkAsync(OutletTestHost.Body(pairedPersonaId: persona.ToString()));
        created.PairedPersonaId.Should().Be(persona.ToString());
        (await OutletTestHost.ProblemAsync(await host.PostAsync("/api/outlets", OutletTestHost.Body(slug: "x", pairedPersonaId: Guid.NewGuid().ToString()))))
            .Detail.Should().Be(OutletService.PersonaNotFoundMessage);
    }

    // ---- helpers --------------------------------------------------------------------------------------

    private static async Task<WireOutlet> ReadOutletAsync(OutletTestHost host, string path)
    {
        var response = await host.GetAsync(path);
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0}: {1}", path, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<WireOutlet>())!;
    }

    internal static Dictionary<string, string> PayloadOf(TelemetryEvent telemetryEvent)
    {
        using var document = JsonDocument.Parse(telemetryEvent.Payload!);
        return document.RootElement.EnumerateObject()
            .Where(p => p.Value.ValueKind == JsonValueKind.String)
            .ToDictionary(p => p.Name, p => p.Value.GetString()!);
    }

    private async Task<SeededExercise> ActAsControllerAsync(OutletTestHost host)
    {
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return seeded;
    }

    private Task<OutletTestHost> StartAsync(Action<IServiceCollection>? configure = null) =>
        OutletTestHost.StartAsync(_fixture.ConnectionString!, configure);
}
