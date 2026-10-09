namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Serves the persisted engine review queue to the shipped controller cockpit and drives the BUILT
/// autonomy/safety domain (<c>Pulse.Core.Features.Autonomy</c>) from the review actions — approve / edit /
/// veto / re-roll / batch-approve, swamped-mode + kill-switch, and the non-request-bound auto-HOLD tick. It
/// is the wire between the frozen <see cref="EngineReviewItemDto"/> the cockpit reads and the load-bearing
/// E8 §8.2 safety invariants (<see cref="AutoHoldPolicy"/> / <see cref="EngineAutonomyState"/>), which this
/// service <b>consumes</b> and never re-decides. Scoped lifetime, matching the <see cref="PulseDbContext"/>
/// unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, always-Critical).</b> Every read, action, and SignalR group is confined to the
/// exercise resolved by <see cref="IExerciseContext"/>. Scope is read ONLY from that context — never from a
/// route, query param, or request body — and FAILS CLOSED when unresolved
/// (<see cref="EngineReviewOutcome.ScopeUnresolved"/> → 401/403 at the endpoint). A cross-exercise draft id
/// resolves to nothing through the central query filter (an IDOR fails closed → 404).
/// </para>
/// <para>
/// <b>B2-not-merged stopgap (flagged).</b> Per-request session→exercise binding is Phase B2's job; until it
/// lands, the scope resolves to <c>null</c> and every participant/controller path fails closed here exactly
/// as B1's social endpoints do. The acting human (COR-018) behind the shared controller account is carried
/// on the action request body (the pre-auth client-trust model B1's <c>controller-as-persona</c> writes also
/// use), NEVER a fabricated client scope. Do not read <c>exerciseId</c> from the client.
/// </para>
/// <para>
/// <b>Telemetry (XC-004).</b> Exactly ONE <c>engine.reviewed</c> event per review DECISION (one per burst,
/// not per post — CTL-034), built via the seam-freeze <see cref="IEngineTelemetryEmitter"/> and committed in
/// the SAME unit of work as the disposition mutation. The publish itself is a separate funnel (story 01's
/// <see cref="IEnginePublishService"/> → B1 ingest), which emits its own per-post <c>post</c> events. The two
/// engine-SETTINGS mutations (autonomy default / tier policy, story 05) likewise emit exactly one additive
/// event each (<see cref="EngineEventTypes.AutonomyDefaultChanged"/> /
/// <see cref="EngineEventTypes.TierPolicyChanged"/>) — a deliberate, reviewer-approved divergence from the
/// swamped-mode/kill-switch/restore trio, which persist none: those controls' state is process memory, so the
/// event is the only record of the change that survives a restart. Story 07's generation-provider cut/restore
/// joins them on the same terms, emitting one <see cref="EngineEventTypes.ProviderChanged"/> per real
/// transition — and none at all for an idempotent no-op (an already-Fake cut, a restore with no cut active).
/// </para>
/// </remarks>
public sealed partial class EngineReviewService
{
    private const string EngineOrigin = "engine";
    private const string DraftEntityType = "engine-draft";

    /// <summary>Fallback IANA zone for the non-request-bound tick until the COR-050 exercise-clock carries the exercise zone (B2/metadata).</summary>
    private const string TickTimeZoneFallback = "UTC";

    private readonly IEngineReviewStore _store;
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IExerciseClock _clock;
    private readonly IEngineTelemetryEmitter _telemetry;
    private readonly IEnginePublishService _publisher;
    private readonly IEngineReviewBroadcaster _broadcaster;
    private readonly EngineAutonomyRegistry _autonomy;
    private readonly EngineTierPolicyRegistry _tierPolicy;
    /// <summary><see cref="IGenerationProvider.Name"/> of the offline provider, which ignores tier bindings.</summary>
    private const string FakeProviderName = FakeGenerationProvider.ProviderName;

    private readonly IGenerationProvider _generationProvider;
    private readonly GenerationOptions _generationOptions;
    private readonly IGenerationProviderCutRegistry _providerCut;
    private readonly ILogger<EngineReviewService> _logger;

    /// <summary>Creates the review service over its persistence, scope, clock, telemetry, publish, push, and autonomy collaborators.</summary>
    /// <param name="store">The seam-freeze review-item persistence store (reads + lookup).</param>
    /// <param name="dbContext">The scoped context the disposition mutation + its single telemetry event commit through (one unit of work).</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="clock">The native scenario clock (story 03) the countdown + scenario-time stamps read.</param>
    /// <param name="telemetry">The seam-freeze XC-004 emit helper.</param>
    /// <param name="publisher">Story 01's single publish funnel (contract-first seam); approve/edit/batch/auto-send call it.</param>
    /// <param name="broadcaster">The exercise-scoped SignalR push (reuses the B1 hub).</param>
    /// <param name="autonomy">The per-exercise autonomy-state registry the safety controls + auto-HOLD read.</param>
    /// <param name="tierPolicy">The per-exercise model-tier-policy registry the reaction loop reads per burst.</param>
    /// <param name="generationProvider">The active generation provider — read ONLY for its name on the settings GET.</param>
    /// <param name="generationOptions">The governed <c>Generation</c> configuration — read-only here (never mutated, NFR-005).</param>
    /// <param name="providerCut">The per-exercise generation-provider cut state (story 07) — the SAME singleton the loop's selector reads.</param>
    /// <param name="logger">Diagnostics for the loud (non-fatal) engine-settings audit-persist failure path.</param>
    public EngineReviewService(
        IEngineReviewStore store,
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IExerciseClock clock,
        IEngineTelemetryEmitter telemetry,
        IEnginePublishService publisher,
        IEngineReviewBroadcaster broadcaster,
        EngineAutonomyRegistry autonomy,
        EngineTierPolicyRegistry tierPolicy,
        IGenerationProvider generationProvider,
        IOptions<GenerationOptions> generationOptions,
        IGenerationProviderCutRegistry providerCut,
        ILogger<EngineReviewService> logger)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(telemetry);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(broadcaster);
        ArgumentNullException.ThrowIfNull(autonomy);
        ArgumentNullException.ThrowIfNull(tierPolicy);
        ArgumentNullException.ThrowIfNull(generationProvider);
        ArgumentNullException.ThrowIfNull(generationOptions);
        ArgumentNullException.ThrowIfNull(providerCut);
        ArgumentNullException.ThrowIfNull(logger);

