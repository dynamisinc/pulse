namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Reads the AUTHORITATIVE pause tier for an exercise — a one-method indirection over
/// <see cref="PauseTierRegistry.GetTier"/> whose only job is to break a DI cycle:
/// <see cref="PauseTierRegistry"/> depends on <see cref="IPauseOverlayPublisher"/>, so a publisher that
/// constructor-injected the registry directly could never be constructed. Registered as a delegate that
/// resolves the registry LAZILY, at publish time, when the registry singleton already exists (see
/// <see cref="PauseOverlayServiceCollectionExtensions.AddPauseParticipantOverlay"/>). Also the seam a unit test
/// substitutes to prove the publisher trusts the registry rather than a possibly-stale
/// the AUTHORITATIVE tier read from the registry (falling back to <c>transition.To</c> only if the
/// failure preceded that read).
/// </summary>
/// <param name="exerciseId">The server-resolved exercise (COR-001).</param>
/// <returns>The exercise's currently-recorded pause tier.</returns>
public delegate PauseTier PauseTierReader(Guid exerciseId);

/// <summary>
/// The REAL <see cref="IPauseOverlayPublisher"/> (feature: world-steering, story 08; CTL-023, COR-001, XC-001,
/// XC-002) — it replaces story 07's <see cref="NullPauseOverlayPublisher"/> and is what finally makes Freeze
/// participant-visible (D5-014/1.3 guards Freeze precisely BECAUSE participants notice it). On every actual
/// pause-tier transition it:
/// <list type="number">
///   <item>writes the exercise's participant overlay into <see cref="OverlayStateService"/> — which
///   <c>GET /api/overlay-state</c> then serves, so a participant joining or refreshing MID-Freeze still lands
///   on the holding page;</item>
///   <item>pushes the resulting state to that exercise's participants as the <c>OverlayStateChanged</c> client
///   event, so an already-loaded participant tab shows/clears the holding page with NO manual refresh.</item>
/// </list>
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001, always-Critical).</b> The fan-out target is derived ONLY from
/// <see cref="PauseTierTransition.ExerciseId"/> — always the server-resolved scope, never client input — through
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/>, the single source of truth the hub itself uses to PLACE a
/// connection. So the join side and the broadcast side cannot drift, and a Freeze in exercise A can never reach
/// a participant in exercise B. This mirrors <see cref="EngineReviewBroadcaster"/> field-for-field: the same
/// <see cref="IHubContext{THub}"/> over the SAME shared <c>/hubs/exercise</c> hub — no second hub, no second
/// client connection. It deliberately does NOT read the injected, per-request
/// <see cref="Pulse.WebApi.Data.IExerciseContext"/>, and does not touch
/// <see cref="ExerciseRealtimeHub.OnConnectedAsync"/> (whose connect-time
/// <c>Context.GetHttpContext()?.GetHostResolvedExerciseId()</c> resolution is the PR #347 fix — reading the
/// per-request context inside hub connection code was the confirmed cause of that bug).
/// </para>
/// <para>
/// <b>Two worlds (XC-002).</b> The pushed payload is <see cref="ParticipantOverlayStateDto"/>, built only from
/// an <see cref="OverlayStateSnapshot"/>. Exactly two fields of the transition are read —
/// <see cref="PauseTierTransition.ExerciseId"/> (the fan-out scope) and
/// <see cref="PauseTierTransition.OverlayRegister"/> (the controller's presentation choice, which IS what
/// participants are meant to see). <see cref="PauseTierTransition.ActingHumanId"/> is read NOWHERE in this type,
/// and the staff <see cref="PauseTier"/> names never cross: a participant learns that the world is held, never
/// which controller held it, and never the staff vocabulary for it.
/// </para>
/// <para>
/// <b>Never throws into the controller's action (WR-004).</b> <see cref="PauseTierRegistry"/> applies the tier
/// and the clock freeze BEFORE publishing, so a broken push must never look like a failed Freeze: transport (and
/// authoritative-read) failures are swallowed and logged here, exactly as the interface documents. Cancellation
/// is the one exception left to propagate, matching the registry's own <c>catch</c> filter.
/// </para>
/// <para>
/// <b>Out-of-order publishes (the story-07 review's SG-206 note).</b> The registry publishes outside its lock,
/// so two rapid transitions can arrive here in either order. This publisher therefore (a) takes a monotonic
/// ticket from <see cref="OverlayStateService.NextSequence"/> BEFORE it reads anything, (b) reads the tier from
/// the registry rather than trusting <see cref="PauseTierTransition.To"/>, and (c) broadcasts the snapshot the
/// store holds AFTER the write. See <see cref="OverlayStateService"/> for why all three together make the
/// participant overlay converge on the true final state, and why no single one of them suffices.
/// </para>
/// <para>
/// <b>No telemetry (XC-004).</b> Nothing is emitted here: story 07's console-side <c>steering_action</c> already
/// records the causal action exactly once, and a second event for the same transition would corrupt the audit
/// trail rather than enrich it.
/// </para>
/// <para>
/// <b>The overlay-precedence ruling is enforced HERE TOO, not only on the GET (Gate-1 CR-001).</b> This push is
/// the SECOND participant channel: an already-connected tab renders it with no refresh, and nothing disconnects
/// hub clients when an exercise reaches EndEx (<c>ExerciseLifecycleGatingMiddleware</c> names "nothing publishes
/// into a closed exercise" an ASSUMPTION, not an invariant). So a Freeze published after
/// <c>live → completed</c> would put the in-fiction holding page over a permanently ended exercise while that
/// same tab's re-GET said <c>none</c> — two channels disagreeing about one state on one screen. A Freeze is
/// therefore gated by the SAME predicate the read side uses
/// (<see cref="SteeringOverlayPrecedence.PauseIsParticipantVisibleIn"/>): one rule, one place, so the open
/// <c>staged</c> question resolves in a single line for both channels.
/// </para>
/// <para>
/// <b>Only ADDING an overlay is gated; CLEARING is always published.</b> A Resume never consults the lifecycle.
/// Gating it would strand a holding page on a tab that legitimately received a Freeze push while the exercise was
/// still running and then saw it end — the clear is the only thing that can rescue that tab, so it must always go
/// out. Suppression is asymmetric on purpose, and in the safe direction.
/// </para>
/// </remarks>
public sealed partial class PauseOverlayPublisher : IPauseOverlayPublisher
{
    /// <summary>
    /// The SignalR client method the participant shell's <c>overlayState.ts</c> live branch subscribes to on the
    /// shared connection (<c>core/realtime/connection.ts</c>).
    /// </summary>
    internal const string OverlayStateChangedEvent = "OverlayStateChanged";

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;
    private readonly OverlayStateService _overlayState;
    private readonly PauseTierReader _tierReader;
    private readonly ExerciseLifecycleStatusReader _lifecycleStatusReader;
    private readonly ILogger<PauseOverlayPublisher> _logger;

