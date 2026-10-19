namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Moq;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// #390: a lifecycle transition PUSHES the participant overlay. Before the fix only a pause-tier change pushed
/// <c>OverlayStateChanged</c>, so a participant tab that received a Freeze push and kept its connection stayed on the
/// in-fiction holding page forever after EndEx, never saw a lifecycle <c>paused</c> holding page go up, and never saw
/// it lift on <c>paused → live</c>. Driven over real HTTP + real SQL on a host composed in <c>Program.cs</c>'s order,
/// with the shared hub's <see cref="IHubContext{THub}"/> swapped for a recorder. Every applied transition is checked
/// for PARITY against <c>GET /api/overlay-state</c> on the same host: the push and the GET are two channels onto one
/// state and must never disagree.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LifecycleOverlayPushTests
{
    private const string TransitionRoute = "/api/staff/exercise-lifecycle/transition";
    private static readonly Uri OverlayStateRoute = new("/api/overlay-state", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public LifecycleOverlayPushTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>The #390 headline: Freeze while live, then EndEx, pushes the lifecycle's answer exactly once.</summary>
    [RequiresDockerFact]
    public async Task FreezeWhileLive_ThenCompleted_PushesTheProjectedState_ExactlyOnce_WithAHigherSequence()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Live);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);

        await FreezeAsync(host, exerciseId);
        var freezePush = hub.SendsTo(exerciseId).Should().ContainSingle("the Freeze itself pushes once").Which;
        freezePush.State.Should().Be("pause");

        await TransitionAsync(host, ExerciseLifecycleStates.Completed);

        var pushes = hub.SendsTo(exerciseId);
        pushes.Should().HaveCount(2, "EndEx must push exactly ONE OverlayStateChanged on top of the Freeze push");
        var endexPush = pushes[1];
        endexPush.State.Should().Be(
            "none",
            "Tom's ruling (2026-10-19, #390, recorded at LifecycleOverlayComposer.FromLifecycle): 'completed' projects to "
            + "'none', so EndEx LIFTS the holding page rather than showing the blocking 'endex' overlay — and the push "
            + "carries that projection, not a constant");
        endexPush.Sequence.Should().BeGreaterThan(
            freezePush.Sequence,
            "the client drops a push whose sequence is not NEWER than the last applied one — a lower or equal ticket "
            + "would be discarded and the holding page would stay up, which is the #390 bug");

        await AssertParityAsync(host, endexPush);
        hub.Sends.Should().OnlyContain(
            send => send.Group == ExerciseRealtimeHub.GroupNameFor(exerciseId),
            "COR-001: the push goes only to this exercise's group");
        AssertBystanderUntouched(hub, bystander);
    }

    /// <summary>live → paused pushes the lifecycle's holding page to connected tabs.</summary>
    [RequiresDockerFact]
    public async Task LiveToPaused_PushesTheLifecyclePauseProjection()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Live);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);

        await TransitionAsync(host, ExerciseLifecycleStates.Paused);

        var push = hub.SendsTo(exerciseId).Should().ContainSingle().Which;
        push.State.Should().Be("pause", "COR-032: a paused exercise shows the holding page");
        push.Register.Should().Be(
            "out-of-fiction", "with nothing chosen on either side the composer falls back to out-of-fiction");
        push.Sequence.Should().BePositive("an unsequenced push is dropped by the client as unorderable (SG-002)");
        await AssertParityAsync(host, push);
        AssertBystanderUntouched(hub, bystander);
    }

    /// <summary>paused → live with no Freeze lifts the holding page.</summary>
    [RequiresDockerFact]
    public async Task PausedToLive_WithNoFreeze_PushesNone()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Paused);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);

        await TransitionAsync(host, ExerciseLifecycleStates.Live);

        var push = hub.SendsTo(exerciseId).Should().ContainSingle().Which;
        push.State.Should().Be("none", "resuming the lifecycle must lift the holding page on connected tabs");
        await AssertParityAsync(host, push);
        AssertBystanderUntouched(hub, bystander);
    }

    /// <summary>
    /// The lifecycle push uses the SAME projection the GET does, so a Freeze that outlived a lifecycle pause re-appears
    /// (with the controller's register) when the lifecycle resumes, rather than being flattened to <c>none</c>.
    /// </summary>
    [RequiresDockerFact]
    public async Task FreezeThenLifecyclePauseThenLive_EachPushMatchesTheGet()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Live);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);
        await FreezeAsync(host, exerciseId);

        await TransitionAsync(host, ExerciseLifecycleStates.Paused);
        var pausedPush = hub.SendsTo(exerciseId).Last();
        pausedPush.State.Should().Be("pause");
        pausedPush.Register.Should().Be("out-of-fiction", "the lifecycle's holding page wins while paused");
        await AssertParityAsync(host, pausedPush);

        await TransitionAsync(host, ExerciseLifecycleStates.Live);
        var livePush = hub.SendsTo(exerciseId).Last();
        livePush.State.Should().Be("pause", "the Freeze still stands once the exercise is running again");
        livePush.Register.Should().Be("in-fiction", "the controller's register, as the GET serves it");
        livePush.Sequence.Should().BeGreaterThan(pausedPush.Sequence);
        await AssertParityAsync(host, livePush);

        hub.SendsTo(exerciseId).Should().HaveCount(3, "one Freeze push plus one push per applied transition");
        AssertBystanderUntouched(hub, bystander);
    }

    /// <summary>
    /// #390 Gate-1 WR-002: a Resume while the LIFECYCLE is paused must push what the GET serves — the lifecycle's holding
    /// page — not the raw cleared store snapshot. Otherwise the tab drops its holding page over a paused exercise.
    /// </summary>
    [RequiresDockerFact]
    public async Task LifecyclePaused_FreezeThenResume_TheResumePushEqualsTheGet_Pause()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Live);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);
        await TransitionAsync(host, ExerciseLifecycleStates.Paused);
        await FreezeAsync(host, exerciseId);

        var resumed = await host.Services.GetRequiredService<PauseTierRegistry>().SetTierAsync(
            exerciseId,
            PauseTier.Running,
            "human-controller-01",
            new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc));
        resumed.Outcome.Should().Be(PauseTierOutcome.Applied);

        var resumePush = hub.SendsTo(exerciseId).Last();
        resumePush.State.Should().Be(
            "pause", "the lifecycle is still paused, so the composed overlay is still the holding page");
        await AssertParityAsync(host, resumePush);
        AssertBystanderUntouched(hub, bystander);
    }

    /// <summary>A refused (409) or invalid (400) transition pushes nothing.</summary>
    [RequiresDockerTheory]
    [InlineData(ExerciseLifecycleStates.Live, "live", HttpStatusCode.Conflict)]
    [InlineData(ExerciseLifecycleStates.Staged, "completed", HttpStatusCode.Conflict)]
    [InlineData(ExerciseLifecycleStates.Live, "sideways", HttpStatusCode.BadRequest)]
    public async Task ARefusedOrInvalidTransition_PushesNothing(string from, string to, HttpStatusCode expected)
    {
        var exerciseId = await SeedAsync(from);
        var hub = new RecordingHub();
        await using var host = await StartAsync(exerciseId, hub);

        var response = await host.Client.PostAsJsonAsync(new Uri(TransitionRoute, UriKind.Relative), new { to });

        response.StatusCode.Should().Be(expected);
        hub.Sends.Should().BeEmpty("nothing changed, so nothing may be pushed");
    }

    /// <summary>
    /// The archive row action (<c>POST /api/org/exercises/{id}/archive</c>) reaches the lifecycle through its
    /// tenant-checked entry point, and must push too. Driven through the REAL <c>Program</c> host, so this also proves
    /// the composition root wires the real observer rather than the no-op.
    /// </summary>
    [RequiresDockerFact]
    public async Task ArchiveRowAction_ThroughTheRealHost_PushesToTheExerciseGroup()
    {
        var world = await Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin.OrgAdminTestWorld.SeedAsync(
            _fixture, Pulse.WebApi.Features.ExerciseLifecycleAdmin.ExerciseAdminRoles.Planner);
        await SetStatusAsync(world.OwnExercise.Id, ExerciseLifecycleStates.Completed);
        var bystander = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();

        await using var baseFactory = new Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin.OrgAdminProbeFactory(
            _fixture.ConnectionString!);
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            Microsoft.AspNetCore.TestHost.WebHostBuilderExtensions.ConfigureTestServices(
                builder,
                services =>
                {
                    services.RemoveAll<IHubContext<ExerciseRealtimeHub>>();
                    services.AddSingleton(hub.Context);
                }));
        using var client = Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin.OrgAdminTestWorld.CreateClient(
            factory, world.Token);

        var response = await client.PostAsync(
            new Uri($"/api/org/exercises/{world.OwnExercise.Id}/archive", UriKind.Relative), content: null);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var push = hub.SendsTo(world.OwnExercise.Id).Should().ContainSingle(
            "→archived through the archive action is a lifecycle transition like any other").Which;
        push.State.Should().Be("none", "an archived world authors no overlay (the GET 403s, which the client clears on)");
        push.Sequence.Should().BePositive();
        hub.Sends.Should().OnlyContain(send => send.Group == ExerciseRealtimeHub.GroupNameFor(world.OwnExercise.Id));
        AssertBystanderUntouched(hub, bystander);
        AssertBystanderUntouched(hub, world.OtherExercise.Id);
    }

    /// <summary>
    /// A failing observer must not fail the transition: it has already committed, so the endpoint answers 200, the row
    /// carries the new state, and the failure is logged.
    /// </summary>
    [RequiresDockerFact]
    public async Task AThrowingObserver_DoesNotFailTheTransition_ItCommitsAndTheErrorIsLogged()
    {
        var exerciseId = await SeedAsync(ExerciseLifecycleStates.Live);
        var hub = new RecordingHub();
        var logs = new CapturingLoggerProvider();
        await using var host = await StartAsync(exerciseId, hub, services =>
        {
            services.RemoveAll<IExerciseLifecycleTransitionObserver>();
            services.AddSingleton<IExerciseLifecycleTransitionObserver, ThrowingObserver>();
            services.AddSingleton<Microsoft.Extensions.Logging.ILoggerProvider>(logs);
        });

        await TransitionAsync(host, ExerciseLifecycleStates.Completed);

        await using (var read = _fixture.CreateContext())
        {
            (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId)).Status
                .Should().Be(ExerciseLifecycleStates.Completed, "the transition committed before the observer ran");
        }

        logs.Entries.Should().ContainSingle(
            entry => entry.Category == typeof(ExerciseLifecycleService).FullName
                && entry.Level == Microsoft.Extensions.Logging.LogLevel.Warning
                && entry.Exception is InvalidOperationException
                && entry.Message.Contains(exerciseId.ToString(), StringComparison.Ordinal),
            "a swallowed post-commit failure must never be silent");
        hub.Sends.Should().BeEmpty();
    }

    // ---- helpers -------------------------------------------------------------------------------

    /// <summary>An observer that always throws.</summary>
    private sealed class ThrowingObserver : IExerciseLifecycleTransitionObserver
    {
        public Task OnTransitionedAsync(
            Pulse.WebApi.Data.Entities.Exercise exercise, string fromState, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("observer exploded");
    }

    /// <summary>Captures every log entry (category, level, rendered message, exception).</summary>
    private sealed class CapturingLoggerProvider : Microsoft.Extensions.Logging.ILoggerProvider
    {
        private readonly ConcurrentQueue<LogEntry> _entries = new();

        public IReadOnlyList<LogEntry> Entries => [.. _entries];

        public Microsoft.Extensions.Logging.ILogger CreateLogger(string categoryName) =>
            new CapturingLogger(categoryName, _entries);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(string category, ConcurrentQueue<LogEntry> entries)
            : Microsoft.Extensions.Logging.ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

            public void Log<TState>(
                Microsoft.Extensions.Logging.LogLevel logLevel,
                Microsoft.Extensions.Logging.EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), exception));
        }
    }

    /// <summary>One captured log entry.</summary>
    private sealed record LogEntry(
        string Category, Microsoft.Extensions.Logging.LogLevel Level, string Message, Exception? Exception);

    /// <summary>
    /// SG-002, a real COR-001 negative: a SECOND, genuinely live exercise exists in the same database and host while
    /// the test's exercise transitions, and its group must have received nothing at all.
    /// </summary>
    private static void AssertBystanderUntouched(RecordingHub hub, Guid bystander) =>
        hub.SendsTo(bystander).Should().BeEmpty(
            "COR-001/XC-001: one exercise's lifecycle push must never reach another exercise's participants");

    private static async Task FreezeAsync(ExerciseLifecycleTestHost host, Guid exerciseId)
    {
        var result = await host.Services.GetRequiredService<PauseTierRegistry>().SetTierAsync(
            exerciseId,
            PauseTier.Freeze,
            "human-controller-01",
            new PauseClockStart(DateTimeOffset.UtcNow, TimeZoneInfo.Utc),
            "in-fiction");
        result.Outcome.Should().Be(PauseTierOutcome.Applied);
    }

    private static async Task TransitionAsync(ExerciseLifecycleTestHost host, string to)
    {
        var response = await host.Client.PostAsJsonAsync(new Uri(TransitionRoute, UriKind.Relative), new { to });
        response.StatusCode.Should().Be(HttpStatusCode.OK, "the transition to '{0}' must be applied", to);
    }

    /// <summary>
    /// PARITY, by JSON key: the pushed frame minus <c>sequence</c> must equal the <c>GET /api/overlay-state</c> body
    /// key-for-key and value-for-value. Generic on purpose — a field later added to <c>OverlayStateResponse</c> is
    /// covered automatically (a key the push lacks, or carries differently, fails here).
    /// </summary>
    private static async Task AssertParityAsync(ExerciseLifecycleTestHost host, RecordedPush push)
    {
        var response = await host.Client.GetAsync(OverlayStateRoute);
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var get = JsonFields(await response.Content.ReadAsStringAsync());
        var pushed = JsonFields(push.Json);

        pushed.Should().ContainKey("sequence", "the push carries its ordering ticket");
        pushed.Remove("sequence");
        pushed.Should().BeEquivalentTo(
            get, "the lifecycle push must carry exactly what a re-GET would serve — two channels, one state");
    }

    /// <summary>A JSON object's top-level fields as key → raw JSON text.</summary>
    internal static Dictionary<string, string> JsonFields(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value.GetRawText(), StringComparer.Ordinal);
    }

    private async Task<Guid> SeedAsync(string status)
    {
        var exerciseId = Guid.NewGuid();
        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();
        return exerciseId;
    }

    private async Task SetStatusAsync(Guid exerciseId, string status)
    {
        await using var context = _fixture.CreateContext();
        var exercise = await context.Exercises.SingleAsync(e => e.Id == exerciseId);
        exercise.Status = status;
        await context.SaveChangesAsync();
    }

    /// <summary>A host in <c>Program.cs</c>'s order (lifecycle, then the steering overlay slice), staff-authenticated.</summary>
    private Task<ExerciseLifecycleTestHost> StartAsync(
        Guid exerciseId,
        RecordingHub hub,
        Action<IServiceCollection>? extra = null)
    {
        _fixture.ConnectionString.Should().NotBeNull();

        return ExerciseLifecycleTestHost.StartAsync(
            _fixture.ConnectionString!,
            exerciseId,
            authenticatedStaff: true,
            configureServices: services =>
            {
                services.AddSignalR();
                services.AddPauseTierSteering();
                services.AddPauseParticipantOverlay();
                services.RemoveAll<IHubContext<ExerciseRealtimeHub>>();
                services.AddSingleton(hub.Context);
                extra?.Invoke(services);
            });
    }

    /// <summary>One recorded <c>OverlayStateChanged</c> send.</summary>
    /// <remarks><see cref="Json"/> is the frame as the wire would carry it (the DTO's own property names).</remarks>
    internal sealed record RecordedPush(
        string Group, string State, string Register, string Message, long Sequence, string Json);

    /// <summary>
    /// A recording <see cref="IHubContext{THub}"/> for the shared exercise hub (the same shape as
    /// <c>PauseOverlayPublisherTests</c>' harness): which group each <c>OverlayStateChanged</c> payload went to.
    /// </summary>
    internal sealed class RecordingHub
    {
        private readonly ConcurrentQueue<RecordedPush> _sends = new();

        public RecordingHub()
        {
            var clients = new Mock<IHubClients>();
            clients.Setup(hubClients => hubClients.Group(It.IsAny<string>())).Returns((string group) =>
            {
                var proxy = new Mock<IClientProxy>();
                proxy
                    .Setup(clientProxy => clientProxy.SendCoreAsync(
                        It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
                    .Returns((string method, object?[] args, CancellationToken _) =>
                    {
                        method.Should().Be("OverlayStateChanged");
                        var dto = args.Should().ContainSingle().Which.Should()
                            .BeOfType<ParticipantOverlayStateDto>(
                                "the lifecycle push must use the SAME participant DTO the Freeze push uses").Subject;
                        _sends.Enqueue(new RecordedPush(
                            group, dto.State, dto.Register, dto.Message, dto.Sequence, JsonSerializer.Serialize(dto)));
                        return Task.CompletedTask;
                    });
                return proxy.Object;
            });

            var context = new Mock<IHubContext<ExerciseRealtimeHub>>();
            context.SetupGet(hubContext => hubContext.Clients).Returns(clients.Object);
            Context = context.Object;
        }

        public IHubContext<ExerciseRealtimeHub> Context { get; }

        public IReadOnlyList<RecordedPush> Sends => [.. _sends];

        public IReadOnlyList<RecordedPush> SendsTo(Guid exerciseId) =>
            [.. _sends.Where(send => send.Group == ExerciseRealtimeHub.GroupNameFor(exerciseId))];
    }
}
