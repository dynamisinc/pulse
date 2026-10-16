namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Collections.Generic;

/// <summary>
/// The SERVER-side half of the <c>ExerciseRole</c> vocabulary that this feature gates on (COR-010 / COR-076) —
/// and the first place <c>orgAdmin</c> exists anywhere in <c>Pulse.WebApi</c>. Until now the role lived only in
/// the frontend's <c>core/auth/roles.ts</c>: nothing server-side minted, stored, validated or recognised it, so
/// the "third, separate surface family" that module has always documented had no counterpart on the API.
/// </summary>
/// <remarks>
/// <para>
/// <b>The literals are the frozen frontend vocabulary, verbatim.</b> <c>StaffAssignment.Role</c> and
/// <c>Session.Role</c> store the role string exactly as <c>core/auth/roles.ts</c> spells it and it flows
/// unmapped onto the frozen <c>Session.role</c> wire field — so the canonical form of the org-admin role is
/// camelCase <c>orgAdmin</c>, never <c>orgadmin</c> or <c>OrgAdmin</c>. Matching is case-INSENSITIVE (a
/// hand-seeded row must not lock a human out over casing) but nothing here ever EMITS a cased variant.
/// </para>
/// <para>
/// <b><c>orgAdmin</c> is not a staff role and is not a superset of one.</b> <c>roles.ts</c> keeps it out of
/// <c>STAFF_ROLES</c> on purpose: controller / evaluator / planner operate INSIDE one exercise, while an
/// org-admin operates ABOVE it (which exercises the customer owns, and who is assigned to them). The two sets
/// below encode exactly that split and deliberately do NOT nest:
/// <list type="bullet">
///   <item><description><see cref="ExerciseAdministrators"/> — <c>planner</c> + <c>orgAdmin</c> +
///   <c>controller</c>: who may CREATE an exercise (COR-074) and LIST the organization's exercises (COR-075).
///   The controller was added by demo-feedback DF-20 (Tom, 2026-10-15): UAT controllers set up and run their
///   own exercises, and a controller who opened <c>/staff/exercises</c> was silently bounced. The evaluator
///   is still refused.</description></item>
///   <item><description><see cref="OrganizationAdministrators"/> — <c>orgAdmin</c> alone: the org-admin
///   surface family's own reads (COR-076). A planner or controller is refused here, which is the whole point
///   of the role being its own family rather than a bigger staff role.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>No global super-admin exists, and none may be added here.</b> Every check below answers "may this role
/// act WITHIN the caller's own organization"; the organization itself always comes from the server-resolved
/// tenant (<c>IOrganizationContext</c>), never from the role. A role that could reach across customers would
/// defeat the tenant boundary these sets are gating for.
/// </para>
/// </remarks>
public static class ExerciseAdminRoles
{
    /// <summary>The organization-administration role (COR-010/COR-076) — its own surface family, neither staff nor participant.</summary>
    public const string OrgAdmin = "orgAdmin";

    /// <summary>The exercise-planner staff role (aka ExerciseAdmin) — may also create/list this organization's exercises.</summary>
    public const string Planner = "planner";

    /// <summary>
    /// The controller staff role — steers ONE exercise, and (DF-20) may also create and list its organization's
    /// exercises. It is never an org administrator: the org-admin family's own reads still refuse it.
    /// </summary>
    public const string Controller = "controller";

    /// <summary>The evaluator staff role — reads everything in ONE exercise, writes nothing (COR-013).</summary>
    public const string Evaluator = "evaluator";

    /// <summary>
    /// The roles permitted to create (COR-074) and list (COR-075) the caller's organization's exercises:
    /// <see cref="Planner"/>, <see cref="OrgAdmin"/> and (DF-20) <see cref="Controller"/>. An evaluator is
    /// refused. Every check stays bounded to the caller's OWN server-resolved tenant.
    /// </summary>
    public static IReadOnlySet<string> ExerciseAdministrators { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Planner, OrgAdmin, Controller };

    /// <summary>
    /// The role permitted to reach the ORG-ADMIN surface family's own reads (COR-076): <see cref="OrgAdmin"/>
    /// alone. Deliberately not a superset of <see cref="ExerciseAdministrators"/> — a planner is refused.
    /// </summary>
    public static IReadOnlySet<string> OrganizationAdministrators { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { OrgAdmin };

    /// <summary>
    /// Whether <paramref name="role"/> is the org-admin role — the direct comparison <c>roles.ts</c>'s module
    /// header asks callers to make, rather than inferring org-admin from "not in either other set".
    /// </summary>
    /// <param name="role">A stored or session role string.</param>
    /// <returns><c>true</c> when the role is <c>orgAdmin</c> (case-insensitively).</returns>
    public static bool IsOrgAdmin(string? role) =>
        role is not null && OrganizationAdministrators.Contains(role);

    /// <summary>
    /// Whether <paramref name="role"/> may administer the organization's exercises (planner, org-admin or
    /// controller). The ONE predicate the endpoint filter and every service re-check share.
    /// </summary>
    /// <param name="role">A stored or session role string.</param>
    /// <returns><c>true</c> when the role is <c>planner</c>, <c>orgAdmin</c> or <c>controller</c> (case-insensitively).</returns>
    public static bool IsExerciseAdministrator(string? role) =>
        role is not null && ExerciseAdministrators.Contains(role);
}
