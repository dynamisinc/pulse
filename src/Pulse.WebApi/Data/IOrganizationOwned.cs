namespace Pulse.WebApi.Data;

/// <summary>
/// Marks an entity that belongs to exactly ONE customer <c>Organization</c> — the outer tenant tier
/// (COR-001 / COR-010, exercise-isolation/11). Every implementer exposes a non-nullable
/// <see cref="OrganizationId"/> that the <see cref="PulseDbContext"/> write-guard enforces is never
/// <see cref="System.Guid.Empty"/>, so a row can never end up owned by no customer.
/// </summary>
/// <remarks>
/// <para>
/// <b>This marker is the WRITE half only.</b> It says "this row has a customer owner". The READ half — a
/// central global query filter — comes from the derived <see cref="IOrganizationScoped"/>. The split is
/// deliberate and is the whole design decision of story 11; read
/// <see cref="IOrganizationScoped"/>'s remarks for why two of the three org-owned entities are
/// intentionally NOT filtered.
/// </para>
/// <para>
/// <b>Who implements what (a question of ownership and of resolution ORDER, not convenience):</b>
/// <list type="bullet">
///   <item><description><b>Owned + FILTERED</b> (<see cref="IOrganizationScoped"/>) — <c>PersonaTemplate</c>,
///   and any future cast library. These are the org-owned SHARED LIBRARY assets: deliberately not
///   <see cref="IExerciseScoped"/> (XC-005 — reusable across an org's runs), which is precisely why the
///   exercise filter cannot protect them and the org filter must.</description></item>
///   <item><description><b>Owned, NOT filtered</b> (this marker alone) — <c>Exercise</c> and
///   <c>StaffUser</c>. Both are RESOLUTION ROOTS looked up BEFORE any scope exists (a host header → an
///   exercise; an IdP subject → a staff human), so a global filter on them is a deadlock, not a guard.
///   They are bounded by the explicit, fail-closed resolution constraint
///   <see cref="OrganizationScope.InOrganization{TEntity}"/> instead — the same shape in which
///   <c>StaffAssignment</c>/<c>Session</c> carry a plain <c>ExerciseId</c> on the inner tier.</description></item>
///   <item><description><b>Not owned — aggregate root:</b> <c>Organization</c> IS the tenant scope; its own
///   <c>Id</c> is what everything else points at.</description></item>
///   <item><description><b>Not owned — transitively bounded:</b> every <see cref="IExerciseScoped"/> entity
///   (<c>Post</c>, <c>Persona</c>, <c>Account</c>, <c>TelemetryEvent</c>, …). An exercise belongs to exactly
///   one organization, so a caller confined to exercise E by the always-Critical exercise filter is
///   ALREADY confined to E's organization. Adding a redundant <c>OrganizationId</c> to those rows would buy
///   no isolation and would create a second, de-normalized copy of the truth that could drift out of sync
///   with <c>Exercise.OrganizationId</c> — a strictly worse guarantee than the one derived from it.</description></item>
/// </list>
/// </para>
/// </remarks>
public interface IOrganizationOwned
{
    /// <summary>
    /// The owning customer tenant (COR-010). Non-nullable; the <see cref="PulseDbContext"/> write-guard
    /// rejects <see cref="System.Guid.Empty"/>, which is what lets the empty GUID serve as the fail-closed
    /// "no organization resolved" sentinel that matches zero rows.
    /// </summary>
    Guid OrganizationId { get; }
}
