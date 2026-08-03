namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story 03 defense-in-depth hardening of <see cref="StaffAssignmentService.SetActiveExerciseAsync"/> (Gate-1
/// Info from story 05, meaningful now that the real <see cref="Features.Identity.Sessions.CurrentStaffSessionAccessor"/>
/// backs the seam): after loading the <c>Session</c> by the accessor-reported id, the service re-asserts that
/// the row actually belongs to the caller AND is a staff-kind session. These prove the fail-closed guard:
/// against REAL SQL Server (Testcontainers), a session whose <c>StaffUserId</c> does not match the caller, or a
/// non-staff session, must NOT be mutated (returns Unauthenticated).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffAssignmentServiceHardeningTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffAssignmentServiceHardeningTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private async Task<Guid> SeedExerciseAsync()
    {
        var id = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = id, Name = $"Ex {id:N}", TimeZone = "UTC", Status = "active" });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task SeedAssignmentAsync(Guid staffUserId, Guid exerciseId)
    {
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(new StaffUser
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = staffUserId,
            ExternalSubject = $"idp|{staffUserId:N}",
            DisplayName = "Staffer",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        seed.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = staffUserId,
            ExerciseId = exerciseId,
            Role = "controller",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<Guid> SeedSessionAsync(Guid sessionId, Guid exerciseId, string kind, Guid? staffUserId)
    {
        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = $"hash_{sessionId:N}",
            Kind = kind,
            ExerciseId = exerciseId,
            PrincipalId = (staffUserId ?? Guid.NewGuid()).ToString(),
            StaffUserId = staffUserId,
            Role = "controller",
            ActingHumanId = "human-1",
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();
        return sessionId;
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_SessionBelongsToDifferentStaffUser_Unauthenticated_NoChange()
    {
        var callerStaffUserId = Guid.NewGuid();
        var otherStaffUserId = Guid.NewGuid();
        var exerciseId = await SeedExerciseAsync();
        await SeedAssignmentAsync(callerStaffUserId, exerciseId);
        // The session id the accessor reports resolves to a row bound to a DIFFERENT staff user.
        var sessionId = await SeedSessionAsync(Guid.NewGuid(), exerciseId, "staff", otherStaffUserId);

        await using var context = _fixture.CreateContext();
        var service = new StaffAssignmentService(
            context,
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = callerStaffUserId }));

        var result = await service.SetActiveExerciseAsync(exerciseId);

        result.Outcome.Should().Be(SetActiveExerciseOutcome.Unauthenticated,
            "the loaded session's StaffUserId does not match the caller — fail closed, never mutate another user's session");

        await using var verify = _fixture.CreateContext();
        (await verify.Sessions.SingleAsync(s => s.Id == sessionId)).ExerciseId.Should().Be(exerciseId,
            "the mismatched session must be left untouched");
    }

    [RequiresDockerFact]
    public async Task SetActiveExercise_NonStaffKindSession_Unauthenticated()
    {
        var callerStaffUserId = Guid.NewGuid();
        var exerciseId = await SeedExerciseAsync();
        await SeedAssignmentAsync(callerStaffUserId, exerciseId);
        // The row matches the caller's StaffUserId but is NOT a staff-kind session.
        var sessionId = await SeedSessionAsync(Guid.NewGuid(), exerciseId, "participant", callerStaffUserId);

        await using var context = _fixture.CreateContext();
        var service = new StaffAssignmentService(
            context,
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = callerStaffUserId }));

        var result = await service.SetActiveExerciseAsync(exerciseId);

        result.Outcome.Should().Be(SetActiveExerciseOutcome.Unauthenticated,
            "a non-staff-kind session must never drive a staff active-exercise switch — fail closed");
    }
}
