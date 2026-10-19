namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// #390 Gate-1 WR-001: the two overlay pushers (the pause-tier <see cref="PauseOverlayPublisher"/> and the lifecycle
/// <see cref="LifecycleOverlayPublisher"/>) race on one exercise. Docker-free and DETERMINISTIC: the Freeze's
/// lifecycle-status read is gated on a <see cref="TaskCompletionSource{TResult}"/>, so the interleaving that lost a
/// Freeze is forced rather than hoped for. The participant client is simulated by its own rule (apply a push only if
/// its <c>sequence</c> is strictly newer than the last applied one), and the result is checked against what the GET
/// projection serves.
/// </summary>
public sealed class OverlayPublishRaceTests
{
    /// <summary>
    /// The lost-Freeze race: a Freeze takes ticket F and awaits its lifecycle read; a transition INTO live then pushes.
    /// Without the per-exercise publish lock the lifecycle push takes L &gt; F, projects an empty store and sends
    /// <c>none@L</c>; the Freeze then sends <c>pause@F</c>, which the client drops — a frozen world with no holding page.
    /// </summary>
    [Fact]
    public async Task AFreezeRacingATransitionIntoLive_TheClientEndsOnPause_AndTheGetAgrees()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World();
        var lifecycleRead = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var freezeReadStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var pausePublisher = world.PausePublisher(
            PauseTier.Freeze,
            async (_, _) =>
            {
                freezeReadStarted.TrySetResult();
                return await lifecycleRead.Task;
            });

