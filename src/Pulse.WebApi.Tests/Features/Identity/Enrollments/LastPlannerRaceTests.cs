namespace Pulse.WebApi.Tests.Features.Identity.Enrollments;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// Story 20 (#575a) — the last-planner guard under real concurrency. Two planners removing (or demoting) each other at
/// the same moment must never leave the exercise with zero planners: the guard counts under a lock in the same
/// transaction as the write, so the second request waits for the first to commit, sees one planner left, and is refused
/// with 409 <c>last-planner</c>. Contention is forced, not hoped for: a test-side transaction holds the exercise's
/// enrollment rows while both requests start, then releases them so the two race for the guard's lock.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class LastPlannerRaceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly EnrollmentTestKit _kit;

    public LastPlannerRaceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new EnrollmentTestKit(fixture);
    }

    [RequiresDockerTheory]
    [InlineData("revoke-each-other")]
    [InlineData("demote-each-other")]
    [InlineData("both-self-remove")]
    public async Task TwoPlannersRemovingEachOtherConcurrently_LeaveExactlyOnePlanner(string shape)
    {
        for (var round = 0; round < 3; round++)
        {
            var org = await _kit.SeedOrganizationAsync();
            var exercise = await _kit.SeedExerciseAsync(org);
            var (plannerA, enrollmentA) = await _kit.SeedStaffAsync(org, exercise, "planner");
            var (plannerB, enrollmentB) = await _kit.SeedStaffAsync(org, exercise, "planner");
            var (sessionA, _) = await _kit.SeedStaffSessionAsync(plannerA, exercise, "planner");
            var (sessionB, _) = await _kit.SeedStaffSessionAsync(plannerB, exercise, "planner");

            var (serviceA, contextA) = _kit.ServiceFor(sessionA, plannerA, org, exercise);
            var (serviceB, contextB) = _kit.ServiceFor(sessionB, plannerB, org, exercise);
            await using (contextA)
            await using (contextB)
            {
                // Resolve both callers BEFORE the gate closes (each request has authenticated by the time it reaches the guard).
                (await serviceA.ListStaffAsync(exercise)).Outcome.Should().Be(EnrollmentOutcome.Ok);
                (await serviceB.ListStaffAsync(exercise)).Outcome.Should().Be(EnrollmentOutcome.Ok);

                await using var gate = _fixture.CreateContext();
                await using var held = await gate.Database.BeginTransactionAsync();
                await gate.Database.ExecuteSqlInterpolatedAsync(
                    $"UPDATE [Enrollments] SET [Role] = [Role] WHERE [ExerciseId] = {exercise}");

                Task<EnrollmentResult> first, second;
                switch (shape)
                {
                    case "revoke-each-other":
                        first = serviceA.RevokeAsync(enrollmentB);
                        second = serviceB.RevokeAsync(enrollmentA);
                        break;
                    case "demote-each-other":
                        first = serviceA.ChangeRoleAsync(enrollmentB, "controller");
                        second = serviceB.ChangeRoleAsync(enrollmentA, "evaluator");
                        break;
                    default:
                        first = serviceA.RevokeAsync(enrollmentA);
                        second = serviceB.ChangeRoleAsync(enrollmentB, "controller");
                        break;
                }

                // Both are now blocked behind the held rows; release them so they race for the guard's lock.
                await Task.Delay(TimeSpan.FromMilliseconds(400));
                first.IsCompleted.Should().BeFalse("the held rows block the first request");
                second.IsCompleted.Should().BeFalse("the held rows block the second request");
                await held.RollbackAsync();

                var results = await Task.WhenAll(first, second);
                results.Count(r => r.Outcome == EnrollmentOutcome.Ok).Should().Be(1, "{0} round {1}: exactly one change wins", shape, round);
                var refused = results.Single(r => r.Outcome != EnrollmentOutcome.Ok);
                refused.Outcome.Should().Be(EnrollmentOutcome.Conflict, "{0} round {1}", shape, round);
                refused.Error.Should().Be(EnrollmentService.LastPlannerError);
            }

            await using var read = _kit.ReadContext();
            (await read.Enrollments.IgnoreQueryFilters().Active()
                    .CountAsync(e => e.ExerciseId == exercise && e.Role == "planner"))
                .Should().Be(1, "{0} round {1}: the exercise is never left without a planner", shape, round);
            (await read.TelemetryEvents.IgnoreQueryFilters().CountAsync(t => t.ExerciseId == exercise
                    && (t.EventType == EnrollmentService.RevokedEventType || t.EventType == EnrollmentService.RoleChangedEventType)))
                .Should().Be(1, "only the winning change is recorded");
        }
    }
}
