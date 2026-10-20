namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.SilenceEscalation.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Addressing;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The in-process reaction-loop host (E8 architecture §1.2, implementation.md open question (a) — DECIDED
/// in-process for v1). A <see cref="BackgroundService"/> that drives the whole loop — observe → decide →
/// generate → (enqueue review) → measure — in <b>scenario time</b> (COR-053) for every registered exercise,
/// as a scheduler off the participant hot path (nothing runs on a participant's synchronous request). Each
/// exercise's per-tick unit of work runs in its OWN <see cref="IServiceScope"/> with
/// <see cref="ExerciseContext.CurrentExerciseId"/> set to that exercise, so a tick for exercise A can never
/// observe, generate, or write into exercise B (COR-001).
/// </summary>
/// <remarks>
/// <para>
/// <b>Freeze / jump (COR-052/051).</b> The cadence is wall-clock (a scheduler heartbeat), but every timer the
/// loop reads is scenario time via story 03's <see cref="IExerciseClock"/>: a <b>freeze</b> halts ticking for
/// that exercise (this host skips the tick entirely, so no observe/generate runs and no silence accrues), and
/// a <b>time-jump</b> leaps the scenario minute so the next tick's storyline advancement blows the windows the
/// skip carried past and surfaces them.
/// </para>
/// <para>
/// <b>Engine paused (CTL-023, world-steering/03 + 07).</b> The <see cref="Steering.PauseTier.Engine"/> tier does NOT
/// skip the tick: the clock keeps running and MEASURE still advances the storylines, so no elapsed time is caught up
/// in one jump on resume. <see cref="ReactionLoopDriver"/> reads the tier each tick and raises no new storyline work
/// (no trigger, no provider call, no <c>engine.generated</c>, no review item) while it holds.
/// </para>
/// <para>
/// <b>Registration seam.</b> The host iterates <see cref="IReactionLoopRegistry"/> — the in-memory set of
/// active exercise loops (pre-seeded / controller-created storylines, §Out-of-scope: auto-detection is v1.1).
/// Populating it (from a seed/controller path) is a later story; until then the host idles with nothing to
/// tick. A tick's per-exercise stages are delegated to <see cref="ReactionLoopDriver"/>.
/// </para>
/// </remarks>
public sealed class ReactionLoopHost : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IReactionLoopRegistry _registry;
    private readonly ReactionLoopDriver _driver;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly ReactionLoopHostOptions _options;
    private readonly ILogger<ReactionLoopHost> _logger;

    /// <summary>Cached high-performance log delegate for a per-exercise tick fault (avoids CA1848 boxing).</summary>
    private static readonly Action<ILogger, Guid, Exception?> LogTickFailed =
        LoggerMessage.Define<Guid>(
            LogLevel.Error,
            new EventId(1, nameof(TickExerciseAsync)),
            "Reaction-loop tick failed for exercise {ExerciseId}.");

    /// <summary>Creates the host with its scope factory, registry, per-tick driver, clock, and cadence options.</summary>
    /// <param name="scopeFactory">Creates the per-exercise <see cref="IServiceScope"/> each tick runs in (COR-001).</param>
    /// <param name="registry">The active exercise loops to tick.</param>
    /// <param name="driver">The per-exercise per-tick stage driver.</param>
    /// <param name="exerciseClock">The native scenario clock (freeze/jump aware).</param>
    /// <param name="timeProvider">The wall-clock source for the scheduler heartbeat.</param>
    /// <param name="options">The loop cadence options.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public ReactionLoopHost(
        IServiceScopeFactory scopeFactory,
        IReactionLoopRegistry registry,
        ReactionLoopDriver driver,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        ReactionLoopHostOptions options,
        ILogger<ReactionLoopHost> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(driver);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _registry = registry;
        _driver = driver;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _options = options;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(_options.TickInterval, _timeProvider);

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            {
                foreach (var registration in _registry.Active)
                {
                    await TickExerciseAsync(registration, stoppingToken).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown — the host is stopping.
        }
    }

    /// <summary>
    /// Runs one scenario-time tick for one exercise inside its own scope. A frozen exercise is skipped
    /// (no observe/generate, no accrual). Per-exercise faults are logged and isolated so one exercise's
    /// failure never stops the loop for the others.
    /// </summary>
    private async Task TickExerciseAsync(ReactionLoopRegistration registration, CancellationToken stoppingToken)
    {
        try
        {
            EnsureClockStarted(registration);

            // Freeze halts ticking (COR-052): no observe/generate runs and silence windows do not accrue.
            if (_exerciseClock.IsFrozen(registration.ExerciseId))
            {
                return;
            }

            using var scope = _scopeFactory.CreateScope();

            // Establish the tick's server-authoritative exercise scope BEFORE any scoped service is resolved,
            // so PulseDbContext captures it and every read/write is confined to this exercise (COR-001).
            if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
            {
                exerciseContext.CurrentExerciseId = registration.ExerciseId;
            }
            else
            {
                throw new InvalidOperationException(
                    "The registered IExerciseContext is not settable; the reaction loop cannot establish its scope (COR-001).");
            }

            await _driver.RunTickAsync(registration, scope.ServiceProvider, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
#pragma warning disable CA1031 // A per-exercise fault must not stop the loop for other exercises.
        catch (Exception ex)
        {
            LogTickFailed(_logger, registration.ExerciseId, ex);
        }
#pragma warning restore CA1031
    }

    /// <summary>
    /// Whether the loop must START exercise <paramref name="exerciseId"/>'s scenario clock on first sight — i.e.
    /// nothing has started it yet.
    ///
    /// <para><b>LOAD-BEARING for the tiered pause (world-steering/07).</b> A controller Freeze that arrives
    /// before the loop's first tick STARTS the clock itself and then freezes it
    /// (<c>Steering/PauseTierRegistry</c>); this predicate is the only reason the loop then leaves that frozen
    /// clock alone. If it ever returned <c>true</c> for a frozen clock, the loop would restart it UNFROZEN and the
    /// engine would generate while the console reads WORLD FROZEN — the exact failure story 07 exists to
    /// eliminate. It is exposed (rather than inlined) so the pause suite asserts against THIS definition of the
    /// rule instead of re-implementing it.</para>
    /// </summary>
    /// <param name="clock">The exercise clock to inspect.</param>
    /// <param name="exerciseId">The exercise whose clock the loop is about to tick.</param>
    /// <returns><c>true</c> only when the clock is neither running nor frozen.</returns>
    public static bool ShouldStartClock(IExerciseClock clock, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(clock);
        return !clock.IsRunning(exerciseId) && !clock.IsFrozen(exerciseId);
    }

    /// <summary>
    /// Starts an exercise's scenario clock whenever nothing has started it — checked on EVERY tick through
    /// <see cref="ShouldStartClock"/> alone. Never restarts an already-running or frozen clock (that would reset the
    /// scenario minute): a controller/seed path, a test, or the startup rehydrator (demo-feedback/18) may have
    /// already started, jumped, frozen or restored it. Deliberately keeps NO per-host "already started" memo: the
    /// controller's runtime reset (DF-28) clears a clock back to unstarted without a restart, and the next tick must
    /// then start it again (a memo would leave it unstarted, stopping white noise and pinning the engine at minute 0
    /// until the next App Service restart). See <see cref="ShouldStartClock"/>: that guard is load-bearing for the
    /// tiered pause.
    /// </summary>
    private void EnsureClockStarted(ReactionLoopRegistration registration)
    {
        if (ShouldStartClock(_exerciseClock, registration.ExerciseId))
        {
            _exerciseClock.Start(registration.ExerciseId, registration.ScenarioStart, registration.TimeZoneInfo);
        }
    }
}

/// <summary>The reaction-loop host cadence options.</summary>
public sealed class ReactionLoopHostOptions
{
    /// <summary>
    /// The wall-clock heartbeat between loop passes (a scheduler cadence, not a scenario-time unit — every
    /// timer the loop <i>reads</i> is scenario time). Defaults to 5 seconds.
    /// </summary>
    public TimeSpan TickInterval { get; set; } = TimeSpan.FromSeconds(5);
}

/// <summary>
/// A persona eligible to voice a storyline in the loop: its generation-facing <see cref="PersonaDossier"/>
/// (voice/style) paired with the persona INSTANCE id (<see cref="InstanceId"/>) a published post is
/// attributed to. The loop keeps the instance id so a burst can be published as an ordinary post by that
/// persona (story 02's approve path resolves it via the shared publish seam).
/// </summary>
/// <param name="InstanceId">The exercise-scoped <see cref="Persona"/> instance id (the <c>authorPersonaId</c>).</param>
/// <param name="Dossier">The persona's generation-facing voice/style dossier.</param>
public sealed record EnginePersona(Guid InstanceId, PersonaDossier Dossier);

/// <summary>
/// One active exercise loop the host ticks — a purely in-memory description of the pre-seeded / controller
/// storylines, the eligible persona cast, the rate governance, and the autonomy state for one exercise. The
/// scenario start + time zone drive story 03's clock. Staff/backend only (XC-002); no participant surface.
/// </summary>
public sealed class ReactionLoopRegistration
{
    /// <summary>The exercise this loop belongs to (COR-001) — the server-authoritative scope for every tick.</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The fictional world + scenario brief (trusted engine context for the system prompt).</summary>
    public required string ExerciseBrief { get; init; }

    /// <summary>
    /// The fictional place name ambient chatter is set in (e.g. the exercise's world name), or <c>null</c>. Ambient
    /// prompts carry ONLY this, via <c>AmbientSettingBrief</c> — never <see cref="ExerciseBrief"/>, which narrates the
    /// incident (ambient-chatter story 01, orchestrator review W-3). Optional; <c>null</c> gives a generic setting.
    /// </summary>
    public string? AmbientPlaceName { get; init; }

    /// <summary>The exercise IANA time zone (XC-008), e.g. <c>America/Chicago</c> — the telemetry envelope zone.</summary>
    public required string TimeZone { get; init; }

    /// <summary>The scenario start instant the clock reads as scenario minute 0 (COR-050).</summary>
    public required DateTimeOffset ScenarioStart { get; init; }

    /// <summary>The <see cref="TimeZoneInfo"/> the scenario instant is expressed in (drives the clock).</summary>
    public required TimeZoneInfo TimeZoneInfo { get; init; }

    /// <summary>The storylines the loop advances (mutable domain objects; ticked in place each pass).</summary>
    public required IReadOnlyList<Storyline> Storylines { get; init; }

    /// <summary>The eligible persona cast, keyed by handle — the dossier + instance id for each participant.</summary>
    public required IReadOnlyDictionary<string, EnginePersona> PersonasByHandle { get; init; }

    /// <summary>The per-exercise rate caps / quiet floors (ADP-011).</summary>
    public RateGovernanceConfig RateConfig { get; init; } = RateGovernanceConfig.Default;

    /// <summary>The engine autonomy state (level resolution + safety clamp) the loop routes on (§8.1).</summary>
    public required EngineAutonomyState Autonomy { get; init; }

    /// <summary>
    /// The controller "desk" the loop's demanded review decisions accrue against (CTL-034
    /// <see cref="WorkloadDemandMeter"/>). A demand measure, never a controller-performance measure.
    /// </summary>
    public required Guid ControllerDeskId { get; init; }

    /// <summary>
    /// The response-matching trust curve for this exercise (ADP-002a, engine-runtime/06). It holds whether a
    /// plausible match of an official post auto-confirms. Off by default: only a human opts in (the
    /// operator's seed request), and the engine never enables it itself (§8.2). Without it, a plausible match
    /// needs the controller's confirmation, which has no console surface yet, so it stays an unaddressed
    /// suggestion that slows the escalation (miss-safe).
    /// </summary>
    public ResponseMatchTrustCurve ResponseMatching { get; init; } = new();

    /// <summary>
    /// The miss-safe slows official posts have left pending on this exercise's storylines (ADP-002a,
    /// engine-runtime/06): each is carried by that storyline's next escalation burst, or removed by a match.
    /// Per registration, so a re-seed starts clean.
    /// </summary>
    public PendingResponseSlows PendingSlows { get; } = new();
}

/// <summary>
/// The in-memory registry of active exercise loops the <see cref="ReactionLoopHost"/> ticks — the seam a
/// later seed/controller path populates. Thread-safe (the host reads it on its scheduler thread; a
/// registration call may arrive on another). Registered as a singleton.
/// </summary>
public interface IReactionLoopRegistry
{
    /// <summary>Registers (or replaces) the loop for its exercise.</summary>
    /// <param name="registration">The exercise loop to activate.</param>
    void Register(ReactionLoopRegistration registration);

    /// <summary>Removes an exercise's loop; returns whether one was present.</summary>
    /// <param name="exerciseId">The exercise whose loop to deactivate.</param>
    /// <returns><c>true</c> if a loop was removed; otherwise <c>false</c>.</returns>
    bool Remove(Guid exerciseId);

    /// <summary>A snapshot of the currently-active exercise loops.</summary>
    IReadOnlyCollection<ReactionLoopRegistration> Active { get; }
}

/// <summary>Default thread-safe <see cref="IReactionLoopRegistry"/> over a concurrent dictionary.</summary>
public sealed class ReactionLoopRegistry : IReactionLoopRegistry
{
    private readonly ConcurrentDictionary<Guid, ReactionLoopRegistration> _loops = new();

    /// <inheritdoc />
    public void Register(ReactionLoopRegistration registration)
    {
        ArgumentNullException.ThrowIfNull(registration);
        _loops[registration.ExerciseId] = registration;
    }

    /// <inheritdoc />
    public bool Remove(Guid exerciseId) => _loops.TryRemove(exerciseId, out _);

    /// <inheritdoc />
    public IReadOnlyCollection<ReactionLoopRegistration> Active => _loops.Values.ToArray();
}

/// <summary>
/// Drives one scenario-time tick for one exercise: measure (advance storylines) → observe → decide →
/// generate (guard-before-human) → enqueue one review item per burst. Owns the per-exercise per-minute
/// counters and the CTL-034 demand meter; the scheduling + scope establishment is
/// <see cref="ReactionLoopHost"/>'s. Registered as a singleton; the scoped collaborators (context, clock,
/// review store) are taken from the tick's scope.
/// </summary>
public sealed partial class ReactionLoopDriver
{
    /// <summary>The default Delayed-auto countdown length in scenario minutes for an enqueued timed burst.</summary>
    public const int DefaultDelayedAutoCountdownMinutes = 5;

    private readonly GenerateStage _generateStage;
    private readonly MeasureStage _measureStage;
    private readonly IEngineTelemetryEmitter _telemetryEmitter;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly EngineTierPolicyRegistry _tierPolicy;
    private readonly IAddressingInbox _addressingInbox;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly ILogger<ReactionLoopDriver> _logger;

    // The decide-stage policies for the two trigger kinds this loop raises. The matched-response reaction
    // (response-reaction/01) shapes an OfficialResponse trigger (gratitude-led burst); silence-escalation
    // (ADP-001, D2) shapes an Inaction trigger, ramping the tone mix from worry toward speculation + anger as the
    // silence runs on past the window. Before D2 only the response behavior was registered, so inaction ran the
    // default composer and its phase-flat mix for the whole Escalating phase. The registry is one behavior PER
    // trigger kind, so the two never compete for the same burst; precedence between a response and an inaction
    // on the same storyline is the loop's (RunTickAsync drops the inaction trigger of a storyline a response
    // just answered, and response work is queued first). Both behaviors start from IntentComposer.Compose, so
    // stop / cap / target gating is unchanged; any other trigger kind still runs the default composer.
    private readonly DecideStage _decideStage = new DecideStage()
        .Register(new ResponseReactionBehavior())
        .Register(new SilenceEscalationBehavior());
    private readonly ConcurrentDictionary<Guid, ExerciseTickState> _tickStates = new();

    /// <summary>Creates the driver over the generate/measure stages, telemetry emitter, scenario clock, and server clock.</summary>
    /// <param name="generateStage">The guard-before-human generate stage.</param>
    /// <param name="measureStage">The storyline-advancement measure stage.</param>
    /// <param name="telemetryEmitter">Builds the observe/decide/generate XC-004 events.</param>
    /// <param name="exerciseClock">The native scenario clock (for the scenario instant on the envelope).</param>
    /// <param name="timeProvider">The server wall-clock source for the telemetry envelope (never client input).</param>
    /// <param name="tierPolicy">The per-exercise model-tier-policy override a controller may set at runtime (story 05).</param>
    /// <param name="addressingInbox">The official posts participants made since the last tick (engine-runtime/06).</param>
    /// <param name="pauseTiers">
    /// The per-exercise pause tier (CTL-023): ENGINE PAUSED holds new storyline work. Required, so a host composed
    /// without <c>AddPauseTierSteering()</c> fails at resolution instead of silently reading every exercise as Running.
    /// </param>
    /// <param name="logger">Records how each official post resolved (matched / needs confirmation / unmatched).</param>
    public ReactionLoopDriver(
        GenerateStage generateStage,
        MeasureStage measureStage,
        IEngineTelemetryEmitter telemetryEmitter,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider,
        EngineTierPolicyRegistry tierPolicy,
        IAddressingInbox addressingInbox,
        PauseTierRegistry pauseTiers,
        ILogger<ReactionLoopDriver> logger)
    {
        ArgumentNullException.ThrowIfNull(generateStage);
        ArgumentNullException.ThrowIfNull(measureStage);
        ArgumentNullException.ThrowIfNull(telemetryEmitter);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(tierPolicy);
        ArgumentNullException.ThrowIfNull(addressingInbox);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(logger);

        _generateStage = generateStage;
        _measureStage = measureStage;
        _telemetryEmitter = telemetryEmitter;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
        _tierPolicy = tierPolicy;
        _addressingInbox = addressingInbox;
        _pauseTiers = pauseTiers;
        _logger = logger;
    }

    /// <summary>
    /// Runs one tick for <paramref name="registration"/> using the scoped services in
    /// <paramref name="scopedServices"/> (the caller has already set the exercise scope). Persists every stage
    /// telemetry event and each enqueued review item within the tick's scoped unit of work. Returns a summary
    /// of the tick for diagnostics/tests.
    /// </summary>
    /// <param name="registration">The exercise loop to tick.</param>
    /// <param name="scopedServices">The tick's scoped service provider (exercise scope already established).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The tick summary (scenario minute, triggers observed, review items enqueued).</returns>
    public async Task<ReactionTickResult> RunTickAsync(
        ReactionLoopRegistration registration,
        IServiceProvider scopedServices,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(registration);
        ArgumentNullException.ThrowIfNull(scopedServices);

        var scenarioClock = scopedServices.GetRequiredService<IScenarioClock>();
        var dbContext = scopedServices.GetRequiredService<PulseDbContext>();
        var reviewStore = scopedServices.GetRequiredService<IEngineReviewStore>();

        var scenarioMinute = scenarioClock.CurrentScenarioMinute;
        var scenarioInstant = _exerciseClock.CurrentScenarioTime(registration.ExerciseId) ?? registration.ScenarioStart;
        var wallClock = _timeProvider.GetUtcNow();

        var context = new EngineTelemetryContext
        {
            ExerciseId = registration.ExerciseId,
            WallClockTime = wallClock,
            ScenarioTime = scenarioInstant,
            TimeZone = registration.TimeZone,
            Channel = "social",
        };

        var tickState = _tickStates.GetOrAdd(
            registration.ExerciseId,
            _ => new ExerciseTickState(new WorkloadDemandMeter(registration.ExerciseId, registration.ControllerDeskId)));
        tickState.RollMinute(scenarioMinute);

        var pendingEvents = new List<TelemetryEvent>();
        var reviewItems = new List<EngineReviewItemEntity>();

        // 1. MEASURE — advance every storyline one tick in scenario time (accrues silence to now + moves
        //    intensity/phase), emitting engine.measured + storyline.state_changed. This refreshes the silence
        //    timers OBSERVE reads, so a jump's blown windows surface here and are observed on the same tick.
        foreach (var storyline in registration.Storylines)
        {
            var measured = _measureStage.Measure(storyline, scenarioClock, context);
            pendingEvents.AddRange(measured.TelemetryEvents);
        }

        // 1b. ENGINE PAUSED (CTL-023 tier 2, world-steering/03 + 07) — "new engine content halts; injects + world
        //     continue". While the exercise's tier is Engine the loop raises NO new storyline work: no inaction
        //     trigger, no decide, no provider call, no engine.generated, no review item. MEASURE above still ran and
        //     the scenario clock keeps going (the tier never freezes it), so silence accrues in real scenario time
        //     and nothing is caught up in one jump on resume. Official posts are still drained and resolved below:
        //     the participants' answers are world events that did happen, so they still address a storyline now.
        //     The cadence is re-based every held tick (HoldReactionCadence) so resuming does not fire one late,
        //     "long silence" burst per storyline on the first tick. Freeze is skipped whole by the host; it is
        //     listed here only as defense in depth, the same pair the ambient publish gate closes on.
        var engineHeld = IsEngineHeld(registration.ExerciseId);
        if (engineHeld)
        {
            HoldReactionCadence(registration.Storylines, scenarioMinute);
        }

        // 2. OBSERVE — the refreshed world for inaction triggers (silence windows elapsed), plus every official
        //    post participants made since the last tick (engine-runtime/06 — until then this was always [], so
        //    no participant post could ever address a storyline). The reaction cadence (ADP-011) suppresses
        //    re-reacting to the SAME ongoing silence every tick: an unaddressed storyline re-fires at most once
        //    per MinMinutesBetweenInactionReactions scenario minutes. Draining is at-most-once, which is safer
        //    than resolving a post twice: a tick that faults later keeps its posts' in-memory effects (an
        //    addressed storyline, pending slows) but loses their telemetry and any response burst.
        var observed = ObserveStage.Observe(
            registration.Storylines,
            _addressingInbox.Drain(registration.ExerciseId),
            scenarioClock,
            registration.RateConfig.MinMinutesBetweenInactionReactions);

        // Held by the Engine tier: drop the inaction triggers outright (the re-based cadence already suppresses them
        // unless the cadence gate is disabled with 0), so no engine.observed is emitted for work that will not run.
        IReadOnlyList<InactionTrigger> inactionTriggers = engineHeld ? [] : observed.InactionTriggers;
        foreach (var trigger in inactionTriggers)
        {
            pendingEvents.Add(BuildObservedEvent(context, trigger));
        }

        // 2b. RESPOND — resolve each official post with the miss-safe resolver (ADP-002/002a). A genuine match
        //     addresses its storyline now (silence clock reset, intensity bent down, phase → Addressed); anything
        //     else is never treated as silence, but leaves the escalation it may have answered slowed until that
        //     storyline's next burst (never paused).
        var responses = ResolveOfficialPosts(registration, observed.AddressingCandidates, scenarioMinute, context, pendingEvents);

        // CTL-034 (D4): every official post the engine could not confirm on its own asks the controller for a
        // response-match decision ("does this address X? Y/N"). That prompt is controller demand exactly like a
        // queue fire, so it is metered on the SAME per-minute meter BEFORE any burst is decided below (the CTL-034
        // accounting and telemetry stay honest), and ordinarily the bursts get only the budget the prompts left.
        // Participant/PIO posts cannot be throttled, so prompts are always recorded. How far prompt demand may
        // squeeze the engine's own work is bounded by the gate in the work loop below (see PassesDemandGate).
        //
        // autoConfirmEarned is deliberately false, not registration.ResponseMatching.AutoConfirmEnabled: with
        // auto-confirm on, a plausible post resolves straight to Matched and is never counted here at all, so every
        // post that DOES reach this line (Unmatched, or NeedsConfirmation with auto-confirm off) still needs a human's
        // Y/N. Passing the opt-in flag would price those genuine prompts at zero. (The reaction-correctness harness,
        // ReactionScenario.ControllerDemandPerMinute, mirrors this.)
        var promptDemand = responses.MatchPrompts * DemandAccounting.MatchPromptDemand(autoConfirmEarned: false);
        for (var i = 0; i < promptDemand; i++)
        {
            tickState.DemandMeter.Record(DemandEventKind.ResponseMatchPrompt, scenarioMinute);
        }

        tickState.PromptDemandThisMinute += promptDemand;

        // 3-5. DECIDE → GENERATE → enqueue. Response reactions go first (the responder's moment), then the
        //       inaction bursts, minus any storyline a response just answered (it is no longer silent). CTL-034:
        //       never demand more than the budget of controller decisions per scenario minute — one burst = one
        //       decision, counted together with this minute's response-match prompts (recorded above) — subject to
        //       the miss-safe minimum service in PassesDemandGate (prompt demand alone never starves the engine).
        //       Under the Engine tier the work list stays empty: a response burst is new engine content too, so the
        //       answer is applied to the storyline above but not voiced.
        IReadOnlyList<Storyline> voiced = engineHeld ? [] : responses.Voiced;
        var work = new List<(Storyline Storyline, ReactionTriggerKind Kind)>();
        foreach (var addressed in voiced)
        {
            work.Add((addressed, ReactionTriggerKind.OfficialResponse));
        }

        foreach (var trigger in inactionTriggers)
        {
            if (responses.IsAnswered(trigger.StorylineId))
            {
                continue;
            }

            var silent = registration.Storylines.FirstOrDefault(s => s.Id == trigger.StorylineId);
            if (silent is not null)
            {
                work.Add((silent, ReactionTriggerKind.Inaction));
            }
        }

        var storylineIntents = 0;
        foreach (var (storyline, kind) in work)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!PassesDemandGate(tickState, storyline, kind, scenarioMinute))
            {
                continue;
            }

            var reactionContext = BuildReactionContext(registration, storyline, kind, tickState, scenarioMinute);
            var intent = _decideStage.Decide(reactionContext);
            if (intent is null)
            {
                continue;
            }

            storylineIntents++;

            // Miss-safe (ADP-002a): an official post that was seen but not matched left this storyline's escalation
            // slowed — fewer voices this burst, never zero. The slow is spent only once a burst actually carries it
            // to the review queue (below), so a dropped burst leaves it pending for the next one.
            var slowed = kind == ReactionTriggerKind.Inaction && registration.PendingSlows.IsPending(storyline.Id);
            if (slowed)
            {
                intent = MissSafeResolver.Slow(intent);
            }

            pendingEvents.Add(BuildDecidedEvent(context, intent, tickState.PostsThisMinute));

            // The per-exercise model-tier override (story 05), applied at the decide stage's own call site —
            // immediately after IntentComposer.Compose (via DecideStage) returned this intent and before the
            // generate request is built. TierPolicyMode.Auto resolves to intent.Tier unchanged, restoring the
            // purpose-based static map (IntentComposer.TierFor) as the decision. This is a READ of shared
            // process state, so a controller's choice is live for this very burst — no redeploy, no restart.
            var tier = _tierPolicy.ResolveTier(registration.ExerciseId, intent.Tier);

            var draftId = Guid.NewGuid();
            var generateResult = await _generateStage
                .GenerateAsync(BuildGenerateRequest(registration, storyline, intent, tier), cancellationToken)
                .ConfigureAwait(false);

            pendingEvents.Add(BuildGeneratedEvent(context, storyline, draftId, generateResult));

            // A guard-failing or diversity-failing burst is dropped here — it never becomes a review item (§8.5).
            if (generateResult.Disposition != GenerateDisposition.Accepted)
            {
                continue;
            }

            var reviewItem = BuildReviewItem(registration.ExerciseId, storyline, intent, generateResult.Posts, draftId, scenarioMinute);
            reviewItems.Add(reviewItem);

            // One demanded decision per burst (CTL-034); rate-account the burst's posts for this minute.
            tickState.DemandMeter.Record(DemandEventKind.QueueFire, scenarioMinute);
            tickState.PostsThisMinute += reviewItem.Posts.Count;

            // Record an inaction reaction so the next tick's Observe suppresses re-reacting to this storyline's
            // ongoing silence until the reaction cadence elapses (ADP-011). Does NOT reset the silence clock — an
            // engine reaction is not an official response, so anxiety keeps building while officials stay silent.
            if (kind == ReactionTriggerKind.Inaction)
            {
                storyline.RecordEngineReaction(scenarioMinute);
            }

            if (slowed)
            {
                registration.PendingSlows.Remove(storyline.Id);
            }
        }

        // 6. AMBIENT (ambient-chatter story 01) — the lowest-priority quiet-floor policy, AFTER all storyline work so it
        //    yields to any storyline intent this tick. A no-op unless a controller set a non-off ambient policy.
        var ambientPublished = await RunAmbientAsync(
            new AmbientTickInputs(registration, scopedServices, dbContext, context, tickState, scenarioMinute, scenarioInstant, storylineIntents),
            pendingEvents,
            reviewItems,
            cancellationToken).ConfigureAwait(false);

        await PersistAsync(dbContext, reviewStore, pendingEvents, reviewItems, cancellationToken).ConfigureAwait(false);

        // Broadcast AFTER commit so a freshly enqueued inject reaches the controller cockpit live (no manual
        // refresh) while staying consistent with a reconnect refetch. The scope stays server-derived
        // (registration.ExerciseId, COR-001). IEngineReviewBroadcaster is Scoped; resolve it per tick from the
        // tick's scope, never inject it into this singleton driver. It is provided by AddEngineReview(), which
        // Program.cs co-wires with AddReactionLoopHost() — GetRequiredService is deliberate: a loop registered
        // WITHOUT the review services is a composition error that should fail loud, never silently drop the
        // push (which would resurface the very "queue only updates on refresh" bug this broadcast fixes).
        if (reviewItems.Count > 0)
        {
            var broadcaster = scopedServices.GetRequiredService<IEngineReviewBroadcaster>();
            foreach (var item in reviewItems)
            {
                await broadcaster
                    .BroadcastReviewItemChangedAsync(registration.ExerciseId, EngineReviewItemDto.FromEntity(item), cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        return new ReactionTickResult(scenarioMinute, inactionTriggers.Count, reviewItems.Count, ambientPublished);
    }

    /// <summary>
    /// Whether exercise <paramref name="exerciseId"/>'s pause tier holds new engine content: <see cref="PauseTier.Engine"/>
    /// (or <see cref="PauseTier.Freeze"/>, which the host already skips whole). Read from the singleton
    /// <see cref="PauseTierRegistry"/> (constructor-injected, the SAME instance the pause-tier endpoint writes), keyed by
    /// the tick's own server-derived exercise (COR-001), exactly as <see cref="InterimEngineLifecyclePublishGate"/> reads it.
    /// </summary>
    private bool IsEngineHeld(Guid exerciseId) =>
        _pauseTiers.GetTier(exerciseId) is PauseTier.Engine or PauseTier.Freeze;

    /// <summary>
    /// Re-bases the reaction cadence (ADP-011) of every storyline that could raise an inaction trigger — unaddressed and
    /// silent past its window — to <paramref name="scenarioMinute"/>, on each tick the Engine tier holds the loop. On
    /// resume the observe stage then sees the cadence as just started, so the storylines re-fire on the normal cadence
    /// instead of all at once on the first tick. Only the engine's own reaction marker moves:
    /// <see cref="Storyline.MinutesSinceLastOfficialResponse"/> is untouched, because the officials' silence during the
    /// pause really happened and keeps shaping intensity and tone.
    /// </summary>
    private static void HoldReactionCadence(IReadOnlyList<Storyline> storylines, int scenarioMinute)
    {
        foreach (var storyline in storylines)
        {
            if (storyline.Phase is StorylinePhase.Seeded or StorylinePhase.Escalating or StorylinePhase.Peak
                && storyline.MinutesSinceLastOfficialResponse >= storyline.ResponseWindowMin)
            {
                storyline.RecordEngineReaction(scenarioMinute);
            }
        }
    }

    /// <summary>
    /// The CTL-034 demand gate for one unit of storyline work (D4 + the miss-safe minimum service, PR #634 CR-001/W-001).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The rule.</b> With <c>total</c> = all demand metered this scenario minute (engine queue fires + response-match
    /// prompts) and <c>engine</c> = the engine-originated part (<c>total</c> minus this minute's prompt demand):
    /// </para>
    /// <list type="number">
    ///   <item><b>OfficialResponse</b> work (the gratitude/response burst) passes while <c>engine &lt; cap</c>. It is
    ///   never gated by prompt demand: a response burst is voiced only on the tick the storyline was addressed (the
    ///   voiced list is tick-local), so a prompt-saturated minute would otherwise lose it permanently.</item>
    ///   <item><b>Inaction</b> work passes while <c>total &lt; cap</c> (the ordinary CTL-034 budget, prompts included);
    ///   OR, when the engine has demanded NOTHING yet this minute (<c>engine == 0</c>) and the storyline is actively
    ///   escalating (Escalating/Peak), it passes anyway — the minimum service of one escalation burst.</item>
    /// </list>
    /// <para>
    /// <b>Why.</b> Miss-safe (ADP-002a) outranks CTL-034 when the demand comes from participants/PIOs we cannot
    /// throttle. If prompt demand alone could exhaust the budget, a stream of six irrelevant official posts a minute
    /// would silence the world entirely — exactly the gaming vector ADP-002a forbids ("unmatched official content
    /// slows escalation, never pauses it"). So total demand can exceed the cap, but only by engine minimum service:
    /// at most one inaction burst per minute plus response work bounded by the engine-only cap. When prompts do not
    /// saturate the budget (e.g. 24 blown storylines + 1 prompt/min), the guarantee never applies — the engine has
    /// already fired that minute — and total demand stays at or below the cap.
    /// </para>
    /// </remarks>
    private static bool PassesDemandGate(ExerciseTickState tickState, Storyline storyline, ReactionTriggerKind kind, int scenarioMinute)
    {
        var total = tickState.DemandMeter.DemandInWindow(scenarioMinute);
        var engine = Math.Max(0, total - tickState.PromptDemandThisMinute);

        if (kind == ReactionTriggerKind.OfficialResponse)
        {
            return engine < WorkloadDemandMeter.BudgetPerMinute;
        }

        if (total < WorkloadDemandMeter.BudgetPerMinute)
        {
            return true;
        }

        return engine == 0 && storyline.Phase is StorylinePhase.Escalating or StorylinePhase.Peak;
    }

    /// <summary>Persists the tick's telemetry + review items in the scoped unit of work (one review item per burst, via the store).</summary>
    private static async Task PersistAsync(
        PulseDbContext dbContext,
        IEngineReviewStore reviewStore,
        List<TelemetryEvent> pendingEvents,
        List<EngineReviewItemEntity> reviewItems,
        CancellationToken cancellationToken)
    {
        if (pendingEvents.Count > 0)
        {
            dbContext.TelemetryEvents.AddRange(pendingEvents);
        }

        if (reviewItems.Count > 0)
        {
            // The store shares this scoped context, so the first enqueue's SaveChanges also flushes the
            // pending stage telemetry — the burst's decision and its telemetry land in one unit of work.
            foreach (var item in reviewItems)
            {
                await reviewStore.EnqueueAsync(item, cancellationToken).ConfigureAwait(false);
            }
        }
        else if (pendingEvents.Count > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Resolves this tick's official posts against the storylines (ADP-002/002a, engine-runtime/06). Per post it
    /// emits one <c>engine.observed</c> (<c>action-seen</c>) against the storyline the resolver names (a match, or
    /// a suggestion awaiting confirmation) and none for a post that relates to nothing; applies a genuine match
    /// (silence clock reset, bend-down, phase → Addressed, with the resulting storyline telemetry); and otherwise
    /// leaves a miss-safe slow pending: on the suggested storyline for an unconfirmed match (unless it is already
    /// addressed), and on every actively escalating storyline when the post's target is unknown. Counts, on the
    /// returned resolutions, every official post that was NOT confirmed as a match (needs confirmation or unmatched):
    /// each raises one response-match prompt the CTL-034 budget must meter (D4). An off-platform marker is the
    /// controller's own action, not a prompt to them, so it is never counted.
    /// </summary>
    private OfficialPostResolutions ResolveOfficialPosts(
        ReactionLoopRegistration registration,
        IReadOnlyList<AddressingCandidate> candidates,
        int scenarioMinute,
        EngineTelemetryContext context,
        List<TelemetryEvent> pendingEvents)
    {
        var resolutions = new OfficialPostResolutions();
        foreach (var candidate in candidates)
        {
            var resolution = MissSafeResolver.Resolve(
                candidate, registration.Storylines, registration.ResponseMatching.AutoConfirmEnabled);

            // Attribute the observation only to a storyline the resolver named and this registration still holds.
            // The matcher suggests SOME storyline whenever one exists, even at zero confidence, so falling back to
            // its best guess would record every off-topic post as an answer to storyline[0] (E10 reads these).
            var target = resolution.StorylineId is { } namedId
                ? registration.Storylines.FirstOrDefault(s => s.Id == namedId)
                : null;
            if (target is not null)
            {
                pendingEvents.Add(BuildActionSeenEvent(context, target.Id, candidate.ScenarioMinute));
            }

            LogOfficialPostResolved(candidate.Reference, resolution.Kind, resolution.Confidence, target?.Id);

            if (candidate.Source == AddressingSource.OfficialPost && resolution.Kind != MatchKind.Matched)
            {
                resolutions.AddMatchPrompt();
            }

            if (resolution.Kind == MatchKind.Matched && target is not null)
            {
                var sentimentBefore = target.Sentiment;
                var raised = MissSafeResolver.Apply(resolution, target, scenarioMinute);
                pendingEvents.AddRange(_measureStage.MapStorylineEvents(
                    raised, target.Sentiment - sentimentBefore, amplification: 0.0, context));
                registration.PendingSlows.Remove(target.Id);

                // Voice a response only when THIS answer addressed the storyline. A later answer to a storyline that
                // is already addressed still resets its clock and bends it (storyline-model's rule) but draws no
                // second burst: N follow-up posts must not become N gratitude waves and N review decisions (CTL-034).
                var addressedNow = raised.OfType<StorylineStateChanged>().Any(change => change.To == StorylinePhase.Addressed);
                resolutions.AddAnswered(target, voice: addressedNow);
            }
            else if (resolution.Kind == MatchKind.NeedsConfirmation && target is not null)
            {
                // A plausible answer slows its storyline even before the window opens (it may pre-empt the
                // concern), but one already addressed has no escalation left to slow.
                if (StorylineStateMachine.CanTransition(target.Phase, StorylineTrigger.OfficialResponseMatched))
                {
                    registration.PendingSlows.Add(target.Id);
                }
            }
            else
            {
                // Unmatched, or a match naming a storyline this registration no longer holds (a stale marker hint):
                // the target is unknown, so every ACTIVELY escalating storyline is slowed (ADP-002a: "all active
                // storyline escalation"). A Seeded storyline is not escalating yet: an unrelated post made before
                // its window opens must not soften its first burst minutes later.
                foreach (var storyline in registration.Storylines)
                {
                    if (storyline.Phase is StorylinePhase.Escalating or StorylinePhase.Peak)
                    {
                        registration.PendingSlows.Add(storyline.Id);
                    }
                }
            }
        }

        return resolutions;
    }

    /// <summary>Builds the eligible-cast <see cref="ReactionContext"/> for a storyline from the registration.</summary>
    private static ReactionContext BuildReactionContext(
        ReactionLoopRegistration registration,
        Storyline storyline,
        ReactionTriggerKind trigger,
        ExerciseTickState tickState,
        int scenarioMinute)
    {
        var eligible = new List<PersonaDossier>();
        foreach (var handle in storyline.ParticipatingPersonas)
        {
            if (registration.PersonasByHandle.TryGetValue(handle, out var persona))
            {
                eligible.Add(persona.Dossier);
            }
        }

        return new ReactionContext
        {
            Storyline = storyline,
            Trigger = trigger,
            Autonomy = registration.Autonomy.ResolveEffective(storyline.Id),
            EligiblePersonas = eligible,
            RateConfig = registration.RateConfig,
            PostsThisMinute = tickState.PostsThisMinute,
            ScenarioMinute = scenarioMinute,
        };
    }

    /// <summary>
    /// Builds the generate-stage request from a decided intent (storyline brief + eligible cast + tier). The brief's
    /// tone mix is the DECIDED intent's (D3), not the storyline's phase-derived projection: the decide-stage
    /// behaviors exist to shape the burst's tone (a gratitude-led response reaction, the silence-escalation ramp),
    /// so the mix the provider is asked for must be the mix that was decided and logged on <c>engine.decided</c>.
    /// Every other brief field still comes from <see cref="StorylineBriefProjection.ToBrief"/>. For a trigger that
    /// runs the default composer the two are identical (<see cref="IntentComposer"/> copies the projection's mix).
    /// </summary>
    /// <param name="registration">The exercise loop being ticked.</param>
    /// <param name="storyline">The storyline the burst voices.</param>
    /// <param name="intent">The decided generation intent.</param>
    /// <param name="tier">
    /// The tier to generate at: <paramref name="intent"/>'s own tier, unless the exercise has a controller-set
    /// tier-policy override (story 05), in which case that wins.
    /// </param>
    private static GenerateStageRequest BuildGenerateRequest(
        ReactionLoopRegistration registration,
        Storyline storyline,
        GenerationIntent intent,
        GenerationTier tier) => new()
        {
            ExerciseId = registration.ExerciseId,
            ExerciseBrief = registration.ExerciseBrief,
            Storyline = storyline.ToBrief() with { ToneMix = intent.ToneMix },
            Personas = intent.Personas,
            Tier = tier,
        };

    /// <summary>Builds the one review item for an accepted burst (Suggest → queued; Delayed-auto → counting down).</summary>
    /// <param name="exerciseId">The tick's resolved server-authoritative scope — the review item is stamped with THIS, never the storyline's own field (COR-001).</param>
    private static EngineReviewItemEntity BuildReviewItem(
        Guid exerciseId,
        Storyline storyline,
        GenerationIntent intent,
        IReadOnlyList<GeneratedPost> posts,
        Guid draftId,
        int scenarioMinute)
    {
        // Defense in depth (COR-001, WR-001): the review item MUST carry the tick's resolved scope, and a
        // storyline whose ExerciseId disagrees with it is a corrupt registration — enqueuing it would file
        // exercise A's draft under exercise B's review queue (the PulseDbContext write-guard only rejects an
        // empty scope, not a scope/entity mismatch). Fail loud rather than silently enqueue; the host's
        // TickExerciseAsync isolates and logs the fault so the loop keeps running for other exercises.
        if (storyline.ExerciseId != exerciseId)
        {
            throw new InvalidOperationException(
                $"Storyline {storyline.Id} carries ExerciseId {storyline.ExerciseId} but the tick's resolved scope is {exerciseId}; a cross-exercise review item is forbidden (COR-001).");
        }

        var isDelayedAuto = intent.AutonomyLevel == AutonomyLevel.DelayedAuto;
        var tag = storyline.Hashtags.Count > 0 ? storyline.Hashtags[0] : $"#{Slug(storyline.Title)}";

        // Attribute each post to its persona by position — the burst is "one post per persona" (§5.2), so
        // post[i] is intent.Personas[i]; the persona's own handle is authoritative (a provider may return a
        // placeholder handle). Bounded by the smaller of the two counts, defensively. Each text is fitted to the
        // ingest ceiling here (Wave 3 Gate-2 M-1): a draft the funnel would refuse can never be approved or
        // auto-sent, so an over-long model output is cut (whole graphemes + an ellipsis) before anyone sees it.
        var draftPosts = new List<EngineReviewDraftPost>();
        var count = System.Math.Min(posts.Count, intent.Personas.Count);
        for (var i = 0; i < count; i++)
        {
            var post = posts[i];
            draftPosts.Add(new EngineReviewDraftPost
            {
                PersonaHandle = intent.Personas[i].Handle,
                Text = EngineDraftText.FitToCeiling(post.Text),
                Sentiment = post.Sentiment,
                Hashtags = post.Hashtags.ToList(),
            });
        }

        return new EngineReviewItemEntity
        {
            DraftId = draftId,
            ExerciseId = exerciseId,
            StorylineId = storyline.Id,
            RoutedAtLevel = intent.AutonomyLevel,
            Disposition = isDelayedAuto ? DraftDisposition.CountingDown : DraftDisposition.Queued,
            CountdownStartedScenarioMinute = isDelayedAuto ? scenarioMinute : null,
            CountdownMinutes = isDelayedAuto ? DefaultDelayedAutoCountdownMinutes : null,
            CountdownDecision = isDelayedAuto ? ControllerDecision.None : null,
            StorylineTag = tag,
            StorylineBrief = storyline.Title,
            ActionLabel = $"post · {tag}",
            Posts = draftPosts,
        };
    }

    /// <summary>Builds the <c>engine.observed</c> event for one inaction trigger.</summary>
    private TelemetryEvent BuildObservedEvent(EngineTelemetryContext context, InactionTrigger trigger)
    {
        var payload = new EngineEventPayloads.Observed
        {
            Trigger = "inaction-timer",
            Storyline = trigger.StorylineId.ToString(),
            ScenarioMinute = trigger.ScenarioMinute,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Observed, context, payload);
    }

    /// <summary>
    /// Builds the <c>engine.observed</c> event for an official post the loop saw (engine-runtime/06), using the
    /// taxonomy's documented <c>action-seen</c> trigger, so the pinned payload shape is unchanged. Whether the
    /// post matched is recorded by the <c>storyline.state_changed</c> (cause <c>matched-response</c>) that a
    /// match raises, and in the resolution log line.
    /// </summary>
    private TelemetryEvent BuildActionSeenEvent(EngineTelemetryContext context, Guid storylineId, int scenarioMinute)
    {
        var payload = new EngineEventPayloads.Observed
        {
            Trigger = "action-seen",
            Storyline = storylineId.ToString(),
            ScenarioMinute = scenarioMinute,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Observed, context, payload);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Information,
        Message = "Official post {Reference} resolved as {Kind} (confidence {Confidence}) against storyline {StorylineId}.")]
    private partial void LogOfficialPostResolved(string reference, MatchKind kind, double confidence, Guid? storylineId);

    /// <summary>
    /// What one tick's official posts answered: every storyline a genuine match reached (never also voiced as an
    /// inaction burst this tick), and among them the ones this tick's answer moved to Addressed, each voiced once
    /// as a response reaction. Miss-safe slows outlive the tick, so they live on the registration instead.
    /// </summary>
    private sealed class OfficialPostResolutions
    {
        private readonly HashSet<Guid> _answered = [];

        /// <summary>The storylines to voice a response reaction for, in resolution order.</summary>
        public List<Storyline> Voiced { get; } = [];

        public void AddAnswered(Storyline storyline, bool voice)
        {
            if (_answered.Add(storyline.Id) && voice)
            {
                Voiced.Add(storyline);
            }
        }

        public bool IsAnswered(Guid storylineId) => _answered.Contains(storylineId);

        /// <summary>Response-match prompts this tick raised: official posts the engine could not confirm on its own (CTL-034, D4).</summary>
        public int MatchPrompts { get; private set; }

        public void AddMatchPrompt() => MatchPrompts++;
    }

    /// <summary>Builds the <c>engine.decided</c> event (personas / tone mix / count / autonomy / rate-cap state).</summary>
    private TelemetryEvent BuildDecidedEvent(EngineTelemetryContext context, GenerationIntent intent, int postsThisMinute)
    {
        var rateCapState = postsThisMinute > 0 ? "in-window" : "ok";
        var payload = new EngineEventPayloads.Decided
        {
            Storyline = intent.StorylineId.ToString(),
            Personas = intent.Personas.Select(persona => persona.Handle).ToList(),
            ToneMix = DescribeToneMix(intent.ToneMix),
            Count = intent.Count,
            AutonomyLevel = intent.AutonomyLevel,
            RateCapState = rateCapState,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Decided, context, payload);
    }

    /// <summary>Builds the <c>engine.generated</c> event (provider / model / token usage / latency / guard result).</summary>
    private TelemetryEvent BuildGeneratedEvent(
        EngineTelemetryContext context,
        Storyline storyline,
        Guid draftId,
        GenerateStageResult result)
    {
        var generation = result.Generation;
        var usage = generation?.Usage ?? new GenerationUsage(0, 0);

        var payload = new EngineEventPayloads.Generated
        {
            Storyline = storyline.Id.ToString(),
            DraftId = draftId.ToString(),
            Provider = generation?.ProviderName ?? "unknown",
            Model = generation?.Model ?? "unknown",
            TokenUsage = new EngineEventPayloads.TokenUsage
            {
                InputTokens = usage.InputTokens,
                OutputTokens = usage.OutputTokens,
                CacheReadInputTokens = usage.CacheReadInputTokens,
                CacheCreationInputTokens = usage.CacheCreationInputTokens,
            },
            LatencyMs = generation?.Latency.TotalMilliseconds ?? 0.0,
            GuardResult = result.GuardResult,
        };

        return _telemetryEmitter.BuildEvent(EngineEventTypes.Generated, context, payload);
    }

    /// <summary>A compact human descriptor of the burst tone mix for the <c>engine.decided</c> payload.</summary>
    private static string DescribeToneMix(ToneMix tone)
    {
        var parts = new List<(string Name, double Value)>
        {
            ("worry", tone.Worry),
            ("anger", tone.Anger),
            ("speculation", tone.Speculation),
            ("gratitude", tone.Gratitude),
            ("skepticism", tone.Skepticism),
            ("calm", tone.Calm),
        };

        var dominant = parts.OrderByDescending(p => p.Value).First();
        return dominant.Value > 0
            ? $"{dominant.Name} {dominant.Value.ToString("0.00", CultureInfo.InvariantCulture)}"
            : "neutral";
    }

    /// <summary>A hashtag-safe slug of a storyline title, for the review card's fallback tag.</summary>
    private static string Slug(string title)
    {
        var chars = title.Where(char.IsLetterOrDigit).ToArray();
        return chars.Length > 0 ? new string(chars) : "Storyline";
    }

    /// <summary>Per-exercise runtime state: the demand meter + the current scenario minute's post counter.</summary>
    private sealed class ExerciseTickState
    {
        public ExerciseTickState(WorkloadDemandMeter demandMeter)
        {
            DemandMeter = demandMeter;
            CurrentMinute = -1;
        }

        public WorkloadDemandMeter DemandMeter { get; }

        public int CurrentMinute { get; private set; }

        public int PostsThisMinute { get; set; }

        /// <summary>
        /// Response-match prompt demand recorded this scenario minute, so the demand gate can separate engine-originated
        /// demand from participant/PIO-originated prompt demand (the meter's one-minute window is this minute).
        /// </summary>
        public int PromptDemandThisMinute { get; set; }

        /// <summary>Resets the per-minute post and prompt counters when the scenario minute advances.</summary>
        public void RollMinute(int scenarioMinute)
        {
            if (scenarioMinute != CurrentMinute)
            {
                CurrentMinute = scenarioMinute;
                PostsThisMinute = 0;
                PromptDemandThisMinute = 0;
            }
        }
    }
}

/// <summary>The summary of one reaction-loop tick — for diagnostics and tests.</summary>
/// <param name="ScenarioMinute">The scenario minute the tick evaluated at.</param>
/// <param name="InactionTriggers">How many inaction triggers observe surfaced this tick.</param>
/// <param name="ReviewItemsEnqueued">How many review items (one per accepted burst) were enqueued this tick.</param>
/// <param name="AmbientPostsPublished">How many ambient posts the autonomous ambient path published this tick (ambient-chatter 01).</param>
public sealed record ReactionTickResult(int ScenarioMinute, int InactionTriggers, int ReviewItemsEnqueued, int AmbientPostsPublished = 0);
