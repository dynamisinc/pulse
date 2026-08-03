namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Linq;
using System.Reflection;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Accounts;
using Xunit;

/// <summary>
/// exercise-lifecycle-admin story 03 (COR-076) — the ROLE VOCABULARY half, model-only (plain
/// <see cref="FactAttribute"/>, no database): <c>orgAdmin</c> exists server-side, is its own authorization
/// family, and is not quietly a bigger staff role or a global super-admin.
/// </summary>
public sealed class ExerciseAdminRolesTests
{
    /// <summary>The literal is the frozen frontend vocabulary, camelCase and verbatim.</summary>
    [Fact]
    public void TheOrgAdminLiteral_IsTheFrozenCamelCaseFrontendVocabulary()
    {
        ExerciseAdminRoles.OrgAdmin.Should().Be(
            "orgAdmin",
            "core/auth/roles.ts spells it camelCase, StaffAssignment.Role and Session.Role store the frozen "
            + "literal verbatim, and it flows unmapped onto the frozen Session.role wire field — a coined "
            + "'orgadmin' or 'OrgAdmin' would fail the client's isExerciseRole guard and fail closed to the "
            + "login redirect this story exists to stop");
    }

    /// <summary>AC5 / COR-076: the org-admin family admits exactly one role, and it is not a staff role.</summary>
    [Fact]
    public void TheOrgAdminFamily_AdmitsOrgAdminAlone_AndNoneOfTheThreeStaffRoles()
    {
        ExerciseAdminRoles.IsOrgAdmin(ExerciseAdminRoles.OrgAdmin).Should().BeTrue();

        ExerciseAdminRoles.IsOrgAdmin(ExerciseAdminRoles.Planner).Should().BeFalse(
            "a planner is the closest staff role and the one most likely to be folded in by accident — "
            + "roles.ts keeps orgAdmin out of STAFF_ROLES precisely so 'is this an org-admin' is a direct "
            + "comparison, never an inference");
        ExerciseAdminRoles.IsOrgAdmin(ExerciseAdminRoles.Controller).Should().BeFalse();
        ExerciseAdminRoles.IsOrgAdmin(ExerciseAdminRoles.Evaluator).Should().BeFalse();
        ExerciseAdminRoles.IsOrgAdmin("participant").Should().BeFalse();
        ExerciseAdminRoles.IsOrgAdmin(null).Should().BeFalse("fail closed on an absent role");
        ExerciseAdminRoles.IsOrgAdmin("").Should().BeFalse();
    }

    /// <summary>COR-074/075: exercise administration is planner OR org-admin — and nothing else.</summary>
    [Fact]
    public void TheExerciseAdministratorSet_IsPlannerAndOrgAdmin_AndNothingElse()
    {
        ExerciseAdminRoles.IsExerciseAdministrator(ExerciseAdminRoles.Planner).Should().BeTrue();
        ExerciseAdminRoles.IsExerciseAdministrator(ExerciseAdminRoles.OrgAdmin).Should().BeTrue();

        ExerciseAdminRoles.IsExerciseAdministrator(ExerciseAdminRoles.Controller).Should().BeFalse(
            "story 01 AC5 and story 02 AC5 both name Controller and Evaluator as refused");
        ExerciseAdminRoles.IsExerciseAdministrator(ExerciseAdminRoles.Evaluator).Should().BeFalse();
        ExerciseAdminRoles.IsExerciseAdministrator("pio").Should().BeFalse();
        ExerciseAdminRoles.IsExerciseAdministrator(null).Should().BeFalse();
    }

    /// <summary>
    /// The two sets deliberately do NOT nest, which is the structural expression of "a third, separate surface
    /// family". If org-admin were merely a superset staff role, the planner asymmetry would vanish.
    /// </summary>
    [Fact]
    public void TheTwoRoleSets_DoNotNest_SoOrgAdminIsASeparateFamilyAndNotABiggerStaffRole()
    {
        ExerciseAdminRoles.ExerciseAdministrators.Should().Contain(ExerciseAdminRoles.Planner);
        ExerciseAdminRoles.OrganizationAdministrators.Should().NotContain(
            ExerciseAdminRoles.Planner,
            "the org-admin family is strictly narrower on one role and that asymmetry IS the separation — "
            + "making the two sets equal, or making one contain the other, would silently delete story 03's "
            + "AC5 while every 'orgAdmin can reach it' test stayed green");
    }

    /// <summary>
    /// The casing forgiveness is one-directional: a hand-seeded row cannot lock a human out over casing, but
    /// nothing in the vocabulary ever EMITS a cased variant.
    /// </summary>
    [Fact]
    public void RoleMatching_IsCaseInsensitive_ButTheCanonicalLiteralStaysCamelCase()
    {
        ExerciseAdminRoles.IsOrgAdmin("ORGADMIN").Should().BeTrue("a hand-seeded row must not lock an admin out");
        ExerciseAdminRoles.IsOrgAdmin("orgadmin").Should().BeTrue();
        ExerciseAdminRoles.IsExerciseAdministrator("Planner").Should().BeTrue();

        ExerciseAdminRoles.OrgAdmin.Should().Be("orgAdmin", "but the canonical value never changes");
    }

