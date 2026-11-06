namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Features.Realtime;

/// <summary>
/// fix/noise-new-posts-clock §2: the <c>ScenarioClockChanged</c> push. Every Start / Freeze / Unfreeze / Jump (and a
/// startup Restore, and a reset's Clear) queues a push of the exercise's CURRENT <see cref="ScenarioClockDto"/>; the
/// clock's mutators never block on it and never see it throw; it composes with the persistence slice's single sink;
/// and the SignalR send goes through the broadcaster's lifecycle-gated group choice. Docker-free.
/// </summary>
public sealed class ScenarioClockChangedPublisherTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WallStart = new(2026, 10, 21, 14, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task StartFreezeUnfreezeJump_EachPushTheExercisesCurrentClockState()
    {
        var broadcaster = new RecordingClockBroadcaster();
        await using var world = World.Create(broadcaster);
        var exerciseId = Guid.NewGuid();

        world.Clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        await world.Publisher.FlushAsync();
        broadcaster.Last(exerciseId).Should().BeEquivalentTo(
            new { Started = true, Frozen = false, ScenarioTime = Utc(ScenarioStart) }, "Start pushes a running clock");

        world.Time.Advance(TimeSpan.FromMinutes(10));
        world.Clock.Freeze(exerciseId);
        await world.Publisher.FlushAsync();
        broadcaster.Last(exerciseId).Should().BeEquivalentTo(
            new { Started = true, Frozen = true, ScenarioTime = Utc(ScenarioStart.AddMinutes(10)) }, "Freeze pushes the held minute");

        world.Time.Advance(TimeSpan.FromMinutes(25));
        world.Clock.Jump(exerciseId, 30);
        await world.Publisher.FlushAsync();
        broadcaster.Last(exerciseId).Should().BeEquivalentTo(
            new { Started = true, Frozen = true, ScenarioTime = Utc(ScenarioStart.AddMinutes(40)) }, "Jump pushes the leap");

        world.Clock.Unfreeze(exerciseId);
        await world.Publisher.FlushAsync();
        var resumed = broadcaster.Last(exerciseId);
        resumed.Should().BeEquivalentTo(new { Started = true, Frozen = false, ScenarioTime = Utc(ScenarioStart.AddMinutes(40)) });
        resumed.ServerTime.Should().Be(Utc(WallStart.AddMinutes(35)), "serverTime is the server wall clock at the same read");

        broadcaster.Pushes.Should().HaveCount(4, "one push per change when each is flushed before the next");
        broadcaster.Pushes.Select(p => p.ExerciseId).Should().AllBeEquivalentTo(
            exerciseId, "the push names only the exercise whose clock changed (COR-001)");
        broadcaster.Pushes.Select(p => p.Clock.ExerciseId).Should().AllBeEquivalentTo(
            exerciseId.ToString(), "W-001: the frame itself carries the server-resolved exercise id");
    }

    [Fact]
    public async Task ARestore_AndAClear_AlsoPush_SoConnectedClientsLearnTheRestoredAndResetStates()
    {
        var broadcaster = new RecordingClockBroadcaster();
        await using var world = World.Create(broadcaster);
        var exerciseId = Guid.NewGuid();
        var persistence = (IExerciseClockPersistence)world.Clock;

        persistence.Restore(
            exerciseId,
            new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.FromMinutes(20), WallStart, Frozen: true));
        await world.Publisher.FlushAsync();
        broadcaster.Last(exerciseId).Should().BeEquivalentTo(
            new { Started = true, Frozen = true, ScenarioTime = Utc(ScenarioStart.AddMinutes(20)) }, "rehydrate-restore pushes");

        persistence.Clear(exerciseId).Should().BeTrue();
        await world.Publisher.FlushAsync();
        broadcaster.Last(exerciseId).Should().BeEquivalentTo(
            new { Started = false, Frozen = false, ScenarioTime = (string?)null }, "the reset's Clear pushes 'not started'");
    }

    [Fact]
    public async Task TwoExercises_EachPushOnlyItsOwnState()
    {
        var broadcaster = new RecordingClockBroadcaster();
        await using var world = World.Create(broadcaster);
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        world.Clock.Start(a, ScenarioStart, TimeZoneInfo.Utc);
        world.Clock.Start(b, ScenarioStart.AddHours(3), TimeZoneInfo.Utc);
        await world.Publisher.FlushAsync();
        world.Clock.Freeze(a);
        await world.Publisher.FlushAsync();

        broadcaster.Last(a).Frozen.Should().BeTrue();
        broadcaster.Last(b).Frozen.Should().BeFalse("freezing A never pushes a frozen state for B (COR-001)");
        broadcaster.Last(a).ExerciseId.Should().Be(a.ToString());
        broadcaster.Last(b).ExerciseId.Should().Be(b.ToString(), "each frame names its own exercise, never another's");
        broadcaster.Pushes.Count(p => p.ExerciseId == b).Should().Be(1, "B's only change was its own Start");
    }

    [Fact]
    public async Task AStuckBroadcaster_NeverBlocksTheMutators()
    {
        var broadcaster = new StuckClockBroadcaster();
        await using var world = World.Create(broadcaster);
        var exerciseId = Guid.NewGuid();

        var stopwatch = Stopwatch.StartNew();
        world.Clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        (await broadcaster.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10))).Should().Be(exerciseId);

        // The consumer is now parked inside a send that never completes; the mutators must still return at once.
        world.Clock.Freeze(exerciseId);
        world.Clock.Jump(exerciseId, 5);
        world.Clock.Unfreeze(exerciseId);
        stopwatch.Stop();

        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5), "the observer only QUEUES (it is called inside a lock)");
        world.Clock.IsRunning(exerciseId).Should().BeTrue("every mutation applied regardless of the stuck push");
        world.Clock.CurrentScenarioMinute(exerciseId).Should().Be(5);
    }

    [Fact]
    public async Task AThrowingBroadcaster_NeverSurfacesThroughTheMutators_AndLaterChangesStillPush()
    {
        var broadcaster = new ThrowingClockBroadcaster();
        await using var world = World.Create(broadcaster);
        var exerciseId = Guid.NewGuid();

        var act = () =>
        {
            world.Clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
            world.Clock.Freeze(exerciseId);
        };

        act.Should().NotThrow();
        await world.Publisher.FlushAsync();
        world.Clock.Jump(exerciseId, 1);
        await world.Publisher.FlushAsync();
        broadcaster.Attempts.Should().BeGreaterThanOrEqualTo(2, "the consumer outlives a failed push");
    }

    [Fact]
    public void AThrowingObserver_IsContained_AndTheSinkAndLaterObserversStillHearTheChange()
    {
        var sink = new CountingSink();
        var after = new CountingObserver();
        var clock = new ExerciseClockService(
            new ManualTimeProvider(WallStart), sink, [new ExplodingObserver(), after]);
        var exerciseId = Guid.NewGuid();

        var act = () => clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        act.Should().NotThrow("a change that already applied must never fail through its notification");
        sink.Count.Should().Be(1);
        after.Count.Should().Be(1);
    }

    [Fact]
    public void ARestoreAndAClear_TellTheObservers_ButNeverThePersistenceSink()
    {
        var sink = new CountingSink();
        var observer = new CountingObserver();
        var clock = new ExerciseClockService(new ManualTimeProvider(WallStart), sink, [observer]);
        var exerciseId = Guid.NewGuid();

        clock.Restore(exerciseId, new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.Zero, WallStart, Frozen: false));
        clock.Clear(exerciseId);

        sink.Count.Should().Be(0, "story 18: Restore and Clear write nothing (the row is already current / deleted)");
        observer.Count.Should().Be(2);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AddScenarioClockApi_ComposesWithThePersistenceSink_InEitherOrder(bool pushFirst)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        if (pushFirst)
        {
            services.AddScenarioClockApi();
            services.AddExerciseClock();
            services.AddExerciseRuntimePersistence();
        }
        else
        {
            services.AddExerciseClock();
            services.AddExerciseRuntimePersistence();
            services.AddScenarioClockApi();
        }

        services.AddScenarioClockApi(); // idempotent
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = false });

        provider.GetRequiredService<IExerciseClockChangeSink>().Should().BeOfType<ExerciseClockWriteThrough>(
            "the push is additive: story 18's write-through stays the one sink");
        provider.GetServices<IExerciseClockChangeObserver>().Should().ContainSingle()
            .Which.Should().BeSameAs(provider.GetRequiredService<ScenarioClockChangedPublisher>());
        provider.GetRequiredService<IExerciseClock>().Should().BeOfType<ExerciseClockService>("no DI cycle");
    }

    [Fact]
    public async Task SignalR_SendsScenarioClockChanged_ToTheExerciseWideGroup_WhileOpen()
    {
        var exerciseId = Guid.NewGuid();
        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}")).Returns(groupProxy.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);
        var payload = new ScenarioClockChangedDto { ExerciseId = exerciseId.ToString(), Started = true, Frozen = true, ScenarioTime = "2033-06-14T08:00:00.0000000Z", ServerTime = "2026-10-21T14:00:00.0000000Z" };

        await TestFeedBroadcasters.Create(hubContext.Object, "live").BroadcastScenarioClockChangedAsync(exerciseId, payload);

        groupProxy.Verify(
            p => p.SendCoreAsync(
                "ScenarioClockChanged",
                It.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], payload)),
                It.IsAny<CancellationToken>()),
            Times.Once,
            "participants AND staff (members of the exercise-wide group) receive it exactly once");
    }

    [Fact]
    public async Task SignalR_SendsScenarioClockChanged_ToTheStaffGroupOnly_AfterEndEx()
    {
        var exerciseId = Guid.NewGuid();
        var staffProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>(MockBehavior.Strict);
        clients.Setup(c => c.Group($"exercise:{exerciseId}:staff")).Returns(staffProxy.Object);
        var hubContext = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hubContext.SetupGet(h => h.Clients).Returns(clients.Object);
        var payload = new ScenarioClockChangedDto { ExerciseId = exerciseId.ToString(), Started = false, Frozen = false, ScenarioTime = null, ServerTime = "2026-10-21T14:00:00.0000000Z" };

        await TestFeedBroadcasters.Create(hubContext.Object, "completed").BroadcastScenarioClockChangedAsync(exerciseId, payload);

        staffProxy.Verify(
            p => p.SendCoreAsync("ScenarioClockChanged", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once,
            "staff consoles keep the clock after EndEx; participants get nothing (#375 send gate)");
    }

    [Fact]
    public void TheFrame_IsTheGetPayloadPlusAFlatExerciseId_OnTheWire()
    {
        var exerciseId = Guid.NewGuid();
        var clock = new ScenarioClockDto { Started = true, Frozen = false, ScenarioTime = Utc(ScenarioStart), ServerTime = Utc(WallStart) };

        using var frame = System.Text.Json.JsonDocument.Parse(
            System.Text.Json.JsonSerializer.Serialize(ScenarioClockChangedDto.From(exerciseId, clock)));
        using var get = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(clock));

        frame.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["exerciseId", "started", "frozen", "scenarioTime", "serverTime"], "W-001: GET payload + exerciseId, flat");
        get.RootElement.TryGetProperty("exerciseId", out _).Should().BeFalse("the GET /api/clock body never carries it");
        frame.RootElement.GetProperty("exerciseId").GetString().Should().Be(exerciseId.ToString("D"));
        frame.RootElement.GetProperty("scenarioTime").GetString().Should().Be(clock.ScenarioTime);
        frame.RootElement.GetProperty("serverTime").GetString().Should().Be(clock.ServerTime);
        frame.RootElement.GetProperty("started").GetBoolean().Should().BeTrue();
        frame.RootElement.GetProperty("frozen").GetBoolean().Should().BeFalse();
    }

    private static string Utc(DateTimeOffset instant) =>
        instant.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>A DI container with the clock, the push and a test broadcaster; the publisher is resolved eagerly.</summary>
    private sealed class World : IAsyncDisposable
    {
        private readonly ServiceProvider _provider;

        private World(ServiceProvider provider, ManualTimeProvider time)
        {
            _provider = provider;
            Time = time;
            Clock = provider.GetRequiredService<IExerciseClock>();
            Publisher = provider.GetRequiredService<ScenarioClockChangedPublisher>();
        }

        public ManualTimeProvider Time { get; }

        public IExerciseClock Clock { get; }

        public ScenarioClockChangedPublisher Publisher { get; }

        public static World Create(IFeedBroadcaster broadcaster)
        {
            var time = new ManualTimeProvider(WallStart);
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<TimeProvider>(time);
            services.AddExerciseClock();
            services.AddScenarioClockApi();
            services.AddScoped(_ => broadcaster);
            return new World(services.BuildServiceProvider(), time);
        }

        public async ValueTask DisposeAsync() => await _provider.DisposeAsync();
    }

    private sealed class RecordingClockBroadcaster : IFeedBroadcaster
    {
        public ConcurrentQueue<(Guid ExerciseId, ScenarioClockChangedDto Clock)> Queue { get; } = new();

        public (Guid ExerciseId, ScenarioClockChangedDto Clock)[] Pushes => [.. Queue];

        public ScenarioClockChangedDto Last(Guid exerciseId) => Pushes.Last(p => p.ExerciseId == exerciseId).Clock;

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task BroadcastScenarioClockChangedAsync(Guid exerciseId, ScenarioClockChangedDto clock, CancellationToken cancellationToken = default)
        {
            Queue.Enqueue((exerciseId, clock));
            return Task.CompletedTask;
        }
    }

    private sealed class StuckClockBroadcaster : IFeedBroadcaster
    {
        public TaskCompletionSource<Guid> Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public async Task BroadcastScenarioClockChangedAsync(Guid exerciseId, ScenarioClockChangedDto clock, CancellationToken cancellationToken = default)
        {
            Entered.TrySetResult(exerciseId);
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
    }

    private sealed class ThrowingClockBroadcaster : IFeedBroadcaster
    {
        private int _attempts;

        public int Attempts => Volatile.Read(ref _attempts);

        public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task BroadcastScenarioClockChangedAsync(Guid exerciseId, ScenarioClockChangedDto clock, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _attempts);
            throw new InvalidOperationException("hub connection lost");
        }
    }

    private sealed class CountingSink : IExerciseClockChangeSink
    {
        public int Count { get; private set; }

        public void ClockChanged(Guid exerciseId) => Count++;
    }

    private sealed class CountingObserver : IExerciseClockChangeObserver
    {
        public int Count { get; private set; }

        public void ClockChanged(Guid exerciseId) => Count++;
    }

    private sealed class ExplodingObserver : IExerciseClockChangeObserver
    {
        public void ClockChanged(Guid exerciseId) => throw new InvalidOperationException("observer exploded");
    }
}
