namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;
using Pulse.WebApi.Tests.Features.EngineRuntime;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// The scenario fixture for the engine reaction-correctness suite (engine-eval-harness story 04, issue #178).
/// </summary>
/// <remarks>
/// <para>
/// <b>What this is.</b> A small, Docker-free "scripted timeline" over the REAL reaction-loop driver. A scenario
/// reads like a script: build a fixture exercise with one or more storylines, then play scenario time forward
/// one minute at a time while injecting the things a real exercise would produce - official posts, off-platform
/// markers (CTL-026), a kill switch, a provider degrade - and finally assert on what the world did.
/// </para>
/// <para>
/// <b>What is real.</b> <see cref="ReactionLoopDriver"/> (observe, respond, decide, generate, enqueue), the
/// storyline state machine / intensity / sentiment models, the miss-safe resolver, the autonomy state and its
/// safety clamps, the generate stage with the content guard + diversity gate, the review store
/// (EF in-memory) and <see cref="EngineReviewService"/>'s auto-hold sweep. Scenario time comes from the real
/// <see cref="ExerciseClockService"/> driven by a hand-advanced <see cref="ManualTimeProvider"/>, so a scenario
/// is deterministic and takes milliseconds of wall time.
/// </para>
/// <para>
/// <b>What is faked.</b> Only the generation provider: <see cref="RecordingFakeProvider"/> wraps the
/// deterministic <see cref="FakeGenerationProvider"/> (no key, no egress) and records every prompt the loop
/// assembled, so a scenario can assert the content the world was ASKED to produce. The publish funnel is a
/// recording double (<see cref="RecordingPublishService"/>), so "nothing auto-published" is a hard assertion on a
/// seam, not an absence-of-evidence guess.
/// </para>
/// <para>
/// <b>Isolation fixture rules.</b> The fixture seeds NO Organization, StaffAssignment or Exercise rows: the
/// storyline loop only needs the tick's server-derived exercise scope (<see cref="ExerciseContext"/>), and every
/// row it writes is stamped with that scope (COR-001).
/// </para>
/// <para>
/// <b>Controller demand (CTL-034), defined once.</b> The unit the budget protects is a controller DECISION.
/// For this suite, <i>controller demand in scenario minute m</i> is the number of engine review-queue items
/// enqueued in minute m (each is one decision the controller must be able to make, at ANY autonomy level; one burst
/// equals one decision regardless of how many posts it carries) PLUS the response-match prompts raised in minute m
/// (one per official post the engine could not confirm on its own). That is the CTL-034 text: "review-queue actions +
/// response-match prompts + queue fires". The production meter records both kinds against one budget
/// (<see cref="DemandEventKind.QueueFire"/> and, since D4, <see cref="DemandEventKind.ResponseMatchPrompt"/>); see
/// <see cref="QueueFireDemandPerMinute"/> and <see cref="ControllerDemandPerMinute"/>.
/// </para>
/// </remarks>
internal sealed class ReactionScenario : IAsyncDisposable
{
    /// <summary>Scenario t=0 (also the wall-clock anchor of the hand-advanced time provider).</summary>
    public static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    /// <summary>The fixture cast. Wide enough that a response burst (3 voices) and a burst-load tick have room.</summary>
    public static readonly IReadOnlyList<string> CastHandles = ["@rosa", "@marcus", "@lena", "@dev", "@tamsin", "@ortiz"];

    private readonly ServiceProvider _services;
    private readonly List<Storyline> _storylines;
    private readonly List<TickRecord> _timeline = [];
    private readonly ManualTimeProvider _time;
    private readonly HashSet<Guid> _seenDrafts = [];
    private readonly List<string> _pendingOfficialPosts = [];

    private ReactionScenario(
        ServiceProvider services,
        Guid exerciseId,
        ReactionLoopRegistration registration,
        List<Storyline> storylines,
        ManualTimeProvider time)
    {
        _services = services;
        ExerciseId = exerciseId;
        Registration = registration;
        _storylines = storylines;
        _time = time;
    }

    /// <summary>The fixture exercise (server-derived scope for every tick).</summary>
    public Guid ExerciseId { get; }

    /// <summary>The loop registration the host would tick.</summary>
    public ReactionLoopRegistration Registration { get; }

    /// <summary>The exercise's autonomy state (the object the kill switch / degrade clamp act on).</summary>
    public EngineAutonomyState Autonomy => Registration.Autonomy;

    /// <summary>The recording publish funnel; "nothing auto-publishes" asserts it stayed empty.</summary>
    public RecordingPublishService Publisher => _services.GetRequiredService<RecordingPublishService>();

