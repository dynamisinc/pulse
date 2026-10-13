namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Integration tests for <see cref="ParticipantLoginService"/> (story 02, COR-011 / XC-004 / NFR-009) against
/// REAL SQL Server (Testcontainers, <see cref="MsSqlContainerFixture"/>). Story 03's issuance seam is exercised
/// through the <see cref="RecordingSessionIssuer"/> double. Proves: a correct credential in the host-resolved
/// exercise issues a participant session + emits one login-success event + records LastLoginAt; a wrong /
/// unknown / credential-less login fails closed (no session) and emits an identity-less failure event.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantLoginServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly ParticipantPasswordHasher _hasher = new();

    public ParticipantLoginServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private const string PasswordSuccessPayload = "{\"outcome\":\"success\",\"method\":\"password\"}";
    private const string PasswordFailurePayload = "{\"outcome\":\"failure\",\"method\":\"password\"}";

    private ParticipantLoginService ServiceFor(PulseDbContext context, Guid? scope, ISessionIssuer issuer) =>
        new(context, new ExerciseContext { CurrentExerciseId = scope }, issuer, _hasher);

    private async Task<Exercise> SeedExerciseAsync(DateTimeOffset? scenarioTime, string timeZone = "America/Chicago")
    {
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = Guid.NewGuid(),
            Name = $"Exercise {Guid.NewGuid():N}",
            TimeZone = timeZone,
            Status = "active",
            CurrentScenarioTime = scenarioTime,
        };

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(exercise);
        await seed.SaveChangesAsync();
        return exercise;
    }

    private async Task<Account> SeedAccountAsync(
        Guid exerciseId,
        string username,
        string? password,
        string role = "participant",
        string? actingHumanId = null,
        DateTimeOffset? disabledAt = null)
    {
        var account = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = username,
            DisplayName = $"Display {username}",
            Role = role,
            ActingHumanId = actingHumanId,
            CredentialHash = password is null ? null : _hasher.Hash(password),
            CreatedAt = DateTimeOffset.UtcNow,
            DisabledAt = disabledAt,
        };

        await using var seed = _fixture.CreateContext();
        seed.Accounts.Add(account);
        await seed.SaveChangesAsync();
        return account;
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
    public async Task Login_Success_IssuesParticipantSession_EmitsSuccessTelemetry_RecordsLastLogin()
    {
        var scenario = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var exercise = await SeedExerciseAsync(scenario);
        var account = await SeedAccountAsync(exercise.Id, "mayor", "pw-mayor-123", role: "pio");

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, issuer);

            var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "mayor", Password = "pw-mayor-123" });

            result.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        }

        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest.Should().NotBeNull();
        issuer.LastRequest!.Kind.Should().Be("participant");
        issuer.LastRequest.Role.Should().Be("pio", "the session role is the account's role");
        issuer.LastRequest.ExerciseId.Should().Be(exercise.Id, "the session binds the host-resolved exercise");
        issuer.LastRequest.AccountId.Should().Be(account.Id);
        issuer.LastRequest.PrincipalId.Should().Be(account.Id.ToString());
        issuer.LastRequest.ActingHumanId.Should().Be(account.Id.ToString(), "actingHumanId derives from the account id when unset (COR-018 1:1)");
        issuer.LastRequest.IsReadOnly.Should().BeFalse();
        issuer.LastRequest.StaffUserId.Should().BeNull();

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().ContainSingle("a participant login emits exactly one XC-004 login event");
        var evt = events[0];
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("participant");
        evt.Actor.ParticipantId.Should().Be(account.Id.ToString());
        evt.Payload.Should().Be(
            PasswordSuccessPayload,
            "easy-login Gate-2 S-1: a password sign-in names its method, like the link and word sign-ins (additive field)");
        evt.ScenarioTime.Should().Be(scenario, "scenario time is stamped from the exercise's stored CurrentScenarioTime (B2 placeholder)");
        evt.TimeZone.Should().Be("America/Chicago");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var stored = await verify.Accounts.SingleAsync(a => a.Id == account.Id);
        stored.LastLoginAt.Should().NotBeNull("a successful login records LastLoginAt");
    }

    [RequiresDockerFact]
    public async Task Login_WrongPassword_Rejected_NoSession_EmitsIdentitylessFailure()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        var account = await SeedAccountAsync(exercise.Id, "alice", "correct-password");

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, issuer);

            var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "alice", Password = "WRONG" });

            result.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential, "a wrong password fails closed — no session");
        }

        issuer.IssueCount.Should().Be(0, "a rejected credential must not mint a session");

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().ContainSingle("a failed login still emits one XC-004 login event");
        events[0].Payload.Should().Be(PasswordFailurePayload, "easy-login Gate-2 S-1: the failure names its method too");
        events[0].Actor.Kind.Should().Be(
            "system",
            "an identity-less attempt is a SYSTEM actor: the v0 envelope conditionally requires participantId "
            + "whenever kind is 'participant', so claiming that kind here would be off-envelope (#356)");
        events[0].Actor.ParticipantId.Should().BeNull("a failed login carries NO session identity");
        var target = events[0].Target;
        target.Should().NotBeNull("the failure event points at the attempted handle");
        target!.EntityType.Should().Be("accountHandle");
        target.EntityId.Should().Be("alice", "the failure event records the sanitized attempted handle for audit");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.SingleAsync(a => a.Id == account.Id)).LastLoginAt.Should().BeNull(
            "a failed login must not record LastLoginAt");
    }

    [RequiresDockerFact]
    public async Task Login_UnknownHandle_Rejected_EmitsFailure()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);

        var issuer = new RecordingSessionIssuer();
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, issuer);

        var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "ghost", Password = "whatever" });

        result.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential, "an unknown handle fails closed");
        issuer.IssueCount.Should().Be(0);

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().ContainSingle();
        events[0].Payload.Should().Contain("failure");
        events[0].Actor.ParticipantId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Login_CredentialLessAccount_Rejected()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedAccountAsync(exercise.Id, "pending", password: null);

        var issuer = new RecordingSessionIssuer();
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, issuer);

        var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "pending", Password = "any" });

        result.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential,
            "an account provisioned without a credential can never authenticate — fail closed");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Login_DisabledAccount_WithTheRightPassword_IsRefusedExactlyLikeAWrongPassword()
    {
        // easy-login/03 (EL-8): staff disabled this person. Their CORRECT password is refused with the wrong-password
        // outcome and the identical identity-less failure event; nothing about the refusal says "disabled".
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        var disabled = await SeedAccountAsync(exercise.Id, "disabled-dana", "right-password", disabledAt: DateTimeOffset.UtcNow.AddMinutes(-5));
        await SeedAccountAsync(exercise.Id, "enabled-eve", "right-password");

        var issuer = new RecordingSessionIssuer();
        ParticipantLoginResult disabledResult;
        ParticipantLoginResult wrongPasswordResult;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = ServiceFor(context, exercise.Id, issuer);
            disabledResult = await service.LoginAsync(new ParticipantLoginRequest { Username = "disabled-dana", Password = "right-password" });
            wrongPasswordResult = await service.LoginAsync(new ParticipantLoginRequest { Username = "enabled-eve", Password = "WRONG" });
        }

        disabledResult.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential, "a disabled person is refused (401)");
        disabledResult.ValidationError.Should().BeNull();
        disabledResult.Issued.Should().BeNull();
        wrongPasswordResult.Outcome.Should().Be(disabledResult.Outcome);
        issuer.IssueCount.Should().Be(0, "a disabled person gets no session");

        var events = await ReadLoginEventsAsync(exercise.Id);
        events.Should().HaveCount(2);
        var disabledEvent = events.Single(e => e.Target!.EntityId == "disabled-dana");
        var wrongPasswordEvent = events.Single(e => e.Target!.EntityId == "enabled-eve");
        disabledEvent.Payload.Should().Be(wrongPasswordEvent.Payload, "the same failure payload as a wrong password");
        disabledEvent.Payload.Should().Be(PasswordFailurePayload);
        disabledEvent.Actor.Kind.Should().Be("system");
        disabledEvent.Actor.ParticipantId.Should().BeNull("the refusal carries no identity, exactly like a wrong password");
        disabledEvent.Target!.EntityType.Should().Be(wrongPasswordEvent.Target!.EntityType);

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.SingleAsync(a => a.Id == disabled.Id)).LastLoginAt.Should().BeNull("a refused sign-in records no login");
    }

    [RequiresDockerFact]
    public async Task Login_UnresolvedScope_FailsClosed_NoSession_NoTelemetry()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedAccountAsync(exercise.Id, "alice", "pw");

        var issuer = new RecordingSessionIssuer();
        // No scope resolved (null host) — the DbContext filter collapses to Guid.Empty too.
        await using var context = _fixture.CreateContext(new ExerciseContext());
        var service = ServiceFor(context, scope: null, issuer);

        var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "alice", Password = "pw" });

        result.Outcome.Should().Be(ParticipantLoginOutcome.ScopeUnresolved, "with no host-resolved exercise the login fails closed (401)");
        issuer.IssueCount.Should().Be(0);
        (await ReadLoginEventsAsync(exercise.Id)).Should().BeEmpty("no scoped event can be stamped without a resolved exercise");
    }

    [RequiresDockerFact]
    public async Task Login_MissingPassword_IsInvalid_NoTelemetry()
    {
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedAccountAsync(exercise.Id, "alice", "pw");

        var issuer = new RecordingSessionIssuer();
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, issuer);

        var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "alice", Password = "" });

        result.Outcome.Should().Be(ParticipantLoginOutcome.Invalid, "a missing password is a 400 before any credential work");
        issuer.IssueCount.Should().Be(0);
        (await ReadLoginEventsAsync(exercise.Id)).Should().BeEmpty("a malformed request emits no telemetry");
    }

    [RequiresDockerFact]
    public async Task Login_RacingADisable_BetweenTheCheckAndTheIssue_IsTheWrongPasswordRefusal_AndRecordsNoSuccess()
    {
        // easy-login Gate-2 W-001 (story 03's join pattern): the password verifies and the account is enabled, then staff
        // disable it BEFORE the session is minted (the racing issuer commits the Disable on its own connection first).
        // The sign-in re-reads the account after minting, so it is refused exactly as a disabled account is.
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        var account = await SeedAccountAsync(exercise.Id, "racer", "pw-racer-123");

        var recording = new RecordingSessionIssuer();
        var issuer = new RacingSessionIssuer(recording, async () =>
        {
            await using var staffSide = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
            (await staffSide.Accounts.SingleAsync(a => a.Id == account.Id)).DisabledAt = DateTimeOffset.UtcNow;
            await staffSide.SaveChangesAsync();
        });

        ParticipantLoginResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            result = await ServiceFor(context, exercise.Id, issuer)
                .LoginAsync(new ParticipantLoginRequest { Username = "racer", Password = "pw-racer-123" });
        }

        result.Outcome.Should().Be(ParticipantLoginOutcome.RejectedCredential, "a sign-in that lost the race to Disable is the ordinary 401");
        result.Issued.Should().BeNull("no session reaches the caller");
        recording.IssueCount.Should().Be(1, "precondition: the session was minted before the re-read");

        var evt = (await ReadLoginEventsAsync(exercise.Id)).Should().ContainSingle(
            "a raced attempt emits exactly one login event, and no success event").Subject;
        evt.Payload.Should().Be(PasswordFailurePayload, "the same failure a disabled account records");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ParticipantId.Should().BeNull("the refusal names nobody");
        evt.Target!.EntityId.Should().Be("racer", "the same attempted-handle target as every password refusal");

        await using var verify = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
        (await verify.Accounts.SingleAsync(a => a.Id == account.Id)).LastLoginAt.Should().BeNull(
            "LastLoginAt is written only once the re-read passes");
    }

    [RequiresDockerFact]
    public async Task Login_Success_AccountMutationAndTelemetry_ShareOneSaveChangesCall()
    {
        // XC-004: the LastLoginAt mutation and the login-success telemetry event must commit together as ONE
        // unit of work — never two round trips where one could persist without the other.
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedAccountAsync(exercise.Id, "alice", "pw-123456");

        var interceptor = new CountingSaveChangesInterceptor();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exercise.Id });
        var service = ServiceFor(context, exercise.Id, new RecordingSessionIssuer());

        var result = await service.LoginAsync(new ParticipantLoginRequest { Username = "alice", Password = "pw-123456" });

        result.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the account mutation and its XC-004 login-success telemetry event must commit in exactly one SaveChangesAsync call");
    }
}