        // 1. The Freeze takes its ticket and parks on its lifecycle read.
        var freeze = pausePublisher.PublishAsync(
            new PauseTierTransition(exerciseId, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "in-fiction"));
        await freezeReadStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));

        // 2. paused -> live commits and its observer runs while the Freeze is still parked.
        var exercise = ExerciseLifecycleTestData.ExerciseInState(exerciseId, ExerciseLifecycleStates.Live);
        var transition = world.LifecyclePublisher.OnTransitionedAsync(
            exercise, ExerciseLifecycleStates.Paused, CancellationToken.None);

        // 3. The Freeze's read resolves: the world IS live, so the Freeze is participant-visible.
        lifecycleRead.SetResult(ExerciseLifecycleStates.Live);
        await Task.WhenAll(freeze, transition).WaitAsync(TimeSpan.FromSeconds(10));

        world.Sends.Should().HaveCount(2, "one Freeze push and one lifecycle push");
        var clientShows = ClientLastApplied(world.Sends);
        clientShows.State.Should().Be(
            "pause",
            "the controller froze a LIVE world: the participant must end on the holding page, never lose the Freeze to "
            + "a lifecycle push that projected the store before the Freeze wrote it");
        clientShows.Register.Should().Be("in-fiction");

        var get = await world.ProjectAsync(exerciseId, ExerciseLifecycleStates.Live);
        new { clientShows.State, clientShows.Register, clientShows.Message }.Should().BeEquivalentTo(
            new { get.State, get.Register, get.Message }, "the push stream converges on exactly what the GET serves");
    }

    /// <summary>
    /// PR #651 review W1: two lifecycle transitions commit (live → paused, then paused → live) but their observers run
    /// OUT OF ORDER — the later commit publishes first. Each push must project the COMMITTED state at its ticket, not
    /// the request's in-memory row, or the earlier transition's stale <c>paused</c> row goes out last with the higher
    /// ticket and leaves the holding page over a LIVE exercise.
    /// </summary>
    [Fact]
    public async Task TwoLifecycleObserversOutOfOrder_EndOnTheCommittedState_AndTheGetAgrees()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World { CommittedStatus = ExerciseLifecycleStates.Live };
        var t1Row = ExerciseLifecycleTestData.ExerciseInState(exerciseId, ExerciseLifecycleStates.Paused);
        var t2Row = ExerciseLifecycleTestData.ExerciseInState(exerciseId, ExerciseLifecycleStates.Live);

        // T2 (paused -> live, the LATER commit) publishes first; T1 (live -> paused) publishes second.
        await world.LifecyclePublisher.OnTransitionedAsync(t2Row, ExerciseLifecycleStates.Paused, CancellationToken.None);
        await world.LifecyclePublisher.OnTransitionedAsync(t1Row, ExerciseLifecycleStates.Live, CancellationToken.None);

        world.Sends.Should().HaveCount(2);
        var clientShows = ClientLastApplied(world.Sends);
        clientShows.State.Should().Be(
            "none", "the exercise is committed LIVE: no holding page may be left over it by a stale in-memory row");

        var get = await world.ProjectAsync(exerciseId, ExerciseLifecycleStates.Live);
        new { clientShows.State, clientShows.Register, clientShows.Message }.Should().BeEquivalentTo(
            new { get.State, get.Register, get.Message }, "the client's sequence rule must land where the GET does");
    }

    /// <summary>The lock is per exercise: a parked publish on exercise A never delays exercise B.</summary>
    [Fact]
    public async Task AParkedPublishOnOneExercise_NeverBlocksAnotherExercise()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var world = new World();
        var lifecycleRead = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var pausePublisher = world.PausePublisher(PauseTier.Freeze, (_, _) => lifecycleRead.Task);

        var parked = pausePublisher.PublishAsync(
            new PauseTierTransition(exerciseA, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "in-fiction"));

        await world.LifecyclePublisher
            .OnTransitionedAsync(
                ExerciseLifecycleTestData.ExerciseInState(exerciseB, ExerciseLifecycleStates.Paused),
                ExerciseLifecycleStates.Live,
                CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(10));

        world.Sends.Should().ContainSingle().Which.Group.Should().Be(ExerciseRealtimeHub.GroupNameFor(exerciseB));

        lifecycleRead.SetResult(ExerciseLifecycleStates.Live);
        await parked.WaitAsync(TimeSpan.FromSeconds(10));
    }

    /// <summary>A throwing lifecycle push still releases the lock, so the next Freeze is not deadlocked.</summary>
    [Fact]
    public async Task AFailedLifecyclePush_ReleasesTheLock_SoTheNextPublishProceeds()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World { HubThrows = true };

        var act = () => world.LifecyclePublisher.OnTransitionedAsync(
            ExerciseLifecycleTestData.ExerciseInState(exerciseId, ExerciseLifecycleStates.Live),
            ExerciseLifecycleStates.Paused,
            CancellationToken.None);
        await act.Should().ThrowAsync<InvalidOperationException>();

        world.HubThrows = false;
        await world.PausePublisher(PauseTier.Freeze, (_, _) => Task.FromResult<string?>("live"))
            .PublishAsync(new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "out-of-fiction"))
            .WaitAsync(TimeSpan.FromSeconds(10));

        world.Sends.Should().ContainSingle().Which.State.Should().Be("pause");
    }

    // ---- PR #651 review W2: a publish is bounded, and the lock never outlives the bound ---------------

    /// <summary>
    /// A hub send that never completes (and ignores cancellation) cannot hang the lifecycle path: the observer returns
    /// within its bound without throwing, the lock is released, and the next publish for the exercise proceeds.
    /// </summary>
    [Fact]
    public async Task ALifecyclePushIntoAHungHub_IsBounded_ReleasesTheLock_AndTheNextPublishProceeds()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World { HubHangs = true };
        var publisher = world.LifecyclePublisherWith(TimeSpan.FromMilliseconds(200));

        var push = publisher.OnTransitionedAsync(
            ExerciseLifecycleTestData.ExerciseInState(exerciseId, ExerciseLifecycleStates.Live),
            ExerciseLifecycleStates.Paused,
            CancellationToken.None);
        await push.WaitAsync(TimeSpan.FromSeconds(5));
        push.IsCompletedSuccessfully.Should().BeTrue(
            "a timeout is logged and swallowed: the transition committed and must never be reported as failed");

        world.HubHangs = false;
        await world.PausePublisher(PauseTier.Freeze, (_, _) => Task.FromResult<string?>("live"))
            .PublishAsync(new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "in-fiction"))
            .WaitAsync(TimeSpan.FromSeconds(5));

        world.Sends.Should().ContainSingle("the hung push was abandoned; the following Freeze got the lock and pushed")
            .Which.State.Should().Be("pause");
    }

    /// <summary>The same bound on the pause publisher: a hung send returns within the bound and frees the lock.</summary>
    [Fact]
    public async Task AFreezePushIntoAHungHub_IsBounded_AndReleasesTheLock()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World { HubHangs = true };

        await world.PausePublisher(
                PauseTier.Freeze, (_, _) => Task.FromResult<string?>("live"), TimeSpan.FromMilliseconds(200))
            .PublishAsync(new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "in-fiction"))
            .WaitAsync(TimeSpan.FromSeconds(5));

        world.OverlayState.Get(exerciseId).State.Should().Be("pause", "the store write stands (WR-004)");
        using var reacquired = await world.OverlayState.AcquirePublishLockAsync(exerciseId)
            .WaitAsync(TimeSpan.FromSeconds(5));
        reacquired.Should().NotBeNull();
    }

    /// <summary>
    /// The pause publisher's DEGRADED path: when the lock is not free within the bound, the store is still written —
    /// so the GET stays truthful — and only the push is skipped.
    /// </summary>
    [Fact]
    public async Task AFreezeWhoseLockWaitTimesOut_StillWritesTheStore_AndSkipsOnlyThePush()
    {
        var exerciseId = Guid.NewGuid();
        var world = new World();
        using var heldElsewhere = await world.OverlayState.AcquirePublishLockAsync(exerciseId);

        await world.PausePublisher(
                PauseTier.Freeze, (_, _) => Task.FromResult<string?>("live"), TimeSpan.FromMilliseconds(200))
            .PublishAsync(new PauseTierTransition(
                exerciseId, PauseTier.Running, PauseTier.Freeze, "human-controller-01", "in-fiction"))
            .WaitAsync(TimeSpan.FromSeconds(5));

        world.OverlayState.Get(exerciseId).State.Should().Be(
            "pause", "the GET (and every re-GET) must still serve the Freeze even though the push could not go out");
        world.Sends.Should().BeEmpty("the push is what the timed-out lock wait gives up");
    }

    /// <summary>The participant client's rule: a push applies only if its sequence is strictly newer.</summary>
    private static World.Send ClientLastApplied(IReadOnlyList<World.Send> sends)
    {
        World.Send? applied = null;
        foreach (var send in sends)
        {
            if (send.Sequence > (applied?.Sequence ?? 0))
            {
                applied = send;
            }
        }

        applied.Should().NotBeNull();
        return applied!;
    }

    /// <summary>
    /// One overlay store shared by both pushers, a recording hub, and a DI container holding the REAL composed
    /// projection chain (<see cref="SteeringPauseOverlayProjection"/> over <see cref="LifecycleOverlayStateProjection"/>).
    /// </summary>
    private sealed class World
    {
        private readonly ConcurrentQueue<Send> _sends = new();

        public World()
        {
            var clients = new Mock<IHubClients>();
            clients.Setup(hubClients => hubClients.Group(It.IsAny<string>())).Returns((string group) =>
            {
                var proxy = new Mock<IClientProxy>();
                proxy
                    .Setup(clientProxy => clientProxy.SendCoreAsync(
                        It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
                    .Returns((string _, object?[] args, CancellationToken _) =>
                    {
                        if (HubThrows)
                        {
                            throw new InvalidOperationException("SignalR fan-out failed");
                        }

                        if (HubHangs)
                        {
                            // A stuck participant pipe: never completes and IGNORES the token.
                            return new TaskCompletionSource().Task;
                        }

                        var dto = (ParticipantOverlayStateDto)args[0]!;
                        _sends.Enqueue(new Send(group, dto.State, dto.Register, dto.Message, dto.Sequence));
                        return Task.CompletedTask;
                    });
                return proxy.Object;
            });
            var hub = new Mock<IHubContext<ExerciseRealtimeHub>>();
            hub.SetupGet(context => context.Clients).Returns(clients.Object);
            Hub = hub.Object;

            Composed = new ComposedOverlayTestSupport(OverlayState);
            LifecyclePublisher = LifecyclePublisherWith(OverlayStateService.DefaultPublishTimeout);
        }

        public bool HubThrows { get; set; }

        /// <summary>When set, every hub send hangs forever (and ignores cancellation).</summary>
        public bool HubHangs { get; set; }

        /// <summary>The exercise's COMMITTED lifecycle status, as a fresh database read would see it.</summary>
        public string? CommittedStatus { get; set; } = ExerciseLifecycleStates.Live;

        public OverlayStateService OverlayState { get; } = new();

        public IHubContext<ExerciseRealtimeHub> Hub { get; }

        public LifecycleOverlayPublisher LifecyclePublisher { get; }

        /// <summary>The real composed projection chain over <see cref="OverlayState"/> (what the GET serves).</summary>
        public ComposedOverlayTestSupport Composed { get; }

        public IReadOnlyList<Send> Sends => [.. _sends];

        /// <summary>A pause publisher over this world, with the given tier and lifecycle-status read.</summary>
        /// <remarks>Its composed read sees the exercise as <c>live</c> — the world each test drives into.</remarks>
        public PauseOverlayPublisher PausePublisher(
            PauseTier tier, ExerciseLifecycleStatusReader lifecycleStatus, TimeSpan? timeout = null) =>
            new(
                Hub,
                OverlayState,
                _ => tier,
                lifecycleStatus,
                Composed.Reader(() => ExerciseLifecycleStates.Live),
                NullLogger<PauseOverlayPublisher>.Instance)
            {
                PublishTimeout = timeout ?? OverlayStateService.DefaultPublishTimeout,
            };

        /// <summary>A lifecycle publisher over this world whose composed read sees <see cref="CommittedStatus"/>.</summary>
        public LifecycleOverlayPublisher LifecyclePublisherWith(TimeSpan timeout) =>
            new(Hub, OverlayState, Composed.Reader(() => CommittedStatus), NullLogger<LifecycleOverlayPublisher>.Instance)
            {
                PublishTimeout = timeout,
            };

        /// <summary>What the GET would serve for an exercise in <paramref name="status"/> — the real projection.</summary>
        public Task<OverlayStateResponse> ProjectAsync(Guid exerciseId, string status) =>
            Composed.ProjectAsync(exerciseId, status);

        /// <summary>One recorded push.</summary>
        public sealed record Send(string Group, string State, string Register, string Message, long Sequence);
    }
}
