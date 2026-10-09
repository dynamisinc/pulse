namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// Wave 1b Gate-2 L-1 and L-4: what <see cref="PostIngestService"/> does AFTER the post commits, against real SQL.
/// A client that disconnects after <c>SaveChanges</c> no longer cancels the projection or the broadcast (the request
/// token is not passed past the commit, as B6's takedown does), and a projection failure keeps its baseline-view
/// fallback — logged at Error when it is an exercise-scope violation (an isolation signal), at Warning otherwise.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostIngestPostCommitTests
{
    private static readonly DateTimeOffset ParentTime = new(2033, 6, 14, 8, 0, 0, TimeSpan.FromHours(-5));

    private readonly MsSqlContainerFixture _fixture;

    public PostIngestPostCommitTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AClientThatDisconnectsAfterTheCommit_StillGetsItsPostProjectedAndBroadcast()
    {
        var exerciseId = Guid.NewGuid();
        var parent = await SeedParentAsync(exerciseId);
        using var request = new CancellationTokenSource();
        var projector = new TokenRecordingProjector();
        var broadcaster = new TokenRecordingBroadcaster();

        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(
            context,
            ScopeFor(exerciseId),
            broadcaster,
            [new DisconnectingObserver(request)],
            new CapturingLogger<PostIngestService>(),
            new StubResolver(parent),
            projector);

        var result = await service.IngestAsync(Reply(parent.Id), ParticipantAttribution(), request.Token);

        request.IsCancellationRequested.Should().BeTrue("precondition: the client went away right after the commit");
        result.Outcome.Should().Be(PostIngestOutcome.Created);
        projector.Tokens.Should().ContainSingle().Which.IsCancellationRequested.Should().BeFalse(
            "the post-commit projection does not run on the request's token");
        var (broadcastExercise, broadcastPost, broadcastToken) = broadcaster.Calls.Should().ContainSingle(
            "the committed post is still pushed to the exercise").Subject;
        broadcastExercise.Should().Be(exerciseId);
        broadcastPost.Id.Should().Be(result.Post!.Id.ToString());
        broadcastToken.IsCancellationRequested.Should().BeFalse("the broadcast does not run on the request's token");
    }

    [RequiresDockerTheory]
    [InlineData("scope-violation", LogLevel.Error, 4)]
    [InlineData("generic", LogLevel.Warning, 3)]
    [InlineData("internal-cancellation", LogLevel.Warning, 3)]
    public async Task APostCommitProjectionFailure_KeepsTheBaselineFallback_AndAScopeViolationIsLoggedAtError(
        string failureKind, LogLevel expectedLevel, int expectedEventId)
    {
        Exception failure = failureKind switch
        {
            "scope-violation" => new ExerciseScopeViolationException("projector saw an out-of-scope row"),
            "generic" => new InvalidOperationException("projection exploded"),
            _ => new OperationCanceledException("an internal timeout, not the caller"),
        };
        var exerciseId = Guid.NewGuid();
        var parent = await SeedParentAsync(exerciseId);
        var broadcaster = new TokenRecordingBroadcaster();
        var logger = new CapturingLogger<PostIngestService>();

        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(
            context, ScopeFor(exerciseId), broadcaster, null, logger, new StubResolver(parent), new ThrowingProjector(failure));

        var result = await service.IngestAsync(Reply(parent.Id), ParticipantAttribution());

        result.Outcome.Should().Be(PostIngestOutcome.Created, "a projection fault never fails a committed post ({0})", failureKind);
        var broadcast = broadcaster.Calls.Should().ContainSingle().Subject.Post;
        broadcast.InReplyTo!.PostId.Should().Be(parent.Id.ToString(), "the baseline view keeps the already-resolved inReplyTo");
        broadcast.Media.Should().BeNull();

        var entry = logger.Entries.Should().ContainSingle(e => e.Exception == failure).Subject;
        entry.Level.Should().Be(expectedLevel);
        entry.EventId.Id.Should().Be(expectedEventId);
    }

    private async Task<Post> SeedParentAsync(Guid exerciseId)
    {
        var parent = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "the parent",
            CreatedScenarioTime = ParentTime,
            CreatedWallClock = DateTimeOffset.UtcNow,
            Origin = "inject",
            ActingHumanId = "seed",
        };
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(parent);
        await seed.SaveChangesAsync();
        return parent;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private static CreatePostRequest Reply(Guid parentId) => new()
    {
        Text = "replying after the commit",
        ScenarioTime = "2033-06-14T09:00:00-05:00",
        TimeZone = "America/Chicago",
        ParentPostId = parentId.ToString(),
    };

    private static PostAttribution ParticipantAttribution() => new()
    {
        AuthorPersonaId = Guid.NewGuid(),
        Origin = "participant",
        ActingHumanId = "participant-post-commit",
    };

    /// <summary>Cancels the request token the moment the post commits — a client disconnecting after SaveChanges.</summary>
    private sealed class DisconnectingObserver(CancellationTokenSource request) : IPostPublishedObserver
    {
        public void OnPostPublished(Guid exerciseId, Post post) => request.Cancel();
    }

    /// <summary>Resolves exactly the seeded parent (B2's resolver is not under test here).</summary>
    private sealed class StubResolver(Post parent) : IReplyParentResolver
    {
        public Task<ReplyParentResult> ResolveAsync(string? parentPostId, CancellationToken cancellationToken) =>
            Task.FromResult(new ReplyParentResult(ReplyParentOutcome.Resolved, parent));
    }

    /// <summary>Projects with the frozen narrowing and records the token each call received.</summary>
    private sealed class TokenRecordingProjector : IParticipantPostProjector
    {
        public List<CancellationToken> Tokens { get; } = [];

        public Task<IReadOnlyList<ParticipantPostDto>> ProjectAsync(
            IReadOnlyCollection<Post> posts, PostProjectionOptions options, CancellationToken cancellationToken)
        {
            Tokens.Add(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<IReadOnlyList<ParticipantPostDto>>(posts.Select(ParticipantPostDto.FromPost).ToList());
        }
    }

    /// <summary>Records every broadcast with the token it received; throws if that token is already cancelled.</summary>
    private sealed class TokenRecordingBroadcaster : IFeedBroadcaster
    {
        public List<(Guid ExerciseId, ParticipantPostDto Post, CancellationToken Token)> Calls { get; } = [];

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default)
        {
            Calls.Add((exerciseId, post, cancellationToken));
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }
    }
}
