namespace Pulse.WebApi.Data;

using System.Linq;

/// <summary>
/// The fail-closed CUSTOMER-tenant <b>resolution constraint</b> — the second half of story 11's scoping
/// mechanism, for the two <see cref="IOrganizationOwned"/> entities a global query filter cannot cover
/// (<c>Exercise</c> and <c>StaffUser</c>; see <see cref="IOrganizationScoped"/> for the full decision and
/// why those two are RESOLUTION ROOTS). Every staff/platform query that lists or resolves them across the
/// tenant MUST pass through <see cref="InOrganization{TEntity}"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail closed, in the query itself.</b> An unresolved tenant (<c>null</c>) — or the
/// <see cref="Guid.Empty"/> sentinel the write-guard guarantees no persisted row carries — yields a
/// predicate that matches ZERO rows, never all of them. The unresolved case is expressed as
/// <c>OrganizationId == Guid.Empty</c> rather than a short-circuiting <c>Where(_ =&gt; false)</c> for the
/// same reason the exercise axis uses that shape: it is one uniform, translatable SQL predicate on every
/// path, so the closed door cannot be optimised away or accidentally diverge between the resolved and
/// unresolved branches.
/// </para>
/// <para>
/// <b>Scope comes ONLY from the server.</b> Pass the tenant resolved from
/// <see cref="IOrganizationContext"/>, from the authenticated staff user's own <c>OrganizationId</c>, or
/// from the server-resolved exercise's <c>OrganizationId</c>. NEVER pass an organization id read out of a
/// request body, route or query string — that is the cross-tenant analogue of the cross-exercise leak
/// COR-001 forbids.
/// </para>
/// <para>
/// <b>This constrains ACCESS, not existence.</b> It does not replace the exercise filter and cannot
/// affect it: <c>Exercise</c> and <c>StaffUser</c> are not <see cref="IExerciseScoped"/>, so no
/// participant-visible content query routes through here at all.
/// </para>
/// </remarks>
public static class OrganizationScope
{
    /// <summary>
    /// Confines a query over an <see cref="IOrganizationOwned"/> entity to one customer tenant, failing
    /// closed (zero rows) when no tenant is resolved.
    /// </summary>
    /// <typeparam name="TEntity">The org-owned entity type being queried.</typeparam>
    /// <param name="source">The query to constrain.</param>
    /// <param name="organizationId">
    /// The SERVER-resolved tenant. <c>null</c> or <see cref="Guid.Empty"/> means "unresolved" and matches
    /// nothing.
    /// </param>
    /// <returns>The constrained query.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="source"/> is <c>null</c>.</exception>
    public static IQueryable<TEntity> InOrganization<TEntity>(this IQueryable<TEntity> source, Guid? organizationId)
        where TEntity : class, IOrganizationOwned
    {
        ArgumentNullException.ThrowIfNull(source);

        // `?? Guid.Empty` is the same fail-closed collapse PulseDbContext's constructor performs for the
        // exercise axis. Guid.Empty is unmatched by construction: GuardOrganizationScope refuses to persist
        // any org-owned row carrying it.
        var tenant = organizationId ?? Guid.Empty;

        return source.Where(entity => entity.OrganizationId == tenant);
    }
}
