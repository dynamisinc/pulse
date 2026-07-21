namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <see cref="StaffLoginService"/> (story 05, COR-014 / XC-004 / NFR-009) against REAL
/// SQL Server (Testcontainers, <see cref="MsSqlContainerFixture"/>) — the login path is built now while
/// story 03 (the auth scheme + <c>ISessionIssuer</c> impl) is a Wave-2 concern, so the story-03 seams are
/// exercised through the <see cref="RecordingSessionIssuer"/> double. Proves: success provisions/refreshes the
/// StaffUser, mints a staff session with the assignment role, and emits exactly one <c>login</c>-success
/// telemetry event; failures fail closed (no session) and emit the failure event.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffLoginServiceTests
{
    private readonly MsSqlContainerFixture _fixture;

    public StaffLoginServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static DynamisIdentityProvider ProviderFor(string username, string secret, string subject, string displayName) =>
        new(Options.Create(new DynamisIdentityProviderOptions
        {
            Accounts = new List<DynamisStaffAccount>
            {
                new() { Username = username, Secret = secret, ExternalSubject = subject, DisplayName = displayName },
            },
        }));

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

    private async Task SeedStaffUserWithAssignmentAsync(Guid staffUserId, string subject, Guid exerciseId, string role, string displayName = "Seeded Name")
    {
        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(new StaffUser
        {
            Id = staffUserId,
            ExternalSubject = subject,
            DisplayName = displayName,
            CreatedAt = DateTimeOffset.UtcNow,
        });
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

    private async Task<IReadOnlyList<TelemetryEvent>> ReadLoginEventsAsync(Guid exerciseId, string eventType)
    {
        await using var read = _fixture.CreateContext();
        return await read.TelemetryEvents
            .IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && e.EventType == eventType)
            .ToListAsync();
    }

    [RequiresDockerFact]
    public async Task Login_Success_ProvisionsStaffUser_IssuesStaffSession_EmitsSuccessTelemetry()
    {
        var subject = $"idp|{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var exercise = await SeedExerciseAsync(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)));
        await SeedStaffUserWithAssignmentAsync(staffUserId, subject, exercise.Id, "controller");

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(context, ProviderFor("ctrl", "pw-123456", subject, "Fresh Controller"), issuer);

            var result = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = exercise.Id.ToString(),
            });

            result.Outcome.Should().Be(StaffLoginOutcome.Authenticated);
        }

        // The session issuer was called with a staff session bound to the assignment's role + exercise.
        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest.Should().NotBeNull();
        issuer.LastRequest!.Kind.Should().Be("staff");
        issuer.LastRequest.Role.Should().Be("controller", "the session role is the staff role for the selected active exercise");
        issuer.LastRequest.ExerciseId.Should().Be(exercise.Id);
        issuer.LastRequest.StaffUserId.Should().Be(staffUserId);
        issuer.LastRequest.PrincipalId.Should().Be(staffUserId.ToString());
        issuer.LastRequest.ActingHumanId.Should().Be(staffUserId.ToString());
        issuer.LastRequest.IsReadOnly.Should().BeFalse();
        issuer.LastRequest.AccountId.Should().BeNull();
        issuer.LastRequest.PersonaId.Should().BeNull();

        // Exactly one XC-004 login-success event, correctly shaped against the v0 envelope.
        var events = await ReadLoginEventsAsync(exercise.Id, "login");
        events.Should().ContainSingle("staff login emits exactly one XC-004 login event");
        var evt = events[0];
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.Role.Should().Be("controller");
        evt.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        evt.Payload.Should().Contain("success");
        evt.ScenarioTime.Should().Be(new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
            "scenario time is stamped from the exercise's stored CurrentScenarioTime (B2 placeholder)");
        evt.TimeZone.Should().Be("America/Chicago");

        // StaffUser identity was refreshed from the provider and LastLoginAt recorded.
        await using var verify = _fixture.CreateContext();
        var stored = await verify.StaffUsers.SingleAsync(u => u.Id == staffUserId);
        stored.DisplayName.Should().Be("Fresh Controller", "the recorded identity is refreshed from the IdP on login");
        stored.LastLoginAt.Should().NotBeNull();
    }

    [RequiresDockerFact]
    public async Task Login_WrongSecret_Rejected_NoSession_EmitsFailureTelemetryWithNoIdentity()
    {
        var subject = $"idp|{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedStaffUserWithAssignmentAsync(staffUserId, subject, exercise.Id, "controller");

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(context, ProviderFor("ctrl", "correct-secret", subject, "Ctrl"), issuer);

            var result = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "WRONG-secret",
                ExerciseId = exercise.Id.ToString(),
            });

            result.Outcome.Should().Be(StaffLoginOutcome.Rejected, "a wrong secret fails closed — never a default session");
        }

        issuer.IssueCount.Should().Be(0, "a rejected credential must not mint a session");

        var events = await ReadLoginEventsAsync(exercise.Id, "login");
        events.Should().ContainSingle("a failed login still emits one XC-004 login event");
        events[0].Payload.Should().Contain("failure");
        events[0].Actor.Kind.Should().Be("system");
        events[0].Actor.ActingHumanId.Should().BeNull("a rejected-credential failure carries no session identity");
        events[0].Actor.Role.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Login_UnknownExercise_Invalid_NoSession_NoTelemetry()
    {
        var subject = $"idp|{Guid.NewGuid():N}";
        var unknownExerciseId = Guid.NewGuid();

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(context, ProviderFor("ctrl", "pw-123456", subject, "Ctrl"), issuer);

            var result = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "ctrl",
                Secret = "pw-123456",
                ExerciseId = unknownExerciseId.ToString(),
            });

            result.Outcome.Should().Be(StaffLoginOutcome.Invalid, "a login against a non-existent exercise is rejected (R6 validation)");
        }

        issuer.IssueCount.Should().Be(0);
        (await ReadLoginEventsAsync(unknownExerciseId, "login")).Should().BeEmpty(
            "no scoped telemetry can be stamped against an exercise that does not exist");
    }

    [RequiresDockerFact]
    public async Task Login_AuthenticatedButNotAssigned_Forbidden_ProvisionsUser_NoSession_EmitsFailure()
    {
        var subject = $"idp|{Guid.NewGuid():N}";
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        // No StaffUser, no assignment seeded — the subject is unknown to Pulse until this first login.

        var issuer = new RecordingSessionIssuer();
        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(context, ProviderFor("newbie", "pw-123456", subject, "New Staffer"), issuer);

            var result = await service.LoginAsync(new StaffLoginRequest
            {
                Username = "newbie",
                Secret = "pw-123456",
                ExerciseId = exercise.Id.ToString(),
            });

            result.Outcome.Should().Be(StaffLoginOutcome.NotAssigned,
                "an authenticated staff user with no assignment on the requested exercise fails closed (403), no session");
        }

        issuer.IssueCount.Should().Be(0);

        // The StaffUser was provisioned from the external identity (so an admin can later assign them), but
        // never entered the exercise, so LastLoginAt stays null.
        await using var verify = _fixture.CreateContext();
        var provisioned = await verify.StaffUsers.SingleOrDefaultAsync(u => u.ExternalSubject == subject);
        provisioned.Should().NotBeNull("first login provisions the StaffUser by external subject");
        provisioned!.LastLoginAt.Should().BeNull("an unassigned login is not a successful entry");

        var events = await ReadLoginEventsAsync(exercise.Id, "login");
        events.Should().ContainSingle();
        events[0].Payload.Should().Contain("failure");
        events[0].Actor.ActingHumanId.Should().Be(provisioned.Id.ToString(),
            "the unassigned-failure event knows the authenticated human (audit), unlike a bad-credential failure");
    }

    [RequiresDockerFact]
    public async Task Login_WorksThroughAnyIIdentityProvider_ProvingTheSwapSeam()
    {
        // AC: swapping the provider (future Entra/SSO) needs no call-site change — the login funnel depends
        // only on IIdentityProvider. Here a non-Dynamis stub provider drives the exact same success path.
        var subject = $"idp|{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedStaffUserWithAssignmentAsync(staffUserId, subject, exercise.Id, "evaluator");

        var swapped = StubIdentityProvider.Accepting(new StaffIdentity
        {
            ExternalSubject = subject,
            DisplayName = "Federated User",
        });

        var issuer = new RecordingSessionIssuer();
        await using var context = _fixture.CreateContext();
        var service = new StaffLoginService(context, swapped, issuer);

        var result = await service.LoginAsync(new StaffLoginRequest
        {
            Username = "anything",
            Secret = "anything",
            ExerciseId = exercise.Id.ToString(),
        });

        result.Outcome.Should().Be(StaffLoginOutcome.Authenticated,
            "a swapped IIdentityProvider drives the same login path with no call-site change");
        issuer.LastRequest!.Role.Should().Be("evaluator");
    }

    [RequiresDockerFact]
    public async Task Login_Success_StaffUserMutationAndTelemetryEvent_ShareOneSaveChangesCall()
    {
        // XC-004: the StaffUser mutation (provisioning + LastLoginAt) and the paired login-success telemetry
        // event must commit together as ONE unit of work — never two separate SaveChangesAsync round trips
        // where one could persist without the other (e.g. a crash between them would otherwise leave a
        // successful login with no audit event, or an audit event for a login that never completed).
        var subject = $"idp|{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedStaffUserWithAssignmentAsync(staffUserId, subject, exercise.Id, "controller");

        var interceptor = new CountingSaveChangesInterceptor();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options);
        var service = new StaffLoginService(context, ProviderFor("ctrl", "pw-123456", subject, "Ctrl"), new RecordingSessionIssuer());

        var result = await service.LoginAsync(new StaffLoginRequest
        {
            Username = "ctrl",
            Secret = "pw-123456",
            ExerciseId = exercise.Id.ToString(),
        });

        result.Outcome.Should().Be(StaffLoginOutcome.Authenticated);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "the StaffUser mutation and its XC-004 login-success telemetry event must commit together in " +
            "exactly one SaveChangesAsync call — the same unit of work");
    }

    [RequiresDockerFact]
    public async Task Login_WrongSecret_FailureTelemetryEvent_PersistsInOneSaveChangesCall()
    {
        // The failure path is just as much a unit-of-work concern: the rejected-login telemetry event must
        // not depend on a second round trip either.
        var subject = $"idp|{Guid.NewGuid():N}";
        var exercise = await SeedExerciseAsync(scenarioTime: null);

        var interceptor = new CountingSaveChangesInterceptor();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options);
        var service = new StaffLoginService(context, ProviderFor("ctrl", "correct-secret", subject, "Ctrl"), new RecordingSessionIssuer());

        var result = await service.LoginAsync(new StaffLoginRequest
        {
            Username = "ctrl",
            Secret = "WRONG-secret",
            ExerciseId = exercise.Id.ToString(),
        });

        result.Outcome.Should().Be(StaffLoginOutcome.Rejected);
        interceptor.SaveChangesCallCount.Should().Be(1,
            "a rejected login's failure telemetry event must persist in exactly one SaveChangesAsync call");
    }

    [RequiresDockerFact]
    public async Task Login_ScenarioTime_FallsBackToWallClock_WhenExerciseHasNoStoredScenarioTime()
    {
        var subject = $"idp|{Guid.NewGuid():N}";
        var staffUserId = Guid.NewGuid();
        var exercise = await SeedExerciseAsync(scenarioTime: null);
        await SeedStaffUserWithAssignmentAsync(staffUserId, subject, exercise.Id, "planner");

        var before = DateTimeOffset.UtcNow.AddSeconds(-5);

        await using (var context = _fixture.CreateContext())
        {
            var service = new StaffLoginService(context, ProviderFor("plan", "pw-123456", subject, "Planner"), new RecordingSessionIssuer());
            await service.LoginAsync(new StaffLoginRequest { Username = "plan", Secret = "pw-123456", ExerciseId = exercise.Id.ToString() });
        }

        var events = await ReadLoginEventsAsync(exercise.Id, "login");
        events.Should().ContainSingle();
        events[0].ScenarioTime.Should().BeOnOrAfter(before,
            "with no stored scenario time the B2 placeholder falls back to the server wall clock");
    }
}
