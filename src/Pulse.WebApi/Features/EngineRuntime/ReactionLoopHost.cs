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
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Review;
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
    private readonly HashSet<Guid> _startedClocks = [];

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
    /// Starts an exercise's scenario clock once, on first sight. Never restarts an already-running or frozen
    /// clock (that would reset the scenario minute) — a controller/seed path or a test may have already
    /// started, jumped, or frozen it.
    /// </summary>
    private void EnsureClockStarted(ReactionLoopRegistration registration)
    {
        if (_startedClocks.Contains(registration.ExerciseId))
        {
            return;
        }

        _startedClocks.Add(registration.ExerciseId);

        if (!_exerciseClock.IsRunning(registration.ExerciseId) && !_exerciseClock.IsFrozen(registration.ExerciseId))
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
public sealed class ReactionLoopDriver
{
    /// <summary>The default Delayed-auto countdown length in scenario minutes for an enqueued timed burst.</summary>
    public const int DefaultDelayedAutoCountdownMinutes = 5;

    private readonly GenerateStage _generateStage;
    private readonly MeasureStage _measureStage;
    private readonly IEngineTelemetryEmitter _telemetryEmitter;
    private readonly IExerciseClock _exerciseClock;
    private readonly TimeProvider _timeProvider;
    private readonly DecideStage _decideStage = new();
    private readonly ConcurrentDictionary<Guid, ExerciseTickState> _tickStates = new();

    /// <summary>Creates the driver over the generate/measure stages, telemetry emitter, scenario clock, and server clock.</summary>
    /// <param name="generateStage">The guard-before-human generate stage.</param>
    /// <param name="measureStage">The storyline-advancement measure stage.</param>
    /// <param name="telemetryEmitter">Builds the observe/decide/generate XC-004 events.</param>
    /// <param name="exerciseClock">The native scenario clock (for the scenario instant on the envelope).</param>
    /// <param name="timeProvider">The server wall-clock source for the telemetry envelope (never client input).</param>
    public ReactionLoopDriver(
        GenerateStage generateStage,
        MeasureStage measureStage,
        IEngineTelemetryEmitter telemetryEmitter,
        IExerciseClock exerciseClock,
        TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(generateStage);
        ArgumentNullException.ThrowIfNull(measureStage);
        ArgumentNullException.ThrowIfNull(telemetryEmitter);
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _generateStage = generateStage;
        _measureStage = measureStage;
        _telemetryEmitter = telemetryEmitter;
        _exerciseClock = exerciseClock;
        _timeProvider = timeProvider;
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

        // 2. OBSERVE — the refreshed world for inaction triggers (silence windows elapsed).
        var observed = ObserveStage.Observe(registration.Storylines, addressing: [], scenarioClock);
        foreach (var trigger in observed.InactionTriggers)
        {
            pendingEvents.Add(BuildObservedEvent(context, trigger));
        }

        // 3-5. DECIDE → GENERATE → enqueue, per trigger. CTL-034: never demand more than the budget of
        //       review decisions per scenario minute — one burst = one decision.
        foreach (var trigger in observed.InactionTriggers)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (tickState.DemandMeter.DemandInWindow(scenarioMinute) >= WorkloadDemandMeter.BudgetPerMinute)
            {
                break;
            }

            var storyline = registration.Storylines.FirstOrDefault(s => s.Id == trigger.StorylineId);
            if (storyline is null)
            {
                continue;
            }

            var reactionContext = BuildReactionContext(registration, storyline, tickState, scenarioMinute);
            var intent = _decideStage.Decide(reactionContext);
            if (intent is null)
            {
                continue;
            }

            pendingEvents.Add(BuildDecidedEvent(context, intent, tickState.PostsThisMinute));

            var draftId = Guid.NewGuid();
            var generateResult = await _generateStage
                .GenerateAsync(BuildGenerateRequest(registration, storyline, intent), cancellationToken)
                .ConfigureAwait(false);

            pendingEvents.Add(BuildGeneratedEvent(context, storyline, draftId, generateResult));

            // A guard-failing or diversity-failing burst is dropped here — it never becomes a review item (§8.5).
            if (generateResult.Disposition != GenerateDisposition.Accepted)
            {
                continue;
            }

            var reviewItem = BuildReviewItem(storyline, intent, generateResult.Posts, draftId, scenarioMinute);
            reviewItems.Add(reviewItem);

            // One demanded decision per burst (CTL-034); rate-account the burst's posts for this minute.
            tickState.DemandMeter.Record(DemandEventKind.QueueFire, scenarioMinute);
            tickState.PostsThisMinute += reviewItem.Posts.Count;
        }

        await PersistAsync(dbContext, reviewStore, pendingEvents, reviewItems, cancellationToken).ConfigureAwait(false);

        return new ReactionTickResult(scenarioMinute, observed.InactionTriggers.Count, reviewItems.Count);
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

    /// <summary>Builds the eligible-cast <see cref="ReactionContext"/> for a storyline from the registration.</summary>
    private static ReactionContext BuildReactionContext(
        ReactionLoopRegistration registration,
        Storyline storyline,
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
            Trigger = ReactionTriggerKind.Inaction,
            Autonomy = registration.Autonomy.ResolveEffective(storyline.Id),
            EligiblePersonas = eligible,
            RateConfig = registration.RateConfig,
            PostsThisMinute = tickState.PostsThisMinute,
            ScenarioMinute = scenarioMinute,
        };
    }

    /// <summary>Builds the generate-stage request from a decided intent (storyline brief + eligible cast + tier).</summary>
    private static GenerateStageRequest BuildGenerateRequest(
        ReactionLoopRegistration registration,
        Storyline storyline,
        GenerationIntent intent) => new()
        {
            ExerciseId = registration.ExerciseId,
            ExerciseBrief = registration.ExerciseBrief,
            Storyline = storyline.ToBrief(),
            Personas = intent.Personas,
            Tier = intent.Tier,
        };

    /// <summary>Builds the one review item for an accepted burst (Suggest → queued; Delayed-auto → counting down).</summary>
    private static EngineReviewItemEntity BuildReviewItem(
        Storyline storyline,
        GenerationIntent intent,
        IReadOnlyList<GeneratedPost> posts,
        Guid draftId,
        int scenarioMinute)
    {
        var isDelayedAuto = intent.AutonomyLevel == AutonomyLevel.DelayedAuto;
        var tag = storyline.Hashtags.Count > 0 ? storyline.Hashtags[0] : $"#{Slug(storyline.Title)}";

        // Attribute each post to its persona by position — the burst is "one post per persona" (§5.2), so
        // post[i] is intent.Personas[i]; the persona's own handle is authoritative (a provider may return a
        // placeholder handle). Bounded by the smaller of the two counts, defensively.
        var draftPosts = new List<EngineReviewDraftPost>();
        var count = System.Math.Min(posts.Count, intent.Personas.Count);
        for (var i = 0; i < count; i++)
        {
            var post = posts[i];
            draftPosts.Add(new EngineReviewDraftPost
            {
                PersonaHandle = intent.Personas[i].Handle,
                Text = post.Text,
                Sentiment = post.Sentiment,
                Hashtags = post.Hashtags.ToList(),
            });
        }

        return new EngineReviewItemEntity
        {
            DraftId = draftId,
            ExerciseId = storyline.ExerciseId,
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

        /// <summary>Resets the per-minute post counter when the scenario minute advances.</summary>
        public void RollMinute(int scenarioMinute)
        {
            if (scenarioMinute != CurrentMinute)
            {
                CurrentMinute = scenarioMinute;
                PostsThisMinute = 0;
            }
        }
    }
}

/// <summary>The summary of one reaction-loop tick — for diagnostics and tests.</summary>
/// <param name="ScenarioMinute">The scenario minute the tick evaluated at.</param>
/// <param name="InactionTriggers">How many inaction triggers observe surfaced this tick.</param>
/// <param name="ReviewItemsEnqueued">How many review items (one per accepted burst) were enqueued this tick.</param>
public sealed record ReactionTickResult(int ScenarioMinute, int InactionTriggers, int ReviewItemsEnqueued);
