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
/// change transaction, and — just before B's last-planner lock runs — planner A demotes or removes B and commits. B's
/// change must then be refused with 403 (B no longer holds the planner grant it was authorized on), and nothing B asked
/// for may land. The interleaving is staged with a command hook, not timing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EnrollmentStaleCallerTests
{
    private readonly EnrollmentTestKit _kit;

    public EnrollmentStaleCallerTests(MsSqlContainerFixture fixture) => _kit = new EnrollmentTestKit(fixture);

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

        // A's change of B lands inside B's transaction, just before B's guard statement (B's first enrollment UPDATE).
        EnrollmentOutcome? competing = null;
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[Enrollments]", StringComparison.Ordinal),
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

        // A's change of B lands inside B's transaction, just before B's caller re-check (B's first enrollment UPDATE).
        EnrollmentOutcome? competing = null;
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[Enrollments]", StringComparison.Ordinal),
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
