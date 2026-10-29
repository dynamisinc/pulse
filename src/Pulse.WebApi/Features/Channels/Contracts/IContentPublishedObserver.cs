namespace Pulse.WebApi.Features.Channels.Contracts;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// FC-7, the content counterpart of <c>IPostPublishedObserver</c> (registry in channels-foundation story 04). The
/// funnel calls every registered observer after the change commits; E8 reaction hooks (PRS-022) and E10 attach
/// here. An observer sees the full entity, including staff-only provenance, and must never forward it to a
/// participant surface (XC-002). An observer failure is logged, never rolled back into the publish.
/// </summary>
/// <remarks>
/// <para>
/// Unlike <c>IPostPublishedObserver</c> it is async and takes no exercise id: the entity carries
/// <c>ExerciseId</c>, and the scope is the funnel's. The <c>item</c> passed in is the funnel's
/// TRACKED instance in its scoped <c>PulseDbContext</c>: treat it as read-only (a mutation would dirty the funnel's
/// context); an observer that writes uses its own unit of work.
/// </para>
/// <para>
/// A restore (retracted → published) is a publish: it calls <see cref="OnPublishedAsync"/>, never
/// <see cref="OnRevisedAsync"/>. <see cref="OnRevisedAsync"/> and <see cref="OnRetractedAsync"/> are default no-ops,
/// so the funnel must invoke them through the interface type.
/// </para>
/// </remarks>
public interface IContentPublishedObserver
{
    /// <summary>Called once per item that became <c>published</c> (publish-now, the runner, a restore).</summary>
    /// <param name="item">The committed item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the observer is done.</returns>
    Task OnPublishedAsync(ContentItem item, CancellationToken cancellationToken = default);

    /// <summary>Called once per committed revise of a published item.</summary>
    /// <param name="item">The committed item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the observer is done.</returns>
    Task OnRevisedAsync(ContentItem item, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <summary>Called once per committed retract.</summary>
    /// <param name="item">The committed item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the observer is done.</returns>
    Task OnRetractedAsync(ContentItem item, CancellationToken cancellationToken = default) => Task.CompletedTask;
}
