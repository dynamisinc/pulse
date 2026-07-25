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
using Pulse.WebApi.Features.Ops.Bootstrap;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Story login/07 (Tier-2) integration tests for the <see cref="BootstrapService"/> PERSONA-BINDING extension
/// against REAL SQL Server (Testcontainers, or a local SQL Server via <c>PULSE_TEST_SQL_CONNECTION</c>). Proves
/// AC1/AC3/AC4/AC5: the <c>bootstrap-exercise</c> participant sub-request binds a persona by handle (or id) onto
/// <see cref="Account.PersonaId"/>; a bound account's login carries the persona onto the session while an unbound
/// one still yields a null-persona session (the composer stays absent, COR-015); an unknown OR CROSS-EXERCISE
/// persona is rejected and writes nothing (COR-001); and the single XC-004 bootstrap event records the binding.
/// Fresh <see cref="Guid.NewGuid"/> ids + unique hostnames/handles per test keep them independent in the shared
/// database (no table truncation), matching the standing suite.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class BootstrapPersonaBindingTests
{
    private const string Secret = "s3cr3t-bootstrap-value";
    private const string Password = "participant-password-1";

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _sharedHasher = new();
    private readonly ParticipantPasswordHasher _participantHasher = new();

    public BootstrapPersonaBindingTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static IExerciseContext ScopeFor(Guid exerciseId) => new ExerciseContext { CurrentExerciseId = exerciseId };

    private static string NewHostname() => $"uat-{Guid.NewGuid():N}.example.com";

    private BootstrapService NewService(PulseDbContext context) =>
        new(
            context,
            Options.Create(new BootstrapOptions { Secret = Secret }),
            Options.Create(new DynamisIdentityProviderOptions { Accounts = new List<DynamisStaffAccount>() }),
            _sharedHasher,
            _participantHasher,
            new OpsPersonaResolver(context));

    /// <summary>
    /// Seeds a host-bound exercise with one persona directly (standing in for
    /// <c>POST /api/ops/bootstrap-exercise</c> + <c>POST /api/ops/seed-engine-content</c> having already run —
    /// the real ordering, since a brand-new exercise has no cast to bind to yet).
    /// </summary>
    private async Task<(Guid ExerciseId, Guid PersonaId, string Handle)> SeedExerciseWithPersonaAsync(string host)
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var handle = $"FairhavenWater{Guid.NewGuid():N}"[..24];

        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            Name = "Seeded",
            Hostname = host,
            TimeZone = "UTC",
            Status = "active",
        });
        seed.Personas.Add(new Persona
        {
            Id = personaId,
            ExerciseId = exerciseId,
            DisplayName = "Fairhaven Water Utility",
            Handle = handle,
            Kind = "org",
            Verified = true,
        });
        await seed.SaveChangesAsync();

        return (exerciseId, personaId, handle);
    }

    /// <summary>Runs the real participant-login funnel for the given exercise scope, capturing the issued session.</summary>
    private async Task<(ParticipantLoginResult Result, RecordingSessionIssuer Issuer)> LoginAsync(
        Guid exerciseId, string username)
    {
        var issuer = new RecordingSessionIssuer();
        await using var context = _fixture.CreateContext(ScopeFor(exerciseId));
        var login = new ParticipantLoginService(context, ScopeFor(exerciseId), issuer, _participantHasher);
        var result = await login.LoginAsync(new ParticipantLoginRequest { Username = username, Password = Password });
        return (result, issuer);
    }

    [RequiresDockerFact]
    public async Task Bootstrap_WithPersonaHandle_BindsPersonaToTheAccount()
    {
        var host = NewHostname();
        var (exerciseId, personaId, handle) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        Password = Password,
                        PersonaHandle = handle,
                    },
                },
                Secret);

            result.Outcome.Should().Be(BootstrapOutcome.Provisioned);
            result.ParticipantAccount!.Created.Should().BeTrue();
            result.ParticipantAccount.PersonaId.Should().Be(
                personaId, "the sub-request's persona handle resolved to the exercise's own persona (AC1)");
            result.ParticipantAccount.PersonaHandle.Should().Be(handle, "the resolved stored handle is echoed back");
            result.ParticipantAccount.PersonaBound.Should().BeTrue("this call wrote the binding");
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var account = await read.Accounts.AsNoTracking().SingleAsync(a => a.Username == username);
        account.PersonaId.Should().Be(personaId, "the binding is persisted onto Account.PersonaId (AC1)");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_WithPersonaId_BindsPersonaToTheAccount()
    {
        var host = NewHostname();
        var (exerciseId, personaId, _) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaId = personaId.ToString(),
                    },
                },
                Secret);

            result.ParticipantAccount!.PersonaId.Should().Be(personaId, "an explicit persona id also binds (AC1)");
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.Accounts.AsNoTracking().SingleAsync(a => a.Username == username)).PersonaId
            .Should().Be(personaId);
    }

    [RequiresDockerFact]
    public async Task Bootstrap_PersonaHandle_MatchesCaseInsensitivelyAndIgnoresLeadingAt()
    {
        var host = NewHostname();
        var (exerciseId, personaId, handle) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = "  @" + handle.ToUpperInvariant() + "  ",
                    },
                },
                Secret);

            result.ParticipantAccount!.PersonaId.Should().Be(
                personaId,
                "a handle is matched case-insensitively with a leading @ and surrounding whitespace normalized away, "
                + "so an operator copying '@FairhavenWater' out of the feed still resolves the seeded persona");
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.Accounts.AsNoTracking().SingleAsync(a => a.Username == username)).PersonaId
            .Should().Be(personaId);
    }

    [RequiresDockerFact]
    public async Task Bootstrap_BoundAccount_LoginPopulatesSessionPersonaId()
    {
        var host = NewHostname();
        var (exerciseId, personaId, handle) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        Password = Password,
                        PersonaHandle = handle,
                    },
                },
                Secret);
        }

        var (login, issuer) = await LoginAsync(exerciseId, username);

        login.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        issuer.LastRequest!.PersonaId.Should().Be(
            personaId,
            "ParticipantLoginService already carries Account.PersonaId onto the issued session, so binding at "
            + "provisioning time is all the frontend needs for canPost (AC3)");
        login.Issued!.Session.PersonaId.Should().Be(personaId, "the issued session carries the persona (AC3)");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_AccountWithNoBinding_LoginYieldsNullPersonaSession()
    {
        var host = NewHostname();
        var (exerciseId, _, _) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Observer",
                        Role = "participant",
                        Password = Password,
                    },
                },
                Secret);

            result.ParticipantAccount!.PersonaBound.Should().BeFalse("no binding was requested");
            result.ParticipantAccount.PersonaId.Should().BeNull();
        }

        var (login, issuer) = await LoginAsync(exerciseId, username);

        login.Outcome.Should().Be(ParticipantLoginOutcome.Authenticated);
        issuer.LastRequest!.PersonaId.Should().BeNull(
            "an account with no bound persona must still yield a NULL-persona session so the composer stays "
            + "absent (COR-015 observer style) — never a broken or enabled control (AC4)");
        login.Issued!.Session.PersonaId.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Bootstrap_CrossExercisePersonaHandle_IsRejected_AndWritesNothing()
    {
        // Exercise A: the bootstrap target. Exercise B: a DIFFERENT exercise whose persona the caller names.
        var hostA = NewHostname();
        var hostB = NewHostname();
        var (exerciseA, _, _) = await SeedExerciseWithPersonaAsync(hostA);
        var (exerciseB, personaB, handleB) = await SeedExerciseWithPersonaAsync(hostB);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = hostA,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = handleB,
                    },
                },
                Secret);

            result.Outcome.Should().Be(
                BootstrapOutcome.Invalid,
                "exercise B's persona handle must NEVER resolve while bootstrapping exercise A — the lookup carries "
                + "an explicit ExerciseId predicate, so a participant can never post as another exercise's persona "
                + "(COR-001, AC5)");
        }

        await using var read = _fixture.CreateContext();

        // The rejected call wrote NOTHING — not even the account it would otherwise have created.
        (await read.Accounts.IgnoreQueryFilters().AnyAsync(a => a.Username == username))
            .Should().BeFalse("a rejected cross-exercise binding must not partially provision the account");

        // The persona DOES exist — in exercise B. So the rejection above is the exercise predicate closing the
        // door, not an empty table.
        (await read.Personas.IgnoreQueryFilters().CountAsync(p => p.Id == personaB && p.ExerciseId == exerciseB))
            .Should().Be(1, "exercise B's persona physically exists — the rejection is the scope predicate, not a missing row");
        (await read.Personas.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseA && p.Handle == handleB))
            .Should().Be(0, "exercise A has no persona with that handle");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_CrossExercisePersonaId_IsRejected_AndWritesNothing()
    {
        var hostA = NewHostname();
        var hostB = NewHostname();
        await SeedExerciseWithPersonaAsync(hostA);
        var (_, personaB, _) = await SeedExerciseWithPersonaAsync(hostB);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = hostA,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaId = personaB.ToString(),
                    },
                },
                Secret);

            result.Outcome.Should().Be(
                BootstrapOutcome.Invalid,
                "a client-supplied persona ID from ANOTHER exercise is the exact cross-exercise vector COR-001 "
                + "forbids — the by-id lookup is confined by an explicit ExerciseId predicate (AC5)");
        }

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().AnyAsync(a => a.Username == username))
            .Should().BeFalse("a rejected cross-exercise binding writes nothing at all");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_UnknownPersonaHandle_IsRejected_AndWritesNothing()
    {
        var host = NewHostname();
        await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = $"no-such-persona-{Guid.NewGuid():N}",
                    },
                },
                Secret);

            result.Outcome.Should().Be(BootstrapOutcome.Invalid, "an unknown persona handle fails closed");
            result.Error.Should().NotBeNullOrEmpty("the operator is told the binding did not resolve");
        }

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().AnyAsync(a => a.Username == username))
            .Should().BeFalse("an unresolvable binding must never provision a half-configured account");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_PersonaIdAndHandleDisagree_IsRejected()
    {
        var host = NewHostname();
        var (exerciseId, personaId, _) = await SeedExerciseWithPersonaAsync(host);
        var otherHandle = $"other-{Guid.NewGuid():N}"[..20];

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Second Persona",
                Handle = otherHandle,
                Kind = "human",
                Verified = false,
            });
            await seed.SaveChangesAsync();
        }

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BootstrapAsync(
            new BootstrapExerciseRequest
            {
                Hostname = host,
                ParticipantAccount = new BootstrapParticipantAccountRequest
                {
                    Username = $"participant-{Guid.NewGuid():N}",
                    DisplayName = "Participant One",
                    Role = "participant",
                    PersonaId = personaId.ToString(),
                    PersonaHandle = otherHandle,
                },
            },
            Secret);

        result.Outcome.Should().Be(
            BootstrapOutcome.Invalid,
            "an id and a handle naming DIFFERENT personas is an operator error — never silently resolved to one of them");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_FreshExerciseWithPersonaHandle_IsRejected_BecauseTheCastIsNotSeededYet()
    {
        // Documents the real ordering: bootstrap-exercise CREATES the exercise, and personas only exist after
        // POST /api/ops/seed-engine-content. A binding on the very first bootstrap of a host therefore cannot
        // resolve — and fails closed rather than silently provisioning an unbound account.
        var host = NewHostname();

        await using var context = _fixture.CreateContext();
        var result = await NewService(context).BootstrapAsync(
            new BootstrapExerciseRequest
            {
                Hostname = host,
                ExerciseName = "Brand New",
                ParticipantAccount = new BootstrapParticipantAccountRequest
                {
                    Username = $"participant-{Guid.NewGuid():N}",
                    DisplayName = "Participant One",
                    Role = "participant",
                    PersonaHandle = "FairhavenWater",
                },
            },
            Secret);

        result.Outcome.Should().Be(BootstrapOutcome.Invalid, "a brand-new exercise has no persona cast to bind to yet");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AnyAsync(e => e.Hostname == host))
            .Should().BeFalse("the whole call is abandoned before SaveChanges — not even the exercise is created");
    }

    [RequiresDockerFact]
    public async Task Bootstrap_ReRun_FillsAnAbsentBinding_ButNeverClobbersADifferentOne()
    {
        var host = NewHostname();
        var (exerciseId, firstPersona, firstHandle) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        var secondPersona = Guid.NewGuid();
        var secondHandle = $"second-{Guid.NewGuid():N}"[..20];
        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = secondPersona,
                ExerciseId = exerciseId,
                DisplayName = "Second Persona",
                Handle = secondHandle,
                Kind = "human",
                Verified = false,
            });
            await seed.SaveChangesAsync();
        }

        // 1. Provision the account with NO binding (the state UAT's participant1 is in).
        await using (var context = _fixture.CreateContext())
        {
            await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                    },
                },
                Secret);
        }

        // 2. Re-run WITH a handle: the absent binding is filled in (completing provisioning, not clobbering).
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = firstHandle,
                    },
                },
                Secret);

            result.ParticipantAccount!.Created.Should().BeFalse("the account already existed — reused, never duplicated");
            result.ParticipantAccount.PersonaBound.Should().BeTrue("an ABSENT binding is filled in by a re-run");
            result.ParticipantAccount.PersonaId.Should().Be(firstPersona);
        }

        await using (var read = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            (await read.Accounts.AsNoTracking().SingleAsync(a => a.Username == username)).PersonaId
                .Should().Be(firstPersona, "the filled binding is persisted");
        }

        // 3. Re-run naming a DIFFERENT persona: bootstrap is non-clobbering, so the live binding survives.
        await using (var context = _fixture.CreateContext())
        {
            var result = await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = secondHandle,
                    },
                },
                Secret);

            result.ParticipantAccount!.PersonaBound.Should().BeFalse(
                "bootstrap never clobbers an existing binding — rebinding is bind-participant-persona's explicit job");
            result.ParticipantAccount.PersonaId.Should().Be(firstPersona, "the response reports the SURVIVING binding");
        }

        await using (var read = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            (await read.Accounts.AsNoTracking().SingleAsync(a => a.Username == username)).PersonaId
                .Should().Be(firstPersona, "the original binding is untouched by the re-run (non-clobbering)");
        }
    }

    [RequiresDockerFact]
    public async Task Bootstrap_WithPersonaBinding_RecordsItOnTheSingleBootstrappedTelemetryEvent()
    {
        var host = NewHostname();
        var (exerciseId, _, handle) = await SeedExerciseWithPersonaAsync(host);
        var username = $"participant-{Guid.NewGuid():N}";

        await using (var context = _fixture.CreateContext())
        {
            await NewService(context).BootstrapAsync(
                new BootstrapExerciseRequest
                {
                    Hostname = host,
                    ParticipantAccount = new BootstrapParticipantAccountRequest
                    {
                        Username = username,
                        DisplayName = "Participant One",
                        Role = "participant",
                        PersonaHandle = handle,
                    },
                },
                Secret);
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var events = await read.TelemetryEvents.AsNoTracking()
            .Where(e => e.EventType == "exercise.bootstrapped")
            .ToListAsync();

        events.Should().ContainSingle("still exactly ONE XC-004 event per successful bootstrap call (AC5)");
        events[0].Payload.Should().Contain(
            "\"participantPersonaBound\":true",
            "the binding is auditable on the bootstrap event's opaque payload (XC-004, AC5)");
    }
}
