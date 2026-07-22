namespace Pulse.WebApi.Features.EngineRuntime.Review;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The persistence seam for engine review items, shared by stories 01 and 02. Story 01 ENQUEUES one review
/// item per decided burst; story 02 READS the queue, looks a draft up, and MUTATES its disposition (approve
/// / veto / hold / publish). It is deliberately minimal PLUMBING — no autonomy logic, no endpoints, no
/// telemetry: those live in the stories. Every read/write goes through <c>PulseDbContext</c>, so the central
/// exercise query filter + write guard confine it to the resolved scope (COR-001).
/// </summary>
public interface IEngineReviewStore
{
    /// <summary>
    /// Persists one review item (story 01, one per burst). The caller stamps <see cref="EngineReviewItemEntity.ExerciseId"/>
    /// from the resolved scope; the write-guard rejects an empty scope (fail closed).
    /// </summary>
    /// <param name="item">The review item to persist.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task EnqueueAsync(EngineReviewItemEntity item, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reads the review queue for the resolved exercise scope (story 02). The central query filter confines
    /// the result to the caller's exercise — an unresolved scope returns zero rows (fail closed).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scoped review items.</returns>
    Task<IReadOnlyList<EngineReviewItemEntity>> GetQueueAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Finds one review item by its draft id within the resolved scope (story 02); returns <c>null</c> when it
    /// does not exist OR belongs to another exercise (the filter fails closed — an IDOR by a foreign draft id
    /// resolves nothing).
    /// </summary>
    /// <param name="draftId">The draft/burst id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The review item, or <c>null</c>.</returns>
    Task<EngineReviewItemEntity?> FindAsync(Guid draftId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Updates one review item's disposition (and, for a Delayed-auto item, its countdown decision) within the
    /// resolved scope (story 02). Returns <c>false</c> when no matching item is visible under the scope.
    /// </summary>
    /// <param name="draftId">The draft/burst id.</param>
    /// <param name="disposition">The new disposition.</param>
    /// <param name="decision">The controller decision to record on the countdown, when applicable; else <c>null</c>.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> if an item was updated; <c>false</c> if none was visible under the scope.</returns>
    Task<bool> UpdateDispositionAsync(
        Guid draftId,
        DraftDisposition disposition,
        ControllerDecision? decision = null,
        CancellationToken cancellationToken = default);
}
