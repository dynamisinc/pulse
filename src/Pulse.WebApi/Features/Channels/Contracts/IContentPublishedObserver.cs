namespace Pulse.WebApi.Features.Channels.Contracts;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// FC-7, the content mirror of <c>IPostPublishedObserver</c> (registry in channels-foundation story 04). The
/// funnel calls every registered observer after the change commits; E8 reaction hooks (PRS-022) and E10 attach
/// here. An observer sees the full entity, including staff-only provenance, and must never forward it to a
/// participant surface (XC-002). An observer failure is logged, never rolled back into the publish.
/// </summary>
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
