namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Enrollments;

using Pulse.WebApi.Tests.Data;

/// <summary>
/// identity-auth-roles/16 (#572) — the enrollment administration seam over real SQL: the lead controller (one statement,
/// no revocation, bare 404 cross-exercise / cross-org, 409 not-a-controller), one role per exercise (409
/// conflicting-enrollment), the grant-revoke rule (role change / removal revokes that exercise's sessions and cuts their
/// hub connections), and the lead-release policy (Tom, Option A: clears the lead and turns swamped mode off, audited).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EnrollmentServiceTests
{
    private readonly EnrollmentTestKit _kit;

    public EnrollmentServiceTests(MsSqlContainerFixture fixture) => _kit = new EnrollmentTestKit(fixture);

    [RequiresDockerFact]
    public async Task SetLead_ByThePlanner_MovesTheLeadInOneStep_RevokesNoSession_AndRecordsTelemetryAndAudit()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (oldLead, oldLeadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (newLead, newLeadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (oldLeadSession, _) = await _kit.SeedStaffSessionAsync(oldLead, exercise, "controller");
        var (newLeadSession, _) = await _kit.SeedStaffSessionAsync(newLead, exercise, "controller");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            var result = await service.SetLeadAsync(newLeadEnrollment);
            result.Outcome.Should().Be(EnrollmentOutcome.Ok);
            result.Enrollment!.IsLead.Should().BeTrue();
        }

        await using var read = _kit.ReadContext();
        var leads = await read.Enrollments.IgnoreQueryFilters().Where(e => e.ExerciseId == exercise && e.IsLead).ToListAsync();
        leads.Should().ContainSingle("an exercise has at most one lead").Which.Id.Should().Be(newLeadEnrollment);
        (await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == oldLeadEnrollment)).IsLead.Should().BeFalse(
            "the previous lead is cleared by the same statement");

        var sessions = await read.Sessions.Where(s => s.Id == oldLeadSession || s.Id == newLeadSession).ToListAsync();
        sessions.Should().OnlyContain(s => s.RevokedAt == null, "a lead change is not a grant change — isLead is read live");

        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.LeadChangedEventType))
            .Should().Be(1, "exactly one XC-004 event in the same unit of work");
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters()
            .SingleAsync(a => a.OrganizationId == org && a.Kind == EnrollmentService.LeadSetAuditKind);
        audit.ActorPersonId.Should().Be(planner);
        audit.SubjectPersonId.Should().Be(newLead);
        audit.ExerciseId.Should().Be(exercise);
        audit.Payload.Should().Contain(oldLeadEnrollment.ToString());
    }

    [RequiresDockerFact]
    public async Task SetLead_OnANonController_Is409NotAController()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, evaluatorEnrollment) = await _kit.SeedStaffAsync(org, exercise, "evaluator");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            var result = await service.SetLeadAsync(evaluatorEnrollment);
            result.Outcome.Should().Be(EnrollmentOutcome.Conflict);
            result.Error.Should().Be(EnrollmentService.NotAControllerError);
        }
    }

    [RequiresDockerFact]
    public async Task SetLead_OnAnotherExercisesEnrollment_IsTheBare404_EvenInTheSameOrganization()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exerciseA = await _kit.SeedExerciseAsync(org);
        var exerciseB = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exerciseA, "planner");
        var (_, controllerInB) = await _kit.SeedStaffAsync(org, exerciseB, "controller");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exerciseA, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exerciseA);
        await using (context)
        {
            (await service.SetLeadAsync(controllerInB)).Outcome.Should().Be(
                EnrollmentOutcome.NotFound, "a planner on A cannot reach B's enrollment — the same bare 404 as a missing id");
            (await service.SetLeadAsync(Guid.NewGuid())).Outcome.Should().Be(EnrollmentOutcome.NotFound);
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == controllerInB)).IsLead.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task SetLead_OnAnotherOrganizationsEnrollment_IsTheBare404()
    {
        var org = await _kit.SeedOrganizationAsync();
        var otherOrg = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var foreignExercise = await _kit.SeedExerciseAsync(otherOrg);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, foreignController) = await _kit.SeedStaffAsync(otherOrg, foreignExercise, "controller");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.SetLeadAsync(foreignController)).Outcome.Should().Be(EnrollmentOutcome.NotFound);
        }
    }

    [RequiresDockerFact]
    public async Task SetLead_IsPlannerOnly_ControllersAndOrgScopeAdminsAre403_NoSessionIs401()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (controller, controllerEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        var (controllerSession, _) = await _kit.SeedStaffSessionAsync(controller, exercise, "controller");
        var (adminSession, _) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        var (asController, c1) = _kit.ServiceFor(controllerSession, controller, org, exercise);
        await using (c1)
        {
            (await asController.SetLeadAsync(controllerEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Forbidden);
        }

        var (asAdmin, c2) = _kit.ServiceFor(adminSession, admin, org, exerciseScope: null);
        await using (c2)
        {
            (await asAdmin.SetLeadAsync(controllerEnrollment)).Outcome.Should().Be(
                EnrollmentOutcome.Forbidden, "org admins act through their own enrollment — there is no org-scope twin");
        }

        var (anonymous, c3) = _kit.ServiceFor(callerSessionId: null, Guid.NewGuid(), org, exercise);
        await using (c3)
        {
            (await anonymous.SetLeadAsync(controllerEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Unauthenticated);
        }
    }

    [RequiresDockerFact]
    public async Task Grant_ASecondEnrollmentForTheSamePersonAndExercise_Is409ConflictingEnrollment()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (person, _) = await _kit.SeedStaffAsync(org, exercise, "evaluator");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            var result = await service.GrantAsync(exercise, person, "controller");
            result.Outcome.Should().Be(EnrollmentOutcome.Conflict);
            result.Error.Should().Be(EnrollmentService.ConflictingEnrollmentError, "one person, one role per exercise (any role)");
        }
    }

    [RequiresDockerFact]
    public async Task Grant_ToANewPerson_EnrollsThem_CreatesTheStaffFacet_AndAuditsASelfGrantDistinctly()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var personOnly = Guid.NewGuid();
        await using (var seed = _kit.ReadContext())
        {
            seed.People.Add(new Pulse.WebApi.Data.Entities.Person
            {
                Id = personOnly, OrganizationId = org, DisplayName = "New Evaluator", CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.GrantAsync(exercise, personOnly, "Evaluator")).Outcome.Should().Be(EnrollmentOutcome.Ok);
            (await service.GrantAsync(exercise, Guid.NewGuid(), "evaluator")).Outcome.Should().Be(
                EnrollmentOutcome.NotFound, "an unknown person is the bare 404");
            (await service.GrantAsync(exercise, personOnly, "participant")).Outcome.Should().Be(
                EnrollmentOutcome.Invalid, "participant enrollments are created with their account, never here");
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.PersonId == personOnly)).Role.Should().Be("evaluator");
        (await read.StaffUsers.AnyAsync(u => u.Id == personOnly)).Should().BeTrue("the staff facet exists once a staff grant does");
        (await read.OrgAuditEvents.IgnoreQueryFilters().SingleAsync(a => a.SubjectPersonId == personOnly)).Kind
            .Should().Be(EnrollmentService.GrantedAuditKind);
    }

    [RequiresDockerFact]
    public async Task ChangeRole_RevokesThatPersonsSessionsOnThatExercise_AccessAndRefresh_AndCutsTheirHubConnections()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var otherExercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (person, enrollment) = await _kit.SeedStaffAsync(org, exercise, "controller");
        await _kit.SeedEnrollmentAsync(otherExercise, person, "controller");
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (onThisExercise, _) = await _kit.SeedStaffSessionAsync(person, exercise, "controller");
        var (onOtherExercise, _) = await _kit.SeedStaffSessionAsync(person, otherExercise, "controller");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.ChangeRoleAsync(enrollment, "evaluator")).Outcome.Should().Be(EnrollmentOutcome.Ok);
        }

        await using var read = _kit.ReadContext();
        var revoked = await read.Sessions.SingleAsync(s => s.Id == onThisExercise);
        revoked.RevokedAt.Should().NotBeNull("a session minted from the changed grant is revoked in the same transaction");
        (await read.Sessions.SingleAsync(s => s.Id == onOtherExercise)).RevokedAt.Should().BeNull(
            "only sessions on THAT exercise were minted from the changed grant");
        (await read.Sessions.SingleAsync(s => s.Id == plannerSession)).RevokedAt.Should().BeNull();
        _kit.Revoker.Revoked.Should().Equal([onThisExercise], "the revoked session's live hub connections are cut too");
    }

    [RequiresDockerFact]
    public async Task Revoke_OfTheLead_IsAllowed_ClearsTheLead_TurnsSwampedModeOff_AndAuditsBoth()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (lead, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var (leadSession, _) = await _kit.SeedStaffSessionAsync(lead, exercise, "controller");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.RevokeAsync(leadEnrollment)).Outcome.Should().Be(EnrollmentOutcome.Ok, "Option A: allowed, not 409");
        }

        await using var read = _kit.ReadContext();
        // identity-auth-roles/21: the revoke is a SOFT delete (XC-010) — the row survives as history, released and revoked.
        (await read.Enrollments.IgnoreQueryFilters().Active().AnyAsync(e => e.Id == leadEnrollment)).Should().BeFalse();
        var revokedRow = await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == leadEnrollment);
        revokedRow.DeletedAt.Should().NotBeNull("the revoke stamps DeletedAt instead of removing the row");
        revokedRow.IsLead.Should().BeFalse("the lead is released before the row is revoked");
        (await read.Enrollments.IgnoreQueryFilters().AnyAsync(e => e.ExerciseId == exercise && e.IsLead)).Should().BeFalse(
            "the exercise has no lead until a planner sets one");
        _kit.Swamped.Calls.Should().ContainSingle().Which.ExerciseId.Should().Be(exercise);
        (await read.Sessions.SingleAsync(s => s.Id == leadSession)).RevokedAt.Should().NotBeNull();

        var kinds = await read.OrgAuditEvents.IgnoreQueryFilters()
            .Where(a => a.ExerciseId == exercise)
            .Select(a => a.Kind)
            .ToListAsync();
        kinds.Should().Contain([
            EnrollmentService.LeadReleasedAuditKind,
            EnrollmentService.SwampedModeOffAuditKind,
            EnrollmentService.RevokedAuditKind,
        ]);
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.SwampedModeOffEventType))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task ChangeRole_OfTheLeadAwayFromController_IsAllowed_ClearsTheLead_AndTurnsSwampedModeOff()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise);
        await using (context)
        {
            (await service.ChangeRoleAsync(leadEnrollment, "evaluator")).Outcome.Should().Be(
                EnrollmentOutcome.Ok, "never a 500 on the IsLead check constraint");
        }

        await using var read = _kit.ReadContext();
        var changed = await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == leadEnrollment);
        changed.Role.Should().Be("evaluator");
        changed.IsLead.Should().BeFalse();
        _kit.Swamped.Calls.Should().ContainSingle().Which.ExerciseId.Should().Be(exercise, "a committed demotion of the lead turns swamped mode off");
        (await read.OrgAuditEvents.IgnoreQueryFilters()
                .CountAsync(a => a.ExerciseId == exercise && a.Kind == EnrollmentService.LeadReleasedAuditKind))
            .Should().Be(1);
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.SwampedModeOffEventType))
            .Should().Be(1, "the flip is recorded once, after it happened");
    }

    [RequiresDockerFact]
    public async Task Revoke_OfTheLead_WhenTheSaveFails_DoesNotTurnSwampedModeOff()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise, interceptor: new FailingSaveInterceptor());
        await using (context)
        {
            var act = () => service.RevokeAsync(leadEnrollment);
            await act.Should().ThrowAsync<DbUpdateException>();
        }

        _kit.Swamped.Calls.Should().BeEmpty("swamped mode is turned off only after the enrollment change commits (M-002)");
        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == leadEnrollment)).IsLead.Should().BeTrue(
            "the failed change left the lead in place");
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(t => t.ExerciseId == exercise && t.EventType == EnrollmentService.SwampedModeOffEventType))
            .Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ChangeRole_OfTheLead_WhenTheSwampedFlipThrows_StillSucceeds_AndRecordsNoFlip()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (planner, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, leadEnrollment) = await _kit.SeedStaffAsync(org, exercise, "controller", isLead: true);
        var (plannerSession, _) = await _kit.SeedStaffSessionAsync(planner, exercise, "planner");
        var throwing = new ThrowingSwampedModeSwitch();

        var (service, context) = _kit.ServiceFor(plannerSession, planner, org, exercise, swamped: throwing);
        await using (context)
        {
            (await service.ChangeRoleAsync(leadEnrollment, "evaluator")).Outcome.Should().Be(
                EnrollmentOutcome.Ok, "the grant change has committed; a failed in-memory flip never fails it");
        }

        throwing.Attempts.Should().Be(1);
        await using var read = _kit.ReadContext();
        var changed = await read.Enrollments.IgnoreQueryFilters().SingleAsync(e => e.Id == leadEnrollment);
        changed.Role.Should().Be("evaluator");
        changed.IsLead.Should().BeFalse();
        (await read.OrgAuditEvents.IgnoreQueryFilters()
                .CountAsync(a => a.ExerciseId == exercise && a.Kind == EnrollmentService.LeadReleasedAuditKind))
            .Should().Be(1, "the lead release is part of the committed enrollment change");
        (await read.OrgAuditEvents.IgnoreQueryFilters()
                .CountAsync(a => a.ExerciseId == exercise && a.Kind == EnrollmentService.SwampedModeOffAuditKind))
            .Should().Be(0, "no record claims a flip that did not happen");
    }

    [Fact]
    public void Rehydrate_AnExerciseWithNoLead_ComesBackWithSwampedModeOff()
    {
        // Swamped mode is in-memory only: neither ExerciseRuntimeStateRehydrator nor any store persists it, so after a
        // restart every exercise's autonomy state is created fresh — swamped OFF by construction, lead or no lead.
        var registry = new EngineAutonomyRegistry();
        var exercise = Guid.NewGuid();

        registry.GetOrCreate(exercise).SwampedModeEnabled.Should().BeFalse(
            "a rehydrated exercise (with no lead) never comes back in swamped mode");
    }
}
