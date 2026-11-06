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
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// Integration tests for <see cref="SharedReadOnlyLoginService"/> (story 06, COR-015 / XC-004 / NFR-009) against
/// REAL SQL Server (Testcontainers, <see cref="MsSqlContainerFixture"/>). The story-03 issuance seam is exercised
/// through the <see cref="RecordingSessionIssuer"/> double so the ephemeral, view-only session request can be
/// asserted precisely. Proves: a correct password against an enabled credential mints a <c>readonly</c> session
/// with an ephemeral identity and emits one <c>login</c>-success event carrying that id as <c>actor.sessionId</c>;
/// a wrong / disabled / revoked credential fails closed (no session) and emits a failure event with no identity;
/// the credential is checked against the RESOLVED scope only (a cross-exercise password never authenticates); and
/// each attempt persists in exactly one <c>SaveChangesAsync</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class SharedReadOnlyLoginServiceTests
{
    private const string Password = "atl-cie-shared-2033";

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public SharedReadOnlyLoginServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private async Task<Exercise> SeedExerciseAsync(
        DateTimeOffset? scenarioTime,
        string timeZone = "America/Chicago",
        string status = "active")
    {
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = Guid.NewGuid(),
            Name = $"Exercise {Guid.NewGuid():N}",
            TimeZone = timeZone,
            Status = status,
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        await TestScenarioNow.SeedWorldTimeAsync(seed, exercise.Id, scenarioTime); // engine-runtime/08: the world's time is its latest post
        return exercise;
    }

    private async Task SeedCredentialAsync(Guid exerciseId, string? password, bool isEnabled = true, DateTimeOffset? revokedAt = null)
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

    private async Task<IReadOnlyList<TelemetryEvent>> ReadLoginEventsAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == "login")
            .ToListAsync();
    }

    [RequiresDockerFact]
    public async Task Login_CorrectPassword_MintsReadOnlySessionWithEphemeralIdentity_EmitsSuccessTelemetry()
    {
        var exercise = await SeedExerciseAsync(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        await SeedCredentialAsync(exercise.Id, Password);

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using (var context = _fixture.CreateContext(scope))
        {
            var service = new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context));
            var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

            result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated);
        }

        // The session issuer was called for a VIEW-ONLY, ephemeral-identity session bound to the resolved exercise.
        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest.Should().NotBeNull();
        issuer.LastRequest!.Kind.Should().Be("readonly");
        issuer.LastRequest.IsReadOnly.Should().BeTrue("a shared login mints a view-only session (COR-015)");
        issuer.LastRequest.Role.Should().Be("participant", "a read-only session lands on the participant world (All-Posts)");
        issuer.LastRequest.ExerciseId.Should().Be(exercise.Id);
        issuer.LastRequest.AccountId.Should().BeNull("a read-only session has no named account");
        issuer.LastRequest.StaffUserId.Should().BeNull();
        issuer.LastRequest.PersonaId.Should().BeNull();
        issuer.LastRequest.PrincipalId.Should().NotBeNullOrEmpty("the ephemeral identity is the principal id");
        issuer.LastRequest.ActingHumanId.Should().Be(issuer.LastRequest.PrincipalId,
            "the ephemeral identity is used as BOTH principal and acting-human — there is no named human");
        Guid.TryParse(issuer.LastRequest.PrincipalId, out _).Should().BeTrue("the ephemeral identity is a generated GUID");

        // Exactly one XC-004 login-success event, shaped against the v0 envelope, carrying the ephemeral id as
        // actor.sessionId (COR-015 reach counting) with actor.kind 'system' and NO participantId.
        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().ContainSingle("a shared login emits exactly one XC-004 login event");
        var evt = events[0];
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("system", "a shared read-only session is not a named participant");
        evt.Actor.ParticipantId.Should().BeNull("actor.kind 'system' carries no participantId (satisfies the v0 superRefine)");
        evt.Actor.SessionId.Should().Be(issuer.LastRequest.PrincipalId,
            "the ephemeral session identity is carried in actor.sessionId so views/reach are counted (COR-015)");
        evt.Payload.Should().Contain("success");
        evt.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
            "scenario time is the exercise's scenario now: its latest post (engine-runtime/08)");
        evt.TimeZone.Should().Be("America/Chicago");
    }

    [RequiresDockerFact]
    public async Task Login_WrongPassword_Rejected_NoSession_EmitsFailureTelemetryWithNoIdentity()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password);

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using (var context = _fixture.CreateContext(scope))
        {
            var service = new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context));
            var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = "WRONG-password" });

            result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected, "a wrong password fails closed — never a default session");
        }

        issuer.IssueCount.Should().Be(0, "a rejected credential must not mint a session");

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().ContainSingle("a failed shared login still emits one XC-004 login event");
        events[0].Payload.Should().Contain("failure");
        events[0].Actor.Kind.Should().Be("system");
        events[0].Actor.SessionId.Should().BeNull("a rejected login mints no session, so it carries no ephemeral session identity");
    }

    /// <summary>
    /// One rule for all (Tom, 2026-10-19): a shared view-only sign-in is admitted exactly where participant reads are
    /// accepted (<c>ExerciseLifecycleStates.IsParticipantSignInAllowed</c>): staged, live, paused and completed.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    public async Task Login_CorrectPassword_IsAdmitted_InEveryParticipantReadState(string status)
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null, status: status);
        await SeedCredentialAsync(exercise.Id, Password);

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using var context = _fixture.CreateContext(scope);
        var result = await new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context))
            .LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated, "a {0} exercise accepts participant reads, so it admits sign-in", status);
        issuer.IssueCount.Should().Be(1);
    }

    /// <summary>
    /// One rule for all: build, archived and an unrecognized status refuse a shared sign-in even with the correct
    /// password, exactly as a wrong password is refused (same outcome, one identity-less failure event, no session), so
    /// the response never reveals the lifecycle state (NFR-009). The closed state takes the existing decoy path, as a
    /// disabled credential does, so a correct password in a closed exercise neither authenticates nor counts toward
    /// lockout.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    [InlineData("scheduled")]
    [InlineData("not-a-state")]
    public async Task Login_CorrectPassword_InAStateThatRefusesParticipantReads_IsRefusedExactlyLikeAWrongPassword(string status)
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null, status: status);
        await SeedCredentialAsync(exercise.Id, Password);

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        SharedReadOnlyLoginResult right;
        SharedReadOnlyLoginResult wrong;
        await using (var context = _fixture.CreateContext(scope))
        {
            right = await new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context))
                .LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });
        }

        await using (var context = _fixture.CreateContext(scope))
        {
            wrong = await new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context))
                .LoginAsync(new SharedReadOnlyLoginRequest { Password = "WRONG-password" });
        }

        right.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected, "a {0} exercise admits no shared sign-in", status);
        right.Outcome.Should().Be(wrong.Outcome, "the lifecycle refusal is indistinguishable from a wrong password");
        right.Issued.Should().BeNull();
        right.ValidationError.Should().BeNull("a refusal says nothing about why");
        issuer.IssueCount.Should().Be(0, "no session in a {0} exercise", status);

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().HaveCount(2, "each attempt emits exactly one login event");
        events.Should().OnlyContain(e =>
            e.Payload == "{\"outcome\":\"failure\"}" && e.Actor.Kind == "system" && e.Actor.SessionId == null,
            "the lifecycle refusal records the same identity-less failure a wrong password records");

        var stored = await ReadCredentialAsync(exercise.Id);
        stored.FailedAttemptCount.Should().Be(0, "a closed exercise takes the decoy path, so no attempt counts toward lockout");
        stored.LockedOutUntil.Should().BeNull();
    }

    /// <summary>
    /// The closed-exercise decoy path never trips the brute-force lockout: <see cref="SharedCredentialLifecyclePolicy.MaxFailedAttempts"/>
    /// wrong passwords in a build or archived exercise leave the counter at zero and the credential unlocked.
    /// </summary>
    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    public async Task Login_MaxFailedAttemptsWrongPasswords_InAClosedExercise_NeverLockTheCredential(string status)
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null, status: status);
        await SeedCredentialAsync(exercise.Id, Password);
        var scope = ScopeFor(exercise.Id);

        for (var attempt = 0; attempt < SharedCredentialLifecyclePolicy.MaxFailedAttempts; attempt++)
        {
            await using var context = _fixture.CreateContext(scope);
            (await new SharedReadOnlyLoginService(context, scope, _hasher, new RecordingSessionIssuer(), TestScenarioNow.Over(context))
                    .LoginAsync(new SharedReadOnlyLoginRequest { Password = "WRONG-password" }))
                .Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected);
        }

        var stored = await ReadCredentialAsync(exercise.Id);
        stored.FailedAttemptCount.Should().Be(0, "no attempt in a {0} exercise counts toward lockout", status);
        stored.LockedOutUntil.Should().BeNull("the credential is never locked by attempts made while the exercise is closed");

        await using var read = _fixture.CreateContext();
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(e => e.ExerciseId == exercise.Id && e.EventType == "auth.lockout"))
            .Should().Be(0, "no lockout trip, so no auth.lockout event");
    }

    private async Task<SharedCredential> ReadCredentialAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.SharedCredentials.IgnoreQueryFilters().AsNoTracking().SingleAsync(c => c.ExerciseId == exerciseId);
    }

    [RequiresDockerFact]
    public async Task Login_DisabledCredential_Rejected_NoSession()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password, isEnabled: false);

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using var context = _fixture.CreateContext(scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected,
            "a disabled shared credential authenticates nothing even with the correct password (fail closed)");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Login_RevokedCredential_Rejected_NoSession()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password, revokedAt: DateTimeOffset.UtcNow.AddMinutes(-1));

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using var context = _fixture.CreateContext(scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected,
            "a revoked shared credential authenticates nothing even with the correct password (fail closed)");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Login_NoCredentialForExercise_Rejected_NoSession()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        // No SharedCredential seeded for this exercise at all.

        var issuer = new RecordingSessionIssuer();
        var scope = ScopeFor(exercise.Id);
        await using var context = _fixture.CreateContext(scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, issuer, TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected,
            "an exercise with no shared credential provisioned rejects a shared login (fail closed)");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Login_UnresolvedScope_FailsClosed_NoSession_NoTelemetry()
    {
        // No host resolved an exercise → CurrentExerciseId is null. The login must fail closed and, with no valid
        // scope, must stamp NO scoped telemetry (mirroring StaffLoginService's unknown-exercise path).
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password);

        var issuer = new RecordingSessionIssuer();
        var unscoped = new ExerciseContext(); // CurrentExerciseId == null
        await using var context = _fixture.CreateContext(unscoped);
        var service = new SharedReadOnlyLoginService(context, unscoped, _hasher, issuer, TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.ScopeUnresolved,
            "with no host-resolved exercise there is no credential to check — fail closed (401), never a default session");
        issuer.IssueCount.Should().Be(0);
        (await ReadLoginEventsAsync(exercise.Id)).Should().BeEmpty("no scoped telemetry can be stamped without a resolved exercise");
    }

    [RequiresDockerFact]
    public async Task Login_ExerciseAPassword_DoesNotAuthenticateAgainstExerciseBCredential()
    {
        // The always-Critical cross-exercise guarantee: exercise A's shared password must NEVER authenticate on
        // exercise B (whose scope is what the host resolves to). Both exercises have their own credential; a login
        // scoped to B with A's password is rejected, while B's own password succeeds.
        var exerciseA = await SeedExerciseAsync(scenarioTime: null);
        var exerciseB = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exerciseA.Id, "password-for-A");
        await SeedCredentialAsync(exerciseB.Id, "password-for-B");

        // Scoped to B (as the host would resolve), presenting A's password → rejected.
        var scopeB = ScopeFor(exerciseB.Id);
        await using (var context = _fixture.CreateContext(scopeB))
        {
            var service = new SharedReadOnlyLoginService(context, scopeB, _hasher, new RecordingSessionIssuer(), TestScenarioNow.Over(context));
            var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = "password-for-A" });

            result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected,
                "exercise A's shared password must never authenticate against exercise B's credential — the " +
                "credential lookup is confined to the resolved scope B by the global query filter (COR-001)");
        }

        // Sanity: B's own password DOES succeed under B's scope — proving the rejection above is isolation, not a
        // broken verify.
        var issuerB = new RecordingSessionIssuer();
        var scopeB2 = ScopeFor(exerciseB.Id);
        await using (var context = _fixture.CreateContext(scopeB2))
        {
            var service = new SharedReadOnlyLoginService(context, scopeB2, _hasher, issuerB, TestScenarioNow.Over(context));
            var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = "password-for-B" });

            result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated, "exercise B's own password authenticates under B's scope");
        }

        issuerB.LastRequest!.ExerciseId.Should().Be(exerciseB.Id, "the minted session is bound to the resolved exercise B");
    }

    [RequiresDockerFact]
    public async Task Login_Success_TelemetryEvent_PersistsInOneSaveChangesCall()
    {
        // XC-004: the single login-success telemetry event must commit in exactly ONE SaveChangesAsync (its own
        // unit of work) — the session mint is a separate issuer round trip by design (mirroring StaffLoginService).
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password);

        var interceptor = new CountingSaveChangesInterceptor();
        var scope = ScopeFor(exercise.Id);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, new RecordingSessionIssuer(), TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = Password });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the XC-004 login-success telemetry event persists in exactly one SaveChangesAsync call on the login " +
            "service's context (the session row is persisted separately by the issuer)");
    }

    [RequiresDockerFact]
    public async Task Login_Failure_TelemetryEvent_PersistsInOneSaveChangesCall()
    {
        // Mirrors the success-path proof above: a REJECTED login has no session to issue, so its single
        // XC-004 failure event is the funnel's ONLY write — it must still land in exactly one
        // SaveChangesAsync call, never split across multiple round trips.
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedCredentialAsync(exercise.Id, Password);

        var interceptor = new CountingSaveChangesInterceptor();
        var scope = ScopeFor(exercise.Id);
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, scope);
        var service = new SharedReadOnlyLoginService(context, scope, _hasher, new RecordingSessionIssuer(), TestScenarioNow.Over(context));

        var result = await service.LoginAsync(new SharedReadOnlyLoginRequest { Password = "WRONG-password" });

        result.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the XC-004 login-failure telemetry event persists in exactly one SaveChangesAsync call — there is " +
            "no session to issue on a rejected login, so this is the funnel's ONLY write");
    }
}
