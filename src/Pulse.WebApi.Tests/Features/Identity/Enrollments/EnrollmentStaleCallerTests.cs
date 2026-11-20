namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// #840 — a planner whose own authority is withdrawn while their request is in flight. Planner B is authorized, opens the
/// change transaction, and — just before B's first lock runs — planner A demotes or removes B and commits. B's
/// change must then be refused with 403 (B no longer holds the planner grant it was authorized on), and nothing B asked
/// for may land. The interleaving is staged with a command hook, not timing.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class EnrollmentStaleCallerTests
{
    private readonly EnrollmentTestKit _kit;

    public EnrollmentStaleCallerTests(MsSqlRcsiFixture rcsi) => _kit = new EnrollmentTestKit(rcsi?.Sql ?? throw new ArgumentNullException(nameof(rcsi)));

    [RequiresDockerTheory]
    [InlineData("demoted", "revoke")]
    [InlineData("demoted", "change-role")]
    [InlineData("removed", "revoke")]
    [InlineData("removed", "change-role")]
    public async Task APlannerWhoLosesTheGrantMidRequest_Is403_AndTheirChangeDoesNotLand(string loss, string action)
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (plannerA, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (plannerB, enrollmentB) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, enrollmentC) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (sessionA, _) = await _kit.SeedStaffSessionAsync(plannerA, exercise, "planner");
        var (sessionB, _) = await _kit.SeedStaffSessionAsync(plannerB, exercise, "planner");

        // A's change of B lands inside B's transaction, just before B's first lock (its person-row lock; the planner
        // re-check under the enrollment lock follows it).
        EnrollmentOutcome? competing = null;
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
            async () =>
            {
                var (serviceA, contextA) = _kit.ServiceFor(sessionA, plannerA, org, exercise);
                await using (contextA)
                {
                    competing = loss == "demoted"
                        ? (await serviceA.ChangeRoleAsync(enrollmentB, "controller")).Outcome
                        : (await serviceA.RevokeAsync(enrollmentB)).Outcome;
                }
            });

        var (serviceB, contextB) = _kit.ServiceFor(sessionB, plannerB, org, exercise, interceptor: hook);
        await using (contextB)
        {
            // B is authorized as a planner before anything is staged (the request has authenticated by then).
            (await serviceB.ListStaffAsync(exercise)).Outcome.Should().Be(EnrollmentOutcome.Ok);

            var result = action == "revoke"
                ? await serviceB.RevokeAsync(enrollmentC)
                : await serviceB.ChangeRoleAsync(enrollmentC, "evaluator");

            hook.Fired.Should().BeTrue("A's change of B landed inside B's request");
            competing.Should().Be(EnrollmentOutcome.Ok, "A's change of B committed first");
            result.Outcome.Should().Be(
                EnrollmentOutcome.Forbidden, "B was {0} before B's change took its lock, so B no longer holds the planner grant", loss);
        }

        await using var read = _kit.ReadContext();
        var c = await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollmentC);
        c.DeletedAt.Should().BeNull("B's revoke did not land");
        c.Role.Should().Be("controller", "B's role change did not land");
        (await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(t => t.ExerciseId == exercise
                && (t.EventType == EnrollmentService.RevokedEventType || t.EventType == EnrollmentService.RoleChangedEventType)))
            .Should().Be(1, "only A's change of B is recorded; nothing B attempted is");
    }

    [RequiresDockerTheory]
    [InlineData("demoted", "grant")]
    [InlineData("demoted", "set-lead")]
    [InlineData("removed", "grant")]
    [InlineData("removed", "set-lead")]
    public async Task APlannerWhoLosesTheGrantMidRequest_CannotGrantOrSetTheLead(string loss, string action)
    {
        // W-002: the same stale-caller window on the two changes that sweep no session.
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (plannerA, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (plannerB, enrollmentB) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, enrollmentC) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (candidate, _) = await _kit.SeedStaffAsync(org, exerciseId: null);
        var (sessionA, _) = await _kit.SeedStaffSessionAsync(plannerA, exercise, "planner");
        var (sessionB, _) = await _kit.SeedStaffSessionAsync(plannerB, exercise, "planner");

        // A's change of B lands inside B's transaction, just before B's first lock (its person-row lock; the planner
        // re-check under the enrollment lock follows it).
        EnrollmentOutcome? competing = null;
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
            async () =>
            {
                var (serviceA, contextA) = _kit.ServiceFor(sessionA, plannerA, org, exercise);
                await using (contextA)
                {
                    competing = loss == "demoted"
                        ? (await serviceA.ChangeRoleAsync(enrollmentB, "controller")).Outcome
                        : (await serviceA.RevokeAsync(enrollmentB)).Outcome;
                }
            });

        var (serviceB, contextB) = _kit.ServiceFor(sessionB, plannerB, org, exercise, interceptor: hook);
        await using (contextB)
        {
            (await serviceB.ListStaffAsync(exercise)).Outcome.Should().Be(EnrollmentOutcome.Ok);

            var result = action == "grant"
                ? await serviceB.GrantAsync(exercise, candidate, "planner")
                : await serviceB.SetLeadAsync(enrollmentC);

            hook.Fired.Should().BeTrue("A's change of B landed inside B's request");
            competing.Should().Be(EnrollmentOutcome.Ok, "A's change of B committed first");
            result.Outcome.Should().Be(EnrollmentOutcome.Forbidden, "B was {0} before B's {1} took its lock", loss, action);
        }

        await using var read = _kit.ReadContext();
        (await read.Enrollments.IgnoreQueryFilters().Active().AnyAsync(e => e.ExerciseId == exercise && e.PersonId == candidate))
            .Should().BeFalse("B's grant did not land");
        (await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollmentC)).IsLead
            .Should().BeFalse("B's lead change did not land");
        (await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(t => t.ExerciseId == exercise
                && (t.EventType == EnrollmentService.GrantedEventType || t.EventType == EnrollmentService.LeadChangedEventType)))
            .Should().Be(0, "nothing B attempted is recorded as done");
    }

    [RequiresDockerTheory]
    [InlineData("org-admin-demoted", "grant")]
    [InlineData("org-admin-demoted", "change-role")]
    [InlineData("org-admin-demoted", "revoke")]
    [InlineData("org-admin-disabled", "grant")]
    [InlineData("org-admin-disabled", "change-role")]
    [InlineData("org-admin-disabled", "revoke")]
    [InlineData("planner-disabled", "grant")]
    [InlineData("planner-disabled", "set-lead")]
    [InlineData("planner-disabled", "change-role")]
    [InlineData("planner-disabled", "revoke")]
    public async Task ACallerWhosePersonLosesAuthorityMidRequest_Is403_AndNothingLands(string loss, string action)
    {
        // #858 review: an org-scope caller's whole authority is the org-admin grant, and any caller's person must still be
        // enabled. The loss commits inside the caller's transaction, just before its first person-row lock.
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var orgScope = loss.StartsWith("org-admin", StringComparison.Ordinal);
        var (caller, _) = orgScope
            ? await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin")
            : await _kit.SeedStaffAsync(org, exercise, "planner");
        if (orgScope)
        {
            await _kit.SeedStaffAsync(org, exercise, "planner");
        }

        var (_, enrollmentC) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (candidate, _) = await _kit.SeedStaffAsync(org, exerciseId: null);
        var (callerSession, _) = orgScope
            ? await _kit.SeedStaffSessionAsync(caller, exerciseId: null, "orgAdmin")
            : await _kit.SeedStaffSessionAsync(caller, exercise, "planner");

        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
            async () =>
            {
                await using var competing = _kit.ReadContext();
                var person = await competing.People.SingleAsync(p => p.Id == caller);
                if (loss == "org-admin-demoted")
                {
                    person.OrgRole = null;
                }
                else
                {
                    person.DisabledAt = DateTimeOffset.UtcNow;
                }

                await competing.SaveChangesAsync();
            });

        var (service, context) = _kit.ServiceFor(callerSession, caller, org, orgScope ? null : exercise, interceptor: hook);
        await using (context)
        {
            var result = action switch
            {
                "grant" => await service.GrantAsync(exercise, candidate, "controller"),
                "set-lead" => await service.SetLeadAsync(enrollmentC),
                "change-role" => await service.ChangeRoleAsync(enrollmentC, "evaluator"),
                _ => await service.RevokeAsync(enrollmentC),
            };

            hook.Fired.Should().BeTrue("the loss committed inside the caller's request");
            result.Outcome.Should().Be(EnrollmentOutcome.Forbidden, "the caller was {0} before their {1} took its lock", loss, action);
        }

        await using var read = _kit.ReadContext();
        var c = await read.Enrollments.IgnoreQueryFilters().AsNoTracking().SingleAsync(e => e.Id == enrollmentC);
        c.DeletedAt.Should().BeNull();
        c.Role.Should().Be("controller");
        c.IsLead.Should().BeFalse();
        (await read.Enrollments.IgnoreQueryFilters().Active().AnyAsync(e => e.PersonId == candidate)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task APlannerWhoStillHoldsTheGrant_IsNotAffected()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        var (plannerB, _) = await _kit.SeedStaffAsync(org, exercise, "planner");
        var (_, enrollmentC) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (sessionB, _) = await _kit.SeedStaffSessionAsync(plannerB, exercise, "planner");

        var (serviceB, contextB) = _kit.ServiceFor(sessionB, plannerB, org, exercise);
        await using (contextB)
        {
            (await serviceB.RevokeAsync(enrollmentC)).Outcome.Should().Be(EnrollmentOutcome.Ok);
        }
    }

    [RequiresDockerFact]
    public async Task AnOrgScopeAdmin_WithNoEnrollmentOfTheirOwn_IsNotAffected()
    {
        var org = await _kit.SeedOrganizationAsync();
        var exercise = await _kit.SeedExerciseAsync(org);
        await _kit.SeedStaffAsync(org, exercise, "planner");
        var (admin, _) = await _kit.SeedStaffAsync(org, exerciseId: null, orgRole: "orgAdmin");
        var (_, enrollmentC) = await _kit.SeedStaffAsync(org, exercise, "controller");
        var (adminSession, _) = await _kit.SeedStaffSessionAsync(admin, exerciseId: null, "orgAdmin");

        var (service, context) = _kit.ServiceFor(adminSession, admin, org, exerciseScope: null);
        await using (context)
        {
            (await service.ChangeRoleAsync(enrollmentC, "evaluator")).Outcome.Should().Be(
                EnrollmentOutcome.Ok, "an org admin acts on exercises through the org grant, not an enrollment");
        }
    }
}
