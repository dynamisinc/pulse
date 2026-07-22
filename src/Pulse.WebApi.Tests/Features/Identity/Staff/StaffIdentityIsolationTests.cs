namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The standing cross-exercise isolation suite's staff-identity entries (<c>exercise-isolation/07</c>,
/// COR-007), extending it for story <c>identity-auth-roles/05</c> (#62). <see cref="StaffAssignmentServiceTests"/>
/// already proves the base shapes this story's AC calls for — own-only assignment reads spanning exercises
/// (<c>GetAssignments_ReturnsOwnAssignmentsAcrossExercises_WithNamesAndRoles</c>), an assigned-exercise switch
/// succeeding and persisting (<c>SetActiveExercise_AssignedExercise_...</c>), and an unassigned-exercise switch
/// being rejected with no persisted change (<c>SetActiveExercise_UnassignedExercise_Forbidden_NoChange_NoTelemetry</c>)
/// — this file adds only the isolation case the standing suite specifically calls for that is NOT yet covered
/// there: an own-only read that holds even when a SECOND staff user shares the caller's EXACT SAME exercise
/// (a stronger overlap than "a different staff user on a disjoint exercise"), proving the filter is a genuine
/// per-user match, not an accidental per-exercise one.
/// </summary>
/// <remarks>
/// <b>Wave boundary (documented, not tested here).</b> The story's AC also describes "selecting an active
/// exercise re-scopes all subsequent STAFF CONTENT queries" end-to-end. That re-scoping is driven by story
/// 03's Wave-2 session middleware, which reads the persisted <see cref="Session.ExerciseId"/> this wave sets
/// and writes it into <c>ExerciseContext.CurrentExerciseId</c> per request — middleware that does not exist
/// yet. This wave owns and tests only the durable half: the switch validates membership and persists the
/// selection (<see cref="StaffAssignmentServiceTests"/>). The end-to-end "switch re-scopes subsequent content
/// queries" case is a Wave-2 addition to this same standing suite, once story 03's middleware lands.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class StaffIdentityIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffIdentityIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static StaffAssignmentService ServiceFor(PulseDbContext context, Guid staffUserId, Guid sessionId) =>
        new(context, new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId }));

    private async Task<Exercise> SeedExerciseAsync(string name)
    {
        var exercise = new Exercise { Id = Guid.NewGuid(), Name = name, TimeZone = "UTC", Status = "active" };
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    private async Task SeedStaffUserAsync(Guid staffUserId, string subject, string displayName = "Staffer")
    {
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(new StaffUser
        {
            Id = staffUserId,
            ExternalSubject = subject,
            DisplayName = displayName,
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

    [RequiresDockerFact]
    public async Task GetAssignments_OwnOnly_EvenWhenAnotherStaffUserSharesTheExactSameExercise()
    {
        // exercise-isolation/07 (COR-007): the standing suite's realistic-adversary shape for this endpoint —
        // it is not enough that a caller's read excludes a DIFFERENT exercise a second staff user happens to
        // be on (already proven in StaffAssignmentServiceTests); it must exclude a second staff user's OWN
        // assignment row on the SAME shared exercise B, proving the own-only filter keys on StaffUserId, not
        // merely on "assignments in exercises this caller also happens to be in".
        var owner = Guid.NewGuid();
        var otherStaffUser = Guid.NewGuid();
        var exerciseA = await SeedExerciseAsync("Owner-Only Exercise A");
        var exerciseB = await SeedExerciseAsync("Shared Exercise B");
        await SeedStaffUserAsync(owner, $"idp|{owner:N}", "Owner Controller");
        await SeedStaffUserAsync(otherStaffUser, $"idp|{otherStaffUser:N}", "Other Evaluator");

        // The owner is assigned to A and B; the OTHER staff user is ALSO assigned to B (the exact same
        // exercise, not a disjoint one) with a DIFFERENT role — the adversarial overlap case.
        await SeedAssignmentAsync(owner, exerciseA.Id, "controller");
        await SeedAssignmentAsync(owner, exerciseB.Id, "evaluator");
        await SeedAssignmentAsync(otherStaffUser, exerciseB.Id, "planner");

        await using var context = _fixture.CreateContext();
        var service = ServiceFor(context, owner, Guid.NewGuid());

        var assignments = await service.GetAssignmentsAsync();

        assignments.Should().NotBeNull();
        assignments!.Should().HaveCount(2,
            "the owner's read must return exactly their own two assignments (A and B), never the other staff user's row");
        // Guid.Parse(...) rather than a bare string == exerciseX.Id.ToString(): GetAssignmentsAsync's
        // ExerciseId = a.ExerciseId.ToString() runs INSIDE the LINQ-to-Entities query, so SQL Server (not
        // .NET) performs the Guid-to-string conversion server-side — which yields UPPERCASE hex, unlike
        // .NET's lowercase Guid.ToString(). An ordinal string compare would spuriously fail on case alone;
        // parsing back to a Guid compares the actual identity, which is what these assertions mean.
        assignments.Should().Contain(a => Guid.Parse(a.ExerciseId) == exerciseA.Id && a.Role == "controller");
        assignments.Should().Contain(a => Guid.Parse(a.ExerciseId) == exerciseB.Id && a.Role == "evaluator");
        assignments.Should().NotContain(a => a.Role == "planner",
            "the other staff user's assignment on the SAME exercise B must never appear in the owner's own-only read — " +
            "proving the filter keys on StaffUserId, not merely on which exercises the caller happens to share");
    }
}