    /// <summary>The recording provider; exposes every prompt the loop assembled.</summary>
    public RecordingFakeProvider Provider => _services.GetRequiredService<RecordingFakeProvider>();

    /// <summary>The tick-by-tick record of the scenario so far (one entry per <see cref="TickAsync"/>).</summary>
    public IReadOnlyList<TickRecord> Timeline => _timeline;

    /// <summary>The current scenario minute on the real exercise clock.</summary>
    public int Minute => _services.GetRequiredService<IExerciseClock>().CurrentScenarioMinute(ExerciseId);

    /// <summary>The service provider, for scenarios that need a seam directly.</summary>
    public IServiceProvider Services => _services;

    /// <summary>Builds the fixture exercise. Storylines are added with <see cref="AddStoryline"/>.</summary>
    /// <param name="level">The exercise-default autonomy level (Suggest or Delayed-auto).</param>
    /// <param name="rate">The per-exercise rate governance (cap / floor / reaction cadence); default when null.</param>
    public static ReactionScenario Create(AutonomyLevel level = AutonomyLevel.Suggest, RateGovernanceConfig? rate = null)
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(time);
        services.AddScoped<IExerciseContext, ExerciseContext>();
        var dbName = $"reaction-scenario-{Guid.NewGuid():N}"; // one named store per scenario: every scope sees the same rows
        services.AddDbContext<PulseDbContext>(o => o.UseInMemoryDatabase(dbName));

        var provider = new RecordingFakeProvider();
        services.AddSingleton(provider);
        services.AddSingleton(new GenerateStage(provider, new PromptAssembler()));
        services.AddSingleton<IGenerationProviderCutRegistry>(new GenerationProviderCutRegistry());
        services.AddSingleton(new EngineAutonomyRegistry());
        services.AddSingleton(new EngineTierPolicyRegistry());

        var publisher = new RecordingPublishService();
        services.AddSingleton(publisher);
        services.AddSingleton<IEnginePublishService>(publisher);
        services.AddSingleton<IEngineReviewBroadcaster>(new RecordingReviewBroadcaster());

        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();
        services.AddPauseTierSteering(); // the PauseTierRegistry the driver requires (CTL-023)

        var built = services.BuildServiceProvider();
        built.GetRequiredService<IExerciseClock>().Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var autonomy = built.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        if (level != AutonomyLevel.Suggest)
        {
            autonomy.SetExerciseDefault(level, "scenario-fixture", 0);
        }

        var cast = CastHandles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

