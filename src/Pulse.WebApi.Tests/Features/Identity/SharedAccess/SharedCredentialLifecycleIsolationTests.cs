namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story 07 (COR-001 / COR-016 / XC-001, TIER-2) — the always-Critical cross-exercise proof for the
/// shared-credential lifecycle, extending the standing isolation suite (exercise-isolation/07) against REAL SQL
/// Server (Testcontainers). Proves that rotate / revoke / lockout / grace act ONLY on the caller's active
/// exercise: a revoke on exercise A leaves B's credential and read-only sessions untouched; a rotate on A never
/// mutates B's credential; brute-force lockout is per-exercise (locking A does not lock B); and a rotation grace
/// window on A never lets A's previous password authenticate on B.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SharedCredentialLifecycleIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public SharedCredentialLifecycleIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private SharedCredentialLifecycleService NewLifecycleService(PulseDbContext context, IExerciseContext scope, Guid sessionId, Guid staffUserId) =>
        new(context, scope, new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId }), _hasher);

    private async Task<Guid> SeedExerciseAsync()
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            Name = $"Exercise {Guid.NewGuid():N}",
            TimeZone = "UTC",
            Status = "active",
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise.Id;
    }

    private async Task SeedCredentialAsync(
        Guid exerciseId,
        string currentPassword,
        string? previousPassword = null,
        DateTimeOffset? graceExpiresAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.SharedCredentials.Add(new SharedCredential
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            CurrentHash = _hasher.Hash(currentPassword),
            PreviousHash = previousPassword is null ? null : _hasher.Hash(previousPassword),
            PreviousHashGraceExpiresAt = graceExpiresAt,
            IsEnabled = true,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<(Guid SessionId, Guid StaffUserId)> SeedStaffSessionAsync(Guid exerciseId)
    {
        var sessionId = Guid.NewGuid();
        var staffUserId = Guid.NewGuid();

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = sessionId,
            TokenHash = Guid.NewGuid().ToString("N"),
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = staffUserId.ToString(),
            StaffUserId = staffUserId,
            Role = "controller",
            ActingHumanId = staffUserId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();
        return (sessionId, staffUserId);
    }

    private async Task<Guid> SeedReadOnlySessionAsync(Guid exerciseId)
    {
        var id = Guid.NewGuid();
        var ephemeral = Guid.NewGuid().ToString();

        await using var seed = _fixture.CreateContext();
        seed.Sessions.Add(new Session
        {
            Id = id,
            TokenHash = Guid.NewGuid().ToString("N"),
            Kind = "readonly",
            ExerciseId = exerciseId,
            PrincipalId = ephemeral,
            Role = "participant",
            ActingHumanId = ephemeral,
            IsReadOnly = true,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<SharedReadOnlyLoginOutcome> LoginOnceAsync(Guid exerciseId, string password)
    {
        var scope = ScopeFor(exerciseId);
        await using var context = _fixture.CreateContext(scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, new RecordingSessionIssuer());
        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = password });
        return result.Outcome;
    }

    private async Task<SharedCredential> ReadCredentialAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.SharedCredentials.IgnoreQueryFilters().SingleAsync(c => c.ExerciseId == exerciseId);
    }

    [RequiresDockerFact]
    public async Task Revoke_OnExerciseA_LeavesExerciseBCredentialAndReadOnlySessionsUntouched()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseA, "password-A");
        await SeedCredentialAsync(exerciseB, "password-B");
        var (sessionA, staffA) = await SeedStaffSessionAsync(exerciseA);
        var readOnlyA = await SeedReadOnlySessionAsync(exerciseA);
        var readOnlyB = await SeedReadOnlySessionAsync(exerciseB);

        var scope = ScopeFor(exerciseA);
        await using (var context = _fixture.CreateContext(scope))
        {
            var result = await NewLifecycleService(context, scope, sessionA, staffA).RevokeAsync();
            result.Outcome.Should().Be(SharedCredentialRevokeOutcome.Revoked);
            result.TerminatedSessionCount.Should().Be(1, "only exercise A's live read-only session is terminated");
        }

        var credentialB = await ReadCredentialAsync(exerciseB);
        credentialB.RevokedAt.Should().BeNull(
            "a revoke on exercise A must NEVER revoke exercise B's credential (COR-001) — the credential lookup is " +
            "confined to A by the global query filter");
        credentialB.IsEnabled.Should().BeTrue("exercise B's shared access is unaffected by A's revoke");

        await using var read = _fixture.CreateContext();
        (await read.Sessions.SingleAsync(s => s.Id == readOnlyA)).RevokedAt.Should().NotBeNull("A's read-only session is terminated");
        (await read.Sessions.SingleAsync(s => s.Id == readOnlyB)).RevokedAt.Should()
            .BeNull("exercise B's read-only session must never be terminated by a revoke on exercise A (COR-001)");
    }

    [RequiresDockerFact]
    public async Task Rotate_OnExerciseA_DoesNotMutateExerciseBCredential()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseA, "password-A");
        await SeedCredentialAsync(exerciseB, "password-B");
        var (sessionA, staffA) = await SeedStaffSessionAsync(exerciseA);

        var scope = ScopeFor(exerciseA);
        await using (var context = _fixture.CreateContext(scope))
        {
            var result = await NewLifecycleService(context, scope, sessionA, staffA).RotateAsync();
            result.Outcome.Should().Be(SharedCredentialRotateOutcome.Rotated);
        }

        var credentialB = await ReadCredentialAsync(exerciseB);
        _hasher.Verify(credentialB.CurrentHash, "password-B").Should().BeTrue(
            "a rotate on exercise A must never change exercise B's password (COR-001)");
        credentialB.PreviousHash.Should().BeNull("exercise B's credential is not touched by A's rotation");
        credentialB.IsEnabled.Should().BeTrue();
        credentialB.RevokedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Lockout_IsPerExercise_LockingExerciseADoesNotLockExerciseB()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseA, "shared-pw");
        await SeedCredentialAsync(exerciseB, "shared-pw");

        // Trip A's lockout with repeated wrong passwords.
        for (var attempt = 0; attempt < SharedCredentialLifecyclePolicy.MaxFailedAttempts; attempt++)
        {
            await LoginOnceAsync(exerciseA, "wrong-pw");
        }

        (await ReadCredentialAsync(exerciseA)).LockedOutUntil.Should().NotBeNull("exercise A is now locked out");
        (await LoginOnceAsync(exerciseA, "shared-pw")).Should().Be(
            SharedReadOnlyLoginOutcome.Rejected, "A is locked, so even the correct password is rejected");

        // B, whose credential shares the same password value, is entirely unaffected.
        var credentialB = await ReadCredentialAsync(exerciseB);
        credentialB.LockedOutUntil.Should().BeNull("brute-forcing exercise A must never lock exercise B (COR-001)");
        credentialB.FailedAttemptCount.Should().Be(0, "exercise B accrues no failed attempts from A's brute force");
        (await LoginOnceAsync(exerciseB, "shared-pw")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "exercise B's shared login is unaffected by A's lockout");
    }

    [RequiresDockerFact]
    public async Task Grace_IsPerExercise_ExerciseAPreviousPasswordNeverAuthenticatesOnExerciseB()
    {
        var exerciseA = await SeedExerciseAsync();
        var exerciseB = await SeedExerciseAsync();

        // A is mid-rotation: its PREVIOUS password ("old-A") still works during A's grace window.
        await SeedCredentialAsync(exerciseA, currentPassword: "new-A", previousPassword: "old-A", graceExpiresAt: DateTimeOffset.UtcNow.AddMinutes(30));
        await SeedCredentialAsync(exerciseB, currentPassword: "current-B");

        (await LoginOnceAsync(exerciseA, "old-A")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "A's previous password authenticates on A during its grace window");
        (await LoginOnceAsync(exerciseB, "old-A")).Should().Be(
            SharedReadOnlyLoginOutcome.Rejected,
            "A's grace-window previous password must NEVER authenticate on exercise B — grace is per-exercise (COR-001)");
    }
}
