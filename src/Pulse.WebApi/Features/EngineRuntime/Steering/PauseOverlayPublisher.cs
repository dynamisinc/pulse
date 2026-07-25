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
/// <c>transition.To</c>.
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
/// an <see cref="OverlayStateSnapshot"/>. <see cref="PauseTierTransition.ActingHumanId"/> is read NOWHERE in
/// this type, and the staff <see cref="PauseTier"/> names never cross: a participant learns that the world is
/// held, never which controller held it, and never the staff vocabulary for it.
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
/// </remarks>
public sealed partial class PauseOverlayPublisher : IPauseOverlayPublisher
{
    /// <summary>
    /// The SignalR client method the participant shell's <c>overlayState.ts</c> live branch subscribes to on the
    /// shared connection (<c>core/realtime/connection.ts</c>).
    /// </summary>
    internal const string OverlayStateChangedEvent = "OverlayStateChanged";

    /// <summary>
    /// The register a Freeze's holding page renders in.
    ///
    /// <para><b>Known plumbing gap (documented, deliberately not worked around).</b> The register the controller
    /// has SELECTED lives in the console (<c>usePauseState().overlayRegister</c>) and is NOT on the wire: story
    /// 07's frozen <c>POST /api/steering/pause-tier</c> body carries only <c>tier</c>/<c>actingHumanId</c>/
    /// <c>timeZone</c>, and <see cref="PauseTierTransition"/> has no register field. Adding one means editing
    /// story 07's files, which are frozen for this story. So the participant sees the console's OWN default
    /// selection — <c>usePauseState</c>'s store initializes <c>overlayRegister</c> to
    /// <c>'out-of-fiction'</c> — which is exactly what the console displays as selected until a controller
    /// changes it. A follow-up story should add <c>overlayRegister</c> to the pause-tier request and carry it
    /// through <see cref="PauseTierTransition"/> to here; <see cref="OverlayStateService.Apply"/> already takes
    /// the register as a parameter, so that change lands in this one line.</para>
    /// </summary>
    internal const string FreezeRegister = OverlayStateWire.OutOfFiction;

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;
    private readonly OverlayStateService _overlayState;
    private readonly PauseTierReader _tierReader;
    private readonly ILogger<PauseOverlayPublisher> _logger;

    /// <summary>Creates the publisher over the shared exercise hub, the overlay store, and the tier reader.</summary>
    /// <param name="hubContext">The context for the SHARED <see cref="ExerciseRealtimeHub"/> (no second hub).</param>
    /// <param name="overlayState">The per-exercise overlay store <c>GET /api/overlay-state</c> reads.</param>
    /// <param name="tierReader">Reads the authoritative pause tier (and breaks the registry DI cycle).</param>
    /// <param name="logger">Logs a swallowed publish failure — never silent.</param>
    public PauseOverlayPublisher(
        IHubContext<ExerciseRealtimeHub> hubContext,
        OverlayStateService overlayState,
        PauseTierReader tierReader,
        ILogger<PauseOverlayPublisher> logger)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(tierReader);
        ArgumentNullException.ThrowIfNull(logger);

        _hubContext = hubContext;
        _overlayState = overlayState;
        _tierReader = tierReader;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(transition);

        // ONLY the exercise is read off the transition here (plus the tier, from the registry). ActingHumanId is
        // never touched — see the type's XC-002 note.
        var exerciseId = transition.ExerciseId;
        if (exerciseId == Guid.Empty)
        {
            // Fail closed: never write, and never fan out to, an unscoped/ambient exercise group (COR-001).
            LogUnscopedPublishIgnored();
            return;
        }

        try
        {
            // The ticket comes FIRST, so the last-invoked publish holds the highest one (see the remarks).
            var sequence = _overlayState.NextSequence();
            var tier = _tierReader(exerciseId);

            var snapshot = tier == PauseTier.Freeze
                ? _overlayState.Apply(exerciseId, OverlayStateWire.Pause, FreezeRegister, sequence)
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
            LogOverlayPushFailed(ex, exerciseId, transition.To);
        }
    }

    /// <summary>Source-generated warning for an unscoped publish (CA1848: no per-call allocation).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "A pause-overlay publish named no exercise; nothing was written or broadcast (COR-001 fail-closed).")]
    private partial void LogUnscopedPublishIgnored();

    /// <summary>Source-generated best-effort push-failure warning (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The participant overlay push for exercise {ExerciseId} (tier {Tier}) failed; the tier and its " +
                  "clock effect STAND — connected participants may not have been notified until they reconnect.")]
    private partial void LogOverlayPushFailed(Exception exception, Guid exerciseId, PauseTier tier);
}