        var storylines = new List<Storyline>();
        var registration = new ReactionLoopRegistration
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "UTC",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = storylines,
            PersonasByHandle = cast,
            Autonomy = autonomy,
            ControllerDeskId = Guid.NewGuid(),
            RateConfig = rate ?? RateGovernanceConfig.Default,
        };

        return new ReactionScenario(built, exerciseId, registration, storylines, time);
    }

    /// <summary>
    /// Seeds a storyline at scenario minute 0 (silence clock starts now) whose cast is the whole fixture cast.
    /// The default expectation/hashtag make "County update on #WaterIssues ..." a genuine answer and an
    /// unrelated notice (farmers market) a genuine non-answer.
    /// </summary>
    public Storyline AddStoryline(
        string title = "Water main contamination fears",
        string expectation = "an official statement from the county about the water",
        string hashtag = "#WaterIssues",
        int responseWindowMin = 20,
        string curve = "Standard")
    {
        var storyline = Storyline.Create(
            ExerciseId,
            title,
            expectation,
            curveName: curve,
            responseWindowMin: responseWindowMin,
            participatingPersonas: CastHandles,
            hashtags: [hashtag]);
        storyline.Seed(0);
        _storylines.Add(storyline);
        return storyline;
    }

    /// <summary>Plays scenario time forward by <paramref name="minutes"/> (a freeze would not; a long jump does).</summary>
    public void Advance(int minutes) => _time.Advance(TimeSpan.FromMinutes(minutes));

    /// <summary>Participants-visible official post lands (on-platform). The loop resolves it on the next tick.</summary>
    public void OfficialPost(string text)
    {
        _pendingOfficialPosts.Add(text);
        _services.GetRequiredService<IAddressingInbox>().Enqueue(
            ExerciseId, new AddressingObservation(AddressingSource.OfficialPost, Guid.NewGuid().ToString(), text));
    }

    /// <summary>A controller sets the off-platform response marker (CTL-026) for a storyline.</summary>
    public void OffPlatformMarker(Storyline storyline) =>
        _services.GetRequiredService<IAddressingInbox>().Enqueue(
            ExerciseId,
            new AddressingObservation(AddressingSource.OffPlatformMarker, Guid.NewGuid().ToString(), string.Empty, storyline.Id));

    /// <summary>Runs one reaction-loop tick at the current scenario minute and records it on the timeline.</summary>
    public async Task<ReactionTickResult> TickAsync()
    {
        // Response-match prompts this tick will raise: every official post the resolver cannot confirm on its own
        // (Unmatched or NeedsConfirmation) asks the controller "does this address X? Y/N" (CTL-034 counts them).
        var prompts = _pendingOfficialPosts.Count(text => MissSafeResolver.Resolve(
            new AddressingCandidate(AddressingSource.OfficialPost, "demand-probe", text, null, Minute),
            _storylines,
            Registration.ResponseMatching.AutoConfirmEnabled).Kind != MatchKind.Matched);
        _pendingOfficialPosts.Clear();

        var driver = _services.GetRequiredService<ReactionLoopDriver>();
        await using var scope = _services.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = ExerciseId;
        var result = await driver.RunTickAsync(Registration, scope.ServiceProvider);

        // Which items did THIS tick enqueue? (the store does not promise an order, so diff against what we saw.)
        var fresh = (await ReviewItemsAsync()).Where(i => _seenDrafts.Add(i.DraftId)).ToList();

        _timeline.Add(new TickRecord(
            result.ScenarioMinute,
            result.ReviewItemsEnqueued,
            fresh.Sum(i => i.Posts.Count),
            prompts,
            _storylines.ToDictionary(s => s.Id, s => new StorylineSnapshot(s.Phase, s.Intensity, s.Sentiment, s.MinutesSinceLastOfficialResponse))));
        return result;
    }

    /// <summary>Advances one scenario minute, then ticks. Repeated <paramref name="minutes"/> times.</summary>
    public async Task RunMinutesAsync(int minutes)
    {
        for (var i = 0; i < minutes; i++)
        {
            Advance(1);
            await TickAsync();
        }
    }

    /// <summary>Runs the real auto-hold sweep (what the engine-review tick host runs every second).</summary>
    public async Task EvaluateAutoHoldAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = ExerciseId;
        var service = new EngineReviewService(
            scope.ServiceProvider.GetRequiredService<IEngineReviewStore>(),
            scope.ServiceProvider.GetRequiredService<PulseDbContext>(),
            scope.ServiceProvider.GetRequiredService<IExerciseContext>(),
            _services.GetRequiredService<IExerciseClock>(),
            new EngineTelemetryEmitter(),
            Publisher,
            new RecordingReviewBroadcaster(),
            _services.GetRequiredService<EngineAutonomyRegistry>(),
            _services.GetRequiredService<EngineTierPolicyRegistry>(),
            new FakeGenerationProvider(),
            Options.Create(new GenerationOptions()),
            _services.GetRequiredService<IGenerationProviderCutRegistry>(),
            NullLogger<EngineReviewService>.Instance,
            ambientPolicy: null,
            // These scenarios exercise the auto-send policy itself (its positive control proves swamped mode CAN
            // auto-send), so the PROVIDER-GOVERNANCE §8 Phase-1 flag is authorised here. With it false (the
            // committed default), swamped mode never auto-sends; EngineReviewSafetyInvariantTests pins that.
            governance: Options.Create(new EngineAmbientGovernanceOptions { TimeoutAutoSendAuthorized = true }));
        await service.EvaluateAutoHoldAsync();
    }

    /// <summary>The generation provider's circuit breaker tripped (NFR-003): fans the degrade out like production.</summary>
    public async Task DegradeProviderAsync(string reason = "provider circuit open") =>
        await new EngineAutonomyProviderHealthListener(
            _services.GetRequiredService<EngineAutonomyRegistry>(), _services.GetRequiredService<IExerciseClock>())
            .OnDegradedAsync(reason);

    /// <summary>The provider recovered. Production must NOT raise autonomy as a result (the scenarios assert it).</summary>
    public async Task RecoverProviderAsync() =>
        await new EngineAutonomyProviderHealthListener(
            _services.GetRequiredService<EngineAutonomyRegistry>(), _services.GetRequiredService<IExerciseClock>())
            .OnRecoveredAsync();

    /// <summary>Every review item the loop has enqueued for the fixture exercise, in enqueue order.</summary>
    public async Task<List<EngineReviewItemEntity>> ReviewItemsAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        return await db.EngineReviewItems.IgnoreQueryFilters().Where(i => i.ExerciseId == ExerciseId).ToListAsync();
    }

    /// <summary>The decide-stage records (<c>engine.decided</c>) for the exercise, in order.</summary>
    public async Task<List<DecidedRecord>> DecidedAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        var rows = await db.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == ExerciseId && e.EventType == EngineEventTypes.Decided)
            .ToListAsync();
        return rows.Select(r =>
        {
            var payload = JsonDocument.Parse(r.Payload ?? "{}").RootElement;
            return new DecidedRecord(
                Guid.Parse(payload.GetProperty("storyline").GetString()!),
                payload.GetProperty("toneMix").GetString() ?? string.Empty,
                payload.GetProperty("count").GetInt32());
        }).ToList();
    }

    /// <summary>The <c>storyline.state_changed</c> telemetry for the exercise (cause + phase move), in order.</summary>
    public async Task<List<PhaseChangeRecord>> PhaseChangesAsync()
    {
        await using var scope = _services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
        var rows = await db.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == ExerciseId && e.EventType == EngineEventTypes.StorylineStateChanged)
            .ToListAsync();
        return rows.Select(r =>
        {
            var payload = JsonDocument.Parse(r.Payload ?? "{}").RootElement;
            return new PhaseChangeRecord(
                Guid.Parse(payload.GetProperty("storyline").GetString()!),
                payload.GetProperty("toPhase").GetString() ?? string.Empty,
                payload.GetProperty("cause").GetString() ?? string.Empty);
        }).ToList();
    }

    /// <summary>
    /// Queue-fire demand per scenario minute: review items enqueued in each minute (one decision per burst). This is
    /// the queue-fire part of what the production meter (<see cref="WorkloadDemandMeter"/>) records and budgets.
    /// </summary>
    public IReadOnlyDictionary<int, int> QueueFireDemandPerMinute() =>
        _timeline
            .GroupBy(t => t.Minute)
            .ToDictionary(g => g.Key, g => g.Sum(t => t.ReviewItemsEnqueued * DemandAccounting.BurstReviewDemand(postCount: 1)));

    /// <summary>
    /// Full CTL-034 controller demand per scenario minute: queue fires plus response-match prompts (the two
    /// controller-decision kinds this loop can raise today; a Delayed-auto item needs no click to resolve, so no
    /// separate review-action demand is added).
    /// </summary>
    public IReadOnlyDictionary<int, int> ControllerDemandPerMinute() =>
        _timeline
            .GroupBy(t => t.Minute)
            .ToDictionary(
                g => g.Key,
                g => g.Sum(t => (t.ReviewItemsEnqueued * DemandAccounting.BurstReviewDemand(postCount: 1))
                    + (t.MatchPrompts * DemandAccounting.MatchPromptDemand(autoConfirmEarned: false))));

    /// <inheritdoc />
    public ValueTask DisposeAsync() => _services.DisposeAsync();
}

