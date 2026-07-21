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
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story 07 (COR-016 / NFR-009) integration tests for the grace + lockout + decoy behaviour folded into story
/// 06's <see cref="SharedReadOnlyLoginService"/>, against REAL SQL Server (Testcontainers). Proves: the PREVIOUS
/// password authenticates during a rotation grace window and stops when it elapses; repeated failures trip a
/// brute-force lockout that rejects even a correct password until it expires and emits one <c>auth.lockout</c>
/// event; a success resets the failed-attempt counter; and a disabled/absent credential does NOT accrue lockout.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SharedReadOnlyLoginGraceAndLockoutTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public SharedReadOnlyLoginGraceAndLockoutTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

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

    private async Task SeedCredentialAsync(
        Guid exerciseId,
        string? currentPassword,
        string? previousPassword = null,
        DateTimeOffset? graceExpiresAt = null,
        int failedAttemptCount = 0,
        DateTimeOffset? lockedOutUntil = null,
        bool isEnabled = true,
        DateTimeOffset? revokedAt = null)
    {
        await using var seed = _fixture.CreateContext();
        seed.SharedCredentials.Add(new SharedCredential
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            CurrentHash = currentPassword is null ? null : _hasher.Hash(currentPassword),
            PreviousHash = previousPassword is null ? null : _hasher.Hash(previousPassword),
            PreviousHashGraceExpiresAt = graceExpiresAt,
            FailedAttemptCount = failedAttemptCount,
            LockedOutUntil = lockedOutUntil,
            IsEnabled = isEnabled,
            RevokedAt = revokedAt,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
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

    private async Task<IReadOnlyList<TelemetryEvent>> ReadEventsAsync(Guid exerciseId, string eventType)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == eventType)
            .ToListAsync();
    }

    [RequiresDockerFact]
    public async Task Login_DuringGraceWindow_PreviousPasswordAuthenticates_AsDoesCurrent()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(
            exerciseId,
            currentPassword: "new-password",
            previousPassword: "old-password",
            graceExpiresAt: DateTimeOffset.UtcNow.AddMinutes(30));

        (await LoginOnceAsync(exerciseId, "old-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated,
            "the previous password still authenticates while the rotation grace window is open (story 07)");
        (await LoginOnceAsync(exerciseId, "new-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "the current password authenticates as usual");
    }

    [RequiresDockerFact]
    public async Task Login_AfterGraceWindowExpires_PreviousPasswordRejected_ButCurrentStillWorks()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(
            exerciseId,
            currentPassword: "new-password",
            previousPassword: "old-password",
            graceExpiresAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        (await LoginOnceAsync(exerciseId, "old-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Rejected,
            "once the grace window has elapsed the previous password stops authenticating (story 07)");
        (await LoginOnceAsync(exerciseId, "new-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "the current password is unaffected by the expired grace");
    }

    [RequiresDockerFact]
    public async Task Login_RepeatedFailures_TripLockout_ThenCorrectPasswordRejected_EmitsAuthLockout()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, currentPassword: "correct-password");

        // MaxFailedAttempts wrong attempts trip the lockout on the last one.
        for (var attempt = 1; attempt <= SharedCredentialLifecyclePolicy.MaxFailedAttempts; attempt++)
        {
            (await LoginOnceAsync(exerciseId, "wrong-password")).Should().Be(
                SharedReadOnlyLoginOutcome.Rejected, $"failed attempt {attempt} is rejected");
        }

        var credential = await ReadCredentialAsync(exerciseId);
        credential.LockedOutUntil.Should().NotBeNull("the threshold of consecutive failures trips the lockout");
        credential.LockedOutUntil!.Value.Should().BeAfter(DateTimeOffset.UtcNow, "the lockout window is still in the future");

        // While locked, even the CORRECT password is rejected.
        (await LoginOnceAsync(exerciseId, "correct-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Rejected,
            "while locked out, every attempt is rejected — even a correct password — until the window elapses");

        var lockoutEvents = await ReadEventsAsync(exerciseId, "auth.lockout");
        lockoutEvents.Should().ContainSingle("crossing the failed-attempt threshold emits exactly one auth.lockout event");
        var evt = lockoutEvents[0];
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("system", "the lockout is a system defence, not a named actor");
        evt.Actor.ActingHumanId.Should().BeNull("a lockout during an anonymous shared login carries no acting human");
        evt.Actor.Role.Should().BeNull("a lockout during an anonymous shared login carries no staff role either");
        evt.Target!.EntityType.Should().Be("sharedCredential");
        evt.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
            "scenario time is stamped from the exercise's stored CurrentScenarioTime (B2 placeholder)");
    }

    [RequiresDockerFact]
    public async Task Login_WhileLockoutExpired_CorrectPasswordAuthenticates()
    {
        var exerciseId = await SeedExerciseAsync();
        // A lockout stamp entirely in the past is inert — the credential authenticates again.
        await SeedCredentialAsync(
            exerciseId,
            currentPassword: "correct-password",
            lockedOutUntil: DateTimeOffset.UtcNow.AddMinutes(-1));

        (await LoginOnceAsync(exerciseId, "correct-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "an expired lockout no longer blocks a correct password");
    }

    [RequiresDockerFact]
    public async Task Login_Success_ResetsFailedAttemptCounter()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, currentPassword: "correct-password", failedAttemptCount: 5);

        (await LoginOnceAsync(exerciseId, "correct-password")).Should().Be(SharedReadOnlyLoginOutcome.Authenticated);

        var credential = await ReadCredentialAsync(exerciseId);
        credential.FailedAttemptCount.Should().Be(0, "a successful login resets the brute-force counter (story 07)");
        credential.LockedOutUntil.Should().BeNull("a successful login clears any residual lockout stamp");
    }

    [RequiresDockerFact]
    public async Task Login_FailedAttempt_IncrementsFailedAttemptCounter_BelowThreshold()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, currentPassword: "correct-password");

        (await LoginOnceAsync(exerciseId, "wrong-password")).Should().Be(SharedReadOnlyLoginOutcome.Rejected);

        var credential = await ReadCredentialAsync(exerciseId);
        credential.FailedAttemptCount.Should().Be(1, "one wrong attempt increments the counter");
        credential.LockedOutUntil.Should().BeNull("a single failure is below the lockout threshold");
    }

    [RequiresDockerFact]
    public async Task Login_DisabledCredential_WrongPassword_DoesNotAccrueLockout()
    {
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(exerciseId, currentPassword: "correct-password", isEnabled: false);

        (await LoginOnceAsync(exerciseId, "wrong-password")).Should().Be(SharedReadOnlyLoginOutcome.Rejected);

        var credential = await ReadCredentialAsync(exerciseId);
        credential.FailedAttemptCount.Should().Be(0,
            "a disabled credential takes the negative (decoy) path and never accrues brute-force lockout state");
    }

    [RequiresDockerFact]
    public async Task Login_AfterLockoutWindowExpires_CorrectPassword_ResetsResidualFailedAttemptCount()
    {
        // Distinct from Login_WhileLockoutExpired_CorrectPasswordAuthenticates (which starts from a ZERO
        // counter): here the credential carries a RESIDUAL nonzero FailedAttemptCount alongside a stale
        // LockedOutUntil, as it would immediately after a real lockout trip once the window has since elapsed
        // with no intervening success. The success path must reset BOTH, not merely leave an already-zero count.
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(
            exerciseId,
            currentPassword: "correct-password",
            failedAttemptCount: 7,
            lockedOutUntil: DateTimeOffset.UtcNow.AddMinutes(-1));

        (await LoginOnceAsync(exerciseId, "correct-password")).Should().Be(
            SharedReadOnlyLoginOutcome.Authenticated, "an expired lockout no longer blocks a correct password");

        var credential = await ReadCredentialAsync(exerciseId);
        credential.FailedAttemptCount.Should().Be(0,
            "a successful login after the lockout window elapses resets a RESIDUAL nonzero failed-attempt counter");
        credential.LockedOutUntil.Should().BeNull("a successful login clears any residual lockout stamp");
    }

    [RequiresDockerFact]
    public async Task Login_LockoutTrip_PersistsInOneSaveChangesCall()
    {
        // XC-004: the failed-attempt increment, the lockout trip itself (LockedOutUntil set + counter reset),
        // the auth.lockout event, AND the login-failure event must all share exactly one SaveChangesAsync call —
        // the same one-unit-of-work guarantee already pinned for plain rotate/revoke, extended to the lockout
        // trip specifically (the busiest single write this funnel performs).
        var exerciseId = await SeedExerciseAsync();
        await SeedCredentialAsync(
            exerciseId,
            currentPassword: "correct-password",
            failedAttemptCount: SharedCredentialLifecyclePolicy.MaxFailedAttempts - 1);

        var interceptor = new CountingSaveChangesInterceptor();
        var scope = ScopeFor(exerciseId);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, new RecordingSessionIssuer());

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = "wrong-password" });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the failed-attempt increment, the lockout trip, the auth.lockout event, and the login-failure event " +
            "all share exactly one SaveChangesAsync call (XC-004)");

        var credential = await ReadCredentialAsync(exerciseId);
        credential.LockedOutUntil.Should().NotBeNull("the threshold-crossing attempt did trip the lockout");
    }
}
