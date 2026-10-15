namespace Pulse.WebApi.Tests.Features.Social.Engagement;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Reactions;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Reactions;
using static Pulse.WebApi.Tests.Features.Social.Reactions.ReactionTestSeed;

/// <summary>
/// The live engagement push (demo-feedback story 14, DF-17 / DF-18) against real SQL: <c>ReactionService</c> and
/// <c>PostIngestService</c> send ONE <c>PostEngagementChanged</c> per state change, after the commit, carrying the shown
/// counts (baseline + real) and a database-derived version that strictly increases; a no-op, a pin and a top-level post
/// send nothing; the push targets only the writing exercise; and a failing broadcaster never fails the write.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostEngagementChangedPushTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostEngagementChangedPushTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task LikeUnlikeRepostUnrepost_EachSendOneFrame_WithTheShownCounts_AndAStrictlyHigherVersion()
    {
        var world = await SeedWorldAsync(_fixture, baselineReply: 1, baselineRepost: 4, baselineLike: 10);
        var broadcaster = new RecordingEngagementBroadcaster();

        await using var context = CreateScopedContext(_fixture, world.Exercise);
        var service = CreateReactionService(context, world, broadcaster);

        (await service.ReactAsync(world.Post, ReactionKinds.Like)).StateChanged.Should().BeTrue();
        (await service.UnreactAsync(world.Post, ReactionKinds.Like)).StateChanged.Should().BeTrue();
        (await service.ReactAsync(world.Post, ReactionKinds.Repost)).StateChanged.Should().BeTrue();
        (await service.UnreactAsync(world.Post, ReactionKinds.Repost)).StateChanged.Should().BeTrue();

        var frames = broadcaster.Changes;
        frames.Should().HaveCount(4, "one frame per state-changing like / unlike / repost / unrepost");
        frames.Should().OnlyContain(frame => frame.ExerciseId == world.Exercise && frame.Change.PostId == world.Post.ToString());

        frames.Select(frame => frame.Change.Counts).Should().Equal(
            new ParticipantPostCounts(Reply: 1, Repost: 4, Like: 11),
            new ParticipantPostCounts(Reply: 1, Repost: 4, Like: 10),
            new ParticipantPostCounts(Reply: 1, Repost: 5, Like: 10),
            new ParticipantPostCounts(Reply: 1, Repost: 4, Like: 10));

        var versions = frames.Select(frame => frame.Change.Version).ToList();
        versions.Should().BeInAscendingOrder().And.OnlyHaveUniqueItems("every state change strictly raises the version");
        versions.Should().Equal(1, 2, 3, 4);
    }

    [RequiresDockerFact]
    public async Task TheFramesCounts_EqualWhatTheCallReturns_AndTheVersionIsWhatAnotherInstanceReads()
    {
        var world = await SeedWorldAsync(_fixture, baselineLike: 3);
        var broadcaster = new RecordingEngagementBroadcaster();

        await using var context = CreateScopedContext(_fixture, world.Exercise);
        var result = await CreateReactionService(context, world, broadcaster).ReactAsync(world.Post, ReactionKinds.Like);

        var frame = broadcaster.Changes.Should().ContainSingle().Subject.Change;
        frame.Counts.Should().Be(result.State!.Counts, "the push reuses the call's own counts read, never a second count");

        // A second app instance (a fresh context on the same database) derives the same number from the rows.
        await using var otherInstance = CreateScopedContext(_fixture, world.Exercise);
        (await PostEngagementVersion.ReadAsync(otherInstance, world.Post, CancellationToken.None))
            .Should().Be(frame.Version, "the version is derived from the database, so two instances agree (DF-18)");
    }

    [RequiresDockerFact]
    public async Task ANoOpLike_AndAPin_SendNothing()
    {
        var world = await SeedWorldAsync(_fixture, baselineLike: 2);
        var broadcaster = new RecordingEngagementBroadcaster();

        await using var context = CreateScopedContext(_fixture, world.Exercise);
        var service = CreateReactionService(context, world, broadcaster);

        await service.ReactAsync(world.Post, ReactionKinds.Like);
        var repeat = await service.ReactAsync(world.Post, ReactionKinds.Like);
        var unlikeNothing = await service.UnreactAsync(world.Post, ReactionKinds.Repost);
        var pin = await service.ReactAsync(world.Post, ReactionKinds.Pin);
        var unpin = await service.UnreactAsync(world.Post, ReactionKinds.Pin);

        repeat.StateChanged.Should().BeFalse();
        unlikeNothing.StateChanged.Should().BeFalse();
        pin.StateChanged.Should().BeTrue("precondition: the pin really changed state");
        unpin.StateChanged.Should().BeTrue();
        broadcaster.Changes.Should().ContainSingle(
            "only the first like changed a counted state: a repeat, an idempotent un-repost and a pin send nothing");
    }

    [RequiresDockerFact]
    public async Task AReply_SendsItsParentsFrame_AfterItsOwnPostReceived_AndATopLevelPostSendsNone()
    {
        var world = await SeedWorldAsync(_fixture, baselineReply: 6, baselineLike: 1);
        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(world.Exercise, world.Post, world.OtherPersona, ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        var broadcaster = new RecordingEngagementBroadcaster();
        await using var context = CreateScopedContext(_fixture, world.Exercise);
        var service = CreateIngestService(context, world.Exercise, broadcaster);

        var topLevel = await service.IngestAsync(Request(parentPostId: null), Attribution(world));
        topLevel.Outcome.Should().Be(PostIngestOutcome.Created);
        broadcaster.Changes.Should().BeEmpty("a top-level post moves no other post's counts");

        var reply = await service.IngestAsync(Request(parentPostId: world.Post), Attribution(world));
        reply.Outcome.Should().Be(PostIngestOutcome.Created);

        var frame = broadcaster.Changes.Should().ContainSingle().Subject;
        frame.ExerciseId.Should().Be(world.Exercise);
        frame.Change.PostId.Should().Be(world.Post.ToString(), "the frame is the PARENT's, not the reply's");
        frame.Change.Counts.Should().Be(
            new ParticipantPostCounts(Reply: 7, Repost: 0, Like: 2), "baseline 6 + 1 real reply; baseline 1 + 1 real like");
        frame.Change.Version.Should().Be(2, "one like row and one reply");
        broadcaster.Order.Should().Equal(
            new[] { "received", "received", "engagement" }, "the reply's own PostReceived goes out before its parent's count");
    }

    [RequiresDockerFact]
    public async Task ThePush_TargetsOnlyTheWritingExercise_AndAnotherExercisesRowsNeverMoveIt()
    {
        var worldA = await SeedWorldAsync(_fixture);
        var worldB = await SeedWorldAsync(_fixture);

        // A stray reaction stamped with exercise B but pointing at A's post (a buggy write elsewhere): it must not count.
        await using (var seed = _fixture.CreateContext())
        {
            seed.PostReactions.Add(NewReaction(worldB.Exercise, worldA.Post, worldB.Persona, ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        var broadcaster = new RecordingEngagementBroadcaster();
        await using (var contextA = CreateScopedContext(_fixture, worldA.Exercise))
        {
            await CreateReactionService(contextA, worldA, broadcaster).ReactAsync(worldA.Post, ReactionKinds.Like);
        }

        var frame = broadcaster.Changes.Should().ContainSingle().Subject;
        frame.ExerciseId.Should().Be(worldA.Exercise, "the push names only the writing exercise's group");
        broadcaster.Changes.Should().NotContain(change => change.ExerciseId == worldB.Exercise);
        frame.Change.Counts.Like.Should().Be(1, "exercise B's stray row is filtered out of A's count");
        frame.Change.Version.Should().Be(1, "and out of A's version");

        // B's own scope cannot see A's post at all: no version to read, nothing to push.
        await using var contextB = CreateScopedContext(_fixture, worldB.Exercise);
        (await PostEngagementVersion.ReadAsync(contextB, worldA.Post, CancellationToken.None)).Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task AFailingBroadcaster_NeverFailsTheReaction_OrTheReply()
    {
        var world = await SeedWorldAsync(_fixture, baselineLike: 5);
        var broadcaster = new ThrowingEngagementBroadcaster();

        await using var context = CreateScopedContext(_fixture, world.Exercise);
        var like = await CreateReactionService(context, world, broadcaster).ReactAsync(world.Post, ReactionKinds.Like);
        var reply = await CreateIngestService(context, world.Exercise, broadcaster)
            .IngestAsync(Request(parentPostId: world.Post), Attribution(world));

        broadcaster.Attempts.Should().Be(2, "precondition: both pushes were attempted and failed");
        like.Outcome.Should().Be(ReactionOutcome.Changed, "the like committed; a push fault is logged, not surfaced");
        like.State!.Counts.Like.Should().Be(6);
        reply.Outcome.Should().Be(PostIngestOutcome.Created, "the reply committed; a push fault is logged, not surfaced");
        (await ReadReactionsAsync(_fixture, world.Post)).Should().ContainSingle(row => row.Kind == ReactionKinds.Like);
    }

    // ---------------------------------------------------------------------------------------------
    // Harness
    // ---------------------------------------------------------------------------------------------

    private static ReactionService CreateReactionService(PulseDbContext context, ReactionWorld world, IFeedBroadcaster broadcaster)
    {
        var exerciseContext = new ExerciseContext { CurrentExerciseId = world.Exercise };
        return new ReactionService(
            context,
            exerciseContext,
            new StubSessionPersonaAccessor(new CurrentSessionPersona
            {
                SessionId = world.SessionId,
                PersonaId = world.Persona,
                Kind = "participant",
                ExerciseId = world.Exercise,
                ActingHumanId = world.ActingHumanId,
            }),
            new ExerciseClockService(TimeProvider.System),
            new PostEngagementReader(context, exerciseContext),
            broadcaster,
            NullLogger<ReactionService>.Instance);
    }

    private static PostIngestService CreateIngestService(PulseDbContext context, Guid exerciseId, IFeedBroadcaster broadcaster)
    {
        var exerciseContext = new ExerciseContext { CurrentExerciseId = exerciseId };
        return new PostIngestService(
            context,
            exerciseContext,
            broadcaster,
            observers: null,
            logger: NullLogger<PostIngestService>.Instance,
            replyParentResolver: new ReplyParentResolver(context, exerciseContext),
            projector: null,
            engagementReader: new PostEngagementReader(context, exerciseContext));
    }

    private static CreatePostRequest Request(Guid? parentPostId) => new()
    {
        Text = parentPostId is null ? "a new top-level post" : "a reply to the parent",
        ScenarioTime = "2033-09-04T09:45:00Z",
        TimeZone = "America/Chicago",
        ParentPostId = parentPostId?.ToString(),
    };

    private static PostAttribution Attribution(ReactionWorld world) => new()
    {
        AuthorPersonaId = world.Persona,
        Origin = "participant",
        ActingHumanId = world.ActingHumanId,
    };

    /// <summary>Returns a fixed session persona, standing in for the request's authenticated session.</summary>
    private sealed class StubSessionPersonaAccessor(CurrentSessionPersona sessionPersona) : ICurrentSessionPersonaAccessor
    {
        public Task<CurrentSessionPersona?> GetCurrentSessionPersonaAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<CurrentSessionPersona?>(sessionPersona);
    }

    /// <summary>Records every engagement push (and the order of every push of any kind).</summary>
    private sealed class RecordingEngagementBroadcaster : IFeedBroadcaster
    {
        private readonly ConcurrentQueue<(Guid ExerciseId, PostEngagementChangedDto Change)> _changes = new();
        private readonly ConcurrentQueue<string> _order = new();

        public IReadOnlyList<(Guid ExerciseId, PostEngagementChangedDto Change)> Changes => _changes.ToArray();

        public IReadOnlyList<string> Order => _order.ToArray();

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
        {
            _order.Enqueue("received");
            return Task.CompletedTask;
        }

        public Task BroadcastPostEngagementChangedAsync(
            Guid exerciseId, PostEngagementChangedDto change, CancellationToken cancellationToken = default)
        {
            _changes.Enqueue((exerciseId, change));
            _order.Enqueue("engagement");
            return Task.CompletedTask;
        }
    }

    /// <summary>A broadcaster whose engagement push always fails (a SignalR outage).</summary>
    private sealed class ThrowingEngagementBroadcaster : IFeedBroadcaster
    {
        private int _attempts;

        public int Attempts => _attempts;

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task BroadcastPostEngagementChangedAsync(
            Guid exerciseId, PostEngagementChangedDto change, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _attempts);
            throw new InvalidOperationException("Simulated SignalR failure while sending PostEngagementChanged.");
        }
    }
}
