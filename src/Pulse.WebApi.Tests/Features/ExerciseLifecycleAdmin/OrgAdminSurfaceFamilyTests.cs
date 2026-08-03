namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// exercise-lifecycle-admin story 03 (COR-076) — the BACKEND half of the OrgAdmin surface family: an
/// authorization branch that recognises <c>orgAdmin</c> distinctly from the three <c>STAFF_ROLES</c>, and the
/// org-scoped staff-assignment read that is the family's Phase-1 content alongside story 02's exercise list.
/// </summary>
/// <remarks>
/// <para>
/// <b>The distinctness is the whole story, so it is asserted from both sides.</b> An <c>orgAdmin</c> session
/// reaches a real, org-scoped surface (not the fail-closed nothing it reached before this feature existed),
/// AND every one of controller / evaluator / planner is refused it. Only asserting the first would be
/// satisfied by folding <c>orgAdmin</c> into the existing staff-session check — which is exactly the gap
/// <c>exercise-configuration/feature.md</c>'s open question (a) records and this story must not repeat.
/// </para>
/// <para>
/// The <c>RoleAwareEntry</c> routing half of story 03 is frontend and is not in this suite's scope.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class OrgAdminSurfaceFamilyTests
{
    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the suite over the shared real-SQL fixture.</summary>
    /// <param name="fixture">The shared migrated database.</param>
    public OrgAdminSurfaceFamilyTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>
    /// AC1 + AC2: an <c>orgAdmin</c> session reaches a real org-scoped surface — the exercise list AND the
    /// staff-assignment view — rather than the nothing it reached before this feature.
    /// </summary>
    [RequiresDockerFact]
    public async Task OrgAdminSession_ReachesBothPhase1Reads_NotAFailClosedNothing()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var exercises = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.ExercisesRoute, UriKind.Relative));
        var assignments = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        exercises.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "AC2: the org-scoped exercise list is the OrgAdmin surface's Phase-1 content");
        assignments.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "AC2: so is the org-scoped view of who holds a StaffAssignment on which of the organization's "
            + "exercises. Before this feature an orgAdmin session had no server-side surface at all — every "
            + "endpoint either ignored role entirely or gated on the three STAFF_ROLES it is deliberately not "
            + "a member of");
    }

    /// <summary>
    /// AC2 + the cross-cutting isolation AC: the staff-assignment view shows only the caller's organization's
    /// assignments — with a positive control, and an unbounded control proving the other customer's assignment
    /// really does exist.
    /// </summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_ShowOnlyTheCallersOrganization_NeverAnotherCustomersRoster()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgStaffAssignmentWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        rows.Should().NotBeNull();
        var listed = rows!;

        // Positive control first — otherwise every exclusion below passes on an empty list.
        listed.Select(row => row.StaffUserId).Should().Contain(
            world.CallerStaffUserId.ToString(),
            "the caller's own organization's roster is what this surface is FOR");

        listed.Select(row => row.StaffUserId).Should().NotContain(
            world.OtherStaffUserId.ToString(),
            "another customer's staff human must never appear — the assignment table is the model's one "
            + "deliberately cross-exercise object and carries no filter of any kind, so an unbounded join here "
            + "would enumerate every customer's roster");
        listed.Select(row => row.ExerciseId).Should().NotContain(
            world.OtherExercise.Id.ToString(), "nor another customer's exercise");

        await using var read = _fixture.CreateContext();
        var otherAssignmentExists = await read.StaffAssignments
            .AsNoTracking()
            .AnyAsync(a => a.StaffUserId == world.OtherStaffUserId);
        otherAssignmentExists.Should().BeTrue(
            "StaffAssignment has no query filter at all, so this unbounded read proves the other customer's "
            + "row exists — which makes its absence from the response the tenant bound closing the door, not "
            + "an empty table");
    }

    /// <summary>
    /// The half-crossing case, which is the one a single-sided bound would miss: an assignment joining OUR
    /// exercise to ANOTHER customer's staff human is invisible from this surface.
    /// </summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_HideAForeignHumanAssignedToOurOwnExercise_BecauseBothJoinsAreBounded()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using (var seed = _fixture.CreateContext())
        {
            // Customer Y's human, assigned to customer X's exercise. The exercise-side bound alone would let
            // this through and disclose a foreign human's identity on our roster.
            seed.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = world.OtherStaffUserId,
                ExerciseId = world.OwnExercise.Id,
                Role = "evaluator",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgStaffAssignmentWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        rows!.Select(row => row.StaffUserId).Should().NotContain(
            world.OtherStaffUserId.ToString(),
            "bounding only the exercise side would render this row — the human's id and display name — to an "
            + "administrator of a different customer. BOTH joins carry InOrganization for exactly this case");

        rows.Should().ContainSingle(
            "the caller's own assignment is still there, so this is a partition and not a blanket denial")
            .Which.StaffUserId.Should().Be(world.CallerStaffUserId.ToString());
    }

    /// <summary>AC5: a Planner is refused the org-admin family read, even though they may list exercises.</summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_AsPlanner_IsRefused_SoOrgAdminIsNotJustABiggerStaffRole()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Planner);
    }

    /// <summary>AC5: a Controller is refused the org-admin family read.</summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_AsController_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Controller);
    }

    /// <summary>AC5: an Evaluator is refused the org-admin family read.</summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_AsEvaluator_IsRefused()
    {
        await AssertRoleIsRefusedAsync(ExerciseAdminRoles.Evaluator);
    }

    /// <summary>The default-deny floor for the org-admin family read.</summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_WithNoSession_IsUnauthorized()
    {
        await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// The role literal is the frozen frontend vocabulary, and it round-trips through the whole stack: an
    /// <c>orgAdmin</c> assignment created by this feature is readable back as <c>orgAdmin</c>, never
    /// normalized to lowercase or coerced onto a staff role.
    /// </summary>
    [RequiresDockerFact]
    public async Task StaffAssignments_RoundTripTheOrgAdminRoleLiteral_Verbatim()
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, ExerciseAdminRoles.OrgAdmin);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var rows = await client.GetFromJsonAsync<List<OrgStaffAssignmentWire>>(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        rows!.Single(row => row.StaffUserId == world.CallerStaffUserId.ToString()).Role.Should().Be(
            "orgAdmin",
            "core/auth/roles.ts spells it camelCase and the column stores the frozen literal verbatim, so a "
            + "lower-cased 'orgadmin' on the wire would fail the client's isExerciseRole guard and drop the "
            + "session straight back to the fail-closed branch this story exists to close");
    }

    /// <summary>Shared arrangement for AC5: a non-org-admin role is refused the family's own read.</summary>
    private async Task AssertRoleIsRefusedAsync(string role)
    {
        var world = await OrgAdminTestWorld.SeedAsync(_fixture, role);

        await using var factory = new OrgAdminProbeFactory(_fixture.ConnectionString!);
        using var client = OrgAdminTestWorld.CreateClient(factory, world.Token);

        var response = await client.GetAsync(
            new Uri(ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Forbidden,
            "AC5: OrgAdmin is its own gated family, not a superset any other staff role can walk into. A 200 "
            + "for {0} means the gate admits 'any staff session' (or the three STAFF_ROLES) rather than "
            + "orgAdmin specifically; a 401 would mean the session was never honored, which would make the "
            + "refusal pass for the wrong reason",
            role);
    }
}