    /// <summary>Creates the publisher over the shared exercise hub, the overlay store, and the two readers.</summary>
    /// <param name="hubContext">The context for the SHARED <see cref="ExerciseRealtimeHub"/> (no second hub).</param>
    /// <param name="overlayState">The per-exercise overlay store <c>GET /api/overlay-state</c> reads.</param>
    /// <param name="tierReader">Reads the authoritative pause tier (and breaks the registry DI cycle).</param>
    /// <param name="lifecycleStatusReader">
    /// Reads the exercise's COR-032 lifecycle status, so the ruling is enforced on this PUSH channel and not only
    /// on the GET (CR-001). A delegate rather than an injected scope factory, mirroring
    /// <paramref name="tierReader"/> — which is also what keeps this constructor free of any persistence type.
    /// </param>
    /// <param name="logger">Logs a swallowed publish failure, and a suppressed publish — never silent.</param>
    public PauseOverlayPublisher(
        IHubContext<ExerciseRealtimeHub> hubContext,
        OverlayStateService overlayState,
        PauseTierReader tierReader,
        ExerciseLifecycleStatusReader lifecycleStatusReader,
        ILogger<PauseOverlayPublisher> logger)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(tierReader);
        ArgumentNullException.ThrowIfNull(lifecycleStatusReader);
        ArgumentNullException.ThrowIfNull(logger);

        _hubContext = hubContext;
        _overlayState = overlayState;
        _tierReader = tierReader;
        _lifecycleStatusReader = lifecycleStatusReader;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(transition);

        // ONLY the exercise and the controller's overlay REGISTER are read off the transition here (plus the tier,
        // from the registry). ActingHumanId is never touched — see the type's XC-002 note.
        var exerciseId = transition.ExerciseId;
        if (exerciseId == Guid.Empty)
        {
            // Fail closed: never write, and never fan out to, an unscoped/ambient exercise group (COR-001).
            LogUnscopedPublishIgnored();
            return;
        }

