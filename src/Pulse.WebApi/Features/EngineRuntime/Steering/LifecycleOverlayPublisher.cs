namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
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
/// <b>The push IS the GET (parity).</b> The pushed state is computed by resolving the registered
/// <see cref="IOverlayStateProjection"/> — <see cref="SteeringPauseOverlayProjection"/> in the composed host, the very
/// projection <c>GET /api/overlay-state</c> calls through <c>ParticipantShellConfigService.GetOverlayStateAsync</c> —
/// over <see cref="ExerciseShellConfigSource.FromExercise"/> of the transitioned row, the same source factory that GET
/// uses. So the precedence chain (endex &gt; pre-start &gt; pause &gt; none) and whatever <c>completed</c> projects to
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
/// <b>Lifetime: SINGLETON, with its own DI scope per notification.</b> Chosen deliberately:
/// <list type="bullet">
///   <item>Everything it holds is a singleton (the hub context, the overlay store, the scope factory), so a singleton
///   captures nothing scoped. The scoped projection is resolved INSIDE a fresh scope at call time — never captured.</item>
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
/// <b>Failures</b> propagate to the caller, which is <see cref="ExerciseLifecycleService"/>'s best-effort, logging
/// wrapper — the transition has committed by the time this runs.
/// </para>
/// </remarks>
public sealed class LifecycleOverlayPublisher : IExerciseLifecycleTransitionObserver
{
    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;
    private readonly OverlayStateService _overlayState;
    private readonly IServiceScopeFactory _scopeFactory;

    /// <summary>Creates the publisher over the shared hub, the overlay store's ticket counter, and a scope factory.</summary>
    /// <param name="hubContext">The context for the SHARED <see cref="ExerciseRealtimeHub"/> (no second hub).</param>
    /// <param name="overlayState">The per-exercise overlay store — used ONLY for its sequence ticket, never written.</param>
    /// <param name="scopeFactory">Opens the per-notification scope the scoped projection is resolved in.</param>
    public LifecycleOverlayPublisher(
        IHubContext<ExerciseRealtimeHub> hubContext,
        OverlayStateService overlayState,
        IServiceScopeFactory scopeFactory)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(scopeFactory);

        _hubContext = hubContext;
        _overlayState = overlayState;
        _scopeFactory = scopeFactory;
    }

    /// <inheritdoc />
    public async Task OnTransitionedAsync(Exercise exercise, string fromState, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        var exerciseId = exercise.Id;
        if (exerciseId == Guid.Empty)
        {
            // Fail closed: never fan out to an unscoped group (COR-001).
            return;
        }

        // WR-001 (#390 Gate-1): the per-exercise publish lock PauseOverlayPublisher also holds, across ticket ->
        // project -> send, so a Freeze can never be between its ticket and its store write while this projects.
        // Released by `using` on every exit, exceptions included; nothing below publishes, so it is never re-taken.
        using var publishLock = await _overlayState.AcquirePublishLockAsync(exerciseId, cancellationToken)
            .ConfigureAwait(false);

        // 1. The ticket FIRST (PauseOverlayPublisher's convergence rule — see the remarks).
        var sequence = _overlayState.NextSequence(exerciseId);

        // 2. The SAME projection over the SAME source factory the GET uses, in a scope of its own.
        var source = ExerciseShellConfigSource.FromExercise(exercise);
        OverlayStateResponse overlay;
        await using (var scope = _scopeFactory.CreateAsyncScope())
        {
            overlay = await scope.ServiceProvider
                .GetRequiredService<IOverlayStateProjection>()
                .ProjectAsync(source, cancellationToken)
                .ConfigureAwait(false);
        }

        // 3. The same participant DTO type the Freeze push sends, built ONLY from the composed GET projection (never
        //    the steering store snapshot), carrying this push's ticket.
        var payload = ParticipantOverlayStateDto.FromComposed(overlay, sequence);

        await _hubContext.Clients
            .Group(ExerciseRealtimeHub.GroupNameFor(exerciseId))
            .SendAsync(PauseOverlayPublisher.OverlayStateChangedEvent, payload, cancellationToken)
            .ConfigureAwait(false);
    }
}