    /// <summary>
    /// <b>There is no global super-admin, and this asserts it structurally.</b> Neither set is "all roles",
    /// and neither predicate has an escape hatch that admits an arbitrary role.
    /// </summary>
    [Fact]
    public void NoRoleSet_IsAWildcard_SoNoGlobalSuperAdminExists()
    {
        foreach (var invented in new[] { "superAdmin", "platformAdmin", "root", "admin", "*", "dynamis" })
        {
            ExerciseAdminRoles.IsOrgAdmin(invented).Should().BeFalse(
                "'{0}' must not be an org-admin — Pulse has no cross-customer role and adding one would "
                + "defeat the tenant boundary every read in this feature is bounded by",
                invented);
            ExerciseAdminRoles.IsExerciseAdministrator(invented).Should().BeFalse(
                "'{0}' must not be an exercise administrator either", invented);
        }
    }

    /// <summary>
    /// XC-002 / the two-worlds rule, restated where it is most likely to be broken: <c>orgAdmin</c> is still
    /// refused as a participant <c>Account</c> role. This feature makes the role real on the STAFF tier and
    /// must not have widened the participant one.
    /// </summary>
    [Fact]
    public void OrgAdmin_IsStillRejectedAsAParticipantAccountRole()
    {
        AccountFieldRules.TryNormalizeRole(ExerciseAdminRoles.OrgAdmin, out _, out var error).Should().BeFalse(
            "a participant Account mints a participant-kind session, so it may only ever carry "
            + "participant/pio. Making orgAdmin real server-side must not have turned it into something a "
            + "participant identity can claim");
        error.Should().NotBeNullOrEmpty();
    }

    /// <summary>
    /// <c>orgAdmin</c> must not have been folded into the engine cockpit's controller gate. The cockpit steers
    /// ONE exercise; org-admin operates above it and has no business approving generated content.
    /// </summary>
    [Fact]
    public void OrgAdmin_IsNotTheEngineCockpitControllerRole()
    {
        EngineCockpitControllerRoleFilter.ControllerRole.Should().NotBe(
            ExerciseAdminRoles.OrgAdmin,
            "the two gates answer different questions — 'may this caller steer this exercise's engine' vs "
            + "'may this caller administer this customer' — and conflating them would let an org-admin trip a "
            + "kill switch on a run they hold no assignment on");
    }

    /// <summary>
    /// XC-002: nothing in this slice puts the customer tenant on the wire. The repo-wide guard
    /// (<c>OrganizationIsNotWireVisibleTests</c>) covers every DTO by reflection; this narrows the same
    /// question to the types this feature added, so a failure names the offender directly.
    /// </summary>
    [Fact]
    public void NoDtoInThisSlice_ExposesTheCustomerTenant()
    {
        var sliceDtos = typeof(ExerciseAdminRoles).Assembly
            .GetTypes()
            .Where(type => type.Namespace == typeof(ExerciseAdminRoles).Namespace)
            .Where(type => type is { IsClass: true, IsPublic: true })
            .Where(type => type.Name.EndsWith("Dto", StringComparison.Ordinal)
                || type.Name.EndsWith("Request", StringComparison.Ordinal))
            .ToList();

        sliceDtos.Should().HaveCountGreaterThan(
            3, "the reflection must actually find this slice's wire types, or the guard is vacuous");

        var offenders = sliceDtos
            .SelectMany(dto => dto.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(property => property.Name.Contains("Organization", StringComparison.OrdinalIgnoreCase))
                .Select(property => $"{dto.Name}.{property.Name}"))
            .ToList();

        offenders.Should().BeEmpty(
            "no response may disclose the tenant and no REQUEST may accept one — a client-supplied "
            + "organization id is the cross-customer analogue of the client-supplied exerciseId COR-001 "
            + "forbids. Offending member(s): " + string.Join(", ", offenders));
    }

    /// <summary>
    /// The caller's tenant is a server-side value that must never be serialized, so
    /// <see cref="StaffCaller"/> — which carries it — must not be shaped like a DTO the JSON pipeline would
    /// pick up.
    /// </summary>
    [Fact]
    public void TheStaffCallerType_CarriesTheTenantButIsNotAWireShape()
    {
        typeof(StaffCaller).Name.Should().NotEndWith(
            "Dto", "it holds OrganizationId and must never be mistaken for, or evolved into, a response body");

        typeof(StaffCaller).GetProperty(nameof(StaffCaller.OrganizationId)).Should().NotBeNull(
            "this is the value the whole org bound is built from — an anti-vacuity anchor for the assertion "
            + "above, which would otherwise pass if the property were ever removed");

        typeof(IOrganizationContext).IsAssignableFrom(typeof(StaffCaller)).Should().BeFalse(
            "the caller record is a read-only snapshot, not a second writable tenant seam");
    }
}