/// <summary>One storyline's observable state at the end of a tick.</summary>
internal sealed record StorylineSnapshot(StorylinePhase Phase, int Intensity, double Sentiment, int MinutesSilent);

/// <summary>What one tick did: the minute, how many review items (controller decisions) and engine posts it enqueued, the response-match prompts it raised, and the world after it.</summary>
internal sealed record TickRecord(int Minute, int ReviewItemsEnqueued, int PostsEnqueued, int MatchPrompts, IReadOnlyDictionary<Guid, StorylineSnapshot> Storylines);

/// <summary>One storyline phase move as telemetry recorded it (the target phase and why).</summary>
internal sealed record PhaseChangeRecord(Guid StorylineId, string ToPhase, string Cause);

/// <summary>A decided burst: which storyline, the dominant tone label the intent carried, and how many voices.</summary>
internal sealed record DecidedRecord(Guid StorylineId, string DominantTone, int Count);

/// <summary>
/// The deterministic generation provider for scenarios: delegates to <see cref="FakeGenerationProvider"/> (canned,
/// anxious/speculative incident lines, no egress) and records each request so a scenario can assert the prompt the
/// loop assembled (the silence guidance, the target emotional mix).
/// </summary>
internal sealed class RecordingFakeProvider : IGenerationProvider
{
    private readonly FakeGenerationProvider _inner = new();
    private readonly List<GenerationRequest> _requests = [];

    public string Name => _inner.Name;

    public GenerationGovernance Governance => _inner.Governance;

    /// <summary>Every request the loop sent, in order.</summary>
    public IReadOnlyList<GenerationRequest> Requests
    {
        get
        {
            lock (_requests)
            {
                return _requests.ToList();
            }
        }
    }

    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        lock (_requests)
        {
            _requests.Add(request);
        }

        return _inner.GenerateAsync(request, cancellationToken);
    }
}
