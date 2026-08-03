namespace Pulse.WebApi.Data;

/// <summary>
/// Resolves the customer <c>Organization</c> the current unit of work is scoped to — the OUTER tenant tier
/// (COR-010, exercise-isolation/11). The <see cref="PulseDbContext"/> reads this once, at construction, to
/// drive the read-side GLOBAL query filter over every <see cref="IOrganizationScoped"/> entity, so an
/// org-owned shared-library query is confined to a single customer CENTRALLY.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fail-closed contract (mirrors <see cref="IExerciseContext"/> exactly).</b>
/// <see cref="CurrentOrganizationId"/> is nullable on purpose: <c>null</c> means "no organization has been
/// resolved for this scope". The context collapses that to <see cref="System.Guid.Empty"/>, and because the
/// write-time guard forbids persisting any org-owned row with an empty <c>OrganizationId</c>, an unresolved
/// tenant can only ever match ZERO rows — never all customers.
/// </para>
/// <para>
/// <b>It cannot widen the exercise scope.</b> The two axes cover disjoint entity sets (see
/// <see cref="IOrganizationScoped"/>), so whatever this property holds — resolved, unset, or wrong — no
/// <see cref="IExerciseScoped"/> query's result changes by one row. The always-Critical per-exercise
/// guarantee is independent of this seam by construction, not by discipline.
/// </para>
/// </remarks>
public interface IOrganizationContext
{
    /// <summary>
    /// The customer tenant the current scope is bound to, or <c>null</c> when none has been resolved. A
    /// null (or otherwise unset) value fails closed — see the interface remarks.
    /// </summary>
    Guid? CurrentOrganizationId { get; }
}
