namespace Pulse.WebApi.Features.Ops.Organizations;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// #602 L-5: the ONE place a new organization's slug is chosen, shared by <c>BootstrapService</c> (a re-created default
/// organization) and <see cref="OpsOrganizationService"/> (<c>POST /api/ops/organizations</c>, #575b):
/// <see cref="OrganizationSlug.FromName"/>, then <c>-2</c>, <c>-3</c>… exactly as the <c>AdminIdentityFoundation</c>
/// backfill suffixes (<see cref="OrganizationSlug.WithCollisionSuffix"/>), so a new tenant never trips the unique slug
/// index on a name that is already taken.
/// </summary>
/// <remarks>
/// A probe, not a reservation: two concurrent creations of the same name can both pick the same free slug, and the
/// loser's insert then fails on the unique index (<c>IX_Organizations_Slug</c>). Callers run it inside their own
/// transaction and treat that unique violation as a retryable conflict.
/// </remarks>
public static class OrganizationSlugAllocator
{
    /// <summary>The most collision suffixes probed before failing loudly (#660 review S-3).</summary>
    public const int MaxCollisionOrdinal = 1000;

    /// <summary>A slug for a new organization named <paramref name="name"/> that no existing organization holds.</summary>
    /// <param name="dbContext">The caller's unit of work.</param>
    /// <param name="name">The new organization's display name.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The first free slug.</returns>
    /// <exception cref="InvalidOperationException">No free slug within <see cref="MaxCollisionOrdinal"/> suffixes.</exception>
    public static async Task<string> UniqueAsync(PulseDbContext dbContext, string name, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(name);

        var baseSlug = OrganizationSlug.FromName(name);
        var slug = baseSlug;
        for (var ordinal = 2; await IsTakenAsync(dbContext, slug, cancellationToken); ordinal++)
        {
            // Bounded (#660 review S-3): a pathological table fails loudly instead of probing forever.
            if (ordinal > MaxCollisionOrdinal)
            {
                throw new InvalidOperationException(
                    $"No free organization slug for '{baseSlug}' within {MaxCollisionOrdinal} collision suffixes.");
            }

            slug = OrganizationSlug.WithCollisionSuffix(baseSlug, ordinal);
        }

        return slug;
    }

    private static Task<bool> IsTakenAsync(PulseDbContext dbContext, string slug, CancellationToken cancellationToken) =>
        // org-scope-exempt(TenantRoot): an existence probe of the TENANT ROOT table by its unique slug, to keep a new
        // tenant's slug unique — there is no outer scope to bound it by, and it returns no row, only whether one exists.
        dbContext.Organizations
            .AsNoTracking()
            .AnyAsync(o => o.Slug == slug, cancellationToken);
}
