namespace Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// PC-3 / PC-4, the Resources shelf seam (implemented by exercise-portal story 04): the participant reads behind
/// <c>GET /api/portal/resources[/{id}]</c> and the staff authoring behind <c>/api/portal/resources*</c>.
/// </summary>
/// <remarks>
/// <para>
/// The exercise scope is the ambient, server-resolved one (<c>IExerciseContext</c>); no member takes an exercise
/// id. A hidden, soft-deleted, unknown or other-exercise id is the same not-found (<c>null</c> /
/// <see cref="PortalWriteOutcome.NotFound"/>), so nothing leaks existence. Authorization and the portal channel
/// gate stay with the calling endpoint.
/// </para>
/// <para>
/// <c>bodyHtml</c> is sanitized once at write with the F04 rich-body profile; links must be host-relative
/// (FC-9.3). Deletes are soft (<c>DeletedAt</c>, XC-010): nothing in this feature hard-deletes.
/// </para>
/// </remarks>
public interface IPortalResourceService
{
    /// <summary>The visible, non-deleted resources of this exercise, in <c>SortOrder</c> (participant projection).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The participant rows; empty when none.</returns>
    Task<IReadOnlyList<PortalResourceDto>> ListVisibleAsync(CancellationToken cancellationToken = default);

    /// <summary>One visible, non-deleted resource of this exercise (participant projection).</summary>
    /// <param name="id">The resource id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resource, or null for a hidden, deleted, unknown or other-exercise id.</returns>
    Task<PortalResourceDto?> GetVisibleAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Every non-deleted resource of this exercise, hidden ones included, in <c>SortOrder</c> (staff view).</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The staff rows.</returns>
    Task<IReadOnlyList<PortalResourceStaffDto>> ListStaffAsync(CancellationToken cancellationToken = default);

    /// <summary>One non-deleted resource of this exercise (staff view).</summary>
    /// <param name="id">The resource id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resource, or null for a deleted, unknown or other-exercise id.</returns>
    Task<PortalResourceStaffDto?> GetStaffAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates a resource at the end of the shelf. Refused (<see cref="PortalWriteOutcome.Invalid"/>) beyond
    /// <see cref="PortalVocabulary.MaxResources"/>, over a title/summary limit, or for an unusable media asset.
    /// </summary>
    /// <param name="request">The fields; <c>version</c> is ignored.</param>
    /// <param name="caller">The authenticated staff caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the new staff view.</returns>
    Task<PortalWriteResult<PortalResourceStaffDto>> CreateAsync(
        PortalResourceWriteRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Updates a resource in place.</summary>
    /// <param name="id">The resource id.</param>
    /// <param name="request">The new fields; a stale <c>version</c> is <see cref="PortalWriteOutcome.Conflict"/>.</param>
    /// <param name="caller">The authenticated staff caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the updated staff view.</returns>
    Task<PortalWriteResult<PortalResourceStaffDto>> UpdateAsync(
        Guid id, PortalResourceWriteRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default);

    /// <summary>
    /// Reorders the shelf. <see cref="PortalResourceReorderRequest.OrderedIds"/> must name every non-deleted resource
    /// exactly once; anything else is <see cref="PortalWriteOutcome.Invalid"/>.
    /// </summary>
    /// <param name="request">The new order.</param>
    /// <param name="caller">The authenticated staff caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome and, on success, the staff list in the new order.</returns>
    Task<PortalWriteResult<IReadOnlyList<PortalResourceStaffDto>>> ReorderAsync(
        PortalResourceReorderRequest request, PortalStaffCaller caller, CancellationToken cancellationToken = default);

    /// <summary>Soft-deletes a resource (XC-010): the row is retained for the AAR export and leaves every list.</summary>
    /// <param name="id">The resource id.</param>
    /// <param name="caller">The authenticated staff caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><see cref="PortalWriteOutcome.Ok"/> or <see cref="PortalWriteOutcome.NotFound"/>; no value.</returns>
    Task<PortalWriteResult<PortalResourceStaffDto>> DeleteAsync(
        Guid id, PortalStaffCaller caller, CancellationToken cancellationToken = default);
}
