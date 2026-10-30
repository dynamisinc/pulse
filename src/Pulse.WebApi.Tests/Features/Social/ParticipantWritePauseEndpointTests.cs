namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// #379 — participant sim writes are refused while the exercise is held: lifecycle <c>paused</c>, or the pause tier
/// <c>Freeze</c>. Every participant write route (<c>POST /api/posts</c> top-level and reply, the reaction
/// <c>PUT</c> for a like and a repost, the follow <c>POST</c>) answers <c>409 {"reason":"frozen"}</c> BEFORE its
/// handler runs, so no row, no telemetry event and no broadcast. The undo routes (unlike, un-repost, unfollow) leave
/// the existing reaction / follow in place. A personal pin is exempt (ruling, Tom, 2026-10-19: "Allow pins"). The
/// <c>Injects</c> and <c>Engine</c> tiers hold only staff/engine content and leave participant writes alone, and a
/// controller posting as a persona through the same <c>POST /api/posts</c> is never refused (staff conduct continues
/// while the world is held). Freezing one exercise never refuses another (COR-001). Boots the REAL
/// <c>Program</c> against real SQL; only the broadcaster is recorded.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantWritePauseEndpointTests
{
    private static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);

    private static readonly DateTimeOffset StoredScenarioTime = new(2033, 9, 4, 9, 30, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public ParticipantWritePauseEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The two ways a world is held for participants: the <c>paused</c> lifecycle, and Freeze.</summary>
    public static TheoryData<string> HeldConditions => new() { "paused", "freeze" };

    // ---- Refused while held --------------------------------------------------------------------------------------

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task TopLevelPost_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing(string condition)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PostAsync(PostsUri, Json(PostBody(world.ParticipantPersona, "participant")));

        await AssertFrozenAsync(response, condition);
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task Reply_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing(string condition)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PostAsync(
            PostsUri, Json(PostBody(world.ParticipantPersona, "participant", parentPostId: world.TargetPost)));

        await AssertFrozenAsync(response, condition);
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerTheory]
    [InlineData("paused", "like")]
    [InlineData("paused", "repost")]
    [InlineData("freeze", "like")]
    [InlineData("freeze", "repost")]
    public async Task Reaction_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing(string condition, string kind)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PutAsync(ReactionUri(world.TargetPost, kind), content: null);

        await AssertFrozenAsync(response, condition);
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task Follow_WhileHeld_Is409Frozen_AndWritesNothing(string condition)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PostAsync(FollowUri(world.OtherPersona), content: null);

        await AssertFrozenAsync(response, condition);
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerFact]
    public async Task TopLevelPost_AtTheFreezeTier_WithTheClockRunning_IsStill409Frozen()
    {
        // The Freeze TIER refuses whatever the clock reads (there is no separate frozen-clock condition).
        var world = await SeedWorldAsync("freeze");
        await using var host = await StartHeldAsync(world, "freeze");
        var clock = host.Services.GetRequiredService<IExerciseClock>();
        clock.Unfreeze(world.Exercise);
        clock.IsFrozen(world.Exercise).Should().BeFalse("this test needs the Freeze tier with a RUNNING clock");
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PostAsync(PostsUri, Json(PostBody(world.ParticipantPersona, "participant")));

        await AssertFrozenAsync(response, "frozen with the clock running");
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerTheory]
    [InlineData("paused", "like")]
    [InlineData("paused", "repost")]
    [InlineData("freeze", "like")]
    [InlineData("freeze", "repost")]
    public async Task Unreact_WhileHeld_Is409Frozen_AndTheReactionStaysActive(string condition, string kind)
    {
        var world = await SeedWorldAsync(condition);
        var reactionId = await SeedReactionAsync(world, kind);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.DeleteAsync(ReactionUri(world.TargetPost, kind));

        await AssertFrozenAsync(response, condition);
        await using var db = _fixture.CreateContext();
        var reaction = await db.PostReactions.IgnoreQueryFilters().AsNoTracking().SingleAsync(r => r.Id == reactionId);
        reaction.DeletedAt.Should().BeNull($"the refused un-{kind} must leave the reaction active");
        (await db.PostReactions.IgnoreQueryFilters().CountAsync(r => r.ExerciseId == world.Exercise)).Should().Be(1);
        await AssertNoEventsOrBroadcastsAsync(world, host);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task Unfollow_WhileHeld_Is409Frozen_AndTheFollowStays(string condition)
    {
        var world = await SeedWorldAsync(condition);
        var followId = await SeedFollowAsync(world);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.DeleteAsync(FollowUri(world.OtherPersona));

        await AssertFrozenAsync(response, condition);
        await using var db = _fixture.CreateContext();
        (await db.Follows.IgnoreQueryFilters().AnyAsync(f => f.Id == followId))
            .Should().BeTrue("the refused unfollow must leave the follow in place");
        await AssertNoEventsOrBroadcastsAsync(world, host);
    }

    /// <summary>
    /// Ruling (Tom, 2026-10-19, WR-002): "Allow pins". A personal pin is a private bookmark, so the held-world gate
    /// exempts it: pin and unpin both work while paused or frozen. (Like and repost stay refused: see
    /// <see cref="Reaction_WhileHeld_Is409Frozen_AndWritesAndBroadcastsNothing"/>.)
    /// </summary>
    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task PersonalPin_PutAndDelete_WhileHeld_Succeed(string condition)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using (var pin = await client.PutAsync(ReactionUri(world.TargetPost, "pin"), content: null))
        {
            pin.StatusCode.Should().Be(HttpStatusCode.OK, $"a personal pin is exempt while {condition}");
        }

        await using (var db = _fixture.CreateContext())
        {
            (await db.PostReactions.IgnoreQueryFilters().AsNoTracking()
                    .SingleAsync(r => r.ExerciseId == world.Exercise && r.Kind == "pin"))
                .DeletedAt.Should().BeNull("the pin landed");
        }

        using (var unpin = await client.DeleteAsync(ReactionUri(world.TargetPost, "pin")))
        {
            unpin.StatusCode.Should().Be(HttpStatusCode.OK, $"a personal unpin is exempt while {condition}");
        }

        await using (var db = _fixture.CreateContext())
        {
            (await db.PostReactions.IgnoreQueryFilters().AsNoTracking()
                    .SingleAsync(r => r.ExerciseId == world.Exercise && r.Kind == "pin"))
                .DeletedAt.Should().NotBeNull("the unpin landed");
        }

        host.Broadcaster.Engagement.Should().BeEmpty("a pin never moves a displayed count");
    }

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task NearMissPinKind_WhileHeld_IsStillRefused(string condition)
    {
        // The exemption is an exact, case-sensitive match on kind=pin; anything else stays under the gate.
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using var response = await client.PutAsync(ReactionUri(world.TargetPost, "PIN"), content: null);

        await AssertFrozenAsync(response, condition);
        await AssertNothingWrittenAsync(world, host);
    }

    [RequiresDockerFact]
    public async Task FreezingExerciseA_DoesNotRefuseAParticipantPostInExerciseB()
    {
        // S-3 / COR-001: the Freeze tier is per exercise, end to end over HTTP.
        var frozenA = await SeedWorldAsync("freeze");
        var liveB = await SeedWorldAsync("live");
        await using var host = await StartHeldAsync(frozenA, "freeze");

        using (var clientB = host.CreateClientFor(liveB.Host, liveB.ParticipantToken))
        using (var responseB = await clientB.PostAsync(
            PostsUri, Json(PostBody(liveB.ParticipantPersona, "participant"))))
        {
            responseB.StatusCode.Should().Be(
                HttpStatusCode.Created, "exercise B is not frozen; A's Freeze must never reach it");
        }

        using (var clientA = host.CreateClientFor(frozenA.Host, frozenA.ParticipantToken))
        using (var responseA = await clientA.PostAsync(
            PostsUri, Json(PostBody(frozenA.ParticipantPersona, "participant"))))
        {
            await AssertFrozenAsync(responseA, "freeze");
        }

        await using var db = _fixture.CreateContext();
        (await db.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == liveB.Exercise)).Should().Be(2);
        (await db.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == frozenA.Exercise)).Should().Be(1);
        host.Broadcaster.Posts.Should().ContainSingle("only B's post is fanned out");
    }

    // ---- Not refused: the lighter tiers, and staff ---------------------------------------------------------------

    [RequiresDockerTheory]
    [InlineData(PauseTier.Injects)]
    [InlineData(PauseTier.Engine)]
    public async Task InjectsOrEngineTier_ParticipantWrites_AreStillAccepted(PauseTier tier)
    {
        var world = await SeedWorldAsync("live");
        await using var host = new PauseTestHost(ConnectionString);
        (await SetTierAsync(host, world, tier)).Outcome.Should().Be(PauseTierOutcome.Applied);
        using var client = host.CreateClientFor(world.Host, world.ParticipantToken);

        using (var post = await client.PostAsync(PostsUri, Json(PostBody(world.ParticipantPersona, "participant"))))
        {
            post.StatusCode.Should().Be(HttpStatusCode.Created, $"the {tier} tier holds no participant write");
        }

        using (var reply = await client.PostAsync(
            PostsUri, Json(PostBody(world.ParticipantPersona, "participant", parentPostId: world.TargetPost))))
        {
            reply.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        (await client.PutAsync(ReactionUri(world.TargetPost, "like"), content: null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.PutAsync(ReactionUri(world.TargetPost, "repost"), content: null))
            .StatusCode.Should().Be(HttpStatusCode.OK);
        (await client.PostAsync(FollowUri(world.OtherPersona), content: null))
            .StatusCode.Should().Be(HttpStatusCode.OK);

        await using var db = _fixture.CreateContext();
        (await db.Posts.IgnoreQueryFilters().CountAsync(
                p => p.ExerciseId == world.Exercise && p.AuthorPersonaId == world.ParticipantPersona))
            .Should().Be(2, "the post and the reply both landed");
        (await db.PostReactions.IgnoreQueryFilters().CountAsync(r => r.ExerciseId == world.Exercise)).Should().Be(2);
        (await db.Follows.IgnoreQueryFilters().CountAsync(f => f.ExerciseId == world.Exercise)).Should().Be(1);
    }

    [RequiresDockerTheory]
    [MemberData(nameof(HeldConditions))]
    public async Task StaffControllerAsPersonaPost_WhileHeld_IsNotRefused(string condition)
    {
        var world = await SeedWorldAsync(condition);
        await using var host = await StartHeldAsync(world, condition);
        using var client = host.CreateClientFor(world.Host, world.StaffToken);

        using var response = await client.PostAsync(
            PostsUri, Json(PostBody(world.OtherPersona, "controller-as-persona", actingHumanId: "controller-1")));

        response.StatusCode.Should().Be(HttpStatusCode.Created,
            "a held world refuses PARTICIPANT writes only; a controller keeps conducting through the same route");
        host.Broadcaster.Posts.Should().ContainSingle("the staff post is fanned out as usual");
    }

    // ---- Helpers -------------------------------------------------------------------------------------------------

    private string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    private static Uri ReactionUri(Guid postId, string kind) =>
        new($"/api/posts/{postId}/reactions/{kind}", UriKind.Relative);

    private static Uri FollowUri(Guid personaId) => new($"/api/personas/{personaId}/follow", UriKind.Relative);

    private static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> PostBody(
        Guid authorPersonaId, string origin, Guid? parentPostId = null, string? actingHumanId = null) => new()
        {
            ["authorPersonaId"] = authorPersonaId.ToString(),
            ["actingHumanId"] = actingHumanId,
            ["text"] = "While the world is held",
            ["scenarioTime"] = "2033-09-04T09:30:00Z",
            ["timeZone"] = "UTC",
            ["origin"] = origin,
            ["parentPostId"] = parentPostId?.ToString(),
        };

    private static async Task AssertFrozenAsync(HttpResponseMessage response, string condition)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.Conflict, $"a participant write is refused while {condition}; got {body}");
        using var json = JsonDocument.Parse(body);
        json.RootElement.GetProperty("reason").GetString().Should().Be("frozen");
    }

    private async Task AssertNothingWrittenAsync(SeededWorld world, PauseTestHost host)
    {
        await using var db = _fixture.CreateContext();
        (await db.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise))
            .Should().Be(1, "only the seeded target post exists: the refused write persisted nothing");
        (await db.PostReactions.IgnoreQueryFilters().CountAsync(r => r.ExerciseId == world.Exercise)).Should().Be(0);
        (await db.Follows.IgnoreQueryFilters().CountAsync(f => f.ExerciseId == world.Exercise)).Should().Be(0);
        (await db.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == world.Exercise
            && (e.EventType.StartsWith("post")
                || e.EventType == "reaction"
                || e.EventType == "repost"
                || e.EventType == "follow"
                || e.EventType == "unfollow")))
            .Should().Be(0, "a refused write emits no telemetry");
        host.Broadcaster.Posts.Should().BeEmpty("a refused write is never fanned out");
        host.Broadcaster.Engagement.Should().BeEmpty("a refused reaction pushes no engagement change");
    }

    private async Task AssertNoEventsOrBroadcastsAsync(SeededWorld world, PauseTestHost host)
    {
        await using var db = _fixture.CreateContext();
        // Scoped to the write path's own event types: host startup can emit unrelated audit events into a seeded
        // exercise (e.g. staff.org_admin_seeded for the enrolled controller).
        (await db.TelemetryEvents.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == world.Exercise
            && (e.EventType.StartsWith("post")
                || e.EventType == "reaction"
                || e.EventType == "repost"
                || e.EventType == "follow"
                || e.EventType == "unfollow")))
            .Should().Be(0, "a refused write emits no telemetry");
        host.Broadcaster.Posts.Should().BeEmpty("a refused write is never fanned out");
        host.Broadcaster.Engagement.Should().BeEmpty("a refused undo pushes no engagement change");
    }

    private async Task<Guid> SeedReactionAsync(SeededWorld world, string kind)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.PostReactions.Add(new PostReaction
        {
            Id = id,
            ExerciseId = world.Exercise,
            PostId = world.TargetPost,
            PersonaId = world.ParticipantPersona,
            Kind = kind,
            CreatedScenarioTime = StoredScenarioTime,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<Guid> SeedFollowAsync(SeededWorld world)
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Follows.Add(new Follow
        {
            Id = id,
            ExerciseId = world.Exercise,
            FollowerPersonaId = world.ParticipantPersona,
            FolloweePersonaId = world.OtherPersona,
            CreatedScenarioTime = StoredScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<PauseTestHost> StartHeldAsync(SeededWorld world, string condition)
    {
        var host = new PauseTestHost(ConnectionString);
        if (condition == "freeze")
        {
            (await SetTierAsync(host, world, PauseTier.Freeze)).Outcome.Should().Be(PauseTierOutcome.Applied);
        }

        return host;
    }

    private static Task<PauseTierResult> SetTierAsync(PauseTestHost host, SeededWorld world, PauseTier tier) =>
        host.Services.GetRequiredService<PauseTierRegistry>().SetTierAsync(
            world.Exercise, tier, "controller-1", new PauseClockStart(StoredScenarioTime, TimeZoneInfo.Utc));

    /// <summary>
    /// One exercise: a participant bound to a persona, a second persona (follow / staff-post target), one post by that
    /// persona (reply / reaction target), and an enrolled controller. <paramref name="condition"/> <c>paused</c> seeds
    /// the paused lifecycle; anything else seeds <c>live</c> (the Freeze tier is applied after the host starts).
    /// </summary>
    private async Task<SeededWorld> SeedWorldAsync(string condition)
    {
        var exerciseId = Guid.NewGuid();
        var participantToken = $"participant-{Guid.NewGuid():N}";
        var staffToken = $"staff-{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var participantPersona = Guid.NewGuid();

        var participantSession = TestSessions.NewSession(participantToken, exerciseId, participantPersona);
        var staffSession = TestSessions.NewSession(staffToken, exerciseId, personaId: null, kind: "staff");
        staffSession.StaffUserId = staffUserId;

        var world = new SeededWorld
        {
            Exercise = exerciseId,
            Host = $"held-{exerciseId:N}.example.com",
            ParticipantPersona = participantPersona,
            OtherPersona = Guid.NewGuid(),
            TargetPost = Guid.NewGuid(),
            ParticipantToken = participantToken,
            StaffToken = staffToken,
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = exerciseId,
            Name = $"Exercise {exerciseId:N}",
            Hostname = world.Host,
            TimeZone = "UTC",
            Status = condition == "paused" ? "paused" : "live",
            CurrentScenarioTime = StoredScenarioTime,
        });
        seed.Personas.Add(NewPersona(world.ParticipantPersona, exerciseId));
        seed.Personas.Add(NewPersona(world.OtherPersona, exerciseId));
        seed.Posts.Add(new Post
        {
            Id = world.TargetPost,
            ExerciseId = exerciseId,
            AuthorPersonaId = world.OtherPersona,
            Body = "The target post",
            CreatedScenarioTime = StoredScenarioTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
            Origin = "controller-as-persona",
            ActingHumanId = "controller-seed",
        });
        seed.Sessions.Add(participantSession);
        seed.Sessions.Add(staffSession);
        seed.StaffUsers.Add(StaffTenantSeed.StaffUserFor(staffUserId));
        seed.Enrollments.Add(new Enrollment
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PersonId = staffUserId,
            Role = "controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();

        return world;
    }

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
    };

    private sealed class SeededWorld
    {
        public required Guid Exercise { get; init; }

        public required string Host { get; init; }

        public required Guid ParticipantPersona { get; init; }

        public required Guid OtherPersona { get; init; }

        public required Guid TargetPost { get; init; }

        public required string ParticipantToken { get; init; }

        public required string StaffToken { get; init; }
    }
}

/// <summary>Records the post and engagement fan-outs a held world must never send for a refused write.</summary>
public sealed class RecordingPauseBroadcaster : IFeedBroadcaster
{
    private readonly ConcurrentQueue<ParticipantPostDto> _posts = new();
    private readonly ConcurrentQueue<PostEngagementChangedDto> _engagement = new();

    /// <summary>Every <c>PostReceived</c> broadcast.</summary>
    public IReadOnlyList<ParticipantPostDto> Posts => _posts.ToArray();

    /// <summary>Every <c>PostEngagementChanged</c> broadcast.</summary>
    public IReadOnlyList<PostEngagementChangedDto> Engagement => _engagement.ToArray();

    /// <inheritdoc />
    public Task BroadcastPostAsync(
        Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
    {
        _posts.Enqueue(post);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task BroadcastPostEngagementChangedAsync(
        Guid exerciseId, PostEngagementChangedDto change, CancellationToken cancellationToken = default)
    {
        _engagement.Enqueue(change);
        return Task.CompletedTask;
    }
}

/// <summary>
/// The real <c>Program</c> host with only the broadcaster recorded (see <see cref="PostWriteWebApplicationFactory"/>).
/// </summary>
public sealed class PauseTestHost : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

    public PauseTestHost(string connectionString) =>
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);

    public RecordingPauseBroadcaster Broadcaster { get; } = new();

    public HttpClient CreateClientFor(string host, string? bearerToken)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://{host}") });
        if (bearerToken is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IFeedBroadcaster>();
            services.AddSingleton<IFeedBroadcaster>(Broadcaster);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
    }
}
