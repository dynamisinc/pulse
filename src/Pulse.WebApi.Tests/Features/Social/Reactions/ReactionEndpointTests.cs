namespace Pulse.WebApi.Tests.Features.Social.Reactions;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// End-to-end coverage of <c>PUT</c>/<c>DELETE /api/posts/{postId}/reactions/{kind}</c> (demo-polish B3) through the
/// REAL <c>Program</c> host and REAL SQL Server: idempotency with one event per state change, soft delete (DP-15),
/// the authorization matrix (DP-10, COR-015), the response shape (§1.5.4) and the server-stamped XC-004 events.
/// The reacting persona always comes from the persisted session; nothing overrides the exercise scope.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ReactionEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ReactionEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // AC: idempotent endpoints, one event per state change
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task PutTwice_Returns200WithTheSameState_OneActiveRow_OneEvent()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        var first = await client.PutAsync(ReactionUri(world.Post, "like"), content: null);
        var second = await client.PutAsync(ReactionUri(world.Post, "like"), content: null);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK, "liking an already-liked post succeeds; it is not an error");
        (await second.Content.ReadAsStringAsync()).Should().Be(
            await first.Content.ReadAsStringAsync(), "a repeat returns the same state");

        var json = await ReadJsonAsync(first);
        json.GetProperty("active").GetBoolean().Should().BeTrue();
        json.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(1);

        (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle(
            "a repeat creates no second row").Which.DeletedAt.Should().BeNull();
        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().ContainSingle(
            "the repeat changed no state, so it emitted no second telemetry event");
    }

    [RequiresDockerFact]
    public async Task DeleteTwice_Returns200WithTheSameState_OneSoftDeletedRow_OneUnlikeEvent()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);
        var first = await client.DeleteAsync(ReactionUri(world.Post, "like"));
        var second = await client.DeleteAsync(ReactionUri(world.Post, "like"));

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.OK, "un-liking a post that is not liked succeeds without error");
        (await second.Content.ReadAsStringAsync()).Should().Be(await first.Content.ReadAsStringAsync());
        (await ReadJsonAsync(first)).GetProperty("active").GetBoolean().Should().BeFalse();

        (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle(
            "the repeat un-like neither adds nor touches a row").Which.DeletedAt.Should().NotBeNull();

        var events = await ReadEventsAsync(_fixture, world.Exercise, "reaction");
        events.Should().HaveCount(2, "one like and one unlike: the repeat emitted nothing");
        events.Select(e => e.Payload).Should().Equal(
            "{\"reaction\":\"like\",\"liked\":true}", "{\"reaction\":\"like\",\"liked\":false}");
    }

    [RequiresDockerFact]
    public async Task DeleteWithNoReaction_Returns200Inactive_WritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.DeleteAsync(ReactionUri(world.Post, "repost"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(response)).GetProperty("active").GetBoolean().Should().BeFalse();
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
        (await ReadEventsAsync(_fixture, world.Exercise, "repost")).Should().BeEmpty();
    }

    [RequiresDockerTheory]
    [InlineData("love")]
    [InlineData("Like")]
    [InlineData("REPOST")]
    [InlineData("quote")]
    public async Task UnknownKind_Returns400_AndWritesNothing(string kind)
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PutAsync(ReactionUri(world.Post, kind), content: null)).StatusCode.Should().Be(
            HttpStatusCode.BadRequest, "kind must be exactly 'like' or 'repost'");
        (await client.DeleteAsync(ReactionUri(world.Post, kind))).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // DP-15: soft delete, re-like inserts a new row, counts and viewer read ACTIVE rows only
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Delete_SoftDeletes_TheRowRemainsWithDeletedAtInScenarioTime()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PutAsync(ReactionUri(world.Post, "like"), content: null);
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.OK);

        var row = (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle(
            "an un-like never hard-deletes (XC-010): the row stays as history").Subject;
        row.DeletedAt.Should().Be(
            world.ScenarioTime,
            "DeletedAt is SCENARIO time from the exercise (here its persisted instant), never the wall clock (DP-15)");
        row.PersonaId.Should().Be(world.Persona);
    }

    [RequiresDockerFact]
    public async Task ReLikeAfterUnlike_InsertsANewActiveRow_AndCountsAndViewerIgnoreTheInactiveOne()
    {
        var world = await SeedWorldAsync(_fixture, baselineLike: 100);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PutAsync(ReactionUri(world.Post, "like"), content: null);

        var afterUnlike = await ReadJsonAsync(await client.DeleteAsync(ReactionUri(world.Post, "like")));
        afterUnlike.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(
            100, "the soft-deleted like no longer counts: baseline only");
        afterUnlike.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeFalse(
            "the viewer flag reads active rows only");

        var afterReLike = await ReadJsonAsync(await client.PutAsync(ReactionUri(world.Post, "like"), content: null));
        afterReLike.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(
            101, "the inactive history row and the new active row are never both counted");
        afterReLike.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeTrue();

        var rows = await ReadReactionsAsync(_fixture, world.Post);
        rows.Should().HaveCount(2, "a re-like inserts a NEW row rather than reviving the old one (DP-15)");
        rows.Should().ContainSingle(row => row.DeletedAt == null, "exactly one row is active");
        rows.Should().ContainSingle(row => row.DeletedAt != null, "the un-liked row stays as history");
        rows.Select(row => row.Id).Should().OnlyHaveUniqueItems();

        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().HaveCount(
            3, "like, unlike and re-like are three real state changes");
    }

    // ---------------------------------------------------------------------------------------------
    // Response shape (§1.5.4): counts = baseline + real, viewer flags, participant-safe
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Response_IsReactionState_CountsAreBaselinePlusReal_AndCarryNoProvenance()
    {
        var world = await SeedWorldAsync(_fixture, baselineReply: 3, baselineRepost: 12, baselineLike: 1450);

        await using (var seed = _fixture.CreateContext())
        {
            // Real engagement by someone else: one like, one live reply, and one taken-down reply (not counted).
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.OtherPersona, ReactionKinds.Like));
            seed.Posts.Add(NewPost(Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: world.Post));
            seed.Posts.Add(NewPost(
                Guid.NewGuid(), world.Exercise, world.OtherPersona, parentPostId: world.Post, deletedAt: world.ScenarioTime));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.PutAsync(ReactionUri(world.Post, "repost"), content: null);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        root.EnumerateObject().Select(p => p.Name).Should().Equal(
            ["postId", "kind", "active", "counts", "viewer"], "the wire shape is ReactionStateDto (§1.5.4)");
        root.GetProperty("postId").GetString().Should().Be(world.Post.ToString());
        root.GetProperty("kind").GetString().Should().Be("repost");
        root.GetProperty("active").GetBoolean().Should().BeTrue();

        var counts = root.GetProperty("counts");
        counts.EnumerateObject().Select(p => p.Name).Should().Equal(["reply", "repost", "like"]);
        counts.GetProperty("reply").GetInt32().Should().Be(4, "baseline 3 + one non-deleted direct reply");
        counts.GetProperty("repost").GetInt32().Should().Be(13, "baseline 12 + the caller's repost");
        counts.GetProperty("like").GetInt32().Should().Be(1451, "baseline 1450 + the other persona's like");

        var viewer = root.GetProperty("viewer");
        viewer.GetProperty("liked").GetBoolean().Should().BeFalse("the CALLER has not liked it; someone else has");
        viewer.GetProperty("reposted").GetBoolean().Should().BeTrue();

        body.Should().NotContain(world.ActingHumanId, "no acting human on a participant payload (XC-002)");
        body.Should().NotContainAny(["origin", "actingHumanId", "createdWallClock", "baseline", "exerciseId"]);
    }

    [RequiresDockerFact]
    public async Task LikeAndRepost_AreIndependentKinds()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PutAsync(ReactionUri(world.Post, "like"), content: null);
        var afterRepost = await ReadJsonAsync(await client.PutAsync(ReactionUri(world.Post, "repost"), content: null));
        var afterUnlike = await ReadJsonAsync(await client.DeleteAsync(ReactionUri(world.Post, "like")));

        afterRepost.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeTrue();
        afterRepost.GetProperty("viewer").GetProperty("reposted").GetBoolean().Should().BeTrue();
        afterUnlike.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeFalse();
        afterUnlike.GetProperty("viewer").GetProperty("reposted").GetBoolean().Should().BeTrue(
            "un-liking leaves the repost alone");
        afterUnlike.GetProperty("counts").GetProperty("repost").GetInt32().Should().Be(1);
        afterUnlike.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(0);
    }

    // ---------------------------------------------------------------------------------------------
    // AC: authorization matrix (DP-10, COR-015)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task StaffSession_EvenWithABoundPersona_IsRefused403_AndWritesNothing()
    {
        // A staff session can carry a persona binding (E7 persona operation). A "not staff" test would be wrong in
        // the other direction too; the allowlist is positive: only kind 'participant' may react.
        var world = await SeedWorldAsync(_fixture);
        var staffToken = await SeedSessionAsync(_fixture, world.Exercise, world.OtherPersona, kind: "staff");

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, staffToken);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "controller reactions are not supported (DP-10)");
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task PersonaLessParticipantSession_IsRefused403()
    {
        var world = await SeedWorldAsync(_fixture);
        var unboundToken = await SeedSessionAsync(_fixture, world.Exercise, personaId: null);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, unboundToken);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "a session with no bound persona has nobody to react AS");
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task SharedReadOnlySession_IsRefused403_OnBothVerbs()
    {
        var world = await SeedWorldAsync(_fixture);
        var readOnlyToken = await SeedSessionAsync(
            _fixture, world.Exercise, world.Persona, kind: "readonly", isReadOnly: true);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, readOnlyToken);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "a view-only session never writes a sim mutation (COR-015)");
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnonymousCaller_IsRejected401_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, bearerToken: null);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "no credential is an authentication failure, answered before the handler");
        (await client.DeleteAsync(ReactionUri(world.Post, "like"))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await ReadReactionsAsync(_fixture, world.Post)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task SoftDeletedPost_Returns404_OnBothVerbs_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);
        var takenDown = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(takenDown, world.Exercise, world.OtherPersona, deletedAt: world.ScenarioTime));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PutAsync(ReactionUri(takenDown, "like"), content: null)).StatusCode.Should().Be(
            HttpStatusCode.NotFound, "a taken-down post cannot be reacted to");
        (await client.DeleteAsync(ReactionUri(takenDown, "like"))).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await ReadReactionsAsync(_fixture, takenDown)).Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // AC: telemetry (XC-004), server-stamped, scenario time from the exercise clock
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Like_EmitsOneReactionEvent_WithPersonaActorActingHumanTargetPostAndExerciseScenarioTime()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PutAsync(ReactionUri(world.Post, "like"), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);

        var telemetryEvent = (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().ContainSingle().Subject;

        telemetryEvent.ExerciseId.Should().Be(world.Exercise, "the scope is the RESOLVED request scope");
        telemetryEvent.SchemaVersion.Should().Be("v0");
        telemetryEvent.Channel.Should().Be("social");
        telemetryEvent.Origin.Should().Be("participant");
        telemetryEvent.Payload.Should().Be("{\"reaction\":\"like\",\"liked\":true}");
        telemetryEvent.Actor.Kind.Should().Be("persona");
        telemetryEvent.Actor.PersonaId.Should().Be(world.Persona.ToString(), "the actor is the SESSION's persona");
        telemetryEvent.Actor.ActingHumanId.Should().Be(world.ActingHumanId, "COR-018, from the session row");
        telemetryEvent.Actor.SessionId.Should().Be(world.SessionId.ToString());
        telemetryEvent.Target!.EntityType.Should().Be("post");
        telemetryEvent.Target.EntityId.Should().Be(world.Post.ToString());
        telemetryEvent.TimeZone.Should().Be(world.TimeZone, "the envelope time zone is the exercise's");
        telemetryEvent.ScenarioTime.Should().Be(
            world.ScenarioTime, "scenario time comes from the exercise (no clock running: its persisted instant)");
        telemetryEvent.WallClockTime.Should().BeCloseTo(
            DateTimeOffset.UtcNow, TimeSpan.FromMinutes(5), "wall-clock is the SERVER's, telemetry-only");
        telemetryEvent.EmittedAt.Should().Be(telemetryEvent.WallClockTime, "one wall-clock read per operation");
    }

    [RequiresDockerFact]
    public async Task RepostAndUndo_EmitRepostEvents_WithTheRepostedPayload()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PutAsync(ReactionUri(world.Post, "repost"), content: null);
        await client.PutAsync(ReactionUri(world.Post, "repost"), content: null);     // idempotent repeat
        await client.DeleteAsync(ReactionUri(world.Post, "repost"));
        await client.DeleteAsync(ReactionUri(world.Post, "repost"));                  // idempotent repeat

        var events = await ReadEventsAsync(_fixture, world.Exercise, "repost");
        events.Select(e => e.Payload).Should().Equal(["{\"reposted\":true}", "{\"reposted\":false}"]);
        events.Should().OnlyContain(e => e.Target!.EntityId == world.Post.ToString() && e.Actor.PersonaId == world.Persona.ToString());
        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().BeEmpty("a repost is not a 'reaction' event");
    }

    [RequiresDockerFact]
    public async Task ARunningExerciseClock_WinsOverThePersistedInstant_ForTheRowTheSoftDeleteAndTheEvent()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var host = CreateHost(_fixture);

        // Start and freeze the native clock (COR-050) at an instant that is neither the persisted scenario time
        // nor anywhere near the wall clock, so a stamp from the wrong source cannot pass.
        var clock = host.Services.GetRequiredService<IExerciseClock>();
        clock.Start(world.Exercise, new DateTimeOffset(2034, 1, 1, 12, 0, 0, TimeSpan.Zero), TimeZoneInfo.Utc);
        clock.Freeze(world.Exercise);
        var clockTime = clock.CurrentScenarioTime(world.Exercise)!.Value;
        clockTime.Should().NotBe(world.ScenarioTime);

        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PutAsync(ReactionUri(world.Post, "like"), content: null);
        await client.DeleteAsync(ReactionUri(world.Post, "like"));

        var row = (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle().Subject;
        row.CreatedScenarioTime.Should().Be(clockTime, "the reaction is stamped from the exercise clock");
        row.DeletedAt.Should().Be(clockTime, "the soft delete is stamped from the SAME clock, never UtcNow (DP-15)");

        (await ReadEventsAsync(_fixture, world.Exercise, "reaction")).Should().HaveCount(2)
            .And.OnlyContain(e => e.ScenarioTime == clockTime, "the events carry the clock's scenario time");
    }
}
