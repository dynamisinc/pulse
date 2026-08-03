namespace Pulse.WebApi.Data;

/// <summary>
/// Marks an <see cref="IOrganizationOwned"/> entity that the <see cref="PulseDbContext"/> confines with a
/// CENTRAL read-side global query filter on the customer tenant — the second scoping axis
/// (exercise-isolation/11, COR-001 / COR-010). Applied once, by reflection over the model, exactly as the
/// exercise axis is: a newly-added org-scoped entity is covered automatically and no query can forget it.
/// </summary>
/// <remarks>
/// <para>
/// <b>THE MECHANISM DECISION (story 11 leaves the choice to the builder; this is it, and why).</b> Story 11
/// allows "either a second global-filter axis on <c>PulseDbContext</c> or a resolution constraint above the
/// exercise scope". Pulse uses <b>both, on disjoint entity sets</b>, chosen per entity by whether the entity
/// can be filtered at all:
/// <list type="number">
///   <item><description><b>A second central global-filter axis (this marker)</b> for the org-owned SHARED
///   LIBRARY assets — <c>PersonaTemplate</c> today, cast libraries when they land. These are exactly the
///   entities the exercise axis deliberately does NOT cover (XC-005: shared across an org's runs), and
///   therefore exactly where the cross-customer leak story 11 names as "gap 2" actually lives. A filter is
///   both possible and correct here: every read of them happens on a staff/authoring surface, well after a
///   tenant is resolved.</description></item>
///   <item><description><b>A fail-closed resolution constraint</b>
///   (<see cref="OrganizationScope.InOrganization{TEntity}"/>) for <c>Exercise</c> and <c>StaffUser</c>,
///   which carry <see cref="IOrganizationOwned"/> ALONE. A global filter on those two is not merely awkward,
///   it is a <b>deadlock</b>: they are the RESOLUTION ROOTS. <c>HostExerciseResolver</c> maps a bare
///   <c>Host</c> header to an <c>Exercise</c> in order to DISCOVER the scope, and <c>StaffLoginService</c>
///   maps an IdP subject to a <c>StaffUser</c> before any session exists. Filtering the very rows that
///   answer "which tenant is this?" by "which tenant is this?" would, fail-closed, return zero rows for
///   every request and blank the entire platform. (This is the same reason <c>Exercise</c> carries no
///   exercise filter, and why <c>Session</c>/<c>StaffAssignment</c> carry a plain <c>ExerciseId</c>.)</description></item>
/// </list>
/// </para>
/// <para>
/// <b>The org axis is strictly ADDITIVE to the exercise axis — it never replaces or weakens it.</b> The two
/// filters are independent, separately-keyed EF global filters. An entity implementing both markers gets
/// BOTH predicates ANDed (EF Core 10 named query filters), never one instead of the other, and the exercise
/// predicate is untouched by this story. No entity on the exercise axis was moved to the org axis; the
/// always-Critical per-exercise participant guarantee (COR-001 / XC-001) is bit-for-bit what it was.
/// </para>
/// <para>
/// <b>Fail closed on BOTH axes, independently.</b> An unresolved organization collapses to
/// <see cref="System.Guid.Empty"/> — which the write-guard guarantees no org-owned row carries — so an
/// unresolved tenant matches ZERO library rows, never all tenants. Crucially, an unresolved ORGANIZATION can
/// never widen the EXERCISE scope: the axes cover disjoint entity sets, so nothing that is exercise-filtered
/// is affected by the org filter's state at all. Do NOT invert either default to "null sees everything".
/// </para>
/// </remarks>
public interface IOrganizationScoped : IOrganizationOwned
{
}
