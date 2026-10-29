namespace Pulse.WebApi.Features.Portal.Data;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The portal's reads over F01's <see cref="PortalConfig"/> and <see cref="PortalResource"/> tables (exercise-portal story
/// 01), for the config and resources services (03/04) and the AAR export. Every query goes through the context's
/// central exercise filter, so it sees the current exercise's rows only and none when no exercise is resolved.
/// </summary>
/// <remarks>
/// Nothing here writes, and nothing in the portal hard-deletes (XC-010): a resource is removed with
/// <c>Remove</c> + <c>SaveChanges</c>, which the context turns into a <c>DeletedAt</c> stamp. Never
/// <c>ExecuteDelete</c> or a bare <c>IgnoreQueryFilters()</c> on these sets.
/// </remarks>
public static class PortalDataQueries
{
    /// <summary>
    /// The current exercise's portal config, or <c>null</c> when it has none. Null means "absent": the caller returns the
    /// defaults and does not create a row (a participant read never writes). Read without tracking.
    /// </summary>
    /// <param name="db">The exercise-scoped context.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The row, or <c>null</c> for the defaults.</returns>
    public static Task<PortalConfig?> FindPortalConfigAsync(
        this PulseDbContext db, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        return db.PortalConfigs.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// The current exercise's live resources (deleted ones excluded by the context's filter) in display order:
    /// <see cref="PortalResource.SortOrder"/>, then <see cref="PortalResource.Id"/> so equal sort orders read stably.
    /// Includes hidden resources; a participant read adds <c>Where(r =&gt; r.Visible)</c>.
    /// </summary>
    /// <param name="db">The exercise-scoped context.</param>
    /// <returns>The ordered query.</returns>
    public static IQueryable<PortalResource> LivePortalResources(this PulseDbContext db)
    {
        ArgumentNullException.ThrowIfNull(db);
        return db.PortalResources.OrderBy(r => r.SortOrder).ThenBy(r => r.Id);
    }

    /// <summary>
    /// How many live resources the current exercise has: the count <see cref="PortalLimits.CheckResourceCount"/> takes.
    /// </summary>
    /// <param name="db">The exercise-scoped context.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The count of resources not deleted.</returns>
    public static Task<int> CountLivePortalResourcesAsync(
        this PulseDbContext db, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        return db.PortalResources.CountAsync(cancellationToken);
    }

    /// <summary>
    /// Every resource the current exercise ever had, deleted ones included with their <c>DeletedAt</c>, for the
    /// after-action review (XC-010). Uses <see cref="PulseDbContext.IncludingSoftDeleted{TEntity}"/>, so it stays inside
    /// the exercise scope and returns nothing when no exercise is resolved. Staff-only: never a participant DTO.
    /// </summary>
    /// <param name="db">The exercise-scoped context.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The rows in display order, then by id.</returns>
    public static async Task<IReadOnlyList<PortalResourceAarRow>> ExportPortalResourcesForAarAsync(
        this PulseDbContext db, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        return await db.IncludingSoftDeleted<PortalResource>()
            .AsNoTracking()
            .OrderBy(r => r.SortOrder)
            .ThenBy(r => r.Id)
            .Select(r => new PortalResourceAarRow(
                r.Id, r.Title, r.Summary, r.BodyHtml, r.MediaAssetId, r.SortOrder, r.Visible, r.Version, r.DeletedAt))
            .ToListAsync(cancellationToken);
    }
}

/// <summary>One portal resource in the AAR export, live or deleted (staff-only).</summary>
/// <param name="Id">The resource id.</param>
/// <param name="Title">The title.</param>
/// <param name="Summary">The summary, if any.</param>
/// <param name="BodyHtml">The sanitized body, if any.</param>
/// <param name="MediaAssetId">The image, if any.</param>
/// <param name="SortOrder">The display order.</param>
/// <param name="Visible">Whether participants saw it.</param>
/// <param name="Version">The row version.</param>
/// <param name="DeletedAt">When it was deleted (server wall clock), or <c>null</c> while live.</param>
public sealed record PortalResourceAarRow(
    Guid Id,
    string Title,
    string? Summary,
    string? BodyHtml,
    Guid? MediaAssetId,
    int SortOrder,
    bool Visible,
    int Version,
    DateTimeOffset? DeletedAt);
