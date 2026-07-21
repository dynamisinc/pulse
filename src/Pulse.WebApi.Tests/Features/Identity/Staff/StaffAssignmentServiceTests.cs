namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <see cref="StaffAssignmentService"/> (story 05, COR-005 / XC-002 / XC-004) against
/// REAL SQL Server (<see cref="MsSqlContainerFixture"/>). Proves the deliberate cross-exercise assignment read
/// is own-only and staff-only (fail closed), and that an active-exercise switch validates against the caller's
/// assignment set, persists the selection onto the staff <c>Session</c> row, and emits one
/// <c>exercise.switched</c> telemetry event. The current-staff-session seam (story 03, Wave 2) is exercised
/// through <see cref="StubCurrentStaffSessionAccessor"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffAssignmentServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffAssignmentServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static StaffAssignmentService ServiceFor(Pulse.WebApi.Data.PulseDbContext context, Guid? staffUserId, Guid? sessionId)
    {
        var accessor = staffUserId is null || sessionId is null
            ? new StubCurrentStaffSessionAccessor(null)
            : new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId.Value, StaffUserId = staffUserId.Value });
        return new StaffAssignmentService(context, accessor);
    }

    private async Task<Exercise> SeedExerciseAsync(string name)
    {
        var exercise = new Exercise { Id = Guid.NewGuid(), Name = name, TimeZone = "UTC", Status = "active" };
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    private async Task SeedStaffUserAsync(Guid staffUserId, string subject)
    {
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(new StaffUser
        {
            Id = staffUserId,
            ExternalSubject = subject,
            DisplayName = "Staffer",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task SeedAssignmentAsync(Guid staffUserId, Guid exerciseId, string role)
    {
        await using var seed = _fixture.CreateContext();
        seed.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Guid> SeedStaffSessionAsync(Guid staffUserId, Guid exerciseId, string role)
    {
        var sessionId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = $"hash_{sessionId:N}",
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = staffUserId.ToString(),
            StaffUserId = staffUserId,
            Role = role,
            ActingHumanId = staffUserId.ToString(),
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();
        return sessionId;
    }

    [RequiresDockerFact]
    public async Task GetAssignments_ReturnsOwnAssignmentsAcrossExercises_WithNamesAndRoles()
    {
        var staffUserId = Guid.NewGuid();
        var otherStaffUserId = Guid.NewGuid();
        var exerciseA = await SeedExerciseAsync("Atlanta CIE");
        var exerciseB = await SeedExerciseAsync("Boston Full-Scale");
        await SeedStaffUserAsync(staffUserId, $"idp|{staffUserId:N}");
        await SeedStaffUserAsync(otherStaffUserId, $"idp|{otherStaffUserId:N}");
        await SeedAssignmentAsync(staffUserId, exerciseA.Id, "controller");
        await SeedAssignmentAsync(staffUserId, exerciseB.Id, "evaluator");
        // Another staff user assigned to the SAME exercise A — must never appear in this caller's list.
        await SeedAssignmentAsync(otherStaffUserId, exerciseA.Id, "planner");

        await using var context = _fixture.CreateContext();
        var service = ServiceFor(context, staffUserId, Guid.NewGuid());

        var assignments = await service.GetAssignmentsAsync();

        assignments.Should().NotBeNull();
        assignments!.Should().HaveCount(2, "a staff user's assignment read spans every exercise they're assigned to (COR-005)");
        assignments.Should().Contain(a => a.ExerciseId == exerciseA.Id.ToString() && a.ExerciseName == "Atlanta CIE" && a.Role == "controller");
        assignments.Should().Contain(a => a.ExerciseId == exerciseB.Id.ToString() && a.ExerciseName == "Boston Full-Scale" && a.Role == "evaluator");
        assignments.Should().NotContain(a => a.Role == "planner",
            "a staff user's assignment read is own-only — it must never surface another staff user's assignment");
    }

    [RequiresDockerFact]
    public async Task GetAssignments_NoCurrentStaffSession_ReturnsNull_FailClosed()
    {
        await using var context = _fixture.CreateContext();
        var service = ServiceFor(context, staffUserId: null, sessionId: null);

        var assignments = await service.GetAssignmentsAsync();

        assignments.Should().BeNull("with no authenticated staff session the endpoint must fail closed (401), not return data");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_AssignedExercise_UpdatesSessionExerciseAndRole_EmitsSwitchedEvent()
    {
        var staffUserId = Guid.NewGuid();
        var exerciseA = await SeedExerciseAsync("Exercise A");
        var exerciseB = await SeedExerciseAsync("Exercise B");
        await SeedStaffUserAsync(staffUserId, $"idp|{staffUserId:N}");
        await SeedAssignmentAsync(staffUserId, exerciseA.Id, "controller");
        await SeedAssignmentAsync(staffUserId, exerciseB.Id, "evaluator");
        var sessionId = await SeedStaffSessionAsync(staffUserId, exerciseA.Id, "controller");

        await using (var context = _fixture.CreateContext())
        {
            var service = ServiceFor(context, staffUserId, sessionId);
            var result = await service.SetActiveExerciseAsync(exerciseB.Id);

            result.Outcome.Should().Be(SetActiveExerciseOutcome.Ok);
            result.Active!.ExerciseId.Should().Be(exerciseB.Id.ToString());
            result.Active.Role.Should().Be("evaluator", "the active-exercise selection adopts that exercise's per-exercise role");
        }

        // The persisted session moved to exercise B with B's role — the durable staff arm of the scope seam.
        await using var verify = _fixture.CreateContext();
        var session = await verify.Sessions.SingleAsync(s => s.Id == sessionId);
        session.ExerciseId.Should().Be(exerciseB.Id, "the selection is persisted onto the session (Wave-2 middleware applies it to CurrentExerciseId)");
        session.Role.Should().Be("evaluator");

        var switched = await verify.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseB.Id && e.EventType == "exercise.switched")
            .ToListAsync();
        switched.Should().ContainSingle("an exercise switch emits exactly one XC-004 exercise.switched event");
        switched[0].Actor.Kind.Should().Be("system");
        switched[0].Actor.Role.Should().Be("evaluator");
        switched[0].Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        switched[0].Channel.Should().Be("system");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_UnassignedExercise_Forbidden_NoChange_NoTelemetry()
    {
        var staffUserId = Guid.NewGuid();
        var exerciseA = await SeedExerciseAsync("Assigned A");
        var exerciseC = await SeedExerciseAsync("Unassigned C");
        await SeedStaffUserAsync(staffUserId, $"idp|{staffUserId:N}");
        await SeedAssignmentAsync(staffUserId, exerciseA.Id, "controller");
        var sessionId = await SeedStaffSessionAsync(staffUserId, exerciseA.Id, "controller");

        await using (var context = _fixture.CreateContext())
        {
            var service = ServiceFor(context, staffUserId, sessionId);
            var result = await service.SetActiveExerciseAsync(exerciseC.Id);

            result.Outcome.Should().Be(SetActiveExerciseOutcome.NotAssigned,
                "selecting an exercise the caller is not assigned to must be rejected (COR-005, fail closed)");
        }

        await using var verify = _fixture.CreateContext();
        var session = await verify.Sessions.SingleAsync(s => s.Id == sessionId);
        session.ExerciseId.Should().Be(exerciseA.Id, "a rejected switch must not move the session's bound exercise");

        (await verify.TelemetryEvents.IgnoreQueryFilters()
            .CountAsync(e => e.ExerciseId == exerciseC.Id && e.EventType == "exercise.switched"))
            .Should().Be(0, "a rejected switch must not emit an exercise.switched event");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_AssignmentPointingAtMissingExercise_Invalid()
    {
        // R6 mitigation: a dangling assignment (references an exercise id with no Exercise row) must not let a
        // typo'd/dangling id take effect — the service validates the exercise resolves before persisting.
        var staffUserId = Guid.NewGuid();
        var danglingExerciseId = Guid.NewGuid();
        var realExercise = await SeedExerciseAsync("Real");
        await SeedStaffUserAsync(staffUserId, $"idp|{staffUserId:N}");
        await SeedAssignmentAsync(staffUserId, danglingExerciseId, "controller");
        var sessionId = await SeedStaffSessionAsync(staffUserId, realExercise.Id, "controller");

        await using var context = _fixture.CreateContext();
        var service = ServiceFor(context, staffUserId, sessionId);

        var result = await service.SetActiveExerciseAsync(danglingExerciseId);

        result.Outcome.Should().Be(SetActiveExerciseOutcome.Invalid,
            "an assignment referencing a non-existent exercise must not resolve as active (R6 service-layer FK check)");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_NoCurrentStaffSession_Unauthenticated_FailClosed()
    {
        var exercise = await SeedExerciseAsync("Exercise");

        await using var context = _fixture.CreateContext();
        var service = ServiceFor(context, staffUserId: null, sessionId: null);

        var result = await service.SetActiveExerciseAsync(exercise.Id);

        result.Outcome.Should().Be(SetActiveExerciseOutcome.Unauthenticated,
            "with no authenticated staff session an active-exercise switch must fail closed (401)");
    }
}
