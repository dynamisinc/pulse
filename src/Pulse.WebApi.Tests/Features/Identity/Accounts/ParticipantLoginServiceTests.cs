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
using Pulse.WebApi.Tests.Data;
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

    private ParticipantLoginService ServiceFor(PulseDbContext context, Guid? scope, RecordingSessionIssuer issuer) =>
        new(context, new ExerciseContext { CurrentExerciseId = scope }, issuer, _hasher);

    private async Task<Exercise> SeedExerciseAsync(DateTimeOffset? scenarioTime, string timeZone = "America/Chicago")
    {
        var exercise = new Exercise
        {
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

    private async Task<Account> SeedAccountAsync(Guid exerciseId, string username, string? password, string role = "participant", string? actingHumanId = null)
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
        evt.Payload.Should().Contain("success");
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
        events[0].Payload.Should().Contain("failure");
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
