namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ParticipantShell;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Pushes the participant overlay when an exercise's LIFECYCLE changes (#390) — world-steering's
/// <see cref="IExerciseLifecycleTransitionObserver"/>. Before it, only a pause-tier change pushed
/// <c>OverlayStateChanged</c>, so a tab that received a Freeze push and kept its connection stayed on the holding
/// page after EndEx, never saw a lifecycle <c>paused</c> holding page go up, and never saw it lift.
/// </summary>
/// <remarks>
/// <para>
/// <b>The push IS the GET (parity).</b> The pushed state is read through <see cref="ComposedOverlayStateReader"/> — the
/// committed exercise row through <see cref="ExerciseShellConfigSource"/>, then the registered
/// <see cref="IOverlayStateProjection"/> (<see cref="SteeringPauseOverlayProjection"/> in the composed host), exactly
/// what <c>GET /api/overlay-state</c> does through <c>ParticipantShellConfigService.GetOverlayStateAsync</c>, and the
/// same reader <see cref="PauseOverlayPublisher"/> pushes through. Only the transitioned row's ID is used: the state is
/// re-read under the lock at ticket time (PR #651 review W1), never taken from the request's in-memory row. So the precedence chain (endex &gt; pre-start &gt; pause &gt; none) and whatever <c>completed</c> projects to
/// are decided in one place for both channels and cannot diverge.
/// </para>
/// <para>
/// <b>Read only on the overlay store.</b> It never writes <see cref="OverlayStateService"/>: the store is the
/// steering tier's record of a controller's Freeze, and a lifecycle change must not overwrite it (a Freeze that
/// outlives a lifecycle pause must re-appear on <c>paused → live</c>). It only takes a ticket from it.
/// </para>
/// <para>
/// <b>Sequence convergence — the <see cref="PauseOverlayPublisher"/> rule, under the shared publish lock.</b> The
/// whole sequence runs under <see cref="OverlayStateService.AcquirePublishLockAsync"/> (#390 Gate-1 WR-001): the
/// <see cref="OverlayStateService.NextSequence"/> ticket is taken FIRST, then the projection is read, then the push is
/// sent with that ticket as its <c>sequence</c>. Because the pause publisher holds the same lock from its ticket to its
/// send, every lower-ticketed Freeze/Resume has already written the store when this projects, so this push both
/// outranks AND reflects every earlier one; a later Freeze/Resume push outranks it in turn. (The ticket alone was not
/// enough: this push writes no store, so a Freeze still awaiting its lifecycle read could lose to it.)
/// </para>
/// <para>
/// <b>Lifetime: SINGLETON, reading in its own DI scope per notification.</b> Chosen deliberately:
/// <list type="bullet">
///   <item>Everything it holds is a singleton (the hub context, the overlay store, the composed-read delegate), so a
///   singleton captures nothing scoped. The delegate opens a fresh scope per call for the scoped
///   <c>PulseDbContext</c> and projection — never captured.</item>
///   <item>The scope is NOT the request's. The observer runs inside the lifecycle request, but that request's scope
///   belongs to the CALLER: on the archive row action it is an org-tier request with no exercise resolved at all. The
///   projection is handed its exercise explicitly through <see cref="ExerciseShellConfigSource"/>, so it needs nothing
///   from the request; a fresh scope (whose <c>IExerciseContext</c> is unset, i.e. fail-closed) keeps it from reading
///   anything the request happens to hold, and keeps the request's <c>PulseDbContext</c> untouched after its commit.
///   This is the same idiom as <see cref="ExerciseLifecycleStatusReader"/>.</item>
///   <item><see cref="ExerciseLifecycleService"/> is constructed on every gated participant request (the lifecycle gate
///   resolves it), so the observer it injects must be cheap to resolve and must not drag the projection graph into
///   that constructor. Resolving the projection lazily also makes a projection ↔ lifecycle-service DI cycle
///   impossible to introduce by accident.</item>
/// </list>
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> The fan-out group comes only from the transitioned row's id through
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/>; that row was loaded by the lifecycle service from the server-resolved
/// scope (or the tenant-checked org path), never from client input.
/// </para>
/// <para>
/// <b>XC-002 / XC-004.</b> The payload is the same <see cref="ParticipantOverlayStateDto"/> type the Freeze push uses,
/// built by <see cref="ParticipantOverlayStateDto.FromComposed"/> from the composed GET projection alone — never from
/// the steering store's snapshot — so it is the GET body plus <c>sequence</c>, and no staff field is reachable. No telemetry: the lifecycle service's one
/// <c>exercise.lifecycle.transitioned</c> event already records the action.
/// </para>
/// <para>
/// <b>Bounded (PR #651 review W2).</b> This runs inline in the lifecycle POST, so the lock wait, the composed read and
/// the hub send together are bounded by <see cref="PublishTimeout"/> (5 s by default). A timeout is logged and
/// swallowed here — the transition has committed, the lock is released by <c>using</c>, and the next publish proceeds.
/// Any other failure propagates to <see cref="ExerciseLifecycleService"/>'s best-effort, logging wrapper.
/// </para>
/// <para>
/// <b>The lock is IN-PROCESS only (PR #651 review S1).</b> <see cref="OverlayStateService.AcquirePublishLockAsync"/> —
/// like the store and its sequence counter — lives in this app instance's memory. That is correct for today's single
/// App Service instance. A scale-out to several instances needs a distributed lock or ordering at the SignalR
/// backplane (and a shared sequence), or two instances' pushes for one exercise can interleave again.
/// </para>
/// </remarks>
public sealed partial class LifecycleOverlayPublisher : IExerciseLifecycleTransitionObserver
{
    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;
    private readonly OverlayStateService _overlayState;
    private readonly ComposedOverlayStateReader _composedOverlayReader;
    private readonly ILogger<LifecycleOverlayPublisher> _logger;

