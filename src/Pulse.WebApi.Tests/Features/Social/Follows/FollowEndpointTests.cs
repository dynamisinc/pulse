namespace Pulse.WebApi.Tests.Features.Social.Follows;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// End-to-end coverage of the follow graph (<c>profiles-social-graph/07</c>, #370) through the REAL
/// <c>Program</c> host and REAL SQL Server: the idempotent follow/unfollow writes, the read-only denial, the
/// always-Critical cross-exercise rejection, the composed displayed counts, the Following-scoped feed, and the
/// server-stamped XC-004 telemetry.
/// </summary>
/// <remarks>
/// Every test drives the genuine pipeline — host→exercise resolution, then session authentication, then the
/// endpoint — with the caller's persona coming ONLY from the persisted session. Nothing here overrides the
/// exercise scope, so these also prove the resolution path the endpoints depend on. All tests are
/// <see cref="RequiresDockerFactAttribute"/>: a real <c>Skipped</c> without a SQL target, never a silent pass.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class FollowEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public FollowEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // AC2 — follow / unfollow round trip + idempotency
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Follow_ThenUnfollow_RoundTripsTheEdge()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var followResponse = await client.PostAsync(FollowUri(world.Followee), content: null);
        followResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(followResponse)).GetProperty("following").GetBoolean().Should().BeTrue();

        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(
            1, "the follow created exactly one edge for the caller's SESSION-bound persona");

        var unfollowResponse = await client.DeleteAsync(FollowUri(world.Followee));
        unfollowResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ReadJsonAsync(unfollowResponse)).GetProperty("following").GetBoolean().Should().BeFalse();

        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(
            0, "the unfollow removed the edge — the round trip leaves no residue");
    }

    [RequiresDockerFact]
    public async Task FollowingTwice_IsIdempotentSuccess_OneRow_NoError()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var first = await client.PostAsync(FollowUri(world.Followee), content: null);
        var second = await client.PostAsync(FollowUri(world.Followee), content: null);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(
            HttpStatusCode.OK, "following an already-followed persona SUCCEEDS — it is not an error (AC2)");

        var firstBody = await first.Content.ReadAsStringAsync();
        var secondBody = await second.Content.ReadAsStringAsync();
        using var secondJson = JsonDocument.Parse(secondBody);
        secondJson.RootElement.GetProperty("following").GetBoolean().Should().BeTrue(
            "the observable state after the repeat is identical to after the first call");
        using var firstJson = JsonDocument.Parse(firstBody);
        firstJson.RootElement.GetProperty("changed").GetBoolean().Should().BeTrue();
        secondJson.RootElement.GetProperty("changed").GetBoolean().Should().BeFalse(
            "the advisory 'changed' flag is what distinguishes the two calls — the observable STATE does not");

        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(
            1, "the unique (exercise, follower, followee) index means a repeat is the SAME row, not a duplicate");
    }

    [RequiresDockerFact]
    public async Task UnfollowingWhenNotFollowing_IsIdempotentSuccess_NoError()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.DeleteAsync(FollowUri(world.Followee));

        response.StatusCode.Should().Be(
            HttpStatusCode.OK, "unfollowing an already-unfollowed persona succeeds without erroring (AC2)");
        (await ReadJsonAsync(response)).GetProperty("following").GetBoolean().Should().BeFalse();
        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ReadOnlySession_IsRefused_OnBothFollowAndUnfollow()
    {
        // COR-015 / D1-011: the same ReadOnlySessionWriteFilter gate POST /api/posts is denied through. The
        // read-only session here DOES carry a persona binding, so a 403 can only come from the filter — not
        // from a missing persona.
        var world = await SeedWorldAsync();
        var readOnlyToken = $"ro-{Guid.NewGuid():N}";

        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(FollowTestHost.NewSession(
                readOnlyToken, world.Exercise, world.Follower, kind: "readonly", isReadOnly: true));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, readOnlyToken);

        (await client.PostAsync(FollowUri(world.Followee), content: null)).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "a view-only session must NEVER write a sim mutation (COR-015)");
        (await client.DeleteAsync(FollowUri(world.Followee))).StatusCode.Should().Be(
            HttpStatusCode.Forbidden, "the denial covers the unfollow write too");

        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(
            0, "the filter denies BEFORE the handler runs — no partial mutation can occur");
    }

    [RequiresDockerFact]
    public async Task SessionWithNoPersonaBinding_IsRefused_AndWritesNothing()
    {
        // Was written as an ANONYMOUS caller, because before identity-auth-roles/11's gate "no session" and
        // "a session carrying no persona" were indistinguishable at this endpoint — both simply had no follower
        // to write. They are different callers, and this test is about the second one, so it now presents a
        // LIVE session with PersonaId: null. 403 is right here: the caller is authenticated, but there is
        // nobody to follow AS. The anonymous case is a 401 and is covered separately, below.
        var world = await SeedWorldAsync();
        var unboundToken = $"unbound-{Guid.NewGuid():N}";

        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(FollowTestHost.NewSession(unboundToken, world.Exercise, personaId: null));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, unboundToken);

        var response = await client.PostAsync(FollowUri(world.Followee), content: null);

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "the FOLLOWER is the caller's session-bound persona — a session with no binding has nobody to "
            + "follow AS, so the write fails closed rather than guessing an identity");
        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task AnonymousCaller_IsRejectedByTheGate_With401_AndWritesNothing()
    {
        // identity-auth-roles/11: a caller presenting NO credential gets 401 from the default-deny gate before
        // the handler runs — not the handler's own 403, which would wrongly imply "we know who you are and you
        // may not do this". Distinct from the persona-less-session case above.
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, bearerToken: null);

        var response = await client.PostAsync(FollowUri(world.Followee), content: null);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "no credential presented is an AUTHENTICATION failure (401), answered before the endpoint's own "
            + "identity logic is reached");
        (await CountEdgesAsync(world.Exercise, world.Follower, world.Followee)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401_OnTheWrite_NotAnEmptyOk()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        // An unprovisioned host resolves to NO exercise, and no token is presented — the scope stays unset.
        using var client = host.CreateClientFor($"unknown-{Guid.NewGuid():N}.example.com", bearerToken: null);

        var response = await client.PostAsync(FollowUri(world.Followee), content: null);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized, "an unresolved exercise scope fails closed with 401 (COR-001)");
    }

    [RequiresDockerFact]
    public async Task SelfFollow_IsRejected_NoEdgeIsWritten()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.PostAsync(FollowUri(world.Follower), content: null);

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "a self-edge would inflate a persona's own displayed follower count with itself");
        (await CountEdgesAsync(world.Exercise, world.Follower, world.Follower)).Should().Be(0);
    }

    // ---------------------------------------------------------------------------------------------
    // AC6 — cross-exercise isolation (always-Critical)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task CrossExerciseFollow_IsRejected_AndNoEdgeExistsInEitherGraph()
    {
        // The always-Critical case: a persona in exercise A can never be followed by a persona in exercise B,
        // and never appears in B's graph in either direction. A rejection, NOT a quiet no-op that looks like
        // success.
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        // Positively assert the target really exists in exercise B — so a 404 below cannot be a false pass
        // against a persona that was simply never seeded.
        await using (var verify = _fixture.CreateContext())
        {
            var target = await verify.Personas.IgnoreQueryFilters().SingleOrDefaultAsync(p => p.Id == worldB.Followee);
            target.Should().NotBeNull("exercise B's target persona must exist for this test to mean anything");
            target!.ExerciseId.Should().Be(worldB.Exercise);
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var response = await client.PostAsync(FollowUri(worldB.Followee), content: null);

        response.StatusCode.Should().Be(
            HttpStatusCode.NotFound,
            "a followee id resolving to ANOTHER exercise's persona is rejected — the scoped persona lookup "
            + "cannot see it, so it is indistinguishable from an unknown id (COR-001)");

        await using var check = _fixture.CreateContext();
        var anyEdge = await check.Follows
            .IgnoreQueryFilters()
            .AnyAsync(edge => edge.FolloweePersonaId == worldB.Followee || edge.FollowerPersonaId == worldA.Follower);

        anyEdge.Should().BeFalse(
            "no edge may exist in EITHER exercise's graph after a cross-exercise attempt — asserted with "
            + "IgnoreQueryFilters so a scoped read cannot hide a row that was actually written");
    }

    [RequiresDockerFact]
    public async Task CrossExerciseFollowersRead_NeverReturnsAnotherExercisesEdges()
    {
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        // A real edge inside exercise B, pointing at B's followee.
        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(new Follow
            {
                Id = Guid.NewGuid(),
                ExerciseId = worldB.Exercise,
                FollowerPersonaId = worldB.Follower,
                FolloweePersonaId = worldB.Followee,
                CreatedScenarioTime = DateTimeOffset.UtcNow,
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var response = await client.GetAsync(new Uri($"/api/personas/{worldB.Followee}/followers", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotContain(
            worldB.Follower.ToString(),
            "exercise B's follower must never appear in a read served under exercise A's scope (COR-001)");

        using var json = JsonDocument.Parse(body);
        json.RootElement.GetProperty("count").GetInt32().Should().Be(
            0, "the aggregate count must not leak another exercise's graph size either");
    }

    // ---------------------------------------------------------------------------------------------
    // AC5 — XC-004 telemetry, stamped server-side
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Follow_EmitsExactlyOneXc004Event_WithServerStampedScopeActorAndScenarioTime()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PostAsync(FollowUri(world.Followee), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);

        var events = await ReadEventsAsync(world.Exercise, "follow");
        var telemetryEvent = events.Should().ContainSingle(
            "exactly ONE XC-004 event accompanies exactly one state change, in the same unit of work").Subject;

        telemetryEvent.ExerciseId.Should().Be(
            world.Exercise, "the scope is stamped from the RESOLVED request scope, never from client input");
        telemetryEvent.Channel.Should().Be("social");
        telemetryEvent.Actor.Kind.Should().Be("persona");
        telemetryEvent.Actor.PersonaId.Should().Be(
            world.Follower.ToString(),
            "the actor persona is read off the persisted SESSION — a client cannot nominate a different follower");
        telemetryEvent.Actor.ActingHumanId.Should().Be(
            world.ActingHumanId, "actingHumanId (COR-018) comes from the session row, server-side");
        telemetryEvent.Target!.EntityType.Should().Be("persona");
        telemetryEvent.Target.EntityId.Should().Be(world.Followee.ToString());
        telemetryEvent.TimeZone.Should().Be(
            world.TimeZone, "the envelope's timeZone is the EXERCISE's (XC-008), not a client value");
        telemetryEvent.ScenarioTime.Should().Be(
            world.ScenarioTime,
            "scenario time (COR-053) is resolved server-side from the exercise's clock/persisted instant — the "
            + "request carries no scenarioTime at all");
        telemetryEvent.WallClockTime.Should().BeCloseTo(
            DateTimeOffset.UtcNow, TimeSpan.FromMinutes(5), "the wall clock is the SERVER's");
    }

    [RequiresDockerFact]
    public async Task Unfollow_EmitsExactlyOneXc004Event_AndAnIdempotentRepeatEmitsNone()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PostAsync(FollowUri(world.Followee), content: null);
        await client.PostAsync(FollowUri(world.Followee), content: null);   // idempotent repeat
        await client.DeleteAsync(FollowUri(world.Followee));
        await client.DeleteAsync(FollowUri(world.Followee));                // idempotent repeat

        (await ReadEventsAsync(world.Exercise, "follow")).Should().ContainSingle(
            "the second follow changed no state, so it emitted no second event — one event per meaningful action");
        var unfollowEvent = (await ReadEventsAsync(world.Exercise, "unfollow")).Should().ContainSingle().Subject;

        unfollowEvent.Actor.PersonaId.Should().Be(world.Follower.ToString());
        unfollowEvent.Target!.EntityId.Should().Be(world.Followee.ToString());
        unfollowEvent.ExerciseId.Should().Be(world.Exercise);
    }

    [RequiresDockerFact]
    public async Task TelemetryOrigin_IsDerivedFromTheSessionKind_NotHardcodedParticipant()
    {
        // SG-003: the accessor resolves ANY live session carrying a persona binding. Today only a participant
        // login sets one, but E7 persona-operation lets a controller act AS a persona — a hardcoded
        // 'participant' origin would then quietly mis-attribute the audit record. Both kinds are pinned here.
        var participantWorld = await SeedWorldAsync();

        var staffWorld = await SeedWorldAsync();
        var staffToken = $"staff-{Guid.NewGuid():N}";
        await using (var seed = _fixture.CreateContext())
        {
            seed.Sessions.Add(FollowTestHost.NewSession(
                staffToken, staffWorld.Exercise, staffWorld.Follower, kind: "staff"));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();

        using (var participantClient = host.CreateClientFor(participantWorld.Host, participantWorld.Token))
        {
            (await participantClient.PostAsync(FollowUri(participantWorld.Followee), content: null))
                .StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var staffClient = host.CreateClientFor(staffWorld.Host, staffToken))
        {
            (await staffClient.PostAsync(FollowUri(staffWorld.Followee), content: null))
                .StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await ReadEventsAsync(participantWorld.Exercise, "follow")).Should().ContainSingle().Which
            .Origin.Should().Be("participant", "a participant session acts as its own account");

        var staffEvent = (await ReadEventsAsync(staffWorld.Exercise, "follow")).Should().ContainSingle().Subject;
        staffEvent.Origin.Should().Be(
            "controller-as-persona",
            "a staff session operating a persona is a CONTROLLER acting on the participants' behalf — the "
            + "origin is derived from Session.Kind, never assumed");
        staffEvent.Actor.ActingHumanId.Should().NotBeNullOrEmpty(
            "COR-018: a controller-as-persona origin must carry the acting human, and the v0 envelope guard "
            + "refuses the row otherwise");
    }

    [RequiresDockerFact]
    public async Task RejectedCrossExerciseFollow_EmitsNoTelemetryInEitherExercise()
    {
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        (await client.PostAsync(FollowUri(worldB.Followee), content: null)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        (await ReadEventsAsync(worldA.Exercise, "follow")).Should().BeEmpty(
            "a rejected write emits nothing — the event is written in the same unit of work as the edge");
        (await ReadEventsAsync(worldB.Exercise, "follow")).Should().BeEmpty(
            "and certainly nothing lands in the TARGET exercise's telemetry (COR-001)");
    }

    // ---------------------------------------------------------------------------------------------
    // AC3 — displayed counts, composed at the persona read
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task PersonaRead_DisplayedFollowerCount_IsMagnitudePlusEdges_FollowingCountIsEdgesOnly()
    {
        var world = await SeedWorldAsync(followerMagnitude: 1200, followeeMagnitude: 50000);

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        (await client.PostAsync(FollowUri(world.Followee), content: null)).StatusCode.Should().Be(HttpStatusCode.OK);

        var personas = await ReadPersonasAsync(client);

        var followee = personas[world.Followee.ToString()];
        followee.GetProperty("followerCount").GetInt32().Should().Be(
            50001, "the DISPLAYED follower count is AudienceMagnitude + real inbound edges (SOC-054, AC3)");
        followee.GetProperty("audienceMagnitude").GetInt32().Should().Be(
            50000, "the magnitude term is still emitted alone so audienceReach() cannot double-count edges");
        followee.GetProperty("followingCount").GetInt32().Should().Be(
            0, "the followee follows nobody — a 50K magnitude must never inflate a FOLLOWING count");

        var follower = personas[world.Follower.ToString()];
        follower.GetProperty("followingCount").GetInt32().Should().Be(
            1, "the following count is real outbound edges only");
        follower.GetProperty("followerCount").GetInt32().Should().Be(
            1200, "nobody follows the follower, so its displayed count is its magnitude alone");
    }

    [RequiresDockerFact]
    public async Task PersonaRead_Counts_NeverIncludeAnotherExercisesEdges()
    {
        var worldA = await SeedWorldAsync(followeeMagnitude: 100);
        var worldB = await SeedWorldAsync();

        // Three edges in exercise B pointing at an id equal to A's followee — a scope-blind count would
        // report 103 on A's profile.
        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < 3; i++)
            {
                seed.Follows.Add(new Follow
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = worldB.Exercise,
                    FollowerPersonaId = Guid.NewGuid(),
                    FolloweePersonaId = worldA.Followee,
                    CreatedScenarioTime = DateTimeOffset.UtcNow,
                    CreatedWallClock = DateTimeOffset.UtcNow,
                });
            }

            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        var personas = await ReadPersonasAsync(client);

        personas[worldA.Followee.ToString()].GetProperty("followerCount").GetInt32().Should().Be(
            100,
            "another exercise's inbound edges must never reach this profile's displayed count — the aggregate "
            + "runs through the central query filter (COR-001)");
    }

    // ---------------------------------------------------------------------------------------------
    // AC4 — directed reads + the Following-scoped feed
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task FollowingAndFollowersReads_ReturnTheRealEdges_InBothDirections()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PostAsync(FollowUri(world.Followee), content: null);

        var following = await ReadIdsAsync(client, $"/api/personas/{world.Follower}/following");
        following.Should().ContainSingle(
            "the caller's outbound set is what 04-who-to-follow excludes its suggestions against")
            .Which.Should().Be(world.Followee.ToString());

        var followers = await ReadIdsAsync(client, $"/api/personas/{world.Followee}/followers");
        followers.Should().ContainSingle(
            "the inverse direction is what 05-audience-magnitude's follower LIST renders (disjoint from the "
            + "magnitude it renders alongside)")
            .Which.Should().Be(world.Follower.ToString());
    }

    [RequiresDockerFact]
    public async Task FollowingFeed_ReturnsOnlyPostsAuthoredByFollowedPersonas()
    {
        var world = await SeedWorldAsync();
        var followedPost = Guid.NewGuid();
        var unfollowedPost = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(followedPost, world.Exercise, world.Followee, "FOLLOWED-AUTHOR-POST"));
            seed.Posts.Add(NewPost(unfollowedPost, world.Exercise, Guid.NewGuid(), "UNFOLLOWED-AUTHOR-POST"));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        await client.PostAsync(FollowUri(world.Followee), content: null);

        var ids = await ReadFeedIdsAsync(client, "/api/feed?scope=following");
        ids.Should().ContainSingle("only the followed author's post belongs in the Following feed (SOC-081)")
            .Which.Should().Be(followedPost.ToString());

        var allIds = await ReadFeedIdsAsync(client, "/api/feed");
        allIds.Should().Contain(
            [followedPost.ToString(), unfollowedPost.ToString()],
            "the default (All Posts) scope is unchanged by this story");
    }

    [RequiresDockerFact]
    public async Task FollowingFeed_WithAnEmptyFollowList_IsEmpty_NotAnAllPostsFallback()
    {
        var world = await SeedWorldAsync();
        var somebodyElsesPost = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(somebodyElsesPost, world.Exercise, Guid.NewGuid(), "NOT-FOLLOWED"));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.GetAsync(new Uri("/api/feed?scope=following", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK, "an empty follow list is not an error");
        (await ReadFeedIdsAsync(client, "/api/feed?scope=following")).Should().BeEmpty(
            "a participant who follows nobody sees an EMPTY Following feed — silently falling back to All "
            + "Posts would misrepresent their own graph");
    }

    [RequiresDockerFact]
    public async Task FollowingFeed_NeverReturnsAnotherExercisesPost()
    {
        var worldA = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();
        var postInB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            // A post in exercise B authored by A's followee id — only the scope keeps it out.
            seed.Posts.Add(NewPost(postInB, worldB.Exercise, worldA.Followee, "EXERCISE-B-ONLY-POST"));
            await seed.SaveChangesAsync();
        }

        await using var host = CreateHost();
        using var client = host.CreateClientFor(worldA.Host, worldA.Token);

        await client.PostAsync(FollowUri(worldA.Followee), content: null);

        var response = await client.GetAsync(new Uri("/api/feed?scope=following", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        body.Should().NotContain(
            "EXERCISE-B-ONLY-POST",
            "the Following filter is composed ON TOP of the central exercise filter — never instead of it (COR-001)");
        body.Should().NotContain(postInB.ToString());
    }

    [RequiresDockerFact]
    public async Task Feed_UnknownScope_Returns400_RatherThanSilentlyServingAllPosts()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor(world.Host, world.Token);

        var response = await client.GetAsync(new Uri("/api/feed?scope=frends", UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.BadRequest,
            "a typo'd scope must not hand a participant the All Posts set behind a 'Following' label");
    }

    [RequiresDockerFact]
    public async Task DirectedReads_FailClosedWith401_OnAnUnresolvedScope()
    {
        var world = await SeedWorldAsync();

        await using var host = CreateHost();
        using var client = host.CreateClientFor($"unknown-{Guid.NewGuid():N}.example.com", bearerToken: null);

        (await client.GetAsync(new Uri($"/api/personas/{world.Follower}/following", UriKind.Relative)))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized, "never an empty 200 that reads as 'follows nobody'");
        (await client.GetAsync(new Uri($"/api/personas/{world.Followee}/followers", UriKind.Relative)))
            .StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    private static Uri FollowUri(Guid personaId) => new($"/api/personas/{personaId}/follow", UriKind.Relative);

    private FollowTestHost CreateHost()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string first");
        return new FollowTestHost(_fixture.ConnectionString!);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static async Task<IReadOnlyList<string>> ReadIdsAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(new Uri(path, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("personaIds").EnumerateArray()
            .Select(element => element.GetString()!)
            .ToArray();
    }

    private static async Task<IReadOnlyList<string>> ReadFeedIdsAsync(HttpClient client, string path)
    {
        var response = await client.GetAsync(new Uri(path, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray()
            .Select(element => element.GetProperty("id").GetString()!)
            .ToArray();
    }

    private static async Task<IReadOnlyDictionary<string, JsonElement>> ReadPersonasAsync(HttpClient client)
    {
        var response = await client.GetAsync(new Uri("/api/personas", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray()
            .ToDictionary(element => element.GetProperty("id").GetString()!, element => element.Clone());
    }

    private async Task<int> CountEdgesAsync(Guid exerciseId, Guid follower, Guid followee)
    {
        await using var context = _fixture.CreateContext();
        return await context.Follows
            .IgnoreQueryFilters()
            .CountAsync(edge => edge.ExerciseId == exerciseId
                && edge.FollowerPersonaId == follower
                && edge.FolloweePersonaId == followee);
    }

    private async Task<IReadOnlyList<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, string eventType)
    {
        await using var context = _fixture.CreateContext();
        return await context.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(candidate => candidate.ExerciseId == exerciseId && candidate.EventType == eventType)
            .ToListAsync();
    }

    private static Post NewPost(Guid id, Guid exerciseId, Guid authorPersonaId, string body) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = authorPersonaId,
        Body = body,
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
        CreatedWallClock = DateTimeOffset.UtcNow,
        Origin = "participant",
        ActingHumanId = "human-test",
    };

    /// <summary>
    /// Seeds one self-contained exercise: a provisioned host, an exercise-scoped follower + followee persona,
    /// and a LIVE participant session bound to the follower persona. Everything the follow path reads is real
    /// persisted state — nothing is stubbed.
    /// </summary>
    private async Task<SeededWorld> SeedWorldAsync(int followerMagnitude = 0, int followeeMagnitude = 0)
    {
        var exerciseId = Guid.NewGuid();
        var world = new SeededWorld
        {
            Exercise = exerciseId,
            Host = $"follow-{exerciseId:N}.example.com",
            Follower = Guid.NewGuid(),
            Followee = Guid.NewGuid(),
            Token = $"follow-token-{Guid.NewGuid():N}",
            TimeZone = "America/Chicago",
            ScenarioTime = new DateTimeOffset(2033, 9, 4, 9, 30, 0, TimeSpan.Zero),
        };

        var session = FollowTestHost.NewSession(world.Token, exerciseId, world.Follower);
        world.ActingHumanId = session.ActingHumanId;

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = world.TimeZone,
            Status = "active",
            CurrentScenarioTime = world.ScenarioTime,
        });
        seed.Personas.Add(NewPersona(world.Follower, exerciseId, followerMagnitude));
        seed.Personas.Add(NewPersona(world.Followee, exerciseId, followeeMagnitude));
        seed.Sessions.Add(session);
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(Guid id, Guid exerciseId, int audienceMagnitude) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
        Verified = false,
        AudienceMagnitude = audienceMagnitude,
    };

    /// <summary>One seeded exercise world — its host, personas, session, and the server-side stamps to assert.</summary>
    private sealed class SeededWorld
    {
        public required Guid Exercise { get; init; }

        public required string Host { get; init; }

        public required Guid Follower { get; init; }

        public required Guid Followee { get; init; }

        public required string Token { get; init; }

        public required string TimeZone { get; init; }

        public required DateTimeOffset ScenarioTime { get; init; }

        public string ActingHumanId { get; set; } = string.Empty;
    }
}
