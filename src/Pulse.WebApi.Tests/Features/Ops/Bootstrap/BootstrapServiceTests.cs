namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story login/05 (Tier-2) integration tests for <see cref="BootstrapService"/> against REAL SQL Server
/// (Testcontainers). Proves the guarded one-time seed: an empty database is bootstrapped into a host-bound
/// <see cref="Exercise"/> (+ optional <see cref="StaffAssignment"/> / first <see cref="SharedCredential"/> /
/// participant <see cref="Account"/>); the call is idempotent and non-clobbering; every scoped row it writes is
/// stamped with the NEW exercise's own id and is isolated (fail closed) from every other exercise (COR-001); one
/// XC-004 <c>exercise.bootstrapped</c> event is emitted per successful call; the bootstrapped rows actually
/// unblock the existing login funnels (staff login for an allowlisted identity; shared read-only login with the
/// one-time plaintext). Fresh <see cref="Guid.NewGuid"/> ids + unique hostnames per test keep them independent in
/// the shared container (no table truncation), matching the standing suite.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class BootstrapServiceTests
{
    private const string Secret = "s3cr3t-bootstrap-value";

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _sharedHasher = new();
    private readonly ParticipantPasswordHasher _participantHasher = new();

    public BootstrapServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private static string NewHostname() => $"uat-{Guid.NewGuid():N}.example.com";

    private BootstrapService NewService(PulseDbContext context, params DynamisStaffAccount[] allowlist) =>
        new(
            context,
            Options.Create(new BootstrapOptions { Secret = Secret }),
            Options.Create(new DynamisIdentityProviderOptions { Accounts = new List<DynamisStaffAccount>(allowlist) }),
            _sharedHasher,
            _participantHasher,
            new OpsPersonaResolver(context));

    [RequiresDockerFact]
    public async Task Bootstrap_EmptyDatabase_CreatesHostBoundActiveExercise()
    {
        var host = NewHostname();

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BootstrapAsync(
            new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT Pilot", TimeZone = "America/New_York" },
            Secret);

        result.Outcome.Should().Be(BootstrapOutcome.Provisioned);
        result.ExerciseCreated.Should().BeTrue("the hostname did not yet resolve to an exercise");
        result.ExerciseId.Should().NotBeNull();
        result.Hostname.Should().Be(host);
        result.Staff.Should().BeNull("no staff sub-request was included");
        result.SharedCredential.Should().BeNull("no shared-credential sub-request was included");
        result.ParticipantAccount.Should().BeNull("no participant-account sub-request was included");

        await using var read = _fixture.CreateContext();
        var exercise = await read.Exercises.AsNoTracking().SingleAsync(e => e.Hostname == host);
        exercise.Id.Should().Be(result.ExerciseId!.Value, "the exercise is host-bound so ExerciseResolutionMiddleware can resolve it");
        exercise.Name.Should().Be("UAT Pilot");
        exercise.TimeZone.Should().Be("America/New_York");
        exercise.Status.Should().Be("active", "a bootstrapped exercise is created active");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_SecondCallSameHostname_ReturnsExistingExercise_NoDuplicate_NoClobber()
    {
        var host = NewHostname();

        Guid firstId;
        await using (var context = _fixture.CreateContext())
        {
            var first = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT" }, Secret);
            first.ExerciseCreated.Should().BeTrue();
            firstId = first.ExerciseId!.Value;
        }

        await using (var context = _fixture.CreateContext())
        {
            var second = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "A Different Name" }, Secret);
            second.ExerciseCreated.Should().BeFalse("a hostname that already resolves is reused, never duplicated (idempotent)");
            second.ExerciseId!.Value.Should().Be(firstId, "the re-run returns the SAME exercise");
        }

        await using var read = _fixture.CreateContext();
        (await read.Exercises.CountAsync(e => e.Hostname == host)).Should().Be(1, "no duplicate exercise row");
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Hostname == host)).Name
            .Should().Be("UAT", "an idempotent re-run must not clobber the stored exercise name");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_WrongSecret_Rejected_WritesNothing()
    {
        var host = NewHostname();

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BootstrapAsync(
            new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT" }, presentedSecret: "not-the-secret");

        result.Outcome.Should().Be(BootstrapOutcome.Rejected, "a wrong secret fails closed");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AnyAsync(e => e.Hostname == host))
            .Should().BeFalse("a rejected (wrong-secret) call must write nothing at all");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ScopedRows_StampedWithNewExerciseId_AndFailClosedIsolated()
    {
        var host = NewHostname();
        var username = $"pio-{Guid.NewGuid():N}";

        Guid exerciseId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    SharedCredential = new BootstrapSharedCredentialRequest { Enabled = true },
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "PIO One",
                        Role = "pio",
                    },
                },
                Secret);

            result.ParticipantAccount!.Created.Should().BeTrue();
            result.SharedCredential!.Created.Should().BeTrue();
            exerciseId = result.ExerciseId!.Value;
        }

        // Visible in the creating exercise's own scope, stamped with its own id.
        await using (var readInScope = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            (await readInScope.Accounts.SingleAsync()).ExerciseId
                .Should().Be(exerciseId, "the account is stamped with the created exercise's OWN id (COR-001)");
            (await readInScope.SharedCredentials.SingleAsync()).ExerciseId
                .Should().Be(exerciseId, "the shared credential is stamped with the created exercise's OWN id");
        }

        // Fail closed: a DIFFERENT exercise's scope sees ZERO of these rows.
        await using (var readOtherScope = _fixture.CreateContext(ScopeFor(Guid.NewGuid())))
        {
            (await readOtherScope.Accounts.CountAsync(a => a.ExerciseId == exerciseId))
                .Should().Be(0, "another exercise's scope must never see this exercise's account (fail closed)");
            (await readOtherScope.SharedCredentials.CountAsync(c => c.ExerciseId == exerciseId))
                .Should().Be(0, "another exercise's scope must never see this exercise's shared credential");
        }

        // The rows DO physically exist (so the zero above is the filter closing the door, not an empty table).
        await using (var readUnfiltered = _fixture.CreateContext())
        {
            (await readUnfiltered.Accounts.IgnoreQueryFilters().CountAsync(a => a.ExerciseId == exerciseId))
                .Should().Be(1, "the account exists — the cross-exercise zero is the read filter, not an empty table");
            (await readUnfiltered.SharedCredentials.IgnoreQueryFilters().CountAsync(c => c.ExerciseId == exerciseId))
                .Should().Be(1, "the shared credential exists — the cross-exercise zero is the read filter");
        }
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Success_EmitsExactlyOneBootstrappedTelemetryEvent()
    {
        var host = NewHostname();

        Guid exerciseId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT" }, Secret);
            exerciseId = result.ExerciseId!.Value;
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var events = await read.TelemetryEvents.AsNoTracking()
            .Where(e => e.EventType == "exercise.bootstrapped")
            .ToListAsync();

        events.Should().ContainSingle("exactly one XC-004 exercise.bootstrapped event is emitted per successful call");
        var telemetry = events[0];
        telemetry.ExerciseId.Should().Be(exerciseId, "the audit event is scoped to the bootstrapped exercise");
        telemetry.Channel.Should().Be("system");
        telemetry.Actor.Kind.Should().Be("system");
        telemetry.Actor.ActingHumanId.Should().Be("bootstrap", "the fixed bootstrap actor id");
        telemetry.Target.Should().NotBeNull();
        telemetry.Target!.EntityType.Should().Be("exercise");
        Guid.Parse(telemetry.Target.EntityId!).Should().Be(exerciseId, "the target points at the bootstrapped exercise");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_StaffAssignment_UnblocksStaffLoginForAllowlistedIdentity()
    {
        var host = NewHostname();
        var staffSecret = "staff-secret-value";

        var assigned = new DynamisStaffAccount
        {
            Username = $"ctrl-{Guid.NewGuid():N}",
            Secret = staffSecret,
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Controller One",
        };
        // A second allowlisted identity that is NOT bootstrapped — proves it is the ASSIGNMENT (not merely the
        // exercise) that unblocks login.
        var unassigned = new DynamisStaffAccount
        {
            Username = $"eval-{Guid.NewGuid():N}",
            Secret = staffSecret,
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Evaluator",
        };

        Guid exerciseId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context, assigned, unassigned).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    Staff = new BootstrapStaffRequest { Username = assigned.Username, Role = "controller" },
                },
                Secret);

            result.Staff.Should().NotBeNull();
            result.Staff!.Created.Should().BeTrue("the assignment was created on this call");
            result.Staff.Role.Should().Be("controller");
            result.Staff.StaffUserId.Should().NotBeEmpty();
            exerciseId = result.ExerciseId!.Value;
        }

        var allowlist = new List<DynamisStaffAccount> { assigned, unassigned };

        await using (var loginContext = _fixture.CreateContext())
        {
            var loginService = new StaffLoginService(
                loginContext,
                new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions { Accounts = allowlist })),
                new RecordingSessionIssuer());

            var login = await loginService.LoginAsync(new StaffLoginRequest
            {
                Username = assigned.Username,
                Secret = staffSecret,
                ExerciseId = exerciseId.ToString(),
            });

            login.Outcome.Should().Be(StaffLoginOutcome.Authenticated,
                "bootstrapping the StaffAssignment unblocks POST /api/auth/staff/login for the allowlisted identity");
        }

        await using (var loginContext = _fixture.CreateContext())
        {
            var loginService = new StaffLoginService(
                loginContext,
                new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions { Accounts = allowlist })),
                new RecordingSessionIssuer());

            var login = await loginService.LoginAsync(new StaffLoginRequest
            {
                Username = unassigned.Username,
                Secret = staffSecret,
                ExerciseId = exerciseId.ToString(),
            });

            login.Outcome.Should().Be(StaffLoginOutcome.NotAssigned,
                "an allowlisted identity that was NOT bootstrapped is still fail-closed (403 NotAssigned) on the same exercise");
        }
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Staff_SecondCall_ReusesAssignment_NoDuplicate()
    {
        var host = NewHostname();
        var allowlisted = new DynamisStaffAccount
        {
            Username = $"ctrl-{Guid.NewGuid():N}",
            Secret = "staff-secret",
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Controller",
        };

        Guid exerciseId;
        Guid firstStaffUserId;
        await using (var context = _fixture.CreateContext())
        {
            var first = await NewService(context, allowlisted).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    Staff = new BootstrapStaffRequest { Username = allowlisted.Username, Role = "controller" },
                },
                Secret);
            first.Staff!.Created.Should().BeTrue();
            exerciseId = first.ExerciseId!.Value;
            firstStaffUserId = first.Staff.StaffUserId;
        }

        await using (var context = _fixture.CreateContext())
        {
            var second = await NewService(context, allowlisted).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    Staff = new BootstrapStaffRequest { Username = allowlisted.Username, Role = "controller" },
                },
                Secret);
            second.Staff!.Created.Should().BeFalse("the assignment already existed — reused, never duplicated");
            second.Staff.StaffUserId.Should().Be(firstStaffUserId, "the same StaffUser is reused");
        }

        await using var read = _fixture.CreateContext();
        (await read.StaffUsers.CountAsync(u => u.ExternalSubject == allowlisted.ExternalSubject))
            .Should().Be(1, "the StaffUser is not duplicated across re-runs");
        (await read.StaffAssignments.CountAsync(a => a.StaffUserId == firstStaffUserId && a.ExerciseId == exerciseId))
            .Should().Be(1, "the StaffAssignment is not duplicated across re-runs");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Staff_ReusesPreExistingAutoProvisionedStaffUser()
    {
        var host = NewHostname();
        var subject = $"idp|{Guid.NewGuid():N}";
        var username = $"ctrl-{Guid.NewGuid():N}";

        // Simulate a StaffUser already auto-provisioned by a prior failed login attempt (per the story AC).
        var preExistingId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.StaffUsers.Add(new StaffUser
            {
                Id = preExistingId,
                ExternalSubject = subject,
                DisplayName = "Prior Login",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        var allowlisted = new DynamisStaffAccount
        {
            Username = username,
            Secret = "staff-secret",
            ExternalSubject = subject,
            DisplayName = "Controller",
        };

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context, allowlisted).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    Staff = new BootstrapStaffRequest { Username = username, Role = "evaluator" },
                },
                Secret);

            result.Staff!.StaffUserId.Should().Be(preExistingId, "an already-auto-provisioned StaffUser is reused, not recreated");
            result.Staff.Created.Should().BeTrue("the ASSIGNMENT is new even though the StaffUser was reused");
        }

        await using var read = _fixture.CreateContext();
        (await read.StaffUsers.CountAsync(u => u.ExternalSubject == subject))
            .Should().Be(1, "the pre-existing StaffUser is reused, never duplicated");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Staff_UnknownUsername_ReturnsInvalid()
    {
        var host = NewHostname();

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BootstrapAsync(
            new BootstrapExerciseRequest
            {
                Hostname = host,
                ExerciseName = "UAT",
                Staff = new BootstrapStaffRequest { Username = "not-in-allowlist", Role = "controller" },
            },
            Secret);

        result.Outcome.Should().Be(BootstrapOutcome.Invalid, "a staff username not in the allowlist cannot resolve an external subject");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AnyAsync(e => e.Hostname == host))
            .Should().BeFalse("a validation failure writes nothing (validated before any write)");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Staff_BadRole_ReturnsInvalid()
    {
        var host = NewHostname();
        var allowlisted = new DynamisStaffAccount
        {
            Username = $"ctrl-{Guid.NewGuid():N}",
            Secret = "staff-secret",
            ExternalSubject = $"idp|{Guid.NewGuid():N}",
            DisplayName = "Controller",
        };

        await using var context = _fixture.CreateContext();
        var result = await NewService(context, allowlisted).BootstrapAsync(
            new BootstrapExerciseRequest
            {
                Hostname = host,
                ExerciseName = "UAT",
                Staff = new BootstrapStaffRequest { Username = allowlisted.Username, Role = "wizard" },
            },
            Secret);

        result.Outcome.Should().Be(BootstrapOutcome.Invalid, "a non-staff role is rejected (controller/evaluator/planner only)");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_Staff_AllowlistEntryWithEmptySecret_ReturnsInvalid_NoDeadAssignment()
    {
        var host = NewHostname();
        var subject = $"idp|{Guid.NewGuid():N}";
        var username = $"ctrl-{Guid.NewGuid():N}";

        // An allowlist entry with a resolvable external subject but NO configured secret. Staff login
        // (DynamisIdentityProvider) fails closed on an empty-secret entry, so bootstrapping an assignment for it
        // would create one that can NEVER authenticate (finding 2 — a dead assignment).
        var secretlessEntry = new DynamisStaffAccount
        {
            Username = username,
            Secret = string.Empty,
            ExternalSubject = subject,
            DisplayName = "Controller",
        };

        await using var context = _fixture.CreateContext();
        var result = await NewService(context, secretlessEntry).BootstrapAsync(
            new BootstrapExerciseRequest
            {
                Hostname = host,
                ExerciseName = "UAT",
                Staff = new BootstrapStaffRequest { Username = username, Role = "controller" },
            },
            Secret);

        result.Outcome.Should().Be(BootstrapOutcome.Invalid,
            "an allowlist entry with no configured secret can never authenticate — bootstrapping it would create a dead assignment");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AnyAsync(e => e.Hostname == host))
            .Should().BeFalse("a validation failure writes nothing at all (validated before any write)");
        (await read.StaffUsers.AnyAsync(u => u.ExternalSubject == subject))
            .Should().BeFalse("no StaffUser (and therefore no dead StaffAssignment) is provisioned when the staff step fails validation");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ConcurrentFirstBootstrapSameHostname_BothSucceed_NoDuplicate()
    {
        var host = NewHostname();

        async Task<BootstrapResult> RunAsync()
        {
            await using var context = _fixture.CreateContext();
            return await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "UAT" }, Secret);
        }

        // Two simultaneous first-bootstraps of the SAME hostname (finding 3 — resolve→insert is not atomic).
        // Whether or not the Hostname unique-index race actually collides on a given run, the invariant must hold:
        // both calls succeed and exactly ONE exercise row exists — the loser recovers idempotently via re-resolve
        // instead of surfacing a DbUpdateException/500 and breaking the idempotent-by-hostname contract.
        var results = await Task.WhenAll(RunAsync(), RunAsync());

        results.Should().OnlyContain(r => r.Outcome == BootstrapOutcome.Provisioned,
            "a concurrent first-bootstrap of the same hostname must never 500 — the loser recovers idempotently");
        results[0].ExerciseId.Should().Be(results[1].ExerciseId,
            "both concurrent calls resolve to the SAME exercise (idempotent by hostname)");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.CountAsync(e => e.Hostname == host))
            .Should().Be(1, "no duplicate exercise row despite the concurrent first-bootstrap");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_SharedCredential_AuthenticatesViaSharedLogin_AndReRunDoesNotClobber()
    {
        var host = NewHostname();

        Guid exerciseId;
        string password;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    SharedCredential = new BootstrapSharedCredentialRequest { Enabled = true },
                },
                Secret);

            result.SharedCredential!.Created.Should().BeTrue();
            result.SharedCredential.Password.Should().NotBeNullOrEmpty("the one-time plaintext is returned exactly once");
            exerciseId = result.ExerciseId!.Value;
            password = result.SharedCredential.Password!;
        }

        // The returned plaintext authenticates via the shared read-only login funnel (POST /api/auth/shared).
        await using (var loginContext = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            var loginService = new SharedReadOnlyLoginService(loginContext, ScopeFor(exerciseId), _sharedHasher, new RecordingSessionIssuer());
            var login = await loginService.LoginAsync(new SharedReadOnlyLoginRequest { Password = password });
            login.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated,
                "the bootstrapped shared credential authenticates via the shared login using the one-time plaintext");
        }

        // A wrong password is rejected.
        await using (var loginContext = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            var loginService = new SharedReadOnlyLoginService(loginContext, ScopeFor(exerciseId), _sharedHasher, new RecordingSessionIssuer());
            var login = await loginService.LoginAsync(new SharedReadOnlyLoginRequest { Password = "definitely-not-the-password" });
            login.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Rejected, "a wrong shared password fails closed");
        }

        // An idempotent re-run does NOT create a second credential and returns no plaintext (never clobbered).
        await using (var context = _fixture.CreateContext())
        {
            var reRun = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    SharedCredential = new BootstrapSharedCredentialRequest { Enabled = true },
                },
                Secret);

            reRun.SharedCredential!.Created.Should().BeFalse("the exercise already had a shared credential — never re-created");
            reRun.SharedCredential.Password.Should().BeNull("no plaintext is returned when the credential is reused");
        }

        // Exactly one credential row, and the ORIGINAL password still authenticates (not clobbered).
        await using (var read = _fixture.CreateContext())
        {
            (await read.SharedCredentials.IgnoreQueryFilters().CountAsync(c => c.ExerciseId == exerciseId))
                .Should().Be(1, "no duplicate shared credential across re-runs (one per exercise)");
        }

        await using (var loginContext = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            var loginService = new SharedReadOnlyLoginService(loginContext, ScopeFor(exerciseId), _sharedHasher, new RecordingSessionIssuer());
            var login = await loginService.LoginAsync(new SharedReadOnlyLoginRequest { Password = password });
            login.Outcome.Should().Be(SharedReadOnlyLoginOutcome.Authenticated,
                "the ORIGINAL shared password still authenticates after an idempotent re-run (never clobbered)");
        }
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ParticipantAccount_SanitizesDisplayNameOnIngest()
    {
        var host = NewHostname();
        var username = $"pio-{Guid.NewGuid():N}";

        Guid exerciseId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ExerciseName = "UAT",
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "<script>alert(1)</script>Ada",
                        Role = "pio",
                    },
                },
                Secret);
            result.ParticipantAccount!.Created.Should().BeTrue();
            exerciseId = result.ExerciseId!.Value;
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var account = await read.Accounts.AsNoTracking().SingleAsync();
        account.DisplayName.Should().NotContain("<script>", "free text is stripped on ingest (NFR-004, the same account-import sanitizer)");
        account.DisplayName.Should().Contain("Ada", "the safe text survives the strip");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ExerciseName_IsSanitizedOnIngest()
    {
        var host = NewHostname();

        Guid exerciseId;
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest { Hostname = host, ExerciseName = "<b>Pilot</b>" }, Secret);
            exerciseId = result.ExerciseId!.Value;
        }

        await using var read = _fixture.CreateContext();
        var exercise = await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId);
        exercise.Name.Should().NotContain("<b>", "the exercise name is sanitized on ingest (NFR-004)");
        exercise.Name.Should().Contain("Pilot");
    }
}