    /// <summary>Creates the publisher over the shared hub, the overlay store's lock and ticket, and the composed read.</summary>
    /// <param name="hubContext">The context for the SHARED <see cref="ExerciseRealtimeHub"/> (no second hub).</param>
    /// <param name="overlayState">The overlay store — used ONLY for its publish lock and sequence ticket, never written.</param>
    /// <param name="composedOverlayReader">
    /// Reads the composed overlay exactly as <c>GET /api/overlay-state</c> serves it, from COMMITTED state, in a DI scope
    /// of its own (the same reader <see cref="PauseOverlayPublisher"/> pushes through).
    /// </param>
    /// <param name="logger">Logs a bounded publish that timed out — never silent.</param>
    public LifecycleOverlayPublisher(
        IHubContext<ExerciseRealtimeHub> hubContext,
        OverlayStateService overlayState,
        ComposedOverlayStateReader composedOverlayReader,
        ILogger<LifecycleOverlayPublisher> logger)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(composedOverlayReader);
        ArgumentNullException.ThrowIfNull(logger);

        _hubContext = hubContext;
        _overlayState = overlayState;
        _composedOverlayReader = composedOverlayReader;
        _logger = logger;
    }

    /// <summary>
    /// The bound on the whole publish — lock wait, composed read and hub send (PR #651 review W2). Defaults to
    /// <see cref="OverlayStateService.DefaultPublishTimeout"/>; settable only so tests can use a short bound.
    /// </summary>
    internal TimeSpan PublishTimeout { get; init; } = OverlayStateService.DefaultPublishTimeout;

    /// <inheritdoc />
    public async Task OnTransitionedAsync(Exercise exercise, string fromState, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        // ONLY the id is read off the request's row (W1): the state pushed is re-read from committed data below.
        var exerciseId = exercise.Id;
        if (exerciseId == Guid.Empty)
        {
            // Fail closed: never fan out to an unscoped group (COR-001).
            return;
        }

        // W2: this runs INLINE in the lifecycle POST (with CancellationToken.None), so the whole publish is bounded —
        // a slow participant pipe must never hang an EndEx/pause request. The transition has already committed.
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(PublishTimeout);
        var bounded = timeout.Token;

        try
        {
            // WR-001 (#390 Gate-1): the per-exercise publish lock PauseOverlayPublisher also holds, across ticket ->
            // read -> send, so a Freeze can never be between its ticket and its store write while this reads.
            // Released by `using` on every exit, exceptions and timeouts included; nothing below publishes, so it is
            // never re-taken.
            using var publishLock = await _overlayState.AcquirePublishLockAsync(exerciseId, bounded)
                .ConfigureAwait(false);

            // 1. The ticket FIRST (PauseOverlayPublisher's convergence rule — see the remarks).
            var sequence = _overlayState.NextSequence(exerciseId);

            // 2. W1: a FRESH read of the composed overlay from COMMITTED state, AFTER the ticket and under the lock —
            //    never the request's in-memory row. Two transitions can commit in one order and reach here in the
            //    other; projecting each request's own row would let the earlier (stale) one go out last with the
            //    higher ticket. Reading at ticket time means the highest ticket always carries the latest commit.
            var overlay = await _composedOverlayReader(exerciseId, bounded).WaitAsync(bounded).ConfigureAwait(false);

            // 3. The same participant DTO type the Freeze push sends, built ONLY from the composed GET projection,
            //    carrying this push's ticket. WaitAsync bounds a transport that ignores the token.
            await _hubContext.Clients
                .Group(ExerciseRealtimeHub.GroupNameFor(exerciseId))
                .SendAsync(
                    PauseOverlayPublisher.OverlayStateChangedEvent,
                    ParticipantOverlayStateDto.FromComposed(overlay, sequence),
                    bounded)
                .WaitAsync(bounded)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            // W2: swallowed and logged, never thrown — the transition committed, and connected tabs heal on their next
            // re-GET (reconnect, or the tab becoming visible).
            LogLifecyclePushTimedOut(exerciseId, PublishTimeout.TotalMilliseconds);
        }
    }

    /// <summary>Source-generated warning for a lifecycle push that exceeded its bound (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The lifecycle overlay push for exercise {ExerciseId} did not complete within {TimeoutMs} ms (lock " +
                  "wait, composed read or hub send) and was abandoned; the transition STANDS — connected participants " +
                  "see it on their next re-read.")]
    private partial void LogLifecyclePushTimedOut(Guid exerciseId, double timeoutMs);
}
