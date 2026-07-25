namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story login/07 (Tier-2) integration tests for <see cref="ParticipantPersonaBindingService"/> — the guarded
/// <c>POST /api/ops/bind-participant-persona</c> ops path that binds/rebinds a persona onto an ALREADY-PROVISIONED
/// participant account (AC2/AC3/AC5) — against REAL SQL Server (Testcontainers, or a local SQL Server via
/// <c>PULSE_TEST_SQL_CONNECTION</c>). Proves: a handle binds and the account's next login carries the persona; a
/// rebind to the same persona is an idempotent no-op success; an unknown host/username/persona fails closed
/// (writing nothing); a CROSS-EXERCISE persona (by handle AND by id) can never be bound (COR-001); an
/// unconfigured/wrong secret is rejected before anything is read; and exactly one XC-004
/// <c>account.persona_bound</c> event is emitted per authorized call. Fresh <see cref="Guid.NewGuid"/> ids +
/// unique hostnames/handles per test keep them independent in the shared database (no table truncation).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantPersonaBindingServiceTests
{
    private const string Secret = "s3cr3t-bootstrap-value";
    private const string Password = "participant-password-1";

    private readonly MsSqlContainerFixture _fixture;
    private readonly ParticipantPasswordHasher _participantHasher = new();

    public ParticipantPersonaBindingServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private static string NewHostname() => $"uat-{Guid.NewGuid():N}.example.com";

    private static ParticipantPersonaBindingService NewService(PulseDbContext context, string? secret = Secret) =>
        new(context, Options.Create(new BootstrapOptions { Secret = secret ?? string.Empty }), new OpsPersonaResolver(context));

    /// <summary>
    /// Seeds a host-bound exercise plus one UNBOUND participant account and two personas — the exact state a live
    /// environment is in after <c>bootstrap-exercise</c> + <c>seed-engine-content</c> (the account can see the feed
    /// but cannot post, because <see cref="Account.PersonaId"/> is null).
    /// </summary>
    private async Task<SeededExercise> SeedAsync(string host)
    {
        var seeded = new SeededExercise(
            ExerciseId: Guid.NewGuid(),
            Hostname: host,
            AccountId: Guid.NewGuid(),
            Username: $"participant-{Guid.NewGuid():N}",
            FirstPersonaId: Guid.NewGuid(),
            FirstHandle: $"FulcoEM{Guid.NewGuid():N}"[..18],
            SecondPersonaId: Guid.NewGuid(),
            SecondHandle: $"mvega{Guid.NewGuid():N}"[..18]);

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(new Exercise
        {
            Id = seeded.ExerciseId,
            Name = "Seeded",
            Hostname = host,
            TimeZone = "UTC",
            Status = "active",
        });
        context.Personas.Add(new Persona
        {
            Id = seeded.FirstPersonaId,
            ExerciseId = seeded.ExerciseId,
            DisplayName = "Fulton County EM",
            Handle = seeded.FirstHandle,
            Kind = "org",
            Verified = true,
        });
        context.Personas.Add(new Persona
        {
            Id = seeded.SecondPersonaId,
            ExerciseId = seeded.ExerciseId,
            DisplayName = "Marisol Vega",
            Handle = seeded.SecondHandle,
            Kind = "human",
            Verified = false,
        });
        context.Accounts.Add(new Account
        {
            Id = seeded.AccountId,
            ExerciseId = seeded.ExerciseId,
            Username = seeded.Username,
            DisplayName = "Participant One",
            Role = "participant",
            PersonaId = null,
            CredentialHash = _participantHasher.Hash(Password),
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await context.SaveChangesAsync();

        return seeded;
    }

    [RequiresDockerFact]
    public async Task Bind_ByHandle_BindsThePersona_AndTheNextLoginCarriesIt()
    {
        var seeded = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);

            result.Outcome.Should().Be(ParticipantPersonaBindingOutcome.Bound, "the handle resolves within the exercise (AC2)");
            result.PersonaId.Should().Be(seeded.FirstPersonaId);
            result.PersonaHandle.Should().Be(seeded.FirstHandle);
            result.AccountId.Should().Be(seeded.AccountId);
            result.PreviousPersonaId.Should().BeNull("the account was unbound before this call");
            result.Changed.Should().BeTrue();
        }

        await using (var read = _fixture.CreateContext(ScopeFor(seeded.ExerciseId)))
        {
            (await read.Accounts.AsNoTracking().SingleAsync(a => a.Id == seeded.AccountId)).PersonaId
                .Should().Be(seeded.FirstPersonaId, "the binding is persisted onto Account.PersonaId (AC2)");
        }

        // AC3: the binding is what makes Session.personaId non-null — no login code changed.
        var issuer = new RecordingSessionIssuer();
        await using (var loginContext = _fixture.CreateContext(ScopeFor(seeded.ExerciseId)))
        {
            var login = new ParticipantLoginService(
                loginContext, ScopeFor(seeded.ExerciseId), issuer, _participantHasher);
            var result = await login.LoginAsync(
                new ParticipantLoginRequest { Username = seeded.Username, Password = Password });

            result.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
            result.Issued!.Session.PersonaId.Should().Be(
                seeded.FirstPersonaId,
                "an ops rebind is immediately visible to the next login — this is what unblocks the composer (AC3)");
        }
    }

    [RequiresDockerFact]
    public async Task Bind_ByHandle_MatchesCaseInsensitivelyAndIgnoresLeadingAt()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = seeded.Hostname,
                Username = seeded.Username,
                PersonaHandle = " @" + seeded.FirstHandle.ToUpperInvariant(),
            },
            Secret);

        result.Outcome.Should().Be(ParticipantPersonaBindingOutcome.Bound);
        result.PersonaId.Should().Be(
            seeded.FirstPersonaId,
            "a leading @ is normalized away and matching is case-insensitive, matching how the cast seeder keys handles");
    }

    [RequiresDockerFact]
    public async Task Bind_ById_BindsThePersona()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = seeded.Hostname,
                Username = seeded.Username,
                PersonaId = seeded.SecondPersonaId.ToString(),
            },
            Secret);

        result.Outcome.Should().Be(ParticipantPersonaBindingOutcome.Bound, "an explicit persona id is accepted too (AC2)");
        result.PersonaId.Should().Be(seeded.SecondPersonaId);
    }

    [RequiresDockerFact]
    public async Task Bind_SamePersonaTwice_IsAnIdempotentNoOpSuccess()
    {
        var seeded = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            var first = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);
            first.Changed.Should().BeTrue("the first call actually bound the persona");
        }

        await using (var context = _fixture.CreateContext())
        {
            var second = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);

            second.Outcome.Should().Be(
                ParticipantPersonaBindingOutcome.Bound,
                "rebinding to the SAME persona is a no-op SUCCESS, not an error — the endpoint is safely re-runnable");
            second.Changed.Should().BeFalse("nothing actually changed");
            second.PersonaId.Should().Be(seeded.FirstPersonaId);
        }

        await using var read = _fixture.CreateContext(ScopeFor(seeded.ExerciseId));
        (await read.Accounts.AsNoTracking().SingleAsync(a => a.Id == seeded.AccountId)).PersonaId
            .Should().Be(seeded.FirstPersonaId, "the binding is unchanged after the idempotent re-run");
    }

    [RequiresDockerFact]
    public async Task Bind_ToADifferentPersona_RebindsAndReportsThePrevious()
    {
        var seeded = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);
        }

        await using (var context = _fixture.CreateContext())
        {
            var rebind = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.SecondHandle,
                },
                Secret);

            rebind.Outcome.Should().Be(ParticipantPersonaBindingOutcome.Bound);
            rebind.Changed.Should().BeTrue();
            rebind.PersonaId.Should().Be(seeded.SecondPersonaId, "this endpoint REBINDS (unlike non-clobbering bootstrap)");
            rebind.PreviousPersonaId.Should().Be(seeded.FirstPersonaId, "the replaced binding is reported for the audit trail");
        }

        await using var read = _fixture.CreateContext(ScopeFor(seeded.ExerciseId));
        (await read.Accounts.AsNoTracking().SingleAsync(a => a.Id == seeded.AccountId)).PersonaId
            .Should().Be(seeded.SecondPersonaId);
    }

    [RequiresDockerFact]
    public async Task Bind_CrossExercisePersonaHandle_FailsClosed_AndLeavesTheAccountUnbound()
    {
        var exerciseA = await SeedAsync(NewHostname());
        var exerciseB = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = exerciseA.Hostname,
                    Username = exerciseA.Username,
                    PersonaHandle = exerciseB.FirstHandle,
                },
                Secret);

            result.Outcome.Should().Be(
                ParticipantPersonaBindingOutcome.PersonaNotFound,
                "exercise B's persona handle must be indistinguishable from a nonexistent one when binding in "
                + "exercise A — a participant can never post as another exercise's persona (COR-001, AC5)");
        }

        await using var read = _fixture.CreateContext();

        (await read.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == exerciseA.AccountId)).PersonaId
            .Should().BeNull("the rejected cross-exercise bind wrote nothing — the account is still unbound");

        // The persona DOES exist (in exercise B), so the rejection is the exercise predicate closing the door.
        (await read.Personas.IgnoreQueryFilters()
                .CountAsync(p => p.Id == exerciseB.FirstPersonaId && p.ExerciseId == exerciseB.ExerciseId))
            .Should().Be(1, "exercise B's persona physically exists — the 404 is the scope predicate, not a missing row");
        (await read.Personas.IgnoreQueryFilters()
                .CountAsync(p => p.ExerciseId == exerciseA.ExerciseId && p.Handle == exerciseB.FirstHandle))
            .Should().Be(0, "exercise A has no persona with that handle");
        (await read.TelemetryEvents.IgnoreQueryFilters()
                .CountAsync(e => e.EventType == "account.persona_bound" && e.ExerciseId == exerciseA.ExerciseId))
            .Should().Be(0, "a rejected bind emits no event because no binding happened");
    }

    [RequiresDockerFact]
    public async Task Bind_CrossExercisePersonaId_FailsClosed_AndLeavesTheAccountUnbound()
    {
        var exerciseA = await SeedAsync(NewHostname());
        var exerciseB = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = exerciseA.Hostname,
                    Username = exerciseA.Username,
                    PersonaId = exerciseB.FirstPersonaId.ToString(),
                },
                Secret);

            result.Outcome.Should().Be(
                ParticipantPersonaBindingOutcome.PersonaNotFound,
                "a client-supplied persona ID from ANOTHER exercise is the exact cross-exercise leak vector COR-001 "
                + "forbids — the by-id lookup carries an explicit ExerciseId predicate (AC5)");
        }

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == exerciseA.AccountId)).PersonaId
            .Should().BeNull("the account is still unbound after the rejected cross-exercise id bind");
    }

    [RequiresDockerFact]
    public async Task Bind_UnknownPersonaHandle_FailsClosed()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = seeded.Hostname,
                Username = seeded.Username,
                PersonaHandle = $"no-such-persona-{Guid.NewGuid():N}",
            },
            Secret);

        result.Outcome.Should().Be(
            ParticipantPersonaBindingOutcome.PersonaNotFound,
            "an unknown persona handle fails closed (404) — identical to the cross-exercise case, no existence hint");
    }

    [RequiresDockerFact]
    public async Task Bind_UnknownUsername_FailsClosed_WithoutCreatingAnAccount()
    {
        var seeded = await SeedAsync(NewHostname());
        var unknown = $"nobody-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = unknown,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);

            result.Outcome.Should().Be(
                ParticipantPersonaBindingOutcome.AccountNotFound,
                "this endpoint binds an EXISTING account only — an unknown handle is a fail-closed 404, never a create");
        }

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().AnyAsync(a => a.Username == unknown))
            .Should().BeFalse("no account is ever created by the binding endpoint");
    }

    [RequiresDockerFact]
    public async Task Bind_CrossExerciseUsername_FailsClosed()
    {
        // Exercise B's participant handle must not resolve when binding on exercise A's host, even though the row
        // exists — the account lookup is confined by an explicit ExerciseId predicate (COR-001).
        var exerciseA = await SeedAsync(NewHostname());
        var exerciseB = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = exerciseA.Hostname,
                Username = exerciseB.Username,
                PersonaHandle = exerciseA.FirstHandle,
            },
            Secret);

        result.Outcome.Should().Be(
            ParticipantPersonaBindingOutcome.AccountNotFound,
            "another exercise's account is invisible to a bind on this host — the endpoint can never reach across exercises");

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == exerciseB.AccountId)).PersonaId
            .Should().BeNull("exercise B's account was not touched by a call made against exercise A's host");
    }

    [RequiresDockerFact]
    public async Task Bind_UnknownHostname_FailsClosed_WithoutCreatingAnExercise()
    {
        var host = NewHostname();

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = host,
                    Username = "participant1",
                    PersonaHandle = "FulcoEM",
                },
                Secret);

            result.Outcome.Should().Be(
                ParticipantPersonaBindingOutcome.HostNotFound,
                "a host that resolves to no exercise is a 404 — this endpoint never creates an exercise");
        }

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AnyAsync(e => e.Hostname == host)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Bind_WrongSecret_IsRejected_AndWritesNothing()
    {
        var seeded = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                presentedSecret: "not-the-secret");

            result.Outcome.Should().Be(ParticipantPersonaBindingOutcome.Rejected, "a wrong secret fails closed (404)");
        }

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == seeded.AccountId)).PersonaId
            .Should().BeNull("a rejected call must write nothing at all");
    }

    [RequiresDockerFact]
    public async Task Bind_UnconfiguredSecret_IsRejected_RegardlessOfPresentedValue()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context, secret: string.Empty).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = seeded.Hostname,
                Username = seeded.Username,
                PersonaHandle = seeded.FirstHandle,
            },
            presentedSecret: "anything");

        result.Outcome.Should().Be(
            ParticipantPersonaBindingOutcome.Rejected,
            "an unconfigured secret disables the endpoint entirely (fail closed, NFR-009)");
    }

    [RequiresDockerFact]
    public async Task Bind_NeitherHandleNorId_IsInvalid()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest { Hostname = seeded.Hostname, Username = seeded.Username },
            Secret);

        result.Outcome.Should().Be(
            ParticipantPersonaBindingOutcome.Invalid,
            "a bind request with no persona identifier is a caller error (400), never a silent no-op");
    }

    [RequiresDockerFact]
    public async Task Bind_PersonaIdAndHandleDisagree_IsInvalid()
    {
        var seeded = await SeedAsync(NewHostname());

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BindPersonaAsync(
            new BindParticipantPersonaRequest
            {
                Hostname = seeded.Hostname,
                Username = seeded.Username,
                PersonaId = seeded.FirstPersonaId.ToString(),
                PersonaHandle = seeded.SecondHandle,
            },
            Secret);

        result.Outcome.Should().Be(
            ParticipantPersonaBindingOutcome.Invalid,
            "an id and a handle naming DIFFERENT personas is rejected, never silently resolved to one of them");
    }

    [RequiresDockerFact]
    public async Task Bind_Success_EmitsExactlyOnePersonaBoundTelemetryEvent()
    {
        var seeded = await SeedAsync(NewHostname());

        await using (var context = _fixture.CreateContext())
        {
            await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);
        }

        await using var read = _fixture.CreateContext(ScopeFor(seeded.ExerciseId));
        var events = await read.TelemetryEvents.AsNoTracking()
            .Where(e => e.EventType == "account.persona_bound")
            .ToListAsync();

        events.Should().ContainSingle("exactly one XC-004 account.persona_bound event per successful bind (AC5)");
        var telemetry = events[0];
        telemetry.ExerciseId.Should().Be(seeded.ExerciseId, "the audit event is scoped to the bound account's exercise");
        telemetry.Channel.Should().Be("system");
        telemetry.Actor.Kind.Should().Be("system");
        telemetry.Actor.ActingHumanId.Should().Be("bind-participant-persona", "the fixed ops actor id");
        telemetry.Target.Should().NotBeNull();
        telemetry.Target!.EntityType.Should().Be("account");
        Guid.Parse(telemetry.Target.EntityId!).Should().Be(seeded.AccountId, "the target points at the bound account");
        telemetry.Payload.Should().Contain(seeded.FirstPersonaId.ToString(), "the payload records the bound persona");
        telemetry.Payload.Should().Contain("\"changed\":true");
    }

    [RequiresDockerFact]
    public async Task Bind_IdempotentNoOp_IsStillAudited()
    {
        var seeded = await SeedAsync(NewHostname());

        for (var attempt = 0; attempt < 2; attempt++)
        {
            await using var context = _fixture.CreateContext();
            await NewService(context).BindPersonaAsync(
                new BindParticipantPersonaRequest
                {
                    Hostname = seeded.Hostname,
                    Username = seeded.Username,
                    PersonaHandle = seeded.FirstHandle,
                },
                Secret);
        }

        await using var read = _fixture.CreateContext(ScopeFor(seeded.ExerciseId));
        var events = await read.TelemetryEvents.AsNoTracking()
            .Where(e => e.EventType == "account.persona_bound")
            .ToListAsync();

        events.Should().HaveCount(
            2, "the no-op re-run is still an operator action on a credential-adjacent surface, so it is audited too");
        events.Should().ContainSingle(e => e.Payload!.Contains("\"changed\":false"),
            "the second event records that nothing actually changed");
    }

    /// <summary>The seeded fixture data for one exercise: its host, an unbound participant account, and two personas.</summary>
    private sealed record SeededExercise(
        Guid ExerciseId,
        string Hostname,
        Guid AccountId,
        string Username,
        Guid FirstPersonaId,
        string FirstHandle,
        Guid SecondPersonaId,
        string SecondHandle);
}
