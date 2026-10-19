namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Threading;
using System.Threading.Tasks;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Notified after an exercise's lifecycle transition has COMMITTED (#390). The seam this slice OWNS so that other
/// slices can react to a transition (world-steering pushes the participant overlay) without this slice taking a
/// dependency on them, on SignalR, or on the overlay store.
/// </summary>
/// <remarks>
/// <para>
/// <b>When it is called.</b> <see cref="ExerciseLifecycleService"/> calls it exactly once per APPLIED transition,
/// right after the one <c>SaveChangesAsync</c> that commits the status change and its audit event, through BOTH
/// entry points (<c>TransitionAsync</c> and the org-tier <c>TransitionTenantCheckedAsync</c> the archive row action
/// uses). A refused, invalid, unscoped or not-found transition never reaches it: nothing changed, so there is
/// nothing to announce.
/// </para>
/// <para>
/// <b>Best effort.</b> The transition has already committed when this runs, so the service swallows and logs any
/// exception it throws, and calls it with <see cref="CancellationToken.None"/>: a client that aborts the request
/// after the commit must not cancel the announcement of a change that did happen. An implementation must therefore
/// never be load-bearing for the transition itself.
/// </para>
/// <para>
/// <b>Read only.</b> <paramref name="exercise"/> (on <see cref="OnTransitionedAsync"/>) is the request's TRACKED row,
/// already carrying the new status. An implementation must not mutate it or save through the request's context.
/// </para>
/// <para>
/// <b>One observer.</b> This slice <c>TryAdd</c>s <see cref="NoOpExerciseLifecycleTransitionObserver"/> as the floor;
/// a contributor replaces it (<c>RemoveAll</c> + add). If a second contributor ever needs it, widen this to an
/// enumerable of observers rather than evicting the first.
/// </para>
/// </remarks>
public interface IExerciseLifecycleTransitionObserver
{
    /// <summary>Called once after a lifecycle transition commits.</summary>
    /// <param name="exercise">The transitioned exercise row, carrying its NEW status. Read only.</param>
    /// <param name="fromState">The canonical COR-032 state the exercise moved FROM.</param>
    /// <param name="cancellationToken">Always <see cref="CancellationToken.None"/> from the lifecycle service.</param>
    /// <returns>A task that completes when the observer is done.</returns>
    Task OnTransitionedAsync(Exercise exercise, string fromState, CancellationToken cancellationToken);
}

/// <summary>
/// The floor <see cref="IExerciseLifecycleTransitionObserver"/>: does nothing. Keeps a lifecycle-only host (no
/// world-steering slice) constructible and behaviourally unchanged.
/// </summary>
public sealed class NoOpExerciseLifecycleTransitionObserver : IExerciseLifecycleTransitionObserver
{
    /// <inheritdoc />
    public Task OnTransitionedAsync(Exercise exercise, string fromState, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
