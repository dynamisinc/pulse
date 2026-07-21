namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Collections.Generic;
using System.Linq;
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
/// Story 07 (COR-016 / NFR-009, TIER-2) integration tests for <see cref="SharedCredentialLifecycleService"/>
/// against REAL SQL Server (Testcontainers). Proves the staff-only rotate/revoke controls: rotation sets a fresh
/// server-generated password (returned once, never stored in the clear) and retires the old one into a grace
/// window; revocation is an immediate kill switch that terminates every active read-only session for the
/// exercise; both are staff-authz-gated (fail closed to 401 without a staff session), require a provisioned
/// credential (404 otherwise), emit exactly one XC-004 event carrying the acting staff role + human id, and
/// persist in a single unit of work.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SharedCredentialLifecycleServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public SharedCredentialLifecycleServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private SharedCredentialLifecycleService NewService(PulseDbContext context, IExerciseContext scope, Guid sessionId, Guid staffUserId) =>
        new(context, scope, new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = sessionId, StaffUserId = staffUserId }), _hasher);

    private async Task<Guid> SeedExerciseAsync()
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            Name = $"Exercise {Guid.NewGuid():N}",
            TimeZone = "America/Chicago",
            Status = "active",
            CurrentScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise.Id;
    }

    private async Task SeedCredentialAsync(Guid exerciseId, string? password = "seed-password", bool isEnabled = true, DateTimeOffset? revokedAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.SharedCredentials.Add(new SharedCredential
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            CurrentHash = password is null ? null : _hasher.Hash(password),
            IsEnabled = isEnabled,
            RevokedAt = revokedAt,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }

    private async Task<(Guid SessionId, Guid StaffUserId, string Role)> SeedStaffSessionAsync(Guid exerciseId, string role = "controller")
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
            Role = role,
            ActingHumanId = staffUserId.ToString(),
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        });
        await seed.SaveChangesAsync();
        return (sessionId, staffUserId, role);
    }

    private async Task<Guid> SeedReadOnlySessionAsync(Guid exerciseId, DateTimeOffset? revokedAt = null)
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
            RevokedAt = revokedAt,
        });
        await seed.SaveChangesAsync();
        return id;
    }

    private async Task<SharedCredential> ReadCredentialAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.SharedCredentials.IgnoreQueryFilters().SingleAsync(c => c.ExerciseId == exerciseId);
    }

    private async Task<IReadOnlyList<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, string eventType)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == eventType)
            .ToListAsync();
    }

    [RequiresDockerFact]
    public async Task Rotate_LiveCredential_SetsFreshPassword_RetiresOldIntoGrace_EmitsRotatedTelemetry()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "old-password");
        var (sessionId, staffUserId, role) = await SeedStaffSessionAsync(exerciseId, role: "controller");

        SharedCredentialRotateResult result;
        var scope = ScopeFor(exerciseId);
        await using (var context = _fixture.CreateContext(scope))
        {
            result = await NewService(context, scope, sessionId, staffUserId).RotateAsync();
        }

        result.Outcome.Should().Be(SharedCredentialRotateOutcome.Rotated);
        result.NewPassword.Should().NotBeNullOrEmpty("the fresh password is returned to staff exactly once");
        result.GraceExpiresAt.Should().NotBeNull("rotating a live credential opens a grace window for the old password");

        var credential = await ReadCredentialAsync(exerciseId);
        credential.IsEnabled.Should().BeTrue();
        credential.RevokedAt.Should().BeNull();
        _hasher.Verify(credential.CurrentHash, result.NewPassword!).Should().BeTrue("the new password hashes into CurrentHash");
        _hasher.Verify(credential.PreviousHash, "old-password").Should().BeTrue("the old password is retired into PreviousHash");
        credential.CurrentHash.Should().NotBe(result.NewPassword, "the password is only ever persisted hashed, never in the clear");
        credential.PreviousHashGraceExpiresAt.Should().NotBeNull();
        credential.FailedAttemptCount.Should().Be(0);
        credential.LockedOutUntil.Should().BeNull();

        var events = await ReadEventsAsync(exerciseId, "credential.rotated");
        events.Should().ContainSingle("a rotation emits exactly one XC-004 credential.rotated event");
        var evt = events[0];
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.Role.Should().Be(role, "the rotate event carries the acting staff role");
        evt.Actor.ActingHumanId.Should().Be(staffUserId.ToString(), "the rotate event carries the acting StaffUser id");
        evt.Target!.EntityType.Should().Be("sharedCredential");
        evt.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
    }

    [RequiresDockerFact]
    public async Task Rotate_RevokedCredential_ReenablesWithNewPassword_ButNeverResurrectsKilledSecretIntoGrace()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "killed-password", isEnabled: false, revokedAt: DateTimeOffset.UtcNow.AddMinutes(-5));
        var (sessionId, staffUserId, _) = await SeedStaffSessionAsync(exerciseId);

        SharedCredentialRotateResult result;
        var scope = ScopeFor(exerciseId);
        await using (var context = _fixture.CreateContext(scope))
        {
            result = await NewService(context, scope, sessionId, staffUserId).RotateAsync();
        }

        result.Outcome.Should().Be(SharedCredentialRotateOutcome.Rotated);
        result.GraceExpiresAt.Should().BeNull("a revoked credential's killed password must never be carried into a grace window");

        var credential = await ReadCredentialAsync(exerciseId);
        credential.IsEnabled.Should().BeTrue("rotating re-enables the credential so the new password authenticates");
        credential.RevokedAt.Should().BeNull("rotating clears the revoked flag as the deliberate, logged recovery path");
        credential.PreviousHash.Should().BeNull("the killed password stays dead — not resurrected into grace");
        _hasher.Verify(credential.CurrentHash, result.NewPassword!).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Rotate_NoStaffSession_FailsClosed_Unauthenticated_CredentialUntouched()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "seed-password");

        var scope = ScopeFor(exerciseId);
        await using (var context = _fixture.CreateContext(scope))
        {
            var service = new SharedCredentialLifecycleService(context, scope, new StubCurrentStaffSessionAccessor(null), _hasher);
            var result = await service.RotateAsync();
            result.Outcome.Should().Be(SharedCredentialRotateOutcome.Unauthenticated,
                "rotate is staff-only and fails closed with no authenticated staff session");
        }

        var credential = await ReadCredentialAsync(exerciseId);
        _hasher.Verify(credential.CurrentHash, "seed-password").Should().BeTrue("an unauthenticated rotate changes nothing");
    }

    [RequiresDockerFact]
    public async Task Rotate_NoCredentialProvisioned_NotProvisioned()
    {
        var exerciseId = await SeedExerciseAsync();
        var (sessionId, staffUserId, _) = await SeedStaffSessionAsync(exerciseId);

        var scope = ScopeFor(exerciseId);
        await using var context = _fixture.CreateContext(scope);
        var result = await NewService(context, scope, sessionId, staffUserId).RotateAsync();

        result.Outcome.Should().Be(SharedCredentialRotateOutcome.NotProvisioned,
            "an exercise with no shared credential row has nothing to rotate (404)");
    }

    [RequiresDockerFact]
    public async Task Rotate_PersistsInOneSaveChangesCall()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "old-password");
        var (sessionId, staffUserId, _) = await SeedStaffSessionAsync(exerciseId);

        var interceptor = new CountingSaveChangesInterceptor();
        var scope = ScopeFor(exerciseId);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, scope);
        var result = await NewService(context, scope, sessionId, staffUserId).RotateAsync();

        result.Outcome.Should().Be(SharedCredentialRotateOutcome.Rotated);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the credential mutation and the rotated telemetry event share exactly one unit of work (XC-004)");
    }

    [RequiresDockerFact]
    public async Task Revoke_TerminatesAllActiveReadOnlySessions_MarksRevoked_EmitsRevokedTelemetry()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "seed-password");
        var (sessionId, staffUserId, role) = await SeedStaffSessionAsync(exerciseId);
        var readOnlyA = await SeedReadOnlySessionAsync(exerciseId);
        var readOnlyB = await SeedReadOnlySessionAsync(exerciseId);
        var alreadyRevokedAt = DateTimeOffset.UtcNow.AddMinutes(-10);
        var readOnlyAlreadyRevoked = await SeedReadOnlySessionAsync(exerciseId, revokedAt: alreadyRevokedAt);

        SharedCredentialRevokeResult result;
        var scope = ScopeFor(exerciseId);
        await using (var context = _fixture.CreateContext(scope))
        {
            result = await NewService(context, scope, sessionId, staffUserId).RevokeAsync();
        }

        result.Outcome.Should().Be(SharedCredentialRevokeOutcome.Revoked);
        result.TerminatedSessionCount.Should().Be(2, "only the two LIVE read-only sessions are terminated at once");

        var credential = await ReadCredentialAsync(exerciseId);
        credential.RevokedAt.Should().NotBeNull("the credential is immediately revoked (no grace)");
        credential.IsEnabled.Should().BeFalse();
        credential.PreviousHash.Should().BeNull("revoke clears any in-flight rotation grace");

        await using var read = _fixture.CreateContext();
        (await read.Sessions.SingleAsync(s => s.Id == readOnlyA)).RevokedAt.Should().NotBeNull("a live read-only session is terminated");
        (await read.Sessions.SingleAsync(s => s.Id == readOnlyB)).RevokedAt.Should().NotBeNull("a live read-only session is terminated");
        (await read.Sessions.SingleAsync(s => s.Id == readOnlyAlreadyRevoked)).RevokedAt.Should()
            .BeCloseTo(alreadyRevokedAt, TimeSpan.FromSeconds(2), "an already-revoked session keeps its original revoke time");
        (await read.Sessions.SingleAsync(s => s.Id == sessionId)).RevokedAt.Should()
            .BeNull("the staff caller's own (non-read-only) session is never terminated by a shared-credential revoke");

        var events = await ReadEventsAsync(exerciseId, "credential.revoked");
        events.Should().ContainSingle("a revocation emits exactly one XC-004 credential.revoked event");
        events[0].Actor.Role.Should().Be(role);
        events[0].Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        events[0].Target!.EntityType.Should().Be("sharedCredential");
    }

    [RequiresDockerFact]
    public async Task Revoke_NoStaffSession_FailsClosed_Unauthenticated_NoSessionsTerminated()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "seed-password");
        var readOnly = await SeedReadOnlySessionAsync(exerciseId);

        var scope = ScopeFor(exerciseId);
        await using (var context = _fixture.CreateContext(scope))
        {
            var service = new SharedCredentialLifecycleService(context, scope, new StubCurrentStaffSessionAccessor(null), _hasher);
            var result = await service.RevokeAsync();
            result.Outcome.Should().Be(SharedCredentialRevokeOutcome.Unauthenticated);
        }

        await using var read = _fixture.CreateContext();
        (await read.Sessions.SingleAsync(s => s.Id == readOnly)).RevokedAt.Should()
            .BeNull("an unauthenticated revoke terminates nothing");
    }

    [RequiresDockerFact]
    public async Task Revoke_NoCredentialProvisioned_NotProvisioned()
    {
        var exerciseId = await SeedExerciseAsync();
        var (sessionId, staffUserId, _) = await SeedStaffSessionAsync(exerciseId);

        var scope = ScopeFor(exerciseId);
        await using var context = _fixture.CreateContext(scope);
        var result = await NewService(context, scope, sessionId, staffUserId).RevokeAsync();

        result.Outcome.Should().Be(SharedCredentialRevokeOutcome.NotProvisioned);
    }

    [RequiresDockerFact]
    public async Task Revoke_PersistsInOneSaveChangesCall()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, password: "seed-password");
        var (sessionId, staffUserId, _) = await SeedStaffSessionAsync(exerciseId);
        await SeedReadOnlySessionAsync(exerciseId);

        var interceptor = new CountingSaveChangesInterceptor();
        var scope = ScopeFor(exerciseId);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, scope);
        var result = await NewService(context, scope, sessionId, staffUserId).RevokeAsync();

        result.Outcome.Should().Be(SharedCredentialRevokeOutcome.Revoked);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the credential revoke, the read-only session terminations, and the revoked telemetry all share one unit of work (XC-004)");
    }
}