        // Declared OUTSIDE the try so the failure log can name the AUTHORITATIVE tier rather than
        // transition.To. This publisher exists precisely because transition.To can be stale under out-of-order
        // publishes, so logging it on failure would misreport exactly the scenario the design defends against
        // (Copilot review, PR #386). Null means "we failed before the registry read".
        PauseTier? authoritativeTier = null;

        try
        {
            // The ticket comes FIRST, so the last-invoked publish holds the highest one (see the remarks).
            var sequence = _overlayState.NextSequence(exerciseId);
            var tier = _tierReader(exerciseId);
            authoritativeTier = tier;

            // CR-001: a Freeze may only become participant-visible in a genuinely RUNNING exercise. Consulted
            // BEFORE the store write, so a suppressed Freeze leaves no trace on either channel — the store is what
            // the GET serves and what a reconnect heals to, so writing 'pause' here and relying on the read gate to
            // hide it would recreate exactly the two-sources-of-truth split this fix closes. A CLEARING publish is
            // never gated (see the type's remarks): it is the only thing that can rescue a tab which received a
            // legitimate Freeze push before the lifecycle moved on.
            if (tier == PauseTier.Freeze)
            {
                var lifecycleStatus = await _lifecycleStatusReader(exerciseId, cancellationToken)
                    .ConfigureAwait(false);

                if (!SteeringOverlayPrecedence.PauseIsParticipantVisibleIn(lifecycleStatus))
                {
                    // The tier and the clock freeze ALREADY stand and are untouched — only the participant-facing
                    // overlay is withheld. Logged, because a controller who froze a non-running world will see no
                    // participant effect and that must be explicable from the logs.
                    LogOverlayPublishSuppressed(exerciseId, lifecycleStatus ?? "(no exercise row)");
                    return;
                }
            }

            // The controller's SELECTED register decides which holding page participants see (AC1/AC5) — the
            // registry already coerced it to a contract literal, and this re-coercion is the last line of defence
            // before a participant-visible value (a non-contract literal would be dropped by the client's own
            // guard, leaving a Freeze invisible). A cleared overlay always reverts to in-fiction (AC3).
            var snapshot = tier == PauseTier.Freeze
                ? _overlayState.Apply(
                    exerciseId,
                    OverlayStateWire.Pause,
                    OverlayStateWire.CoerceRegister(transition.OverlayRegister),
                    sequence)
                : _overlayState.Apply(exerciseId, OverlayStateWire.None, OverlayStateWire.InFiction, sequence);

            // Store BEFORE push: a reconnecting participant's GET must never read older state than a push that
            // has already gone out. The pushed value is the store's CURRENT snapshot, not the one this call
            // hoped to write — so a write that lost to a newer one broadcasts the newer state.
            await _hubContext.Clients
                .Group(ExerciseRealtimeHub.GroupNameFor(exerciseId))
                .SendAsync(
                    OverlayStateChangedEvent,
                    ParticipantOverlayStateDto.FromSnapshot(snapshot),
                    cancellationToken: cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // WR-004: the tier + clock freeze ALREADY stand. Swallowing keeps a transport blip from reverting a
            // safety action the world has felt — but it is logged loudly, because participants may not have been
            // told (their next reconnect re-GETs the store, which is the recovery path).
            LogOverlayPushFailed(ex, exerciseId, authoritativeTier ?? transition.To);
        }
    }

    /// <summary>Source-generated warning for an unscoped publish (CA1848: no per-call allocation).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A pause-overlay publish named no exercise; nothing was written or broadcast (COR-001 fail-closed).")]
    private partial void LogUnscopedPublishIgnored();

    /// <summary>
    /// Source-generated notice that the overlay-precedence ruling withheld a Freeze from participants (CA1848).
    /// Information, not a warning: this is the ruling working as designed, and it is the ONLY visible trace of a
    /// Freeze that produced no participant effect.
    /// </summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "A Freeze on exercise {ExerciseId} was NOT made participant-visible: its lifecycle state " +
                  "{LifecycleStatus} is not a running world (overlay precedence: endex > pre-start > pause > " +
                  "none). The pause tier and its clock effect STAND; only the participant overlay was withheld.")]
    private partial void LogOverlayPublishSuppressed(Guid exerciseId, string lifecycleStatus);

    /// <summary>Source-generated best-effort push-failure warning (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The participant overlay push for exercise {ExerciseId} (tier {Tier}) failed; the tier and its " +
                  "clock effect STAND — connected participants may not have been notified until they reconnect.")]
    private partial void LogOverlayPushFailed(Exception exception, Guid exerciseId, PauseTier tier);
}