        _store = store;
        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _clock = clock;
        _telemetry = telemetry;
        _publisher = publisher;
        _broadcaster = broadcaster;
        _autonomy = autonomy;
        _tierPolicy = tierPolicy;
        _generationProvider = generationProvider;
        _generationOptions = generationOptions.Value;
        _providerCut = providerCut;
        _logger = logger;
    }

    // ---- Queue read -----------------------------------------------------------------------------

    /// <summary>
    /// Serves the current exercise's review QUEUE: queued Suggest + counting-down Delayed-auto + auto-HELD
    /// items, EXCLUDING resolved (Published/Vetoed) items. The store returns the full scoped set (it does not
    /// filter by disposition), so the queue projection is applied here (Gate-2 carryover). Each item is
    /// projected to the frozen <see cref="EngineReviewItemDto"/> wire shape the cockpit consumes.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The projected queue, or <see cref="EngineReviewOutcome.ScopeUnresolved"/> (fail closed).</returns>
    public async Task<EngineQueueResult> GetQueueAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out _))
        {
            return EngineQueueResult.ScopeUnresolved();
        }

        var all = await _store.GetQueueAsync(cancellationToken);
        var queue = all
            .Where(IsInQueue)
            .Select(EngineReviewItemDto.FromEntity)
            .ToList();

        return EngineQueueResult.Ok(queue);
    }

    // ---- Terminal actions -----------------------------------------------------------------------

    /// <summary>
    /// Approves a queued / counting-down burst: publishes it through story 01's single publish funnel
    /// (<see cref="IEnginePublishService.PublishBurstAsync"/>, one decision per burst), and — ONLY when every
    /// post genuinely reached the feed — marks it <see cref="DraftDisposition.Published"/>, emits one
    /// <c>engine.reviewed</c> (approve), and pushes the change. Nothing publishes for a scope/validation/
    /// not-found failure; and a burst that does not fully publish is left actionable, not marked Published
    /// (WR-002), surfacing <see cref="EngineReviewOutcome.PublishFailed"/> to the endpoint. Any of its posts that DID
    /// reach the feed are dropped from the item, so approving again sends only the rest (Wave 3 Gate-2 M-1).
    /// </summary>
    public Task<EngineReviewActionResult> ApproveAsync(
        Guid draftId,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default) =>
        PublishDecisionAsync(draftId, input, EngineReviewAction.Approve, leadTextOverride: null, cancellationToken);

    /// <summary>
    /// Edits then publishes a burst: the new lead text is SANITIZED (NFR-004, via the shared
    /// <see cref="PostSanitizer"/> funnel) BEFORE publishing through the SAME seam (the ingest path
    /// re-sanitizes; strip-not-encode is idempotent). Publishes as <c>origin:'engine'</c> like approve — the
    /// approve/edit distinction is TELEMETRY-only (there is no <c>engine-edited</c> origin). Emits one
    /// <c>engine.reviewed</c> (edit).
    /// </summary>
    /// <remarks>
    /// An edit longer than the ingest bounds (raw over <see cref="PostIngestService.MaxRawTextLength"/>, or sanitized
    /// over <see cref="PostIngestService.TextLengthCeiling"/>) is refused up front with ingest's own message (→ 400),
    /// before anything publishes (Wave 3 Gate-2 M-1). A human's words are never cut to fit — unlike generated text
    /// (<see cref="EngineDraftText"/>) — and an over-long edit must not reach the funnel, where the lead post would
    /// be refused while the rest of the burst went out.
    /// </remarks>
    public Task<EngineReviewActionResult> EditAsync(
        Guid draftId,
        string? newText,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        if (newText is null)
        {
            return Task.FromResult(EngineReviewActionResult.Invalid("text is required for an edit."));
        }

        // The raw bound first, so the sanitizer never runs over an oversized body (as on the ingest path).
        if (newText.Length > PostIngestService.MaxRawTextLength)
        {
            return Task.FromResult(EngineReviewActionResult.Invalid(PostIngestService.TextTooLongMessage));
        }

        // Sanitize the edited text at the review boundary (NFR-004) before it enters the burst; the ingest
        // funnel sanitizes again — strip-not-encode is idempotent, so this belt-and-suspenders is safe.
        var sanitized = PostSanitizer.Sanitize(newText);
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            // "", "   " or pure markup: ingest would refuse the lead post while the rest of the burst went out.
            return Task.FromResult(EngineReviewActionResult.Invalid("text is required for an edit; it is blank once markup is removed."));
        }

        if (sanitized.Length > PostIngestService.TextLengthCeiling)
        {
            return Task.FromResult(EngineReviewActionResult.Invalid(PostIngestService.TextTooLongMessage));
        }

        return PublishDecisionAsync(draftId, input, EngineReviewAction.Edit, sanitized, cancellationToken);
    }

    /// <summary>
    /// Vetoes a burst: marks it <see cref="DraftDisposition.Vetoed"/> and emits one <c>engine.reviewed</c>
    /// (veto). NOTHING publishes — no post reaches the feed.
    /// </summary>
    public async Task<EngineReviewActionResult> VetoAsync(
        Guid draftId,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        var validation = ValidateAction(input);
        if (validation is not null)
        {
            return validation;
        }

        var exerciseId = _exerciseContext.CurrentExerciseId!.Value;
        var item = await _store.FindAsync(draftId, cancellationToken);
        if (item is null)
        {
            return EngineReviewActionResult.NotFound();
        }

        if (IsResolved(item.Disposition))
        {
            return EngineReviewActionResult.AlreadyResolved();
        }

        item.Disposition = DraftDisposition.Vetoed;
        if (item.CountdownStartedScenarioMinute is not null)
        {
            item.CountdownDecision = ControllerDecision.Vetoed;
        }

        await CommitDecisionAsync(item, exerciseId, EngineReviewAction.Veto, input.ActingHumanId, input.TimeZone, cancellationToken);
        return EngineReviewActionResult.Ok(EngineReviewItemDto.FromEntity(item));
    }

    /// <summary>
    /// Re-rolls a burst: returns it to review (a fresh Delayed-auto countdown from the current scenario
    /// minute for a Delayed-auto burst, else back to <see cref="DraftDisposition.Queued"/>) and emits one
    /// <c>engine.reviewed</c> (re-roll). NOTHING publishes.
    /// </summary>
    /// <remarks>
    /// The controller's re-roll signals INTENT to regenerate; the fresh draft CONTENT is produced by the
    /// reaction loop (story 01), not synchronously here — this wave exposes no draft-regeneration seam, so
    /// the persisted draft text is retained while the review window resets. Documented as the connective
    /// behavior; the loop replaces the content on its next tick.
    /// </remarks>
    public async Task<EngineReviewActionResult> ReRollAsync(
        Guid draftId,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        var validation = ValidateAction(input);
        if (validation is not null)
        {
            return validation;
        }

        var exerciseId = _exerciseContext.CurrentExerciseId!.Value;
        var item = await _store.FindAsync(draftId, cancellationToken);
        if (item is null)
        {
            return EngineReviewActionResult.NotFound();
        }

        if (IsResolved(item.Disposition))
        {
            return EngineReviewActionResult.AlreadyResolved();
        }

        if (item.RoutedAtLevel == AutonomyLevel.DelayedAuto)
        {
            // Fresh countdown from now; keep the original window length. Reset the decision to None.
            item.Disposition = DraftDisposition.CountingDown;
            item.CountdownStartedScenarioMinute = _clock.CurrentScenarioMinute(exerciseId);
            item.CountdownMinutes ??= 0;
            item.CountdownDecision = ControllerDecision.None;
        }
        else
        {
            item.Disposition = DraftDisposition.Queued;
        }

        await CommitDecisionAsync(item, exerciseId, EngineReviewAction.ReRoll, input.ActingHumanId, input.TimeZone, cancellationToken);
        return EngineReviewActionResult.Ok(EngineReviewItemDto.FromEntity(item));
    }

    /// <summary>
    /// Batch-approves several bursts, reporting a per-item outcome. Each unresolved burst is ONE review
    /// decision (one <c>engine.reviewed</c> approve + one publish per burst, never per post — CTL-034); an
    /// already-resolved or out-of-scope (foreign/missing) draft id is skipped, never re-published.
    /// </summary>
    public async Task<EngineBatchApproveResult> BatchApproveAsync(
        IReadOnlyList<Guid> draftIds,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draftIds);

        if (!TryResolveScope(out _))
        {
            return EngineBatchApproveResult.ScopeUnresolved();
        }

        var validation = ValidateAction(input);
        if (validation is not null)
        {
            return EngineBatchApproveResult.Invalid(validation.ValidationError!);
        }

        var outcomes = new List<EngineBatchApproveItemOutcome>(draftIds.Count);
        foreach (var draftId in draftIds)
        {
            // Best-effort per-item (by design, NOT transactional): each burst is marked Published only if its
            // OWN publish fully reached the feed (WR-002). A publish failure is reported as 'failed' (distinct
            // from a 'skipped' already-resolved/foreign item), so the caller sees which bursts did not send.
            var result = await ApproveAsync(draftId, input, cancellationToken);
            var outcome = result.Outcome switch
            {
                EngineReviewOutcome.Ok => EngineBatchApproveItem.Published,
                EngineReviewOutcome.PublishFailed => EngineBatchApproveItem.Failed,
                _ => EngineBatchApproveItem.Skipped,
            };
            outcomes.Add(new EngineBatchApproveItemOutcome(draftId.ToString(), outcome));
        }

        return EngineBatchApproveResult.Ok(outcomes);
    }

    // ---- Autonomy controls (only ever LOWER autonomy — never self-escalate, §8.2) ----------------

    /// <summary>
    /// Sets swamped mode for the current exercise (the lead-gated toggle that is the ONLY path by which a
    /// Delayed-auto draft auto-sends on expiry, D5-014/1.1, #36). Always an explicit human action; the engine
    /// never turns it on by itself. Delegates to the built <see cref="EngineAutonomyState.SetSwampedMode"/>.
    /// </summary>
    public async Task<EngineAutonomyResult> SetSwampedModeAsync(
        bool enabled,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineAutonomyResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineAutonomyResult.Invalid("actingHumanId is required (COR-018).");
        }

        var state = _autonomy.GetOrCreate(exerciseId);
        state.SetSwampedMode(enabled, input.ActingHumanId, _clock.CurrentScenarioMinute(exerciseId));
        return EngineAutonomyResult.Ok(EngineAutonomyStateDto.From(state));
    }

    /// <summary>
    /// Engages the manual kill switch (ADP-042) for the current exercise: drops the whole engine to Suggest,
    /// or full-stop, instantly. Delegates to the built <see cref="EngineAutonomyState.EngageKillSwitch"/>,
    /// which only ever LOWERS autonomy and does NOT auto-recover; in-flight Delayed-auto countdowns are
    /// suspended as a consequence (their effective level is no longer Delayed-auto, so the auto-HOLD tick
    /// holds them instead of auto-sending — even under swamped mode).
    /// </summary>
    public async Task<EngineAutonomyResult> EngageKillSwitchAsync(
        KillSwitchMode mode,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineAutonomyResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineAutonomyResult.Invalid("actingHumanId is required (COR-018).");
        }

        var state = _autonomy.GetOrCreate(exerciseId);
        state.EngageKillSwitch(mode, input.ActingHumanId, _clock.CurrentScenarioMinute(exerciseId));
        return EngineAutonomyResult.Ok(EngineAutonomyStateDto.From(state));
    }

    /// <summary>
    /// The controller UNDO for the kill switch (ADP-042) / degraded-mode clamp: lifts the active safety clamp
    /// for the current exercise so generation resumes, preserving the base levels underneath (per-storyline
    /// configuration is not lost) and clearing the degraded alert. Delegates to the built
    /// <see cref="EngineAutonomyState.RestoreFromSafety"/>, the §8.2 human-only raise (automation never
    /// restores). Restoring an already-running engine (nothing clamped) is an idempotent no-op that STILL
    /// succeeds — the domain call returns null and the state is simply unchanged.
    /// </summary>
    public async Task<EngineAutonomyResult> RestoreFromSafetyAsync(
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineAutonomyResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineAutonomyResult.Invalid("actingHumanId is required (COR-018).");
        }

        // Resolve the SAME shared per-exercise state instance the reaction loop + auto-HOLD tick read (never a
        // fresh Create) so a resumed clamp is visible to the loop immediately — this is load-bearing for the
        // undo. Like the kill-switch / swamped-mode siblings, this control persists NO telemetry (mapping an
        // autonomy change onto XC-004 is engine-telemetry-tuning's job, not yet built), so the returned
        // (nullable) level change is discarded exactly as EngageKillSwitch discards EngineKillSwitchFired.
        var state = _autonomy.GetOrCreate(exerciseId);
        state.RestoreFromSafety(input.ActingHumanId, _clock.CurrentScenarioMinute(exerciseId));
        return EngineAutonomyResult.Ok(EngineAutonomyStateDto.From(state));
    }

    // ---- Engine settings (story 05: the runtime-settable autonomy default + tier policy) ---------

    /// <summary>
    /// The staff-only engine-settings READ: the active provider name, the governed
    /// <c>Generation:Tiers:*</c> mapping (informational — never editable here), the exercise's autonomy default
    /// + active safety clamp, and its tier-policy mode. Open to any assigned staff caller (an evaluator may
    /// WATCH); fails closed on an unresolved scope (COR-001).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The settings snapshot, or <see cref="EngineReviewOutcome.ScopeUnresolved"/> (fail closed).</returns>
    public async Task<EngineSettingsResult> GetSettingsAsync(CancellationToken cancellationToken = default)
    {
        await Task.CompletedTask;
        cancellationToken.ThrowIfCancellationRequested();

        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>
    /// Sets the exercise's DEFAULT autonomy level at runtime — the control that makes
    /// <see cref="AutonomyLevel.DelayedAuto"/> reachable at all (before story 05 nothing in
    /// <c>Pulse.WebApi</c> ever called the built <see cref="EngineAutonomyState.SetExerciseDefault"/>, so every
    /// exercise stayed permanently at the <see cref="AutonomyLevel.Suggest"/> seed).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Resolves the SHARED per-exercise state via <see cref="EngineAutonomyRegistry.GetOrCreate"/> — never a
    /// fresh <see cref="EngineAutonomyState.Create"/> — so the reaction loop's registration and the auto-HOLD
    /// tick observe the new default on the very next burst, with no redeploy and no restart.
    /// </para>
    /// <para>
    /// <b>A default change never lifts a safety clamp (§8.2).</b> <see cref="EngineAutonomyState.SetExerciseDefault"/>
    /// sets the base level UNDERNEATH an active kill-switch/degraded clamp; only an explicit
    /// <see cref="RestoreFromSafetyAsync"/> releases it. <see cref="AutonomyLevels.EnsureSelectable"/> rejects
    /// <see cref="AutonomyLevel.Auto"/> (v1.1) with a 400 — never a silent clamp to Suggest.
    /// </para>
    /// </remarks>
    /// <param name="level">The requested level literal (<c>suggest</c> / <c>delayed-auto</c>).</param>
    /// <param name="input">The acting human (COR-018) + optional telemetry zone (XC-008).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> SetExerciseAutonomyDefaultAsync(
        string? level,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineSettingsResult.Invalid("actingHumanId is required (COR-018).");
        }

        // Validate BEFORE touching the shared state, so a rejected level mutates nothing at all.
        if (!TryParseAutonomyLevel(level, out var requested))
        {
            return EngineSettingsResult.Invalid("level must be one of 'suggest' or 'delayed-auto'.");
        }

        try
        {
            AutonomyLevels.EnsureSelectable(requested);
        }
        catch (NotSupportedException ex)
        {
            // 'auto' is reserved for v1.1: rejected explicitly (400), never silently clamped or ignored.
            return EngineSettingsResult.Invalid(ex.Message);
        }

        var scenarioMinute = _clock.CurrentScenarioMinute(exerciseId);
        var state = _autonomy.GetOrCreate(exerciseId);
        var from = state.ExerciseDefault;
        state.SetExerciseDefault(requested, input.ActingHumanId, scenarioMinute);

        var payload = new EngineEventPayloads.AutonomyDefaultChanged
        {
            FromLevel = from,
            ToLevel = state.ExerciseDefault,
            SafetyClampActive = state.SafetyClampActive,
            ScenarioMinute = scenarioMinute,
        };

        await CommitSettingsEventAsync(
            EngineEventTypes.AutonomyDefaultChanged, exerciseId, input, payload, cancellationToken);

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>
    /// Sets the exercise's model-tier POLICY mode at runtime (<c>standard</c> / <c>ambient</c> / <c>auto</c>).
    /// The override is recorded in the shared <see cref="EngineTierPolicyRegistry"/> the reaction loop reads at
    /// its existing <c>IntentComposer</c> call site, so it takes effect on the next generated burst;
    /// <c>auto</c> CLEARS the override, restoring the purpose-based static map's role.
    /// </summary>
    /// <remarks>
    /// Only the tier ROLE is settable. Which concrete deployment/model a tier resolves to stays governed
    /// <c>Generation:Tiers:*</c> configuration behind the fail-closed startup gate (NFR-005 / ADP-025) — this
    /// endpoint can never point generation at an unattested endpoint.
    /// </remarks>
    /// <param name="mode">The requested mode literal (<c>standard</c> / <c>ambient</c> / <c>auto</c>).</param>
    /// <param name="input">The acting human (COR-018) + optional telemetry zone (XC-008).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> SetTierPolicyModeAsync(
        string? mode,
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineSettingsResult.Invalid("actingHumanId is required (COR-018).");
        }

        if (!TierPolicyModes.TryParse(mode, out var requested))
        {
            return EngineSettingsResult.Invalid("mode must be one of 'standard', 'ambient' or 'auto'.");
        }

        // Reject a tier the deployment has not actually bound, BEFORE recording it. Otherwise this returns 200
        // and every later tick throws GenerationConfigurationException inside the loop's per-exercise catch —
        // the engine stops producing with nothing but a log line: a control that appears to work and quietly
        // breaks generation. Skipped when NO tiers are configured at all, which is the offline Fake provider's
        // normal state (it ignores the tier), so local/CI behaviour is unchanged.
        if (ForcedTierIsUnbound(requested, out var unboundTierKey))
        {
            return EngineSettingsResult.Invalid(
                $"tier '{unboundTierKey}' has no deployment configured for this environment " +
                $"(set Generation:Tiers:{unboundTierKey}:Deployment). Choose a bound tier or 'auto'.");
        }

        var scenarioMinute = _clock.CurrentScenarioMinute(exerciseId);
        var from = _tierPolicy.SetMode(exerciseId, requested);

        var payload = new EngineEventPayloads.TierPolicyChanged
        {
            FromMode = from,
            ToMode = requested,
            ScenarioMinute = scenarioMinute,
        };

        await CommitSettingsEventAsync(
            EngineEventTypes.TierPolicyChanged, exerciseId, input, payload, cancellationToken);

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    // ---- Generation-provider cut (story 07: the runtime EGRESS lever, ADP-042) --------------------

    /// <summary>
    /// CUTS this exercise's generation to <see cref="FakeGenerationProvider"/> — the manual egress brake
    /// (ADP-042). The exercise's next burst is generated offline instead of reaching the live provider:
    /// immediately, with no restart, no config change, and no effect on any other exercise (COR-001). The set of
    /// registered providers is exactly what startup created; this only changes which ALREADY-REGISTERED instance
    /// this exercise resolves to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Never a provider chooser (NFR-005 / ADP-025).</b> There is no parameter here, and no field on the
    /// request body, that names a provider — the only destination is Fake, and the only way back is the
    /// startup-configured provider. Nothing this method can do makes an endpoint reachable that
    /// <c>GenerationGovernance.Validate</c> did not sign off at startup.
    /// </para>
    /// <para>
    /// <b>Idempotent, and honest about a no-op.</b> When the configured provider is ALREADY <c>Fake</c> (the
    /// committed default) nothing is recorded and NO telemetry is emitted — the snapshot reports
    /// <c>alreadyFake: true</c> rather than a false "I just locked something down" signal. A second cut while one
    /// is already active is likewise a no-op with no second audit event.
    /// </para>
    /// </remarks>
    /// <param name="input">The acting human (COR-018) + optional telemetry zone (XC-008).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> CutGenerationToFakeAsync(
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineSettingsResult.Invalid("actingHumanId is required (COR-018).");
        }

        var configured = _generationProvider.Name;

        // Only cut when the configured provider actually egresses — i.e. this guard is the "NOT already
        // offline" case. When it IS already Fake we fall straight through to the snapshot below, which reports
        // alreadyFake and emits nothing: recording a cut there would make the console claim a lockdown that
        // never happened.
        if (!IsFakeProvider(configured))
        {
            var changed = _providerCut.Cut(exerciseId);
            if (changed)
            {
                await CommitProviderChangeAsync(
                    exerciseId, configured, FakeProviderName, EngineEventPayloads.ProviderChanged.ReasonCut,
                    input, cancellationToken);
            }
        }

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>
    /// RESTORES this exercise's generation to the STARTUP-CONFIGURED provider and no other — the §8.2 human-only
    /// raise, capped at the pre-existing baseline (the direct sibling of <see cref="RestoreFromSafetyAsync"/>).
    /// It can never land on a provider that was not already running at startup, so it can never exceed the
    /// governed baseline. Restoring when no cut is active is an idempotent no-op that still succeeds, and emits
    /// no telemetry.
    /// </summary>
    /// <remarks>
    /// <b>The audit write is deliberately non-fatal, which is asymmetric here.</b>
    /// <see cref="CommitProviderChangeAsync"/> runs AFTER the registry mutation and swallows a persist failure
    /// (loud log, non-fatal — inherited from the story-05 settings path and matching the
    /// <see cref="RestoreFromSafetyAsync"/> kill-switch precedent), so for a CUT it fails toward less egress,
    /// but for a RESTORE it means egress resumes with only a log line if this event — the only durable record of
    /// the change, since the cut state is process memory — fails to persist.
    /// </remarks>
    /// <param name="input">The acting human (COR-018) + optional telemetry zone (XC-008).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resulting settings snapshot, or a fail-closed/invalid outcome.</returns>
    public async Task<EngineSettingsResult> RestoreGenerationProviderAsync(
        EngineReviewActionInput input,
        CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return EngineSettingsResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineSettingsResult.Invalid("actingHumanId is required (COR-018).");
        }

        // The restore DESTINATION is read from the running provider, never from the request — that is what makes
        // "capped at the startup baseline" structural rather than a validation rule someone could relax.
        var configured = _generationProvider.Name;

        if (_providerCut.Restore(exerciseId))
        {
            await CommitProviderChangeAsync(
                exerciseId, FakeProviderName, configured, EngineEventPayloads.ProviderChanged.ReasonRestore,
                input, cancellationToken);
        }

        return EngineSettingsResult.Ok(BuildSettings(exerciseId));
    }

    /// <summary>Whether a provider name is the offline provider's (the cut destination / the already-Fake case).</summary>
    private static bool IsFakeProvider(string providerName) =>
        string.Equals(providerName, FakeProviderName, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Persists the single <c>engine.provider_changed</c> XC-004 event for a real cut/restore transition — the
    /// same one-event-per-meaningful-action, own-unit-of-work, non-fatal-on-failure shape the story-05 settings
    /// events use (the cut state is process memory, so this event IS its durable record).
    /// </summary>
    private Task CommitProviderChangeAsync(
        Guid exerciseId,
        string fromProvider,
        string toProvider,
        string reason,
        EngineReviewActionInput input,
        CancellationToken cancellationToken)
    {
        var payload = new EngineEventPayloads.ProviderChanged
        {
            FromProvider = fromProvider,
            ToProvider = toProvider,
            Reason = reason,
            ScenarioMinute = _clock.CurrentScenarioMinute(exerciseId),
        };

        return CommitSettingsEventAsync(
            EngineEventTypes.ProviderChanged, exerciseId, input, payload, cancellationToken);
    }

    // ---- Auto-HOLD tick (non-request-bound; silence is never approval, D5-014/1.1) --------------

    /// <summary>
    /// Evaluates every counting-down Delayed-auto draft in the CURRENT exercise scope against the built
    /// <see cref="AutoHoldPolicy.Evaluate"/> at the current scenario minute (story 03 clock). An expired
    /// countdown with NO controller decision auto-HOLDs (<see cref="DraftDisposition.Held"/>, "timer expired
    /// — held for you", surfaces in NEEDS YOU) — it NEVER auto-sends. The ONLY auto-send-on-expiry path is
    /// swamped mode explicitly enabled AND the draft still effectively Delayed-auto; a kill switch or degraded
    /// clamp lowers the effective level below Delayed-auto, so the countdown suspends (holds) even under
    /// swamped mode. Each resolution emits exactly one <c>engine.reviewed</c> (hold-on-expiry / auto-send) and
    /// pushes the change. Callers (the tick host) set <see cref="IExerciseContext.CurrentExerciseId"/> before
    /// invoking, so this operates entirely within one exercise's scope (COR-001).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    public async Task EvaluateAutoHoldAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return;
        }

        var state = _autonomy.GetOrCreate(exerciseId);
        var swamped = state.SwampedModeEnabled;
        var currentMinute = _clock.CurrentScenarioMinute(exerciseId);

        var queue = await _store.GetQueueAsync(cancellationToken);
        foreach (var candidate in queue.Where(i => i.Disposition == DraftDisposition.CountingDown).ToList())
        {
            if (candidate.CountdownStartedScenarioMinute is not { } started
                || candidate.CountdownMinutes is not { } minutes)
            {
                continue;
            }

            var countdown = new DelayedAutoCountdown(
                exerciseId,
                candidate.StorylineId,
                candidate.DraftId,
                started,
                minutes,
                candidate.CountdownDecision ?? ControllerDecision.None);

            var effective = state.ResolveEffective(candidate.StorylineId);
            var evaluation = AutoHoldPolicy.Evaluate(countdown, effective, currentMinute, swamped);

            // Only an on-expiry, no-decision transition returns an event to act on here; while the countdown
            // is still running the display tick is driven client-side (the frozen useReviewQueue's own clock).
            if (evaluation.Event is null)
            {
                continue;
            }

            if (evaluation.Disposition == TimeoutDisposition.Publish)
            {
                await AutoSendOnTickAsync(candidate, exerciseId, cancellationToken);
            }
            else
            {
                // Silence is never approval → HOLD for the controller (D5-014/1.1). NOTHING publishes. The row is
                // re-read first: a human who acted since the snapshot (veto, approve, re-roll) is never overridden.
                var item = await FindStillExpiredAsync(candidate, cancellationToken);
                if (item is not null)
                {
                    await ResolveOnTickAsync(item, exerciseId, DraftDisposition.Held, EngineReviewAction.HoldOnExpiry, mutate: null, cancellationToken);
                }
            }
        }
    }

    /// <summary>
    /// Swamped-mode auto-send of one expired countdown (the sole timeout publish path): publishes through the SAME
    /// funnel, and marks Published ONLY when the burst genuinely reached the feed (WR-002). Anything less resolves
    /// the item to <see cref="DraftDisposition.Held"/> with a reason on its action label — it is NEVER left
    /// counting down (Wave 3 Gate-2 M-1).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Leaving a partly-published burst counting down re-sent it on every tick: the expiry is re-evaluated each
    /// interval, and the posts that had published went out again each time while the failing one kept failing. Now
    /// the posts that reached the feed are dropped from the item (so a later approve sends only the rest) and the
    /// item waits for a human, with one <c>engine.reviewed</c> (hold-on-expiry). A publish that THROWS, or is
    /// interrupted by shutdown, is held the same way, but its posts are kept and the label tells the controller to
    /// check the feed first: which of them went out is unknown, and the ingest-side draftId idempotency gap
    /// (WR-001) applies to a later approve.
    /// </para>
    /// <para>
    /// <b>One instance, re-checked before the publish (483dd34 review M-1).</b> The queue snapshot the tick iterates
    /// is untracked and can be stale by the time an item's turn comes (a swamped tick works through every expired
    /// countdown in turn). So the TRACKED row is read first, the burst is published only if that row is still the
    /// same expired, undecided countdown, and the outcomes are recorded against that very instance — the per-post
    /// outcomes then line up with the posts that were sent. A human who vetoed, approved or re-rolled the item since
    /// the snapshot is never published over; after a partial approve only the posts it left are sent. What remains
    /// is the window of the publish itself across
    /// two DbContexts; closing it needs an atomic claim (a rowversion or a conditional update), a follow-up tracked
    /// with WR-001.
    /// </para>
    /// </remarks>
    private async Task AutoSendOnTickAsync(
        EngineReviewItemEntity candidate,
        Guid exerciseId,
        CancellationToken cancellationToken)
    {
        var item = await FindStillExpiredAsync(candidate, cancellationToken);
        if (item is null)
        {
            return;
        }

        // Once the publish has been attempted, its record is written with CancellationToken.None: posts may be live,
        // so a host shutdown at this point must not leave the item counting down to be sent again on restart.
        EngineBurstPublishResult publishResult;
        try
        {
            publishResult = await PublishBurstAsync(item, exerciseId, input: null, leadTextOverride: null, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Shutdown in the middle of a burst: posts 1..k may be live. Hold it with the same warning (best effort,
            // so a failed record never hides the cancellation), then let the cancellation through.
#pragma warning disable CA1031 // The hold is best effort; the cancellation must still propagate.
            try
            {
                await ResolveOnTickAsync(
                    item,
                    exerciseId,
                    DraftDisposition.Held,
                    EngineReviewAction.HoldOnExpiry,
                    tracked => tracked.ActionLabel = WithPublishReason(tracked.ActionLabel, "auto-send interrupted; check the feed before approving"),
                    CancellationToken.None);
            }
            catch (Exception ex)
            {
                LogAutoSendHoldFailed(ex, item.DraftId, exerciseId);
            }
#pragma warning restore CA1031

            throw;
        }
#pragma warning disable CA1031 // Any publish fault must hold the burst for a human, never leave it to re-send next tick.
        catch (Exception ex)
        {
            LogAutoSendFailed(ex, item.DraftId, exerciseId);
            await ResolveOnTickAsync(
                item,
                exerciseId,
                DraftDisposition.Held,
                EngineReviewAction.HoldOnExpiry,
                tracked => tracked.ActionLabel = WithPublishReason(tracked.ActionLabel, "auto-send failed; check the feed before approving"),
                CancellationToken.None);
            return;
        }
#pragma warning restore CA1031

        if (IsPublishFullySuccessful(publishResult))
        {
            await ResolveOnTickAsync(item, exerciseId, DraftDisposition.Published, EngineReviewAction.AutoSend, mutate: null, CancellationToken.None);
            return;
        }

        await ResolveOnTickAsync(
            item,
            exerciseId,
            DraftDisposition.Held,
            EngineReviewAction.HoldOnExpiry,
            tracked => RecordPartialPublish(tracked, publishResult, "auto-send"),
            CancellationToken.None);
    }

    /// <summary>
    /// Re-reads the TRACKED row for a snapshot <paramref name="candidate"/> and returns it only if it is still the
    /// same expired countdown with no decision: still <see cref="DraftDisposition.CountingDown"/>, no controller
    /// decision, and the same countdown start and length (a re-roll restarts it). Otherwise <c>null</c> — a human
    /// acted after the snapshot and the tick must leave the item alone.
    /// </summary>
    private async Task<EngineReviewItemEntity?> FindStillExpiredAsync(
        EngineReviewItemEntity candidate,
        CancellationToken cancellationToken)
    {
        var item = await _store.FindAsync(candidate.DraftId, cancellationToken);
        return item is not null
            && item.Disposition == DraftDisposition.CountingDown
            && (item.CountdownDecision ?? ControllerDecision.None) == ControllerDecision.None
            && item.CountdownStartedScenarioMinute == candidate.CountdownStartedScenarioMinute
            && item.CountdownMinutes == candidate.CountdownMinutes
                ? item
                : null;
    }

    // ---- internals ------------------------------------------------------------------------------

    /// <summary>The separator between a burst's own action label and the reason its last publish was incomplete.</summary>
    private const string PublishReasonSeparator = " · publish incomplete: ";

    /// <summary>
    /// Records a publish that did not fully reach the feed on the TRACKED item: drops every post that DID publish
    /// (the outcomes are one per post, in order), so a later approve or auto-send sends only the rest and nothing
    /// twice, and names what happened on the action label, which the console shows on the card.
    /// </summary>
    /// <param name="item">The tracked review item whose burst was just published.</param>
    /// <param name="result">The funnel's per-post outcomes for that burst.</param>
    /// <param name="attempt">What attempted the publish (<c>approve</c> / <c>edit</c> / <c>auto-send</c>), for the label.</param>
    private static void RecordPartialPublish(EngineReviewItemEntity item, EngineBurstPublishResult result, string attempt)
    {
        var total = item.Posts.Count;
        string? firstError = null;
        var published = 0;
        for (var index = total - 1; index >= 0; index--)
        {
            var outcome = index < result.Posts.Count ? result.Posts[index] : null;
            if (outcome?.Outcome == EnginePublishOutcome.Published)
            {
                item.Posts.RemoveAt(index);
                published++;
            }
            else
            {
                firstError = outcome switch
                {
                    null => "not attempted",
                    { Outcome: EnginePublishOutcome.ScopeUnresolved } => "exercise scope unresolved",
                    { Error: { Length: > 0 } error } => error,
                    _ => "refused",
                };
            }
        }

        var remaining = total - published;
        item.ActionLabel = WithPublishReason(
            item.ActionLabel,
            $"{attempt} posted {published} of {total}; {remaining} held for review ({firstError ?? "refused"})");
    }

    /// <summary>Replaces any earlier publish reason on <paramref name="label"/> with <paramref name="reason"/>, so reasons never pile up.</summary>
    private static string WithPublishReason(string label, string reason)
    {
        var cut = label.IndexOf(PublishReasonSeparator, StringComparison.Ordinal);
        var baseLabel = cut >= 0 ? label[..cut] : label;
        return baseLabel + PublishReasonSeparator + reason;
    }

    /// <summary>Whether a disposition is a resolved terminal (Published/Vetoed) — the WR-001 guard every request-bound action checks so a terminal item is rejected (→ 409/404) and can never be re-published.</summary>
    private static bool IsResolved(DraftDisposition disposition) =>
        disposition is DraftDisposition.Published or DraftDisposition.Vetoed;

    /// <summary>Whether an item currently belongs in the served queue (queued / counting-down / held; not resolved).</summary>
    private static bool IsInQueue(EngineReviewItemEntity item) =>
        item.Disposition is DraftDisposition.Queued or DraftDisposition.CountingDown or DraftDisposition.Held;

    /// <summary>Resolves the fail-closed exercise scope; false (with <see cref="Guid.Empty"/>) when unresolved.</summary>
    private bool TryResolveScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return scope is not null && scope.Value != Guid.Empty;
    }

    /// <summary>
    /// Composes the current settings snapshot for an exercise (configured + EFFECTIVE provider, governed tiers,
    /// autonomy, tier policy).
    /// </summary>
    /// <remarks>
    /// <see cref="IGenerationProvider.Name"/> is the STARTUP-CONFIGURED provider even while a cut is active (the
    /// story-07 selector passes it through by design), so the effective provider is resolved from the cut
    /// REGISTRY here — per exercise — and put on the wire as its own field rather than left to be re-derived
    /// (WR-003).
    /// </remarks>
    private EngineSettingsDto BuildSettings(Guid exerciseId) => EngineSettingsDto.From(
        _generationProvider.Name,
        _providerCut.IsCutToFake(exerciseId),
        _generationOptions,
        EngineAutonomyStateDto.From(_autonomy.GetOrCreate(exerciseId)),
        _tierPolicy.GetMode(exerciseId));

    /// <summary>
    /// Whether <paramref name="mode"/> would force a tier this deployment has NOT bound to a deployment name —
    /// checked against the SAME <c>Generation:Tiers:{Tier}</c> key (and the same empty-<c>Deployment</c> rule)
    /// the generation providers look up, so an accepted mode is one generation can actually serve. Always false
    /// for <c>auto</c>, and false when no tiers are configured at all (the offline Fake provider).
    /// </summary>
    private bool ForcedTierIsUnbound(TierPolicyMode mode, out string tierKey)
    {
        tierKey = string.Empty;

        if (!TierPolicyModes.TryGetForcedTier(mode, out var forced))
        {
            return false;
        }

        // Skip ONLY when there is genuinely nothing to validate against: no tier bindings configured AND the
        // offline provider active. Both conjuncts are load-bearing (Copilot review, PR #385):
        //   - `Tiers.Count == 0` alone was too permissive -- a REAL provider with no bindings is precisely the
        //     misconfiguration this check exists to catch. It would return 200, record the override, then throw
        //     inside every subsequent tick, stalling generation with only a log line: the same "a controller
        //     action that appears to work and quietly breaks the engine" failure this validation prevents.
        //   - provider-is-Fake alone was too permissive in the other direction -- Fake is the CI/local default,
        //     so it would disable the check in every environment that actually runs the tests, leaving the rule
        //     unexercised. (Confirmed empirically: it made the two rejection tests pass with Ok.)
        // With the conjunction, configured tiers are always validated whatever the provider, and the offline
        // no-config case stays free.
        if (_generationOptions.Tiers.Count == 0
            && string.Equals(_generationProvider.Name, FakeProviderName, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        tierKey = forced.ToString();
        return !_generationOptions.Tiers.TryGetValue(tierKey, out var tier)
            || string.IsNullOrWhiteSpace(tier.Deployment);
    }

    /// <summary>
    /// Parses the frozen autonomy-level wire literal (<c>suggest</c> / <c>delayed-auto</c> / <c>auto</c>). The
    /// v1.1 <c>auto</c> literal parses SUCCESSFULLY here so the rejection is made by
    /// <see cref="AutonomyLevels.EnsureSelectable"/> (the single place the v1 selectability invariant lives),
    /// not by a second, drifting list of accepted strings.
    /// </summary>
    private static bool TryParseAutonomyLevel(string? raw, out AutonomyLevel level)
    {
        switch (raw)
        {
            case "suggest":
                level = AutonomyLevel.Suggest;
                return true;
            case "delayed-auto":
                level = AutonomyLevel.DelayedAuto;
                return true;
            case "auto":
                level = AutonomyLevel.Auto;
                return true;
            default:
                level = AutonomyLevel.Suggest;
                return false;
        }
    }

    /// <summary>
    /// Persists the ONE XC-004 event for a settings change (XC-004: exactly one event per meaningful action) in
    /// its own single <c>SaveChanges</c> — the mutation itself is process memory, so this event IS the durable
    /// record, and it is the deliberate divergence from the swamped-mode/kill-switch/restore trio (which emit no
    /// backend telemetry). One server clock read is shared by the envelope's wall clock + emittedAt.
    /// </summary>
    /// <remarks>
    /// <b>Deliberately NOT atomic with the in-memory posture change, and deliberately not fatal.</b> The
    /// registry mutation has already happened and is already live for the next burst, so a failure to persist
    /// the audit row must NOT surface as a 500: that would tell the operator "your change did not apply" while
    /// it very much did. The failure is logged at Error (the loud path — an audit gap is an ops event) and the
    /// applied snapshot is still returned. Closing this window properly needs the posture itself to be
    /// persisted, which is out of scope for story 05 (process memory, like the kill switch it sits beside).
    /// </remarks>
    private async Task CommitSettingsEventAsync(
        string eventType,
        Guid exerciseId,
        EngineReviewActionInput input,
        object payload,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var context = new EngineTelemetryContext
        {
            ExerciseId = exerciseId,
            WallClockTime = now,
            ScenarioTime = _clock.CurrentScenarioTime(exerciseId) ?? now,
            TimeZone = string.IsNullOrWhiteSpace(input.TimeZone) ? TickTimeZoneFallback : input.TimeZone,
            Channel = "social",
            Origin = EngineOrigin,
            // COR-018: the controller behind the shared account. Empty is null-omitted by the emitter (the v0
            // schema types actor.actingHumanId as optional/min-1), never persisted as "".
            Actor = new EngineTelemetryActor { Kind = EngineOrigin, ActingHumanId = input.ActingHumanId },
        };

        _dbContext.TelemetryEvents.Add(_telemetry.BuildEvent(eventType, context, payload));

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
#pragma warning disable CA1031 // The posture change is already applied and live; an audit-persist failure must be loud, not fatal.
        catch (Exception ex)
        {
            LogSettingsAuditPersistFailed(eventType, exerciseId, ex);
        }
#pragma warning restore CA1031
    }

    /// <summary>Source-generated Error log for an interrupted auto-send whose best-effort hold could not be recorded.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Swamped-mode auto-send of draft {DraftId} in exercise {ExerciseId} was interrupted and its hold could not be recorded; some of its posts may already be live.")]
    private partial void LogAutoSendHoldFailed(Exception exception, Guid draftId, Guid exerciseId);

    /// <summary>Source-generated Warning log for a review-item push that failed after a partial publish was recorded.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Review-item push failed for draft {DraftId} in exercise {ExerciseId} after a partial publish was recorded; the console picks it up on its next queue read.")]
    private partial void LogPartialPublishPushFailed(Exception exception, Guid draftId, Guid exerciseId);

    /// <summary>Source-generated Error log for a swamped-mode auto-send whose publish threw; the burst is held for a human.</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Swamped-mode auto-send of draft {DraftId} in exercise {ExerciseId} failed; the burst is HELD for review and some of its posts may already be live.")]
    private partial void LogAutoSendFailed(Exception exception, Guid draftId, Guid exerciseId);

    /// <summary>Source-generated Error log for an engine-settings audit row that could not be persisted (CA1848: no per-call allocation).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "Engine settings change '{EventType}' for exercise {ExerciseId} was APPLIED in memory but its XC-004 audit event could not be persisted; the posture change is live and unaudited.")]
    private partial void LogSettingsAuditPersistFailed(string eventType, Guid exerciseId, Exception exception);

    /// <summary>Validates a request-bound action's COR-018 actor + XC-008 zone; null when valid.</summary>
    private EngineReviewActionResult? ValidateAction(EngineReviewActionInput input)
    {
        if (!TryResolveScope(out _))
        {
            return EngineReviewActionResult.ScopeUnresolved();
        }

        if (string.IsNullOrWhiteSpace(input.ActingHumanId))
        {
            return EngineReviewActionResult.Invalid("actingHumanId is required for a review decision (COR-018).");
        }

        if (string.IsNullOrWhiteSpace(input.TimeZone))
        {
            return EngineReviewActionResult.Invalid("timeZone is required (XC-008 telemetry envelope).");
        }

        return null;
    }

    /// <summary>The shared approve/edit path: validate, look up in scope, publish through the single funnel, then commit + push.</summary>
    private async Task<EngineReviewActionResult> PublishDecisionAsync(
        Guid draftId,
        EngineReviewActionInput input,
        EngineReviewAction action,
        string? leadTextOverride,
        CancellationToken cancellationToken)
    {
        var validation = ValidateAction(input);
        if (validation is not null)
        {
            return validation;
        }

        var exerciseId = _exerciseContext.CurrentExerciseId!.Value;
        var item = await _store.FindAsync(draftId, cancellationToken);
        if (item is null)
        {
            return EngineReviewActionResult.NotFound();
        }

        // WR-001 terminal guard: a resolved (Published/Vetoed) item is rejected (→ 409 at the endpoint) so an
        // already-published burst can NEVER be re-approved into a double-publish. Same guard on veto/re-roll,
        // and batch-approve inherits it through this path.
        if (IsResolved(item.Disposition))
        {
            return EngineReviewActionResult.AlreadyResolved();
        }

        var publishResult = await PublishBurstAsync(item, exerciseId, input, leadTextOverride, cancellationToken);

        // WR-002 / SG-001: record the burst as Published ONLY when every post genuinely reached the feed. A post
        // that comes back Invalid (which also covers an unresolved persona handle — SG-001) or ScopeUnresolved
        // means nothing (or not all) reached the feed, so we must NOT mark Published and must NOT emit a success
        // engine.reviewed. Leave the item at its current (actionable) queue disposition and surface the failure
        // so the endpoint returns a non-2xx (→ 502).
        if (!IsPublishFullySuccessful(publishResult))
        {
            // Wave 3 Gate-2 M-1: when SOME posts did reach the feed, drop them from the item and say so on its
            // label, so approving again sends only the rest and never re-posts what is already live. This is
            // bookkeeping, not a decision: no engine.reviewed (the published posts carry their own events). The
            // request token is not passed: those posts are live, so a disconnect must not lose the record of them.
            if (publishResult.Posts.Any(p => p.Outcome == EnginePublishOutcome.Published))
            {
                // An edited lead that did NOT go out keeps the controller's edit, so approving again sends what they
                // wrote rather than the engine text they replaced (483dd34 review L-3).
                if (leadTextOverride is not null
                    && item.Posts.Count > 0
                    && (publishResult.Posts.Count == 0 || publishResult.Posts[0].Outcome != EnginePublishOutcome.Published))
                {
                    item.Posts[0].Text = leadTextOverride;
                }

                RecordPartialPublish(item, publishResult, action == EngineReviewAction.Edit ? "edit" : "approve");
                await _dbContext.SaveChangesAsync(CancellationToken.None);

                // The record is saved; a failed push must not turn the 502 into a 500 (the console re-reads the queue).
                try
                {
                    await _broadcaster.BroadcastReviewItemChangedAsync(exerciseId, EngineReviewItemDto.FromEntity(item), CancellationToken.None);
                }
#pragma warning disable CA1031 // A push fault after the record is saved must not change the response.
                catch (Exception ex)
                {
                    LogPartialPublishPushFailed(ex, item.DraftId, exerciseId);
                }
#pragma warning restore CA1031
            }

            return EngineReviewActionResult.PublishFailed();
        }

        // WR-001 (KNOWN CONSISTENCY LIMITATION — tracked, not silent): the publish above has already reached the
        // feed, but the disposition + telemetry commit below is a SEPARATE unit of work from the ingest publish.
        // If SaveChanges throws here, the item stays in-queue while its posts are live, so a later re-approve
        // would RE-PUBLISH the burst (story 01's publish path does NOT dedupe on draftId). This residual window
        // cannot be closed from the review side; the fix is ingest-side draftId idempotency (a draftId dedupe on
        // story 01's publish path / the Post schema), which is OUT OF SCOPE for this hardening pass.
        item.Disposition = DraftDisposition.Published;
        if (item.CountdownStartedScenarioMinute is not null)
        {
            item.CountdownDecision = ControllerDecision.Approved;
        }

        await CommitDecisionAsync(item, exerciseId, action, input.ActingHumanId, input.TimeZone, cancellationToken);
        return EngineReviewActionResult.Ok(EngineReviewItemDto.FromEntity(item));
    }

    /// <summary>Whether a burst publish fully reached the feed — the burst was non-empty AND every post came back <see cref="EnginePublishOutcome.Published"/>. Anything else (an <see cref="EnginePublishOutcome.Invalid"/> post — including an unresolved persona handle, SG-001 — or <see cref="EnginePublishOutcome.ScopeUnresolved"/>) is a publish failure that must NOT mark the burst Published (WR-002).</summary>
    private static bool IsPublishFullySuccessful(EngineBurstPublishResult result) =>
        result.Posts.Count > 0 && result.Posts.All(p => p.Outcome == EnginePublishOutcome.Published);

    /// <summary>Publishes the burst through story 01's single funnel (one decision per burst, SOC-003), resolving persona handles + server scenario time, and returns the per-post outcome so the caller can gate on genuine success (WR-002).</summary>
    private async Task<EngineBurstPublishResult> PublishBurstAsync(
        EngineReviewItemEntity item,
        Guid exerciseId,
        EngineReviewActionInput? input,
        string? leadTextOverride,
        CancellationToken cancellationToken)
    {
        var scenarioTime = ScenarioTimeString(exerciseId);
        var timeZone = input?.TimeZone ?? TickTimeZoneFallback;
        var handleToId = await ResolvePersonaHandlesAsync(item, cancellationToken);

        var posts = item.Posts
            .Select((draft, index) => new EngineBurstPost
            {
                PersonaId = handleToId.TryGetValue(draft.PersonaHandle.TrimStart('@'), out var id) ? id : Guid.Empty,
                PersonaHandle = draft.PersonaHandle,
                // The lead post's text is replaced on the edit path (already sanitized above).
                Text = index == 0 && leadTextOverride is not null ? leadTextOverride : draft.Text,
                Sentiment = draft.Sentiment,
                Hashtags = draft.Hashtags.ToList(),
                ScenarioTime = scenarioTime,
                Channel = "social",
            })
            .ToList();

        var burst = new EngineBurst
        {
            ExerciseId = exerciseId,
            StorylineId = item.StorylineId,
            DraftId = item.DraftId,
            TimeZone = timeZone,
            Posts = posts,
        };

        return await _publisher.PublishBurstAsync(burst, cancellationToken);
    }

    /// <summary>Resolves the burst's persona handles to their scoped persona-instance ids (keyed by the '@'-stripped handle).</summary>
    private async Task<IReadOnlyDictionary<string, Guid>> ResolvePersonaHandlesAsync(
        EngineReviewItemEntity item,
        CancellationToken cancellationToken)
    {
        var wanted = item.Posts
            .SelectMany(p => new[] { p.PersonaHandle, p.PersonaHandle.TrimStart('@') })
            .Distinct()
            .ToList();

        var personas = await _dbContext.Personas
            .AsNoTracking()
            .Where(p => wanted.Contains(p.Handle))
            .Select(p => new { p.Handle, p.Id })
            .ToListAsync(cancellationToken);

        // Normalize both sides by stripping a leading '@' so "@mvega_fh" and "mvega_fh" resolve alike.
        //
        // The GroupBy/First() stays even though IX_Personas_ExerciseId_Handle (backend-host/03) now makes
        // (ExerciseId, Handle) unique case-insensitively. The index does NOT make this collapse a no-op: it keys
        // on the STORED handle, so "@mvega_fh" and "mvega_fh" are two distinct, both-legal keys within one
        // exercise, and TrimStart('@') folds them together here. Without the grouping ToDictionary would throw on
        // that pair; with it, First() picks one arbitrarily (query order, unordered). That residual ambiguity is a
        // handle-NORMALIZATION gap (nothing forbids storing the '@' form), not a uniqueness gap, and is out of
        // scope for the index — see backend-host/03 Out of Scope.
        return personas
            .GroupBy(p => p.Handle.TrimStart('@'), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.Ordinal);
    }

    /// <summary>Commits a request-bound decision: the tracked disposition mutation + its single engine.reviewed event in ONE unit of work, then pushes.</summary>
    private async Task CommitDecisionAsync(
        EngineReviewItemEntity item,
        Guid exerciseId,
        EngineReviewAction action,
        string? actingHumanId,
        string? timeZone,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        _dbContext.TelemetryEvents.Add(BuildReviewedEvent(item, exerciseId, action, actingHumanId, timeZone, now));

        // One SaveChanges flushes BOTH the tracked disposition mutation and the added telemetry row (XC-004
        // same unit of work); the central write-guard validates ExerciseId != Guid.Empty on both scoped rows.
        await _dbContext.SaveChangesAsync(cancellationToken);
        await _broadcaster.BroadcastReviewItemChangedAsync(exerciseId, EngineReviewItemDto.FromEntity(item), cancellationToken);
    }

    /// <summary>
    /// Commits an auto-HOLD-tick resolution (no human actor) on the TRACKED row the tick re-read: mutates it, commits
    /// its single engine.reviewed event, then pushes. A row that is already resolved (Published/Vetoed) is left
    /// exactly as it is, with no event — the same WR-001 terminal guard every request-bound action applies.
    /// </summary>
    /// <param name="item">The tracked review item to resolve.</param>
    /// <param name="exerciseId">The tick's resolved scope.</param>
    /// <param name="disposition">The disposition to resolve it to.</param>
    /// <param name="action">The <c>engine.reviewed</c> action to record.</param>
    /// <param name="mutate">An extra change to the tracked row in the same unit of work (e.g. a partial-publish record), or <c>null</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    private async Task ResolveOnTickAsync(
        EngineReviewItemEntity item,
        Guid exerciseId,
        DraftDisposition disposition,
        EngineReviewAction action,
        Action<EngineReviewItemEntity>? mutate,
        CancellationToken cancellationToken)
    {
        if (IsResolved(item.Disposition))
        {
            return;
        }

        item.Disposition = disposition;
        mutate?.Invoke(item);

        var now = DateTimeOffset.UtcNow;
        // The tick is silence, not a human decision — actor.kind:'engine' with NO actingHumanId (null-omitted).
        _dbContext.TelemetryEvents.Add(BuildReviewedEvent(item, exerciseId, action, actingHumanId: null, TickTimeZoneFallback, now));
        await _dbContext.SaveChangesAsync(cancellationToken);
        await _broadcaster.BroadcastReviewItemChangedAsync(exerciseId, EngineReviewItemDto.FromEntity(item), cancellationToken);
    }

    /// <summary>Builds the single XC-004 <c>engine.reviewed</c> event for one decision against the locked v0 envelope (seam-freeze emitter).</summary>
    private TelemetryEvent BuildReviewedEvent(
        EngineReviewItemEntity item,
        Guid exerciseId,
        EngineReviewAction action,
        string? actingHumanId,
        string? timeZone,
        DateTimeOffset now)
    {
        var context = new EngineTelemetryContext
        {
            ExerciseId = exerciseId,
            WallClockTime = now,
            ScenarioTime = _clock.CurrentScenarioTime(exerciseId) ?? now,
            TimeZone = string.IsNullOrWhiteSpace(timeZone) ? TickTimeZoneFallback : timeZone,
            Channel = "social",
            Origin = EngineOrigin,
            // COR-018: the human behind the shared controller account, when the action is a human decision;
            // the auto-HOLD/auto-send tick carries no human (null-omitted by the emitter).
            Actor = new EngineTelemetryActor { Kind = EngineOrigin, ActingHumanId = actingHumanId },
            Target = new EngineTelemetryTarget { EntityType = DraftEntityType, EntityId = item.DraftId.ToString() },
        };

        var payload = new EngineEventPayloads.Reviewed
        {
            Storyline = item.StorylineId.ToString(),
            DraftId = item.DraftId.ToString(),
            Action = action,
        };

        return _telemetry.BuildEvent(EngineEventTypes.Reviewed, context, payload);
    }

    /// <summary>The current server-authoritative scenario instant as a round-trip ISO string (COR-053); the server wall-clock when the clock is unstarted.</summary>
    private string ScenarioTimeString(Guid exerciseId) =>
        (_clock.CurrentScenarioTime(exerciseId) ?? DateTimeOffset.UtcNow).ToString("O");
}

/// <summary>The action-request inputs a request-bound review decision carries — the acting human (COR-018) and the exercise IANA zone (XC-008). Never a client <c>exerciseId</c>.</summary>
/// <param name="ActingHumanId">The individual controller behind the shared account (COR-018) — required.</param>
/// <param name="TimeZone">The exercise IANA time zone for the XC-004 envelope (XC-008) — required (client-supplied stopgap until COR-050 metadata carries it).</param>
public readonly record struct EngineReviewActionInput(string? ActingHumanId, string? TimeZone);

/// <summary>The outcome kind of a review-service operation, mapped to an HTTP status at the endpoint (fail closed).</summary>
public enum EngineReviewOutcome
{
    /// <summary>The operation succeeded.</summary>
    Ok,

    /// <summary>No exercise scope was resolved — fail closed (401/403).</summary>
    ScopeUnresolved,

    /// <summary>The request failed validation (400).</summary>
    Invalid,

    /// <summary>No matching review item is visible under the scope — missing, or a cross-exercise IDOR (404).</summary>
    NotFound,

    /// <summary>The item is already resolved (Published/Vetoed) and cannot be acted on again (409).</summary>
    AlreadyResolved,

    /// <summary>The publish funnel did not fully reach the feed (a post came back Invalid/ScopeUnresolved); the item is left actionable and NOT marked Published (WR-002/SG-001) — mapped to a non-2xx (502).</summary>
    PublishFailed,
}

/// <summary>The result of a queue read.</summary>
public sealed class EngineQueueResult
{
    private EngineQueueResult(EngineReviewOutcome outcome, IReadOnlyList<EngineReviewItemDto> items)
    {
        Outcome = outcome;
        Items = items;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The projected queue — non-empty only when <see cref="Outcome"/> is <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public IReadOnlyList<EngineReviewItemDto> Items { get; }

    /// <summary>A successful queue read.</summary>
    public static EngineQueueResult Ok(IReadOnlyList<EngineReviewItemDto> items) => new(EngineReviewOutcome.Ok, items);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    public static EngineQueueResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, []);
}

/// <summary>The result of a single terminal review action.</summary>
public sealed class EngineReviewActionResult
{
    private EngineReviewActionResult(EngineReviewOutcome outcome, EngineReviewItemDto? item, string? validationError)
    {
        Outcome = outcome;
        Item = item;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The updated review item — non-null only on <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public EngineReviewItemDto? Item { get; }

    /// <summary>The validation message — non-null only on <see cref="EngineReviewOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful action carrying the updated item.</summary>
    public static EngineReviewActionResult Ok(EngineReviewItemDto item) => new(EngineReviewOutcome.Ok, item, null);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    public static EngineReviewActionResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request.</summary>
    public static EngineReviewActionResult Invalid(string validationError) => new(EngineReviewOutcome.Invalid, null, validationError);

    /// <summary>No matching item visible under the scope (missing / cross-exercise IDOR).</summary>
    public static EngineReviewActionResult NotFound() => new(EngineReviewOutcome.NotFound, null, null);

    /// <summary>The item is already resolved and cannot be acted on again.</summary>
    public static EngineReviewActionResult AlreadyResolved() => new(EngineReviewOutcome.AlreadyResolved, null, null);

    /// <summary>The publish funnel did not fully succeed; the item is left actionable and was NOT marked Published (WR-002/SG-001).</summary>
    public static EngineReviewActionResult PublishFailed() => new(EngineReviewOutcome.PublishFailed, null, null);
}

/// <summary>The per-item outcome kind of a batch approve.</summary>
public static class EngineBatchApproveItem
{
    /// <summary>The burst was published.</summary>
    public const string Published = "published";

    /// <summary>The burst was skipped — already resolved, or not visible under the scope (foreign/missing).</summary>
    public const string Skipped = "skipped";

    /// <summary>The burst was attempted but its publish did not fully reach the feed (WR-002); it was left actionable, not marked Published.</summary>
    public const string Failed = "failed";
}

/// <summary>One burst's outcome within a batch approve.</summary>
/// <param name="DraftId">The burst/draft id, as a GUID string.</param>
/// <param name="Outcome">The <see cref="EngineBatchApproveItem"/> outcome (<c>published</c> / <c>skipped</c>).</param>
public sealed record EngineBatchApproveItemOutcome(string DraftId, string Outcome);

/// <summary>The result of a batch approve.</summary>
public sealed class EngineBatchApproveResult
{
    private EngineBatchApproveResult(EngineReviewOutcome outcome, IReadOnlyList<EngineBatchApproveItemOutcome> outcomes, string? validationError)
    {
        Outcome = outcome;
        Outcomes = outcomes;
        ValidationError = validationError;
    }

    /// <summary>Which overall outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The per-item outcomes — populated only on <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public IReadOnlyList<EngineBatchApproveItemOutcome> Outcomes { get; }

    /// <summary>The validation message — non-null only on <see cref="EngineReviewOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful batch, carrying each burst's outcome.</summary>
    public static EngineBatchApproveResult Ok(IReadOnlyList<EngineBatchApproveItemOutcome> outcomes) => new(EngineReviewOutcome.Ok, outcomes, null);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    public static EngineBatchApproveResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, [], null);

    /// <summary>A rejected request.</summary>
    public static EngineBatchApproveResult Invalid(string validationError) => new(EngineReviewOutcome.Invalid, [], validationError);
}

/// <summary>The result of an autonomy control (swamped mode / kill switch).</summary>
public sealed class EngineAutonomyResult
{
    private EngineAutonomyResult(EngineReviewOutcome outcome, EngineAutonomyStateDto? state, string? validationError)
    {
        Outcome = outcome;
        State = state;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The resulting autonomy snapshot — non-null only on <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public EngineAutonomyStateDto? State { get; }

    /// <summary>The validation message — non-null only on <see cref="EngineReviewOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful control change carrying the resulting snapshot.</summary>
    public static EngineAutonomyResult Ok(EngineAutonomyStateDto state) => new(EngineReviewOutcome.Ok, state, null);

    /// <summary>The fail-closed result for an unresolved scope.</summary>
    public static EngineAutonomyResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request.</summary>
    public static EngineAutonomyResult Invalid(string validationError) => new(EngineReviewOutcome.Invalid, null, validationError);
}

/// <summary>The staff-only wire snapshot of an exercise's autonomy/safety state after a control change (COBRA cockpit; never a participant surface, XC-002).</summary>
public sealed class EngineAutonomyStateDto
{
    /// <summary>Whether swamped mode (timeout auto-send) is on — the only auto-send-on-expiry path (#36).</summary>
    [System.Text.Json.Serialization.JsonPropertyName("swampedMode")]
    public required bool SwampedMode { get; init; }

    /// <summary>Whether the engine is fully stopped (kill switch full-stop): no generation at all.</summary>
    [System.Text.Json.Serialization.JsonPropertyName("generationStopped")]
    public required bool GenerationStopped { get; init; }

    /// <summary>Whether a safety control (kill switch / degraded mode) is currently clamping autonomy down.</summary>
    [System.Text.Json.Serialization.JsonPropertyName("safetyClampActive")]
    public required bool SafetyClampActive { get; init; }

    /// <summary>The reason the provider is currently degraded, or <c>null</c> when healthy (drives the alert).</summary>
    [System.Text.Json.Serialization.JsonPropertyName("degradedReason")]
    public string? DegradedReason { get; init; }

    /// <summary>
    /// The per-exercise DEFAULT autonomy level (<c>suggest</c> / <c>delayed-auto</c>) BEFORE any storyline
    /// override or safety clamp — the level a controller sets via
    /// <c>POST /api/engine/settings/autonomy-default</c> (autonomy-safety story 05). Added additively to the
    /// snapshot every autonomy control already returns, so the cockpit can show the real posture instead of
    /// assuming it. When <see cref="SafetyClampActive"/> is <c>true</c> this default is deliberately NOT the
    /// effective level: the clamp still holds underneath until an explicit restore (§8.2).
    /// </summary>
    [System.Text.Json.Serialization.JsonPropertyName("exerciseDefaultLevel")]
    [System.Text.Json.Serialization.JsonConverter(typeof(AutonomyLevelJsonConverter))]
    public required AutonomyLevel ExerciseDefaultLevel { get; init; }

    /// <summary>
    /// The level the loop ACTUALLY routes on: <see cref="ExerciseDefaultLevel"/> lowered by any active safety
    /// clamp (§8.2), or <c>null</c> when generation is fully STOPPED (kill-switch full stop — nothing routes at
    /// any level). Projected from the domain's own <see cref="EngineAutonomyState.ResolveEffective"/> so a
    /// consumer never has to re-derive "a clamp is active, therefore effectively Suggest" — re-deriving it is
    /// exactly the class of bug (a mislabelled posture) that story 06 exists to fix.
    ///
    /// <para><b><c>required</c> although nullable, deliberately.</b> <c>null</c> means "fully stopped" to every
    /// consumer, so a construction site that simply forgot this field would publish a high-consequence silent
    /// default. <c>required</c> keeps null expressible while forcing the decision at every construction site.</para>
    /// </summary>
    [System.Text.Json.Serialization.JsonPropertyName("effectiveLevel")]
    [System.Text.Json.Serialization.JsonConverter(typeof(NullableAutonomyLevelJsonConverter))]
    public required AutonomyLevel? EffectiveLevel { get; init; }

    /// <summary>Projects the built autonomy state to the staff wire snapshot.</summary>
    /// <param name="state">The exercise's autonomy state.</param>
    /// <returns>The wire snapshot.</returns>
    public static EngineAutonomyStateDto From(EngineAutonomyState state)
    {
        ArgumentNullException.ThrowIfNull(state);

        // The EXERCISE-level effective disposition. Guid.Empty can never carry a per-storyline override
        // (SetStorylineOverride rejects an empty storyline id), so ResolveBase falls through to the exercise
        // default and this is exactly "the default, lowered by the clamp" — read from the domain, not re-derived.
        var effective = state.ResolveEffective(Guid.Empty);

        return new EngineAutonomyStateDto
        {
            SwampedMode = state.SwampedModeEnabled,
            GenerationStopped = state.IsGenerationStopped,
            SafetyClampActive = state.SafetyClampActive,
            DegradedReason = state.DegradedReason,
            ExerciseDefaultLevel = state.ExerciseDefault,
            EffectiveLevel = effective.GenerationStopped ? null : effective.Level,
        };
    }
}

/// <summary>
/// The per-exercise <see cref="EngineAutonomyState"/> registry (singleton) — the one place an exercise's
/// autonomy/safety state lives across requests, the auto-HOLD tick, and the provider-health fan-out. Holds
/// one independently-mutable state per exercise, keyed by <c>exerciseId</c>, so a control on one exercise can
/// never move another's (COR-001). Each state is created at the safe floor (<see cref="AutonomyLevel.Suggest"/>);
/// the reaction loop (story 01) raises a storyline to Delayed-auto as it routes bursts.
/// </summary>
/// <remarks>
/// <b>Shared-seam flag.</b> Story 01's decide stage SETS autonomy levels (routing a burst at Delayed-auto)
/// and story 02 READS them here for the auto-HOLD decision; for swamped auto-send to be reachable in
/// production both must converge on this SAME per-exercise instance. This registry is the singleton home for
/// that shared state — flagged in the report as the seam story 01 should resolve against.
/// </remarks>
public sealed class EngineAutonomyRegistry
{
    private readonly ConcurrentDictionary<Guid, EngineAutonomyState> _states = new();

    /// <summary>Gets (or creates at the Suggest floor) the autonomy state for <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The exercise whose autonomy state to resolve (COR-001); must not be empty.</param>
    /// <returns>The exercise's autonomy state.</returns>
    public EngineAutonomyState GetOrCreate(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Autonomy state is exercise-scoped (COR-001).", nameof(exerciseId));
        }

        return _states.GetOrAdd(exerciseId, id => EngineAutonomyState.Create(id));
    }

    /// <summary>The exercises that currently have an autonomy state — the set the provider-health fan-out clamps.</summary>
    public IReadOnlyCollection<Guid> ActiveExercises => _states.Keys.ToList();
}

/// <summary>
/// Host-wide bridge from the generation core's degraded-mode signal (NFR-003 / ADP-042, §3.5) to every active
/// exercise's autonomy state. A single generation provider serves the whole host, so one circuit trip fans
/// out to each exercise's <see cref="EngineAutonomyState"/> in the <see cref="EngineAutonomyRegistry"/> — the
/// WebApi/host registry the built single-exercise <see cref="AutonomyProviderHealthListener"/> documents as
/// "none yet". It reuses the built <see cref="EngineAutonomyState.DegradeToSuggest"/> /
/// <see cref="EngineAutonomyState.MarkProviderRecovered"/> (via <see cref="IEngineSafetySwitch"/>): the trip
/// clamps every exercise to Suggest (only ever LOWERS autonomy, §8.2), and recovery clears the alert but NEVER
/// raises autonomy — a controller restores explicitly. Registered as the host <see cref="IProviderHealthListener"/>
/// so the AddEngineGeneration circuit breaker's <c>OnOpened</c>/<c>OnClosed</c> drive it (replacing the no-op default).
/// </summary>
public sealed class EngineAutonomyProviderHealthListener : IProviderHealthListener
{
    private readonly EngineAutonomyRegistry _registry;
    private readonly IExerciseClock _clock;

    /// <summary>Creates the fan-out listener over the autonomy registry and the scenario clock.</summary>
    /// <param name="registry">The per-exercise autonomy-state registry to clamp.</param>
    /// <param name="clock">The scenario clock stamping each degrade/recover transition (COR-050/051).</param>
    public EngineAutonomyProviderHealthListener(EngineAutonomyRegistry registry, IExerciseClock clock)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(clock);
        _registry = registry;
        _clock = clock;
    }

    /// <inheritdoc />
    public ValueTask OnDegradedAsync(string reason, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        foreach (var exerciseId in _registry.ActiveExercises)
        {
            _registry.GetOrCreate(exerciseId).DegradeToSuggest(reason, _clock.CurrentScenarioMinute(exerciseId));
        }

        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask OnRecoveredAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        foreach (var exerciseId in _registry.ActiveExercises)
        {
            // Clears the degraded cause but NEVER raises autonomy (§8.2) — a human restores explicitly.
            _registry.GetOrCreate(exerciseId).MarkProviderRecovered(_clock.CurrentScenarioMinute(exerciseId));
        }

        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// The non-request-bound scenario tick that drives <see cref="EngineReviewService.EvaluateAutoHoldAsync"/> so
/// an expiring Delayed-auto countdown auto-HOLDs (or, under swamped mode, auto-sends) even with no controller
/// online — silence is never approval (D5-014/1.1). A <see cref="BackgroundService"/> has no HTTP request, so
/// it establishes exercise scope the SAME way story 01's loop does (implementation.md open question (b),
/// option (i)): per exercise it opens an <see cref="IServiceScope"/>, sets
/// <see cref="ExerciseContext.CurrentExerciseId"/> on that scope, and resolves an
/// <see cref="EngineReviewService"/> in-scope — the scope is server-authoritative and NEVER client-derived.
/// </summary>
/// <remarks>
/// The set of exercises to tick is derived by a trusted server-side sweep of counting-down review items
/// (<c>IgnoreQueryFilters</c> over the loop's own store) — it reads only exercise IDS to then process each
/// within its OWN scope, and never returns cross-exercise DATA to any client (COR-001-honest, exactly the
/// non-request-bound trust the loop already holds). Each iteration is guarded so a transient failure on one
/// exercise never stops the tick for the rest.
/// </remarks>
public sealed partial class EngineReviewTickHost : BackgroundService
{
    /// <summary>How often the auto-HOLD tick runs. Scenario countdowns are minute-granular, so a short wall-clock cadence is ample.</summary>
    public static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<EngineReviewTickHost> _logger;

    /// <summary>Creates the tick host over the scope factory it opens per-exercise scopes from.</summary>
    /// <param name="scopeFactory">The DI scope factory (per-exercise <see cref="IServiceScope"/>).</param>
    /// <param name="logger">The logger for resilient per-tick diagnostics.</param>
    public EngineReviewTickHost(IServiceScopeFactory scopeFactory, ILogger<EngineReviewTickHost> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A transient failure (e.g. the database briefly unreachable) must not kill the safety tick.
                LogTickFailed(ex);
            }
        }
    }

    /// <summary>Source-generated resilient-tick warning log (CA1848: no per-call allocation).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Engine review auto-HOLD tick failed; will retry on the next interval.")]
    private partial void LogTickFailed(Exception exception);

    /// <summary>Sweeps the active exercises and drives the auto-HOLD evaluation for each within its own scope.</summary>
    private async Task TickAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<Guid> exercises;
        await using (var sweepScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = sweepScope.ServiceProvider.GetRequiredService<PulseDbContext>();
            exercises = await dbContext.EngineReviewItems
                .IgnoreQueryFilters()
                .Where(item => item.Disposition == DraftDisposition.CountingDown)
                .Select(item => item.ExerciseId)
                .Distinct()
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        foreach (var exerciseId in exercises)
        {
            await using var scope = _scopeFactory.CreateAsyncScope();

            // Set the server-authoritative scope on this per-exercise scope, then resolve the service in-scope
            // so its PulseDbContext + IExerciseContext are bound to exactly this exercise (COR-001).
            if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
            {
                exerciseContext.CurrentExerciseId = exerciseId;
            }

            var service = scope.ServiceProvider.GetRequiredService<EngineReviewService>();
            await service.EvaluateAutoHoldAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
