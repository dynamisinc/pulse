namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// engine-runtime/06: the post-published observer seam on the single ingest funnel, against real SQL. Observers
/// hear about a post only after it commits, always with the SERVER-resolved scope, and an observer that throws
/// can never fail a post that already committed.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostIngestServiceObserverTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostIngestServiceObserverTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task CommittedPost_NotifiesEachObserverOnce_WithTheServerResolvedScope()
    {
        var exerciseId = Guid.NewGuid();
        var observer = new RecordingObserver();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), new FakeFeedBroadcaster(), [observer]);

        var result = await service.IngestAsync(Request(), ParticipantAttribution());

        result.Outcome.Should().Be(PostIngestOutcome.Created);
        var (scope, post) = observer.Calls.Should().ContainSingle().Subject;
        scope.Should().Be(exerciseId, "observers get the server-resolved scope, never anything client-supplied (COR-001)");
        post.Id.Should().Be(result.Post!.Id);
        post.Origin.Should().Be("participant", "the observer sees the provenance it needs to tell a response from the world talking");
    }

    [RequiresDockerFact]
    public async Task RefusedPost_NotifiesNoObserver()
    {
        var exerciseId = Guid.NewGuid();
        var observer = new RecordingObserver();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), new FakeFeedBroadcaster(), [observer]);

        var unattributed = new PostAttribution
        {
            AuthorPersonaId = Guid.Empty,
            Origin = "participant",
            ActingHumanId = "participant-pio-1",
        };
        var result = await service.IngestAsync(Request(), unattributed);

        result.Outcome.Should().Be(PostIngestOutcome.Invalid);
        observer.Calls.Should().BeEmpty("nothing may react to a post that never persisted");
    }

    [RequiresDockerFact]
    public async Task AThrowingObserver_NeverFailsTheCommittedPost_AndLaterObserversStillHearIt()
    {
        var exerciseId = Guid.NewGuid();
        var after = new RecordingObserver();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(
            context, ScopeFor(exerciseId), new FakeFeedBroadcaster(), [new ThrowingObserver(), after]);

        var result = await service.IngestAsync(Request(), ParticipantAttribution());

        result.Outcome.Should().Be(PostIngestOutcome.Created, "the post is committed and broadcast before any observer runs");
        after.Calls.Should().ContainSingle("one observer's failure must not starve the others");

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task AFailedBroadcast_AfterTheCommit_StillReachesEveryObserver_AndTheIngestStillSucceeds()
    {
        // The broadcast runs after the commit and can throw. A committed PIO answer must still reach the engine;
        // otherwise it is persisted but can never address its storyline. Since the Wave 3 Gate-2 L-1 fold the
        // broadcast failure is also absorbed (logged, as B6's takedown does): the post committed, so the ingest
        // reports Created rather than throwing — a throw would answer 500 and the caller's retry would duplicate it.
        var exerciseId = Guid.NewGuid();
        var observer = new RecordingObserver();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var service = new PostIngestService(context, ScopeFor(exerciseId), new ThrowingFeedBroadcaster(), [observer]);

        var result = await service.IngestAsync(Request(), ParticipantAttribution());

        result.Outcome.Should().Be(PostIngestOutcome.Created, "a broadcast fault never turns a committed post into a failure");
        observer.Calls.Should().ContainSingle("the observer hears a committed post whatever the broadcast does");

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(1);
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static CreatePostRequest Request() => new()
    {
        Text = "Fulton County EM: do not drink tap water #WaterIssues",
        ScenarioTime = "2033-06-14T09:00:00-05:00",
        TimeZone = "America/Chicago",
    };

    private static PostAttribution ParticipantAttribution() => new()
    {
        AuthorPersonaId = Guid.NewGuid(),
        Origin = "participant",
        ActingHumanId = "participant-pio-1",
    };

    private sealed class RecordingObserver : IPostPublishedObserver
    {
        public List<(Guid ExerciseId, Post Post)> Calls { get; } = [];

        public void OnPostPublished(Guid exerciseId, Post post) => Calls.Add((exerciseId, post));
    }

    private sealed class ThrowingObserver : IPostPublishedObserver
    {
        public void OnPostPublished(Guid exerciseId, Post post) =>
            throw new InvalidOperationException("observer exploded");
    }

    private sealed class ThrowingFeedBroadcaster : IFeedBroadcaster
    {
        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("hub connection lost");
    }
}
