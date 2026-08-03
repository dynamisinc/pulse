namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/02-persistence-efcore</c> (#269) AC4: "Given a clean database, when the initial
/// EF Core migration is applied, then it succeeds against an Azure-SQL-compatible target ... and
/// <c>dotnet test</c> includes a test that applies the migration and round-trips one row per entity."
/// Runs against a REAL SQL Server (Testcontainers), not an in-memory provider stand-in, so it actually
/// proves the migration + column types/collation apply, not just that the C# model compiles.
/// </summary>
/// <remarks>
/// Every test is <see cref="RequiresDockerFactAttribute"/>, not a plain <c>[Fact]</c> — Gate-1 W-001: on a
/// Docker-less machine these report a real <c>Skipped</c> outcome (decided at discovery time), never a
/// silent <c>Passed</c>. Where Docker is present (here, CI), they run for real.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class MigrationRoundTripTests
{
    private readonly MsSqlContainerFixture _fixture;

    public MigrationRoundTripTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Exercise_RoundTrips()
    {
        var id = Guid.NewGuid();
        var exercise = new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = id, Name = $"Round Trip Exercise {id}" };

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(exercise);
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.Id.Should().Be(exercise.Id);
        reloaded.Name.Should().Be(exercise.Name);
    }

    [RequiresDockerFact]
    public async Task PersonaTemplate_RoundTrips()
    {
        var id = Guid.NewGuid();
        var template = new PersonaTemplate
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            DisplayName = "Reporter Template",
            Handle = $"@template_{id:N}",
        };

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.PersonaTemplates.Add(template);
            await writeContext.SaveChangesAsync();
        }

        // exercise-isolation/11: PersonaTemplate is IOrganizationScoped, so the read must be made under the
        // owning CUSTOMER tenant. An unscoped context would (correctly) see zero rows — that fail-closed
        // behaviour is proved in OrganizationIsolationTests; here we are round-tripping the columns.
        await using var readContext = _fixture.CreateContextForOrganization(Organization.DefaultOrganizationId);
        var reloaded = await readContext.PersonaTemplates.SingleAsync(p => p.Id == id);

        reloaded.Id.Should().Be(template.Id);
        reloaded.OrganizationId.Should().Be(
            Organization.DefaultOrganizationId, "the tenant column must round-trip like every other column");
        reloaded.DisplayName.Should().Be(template.DisplayName);
        reloaded.Handle.Should().Be(template.Handle);
    }

    [RequiresDockerFact]
    public async Task Persona_RoundTrips_WithRealExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var templateId = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Persona Round Trip Exercise" });
            writeContext.PersonaTemplates.Add(new PersonaTemplate
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = templateId,
                DisplayName = "Anchor Template",
                Handle = $"@anchor_{templateId:N}",
            });
            writeContext.Personas.Add(new Persona
            {
                Id = personaId,
                ExerciseId = exerciseId,
                DisplayName = "Jordan Ferry",
                Handle = $"@jferry_{personaId:N}",
                PersonaTemplateId = templateId,
                Kind = "human",
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: this is a persistence round-trip, not an isolation test — read back the row
        // regardless of the (unscoped) read context's now-active exercise query filter.
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == personaId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.DisplayName.Should().Be("Jordan Ferry");
        reloaded.Handle.Should().Be($"@jferry_{personaId:N}");
        reloaded.PersonaTemplateId.Should().Be(templateId);
    }

    [RequiresDockerFact]
    public async Task Post_RoundTrips_WithRealExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var createdScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 30, 0, TimeSpan.FromHours(-5));
        var createdWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Post Round Trip Exercise" });
            writeContext.Posts.Add(new Post
            {
                Id = postId,
                ExerciseId = exerciseId,
                AuthorPersonaId = authorPersonaId,
                Body = "Reports of flooding downtown; avoid Elm Street.",
                CreatedScenarioTime = createdScenarioTime,
                Origin = "participant",
                ActingHumanId = "human-test",
                CreatedWallClock = createdWallClock,
                RumorRef = null,
                MutationOf = null,
                DeletedAt = null,
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: persistence round-trip, not an isolation test (see Persona_RoundTrips).
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.AuthorPersonaId.Should().Be(authorPersonaId);
        reloaded.Body.Should().Be("Reports of flooding downtown; avoid Elm Street.");
        reloaded.CreatedScenarioTime.Should().Be(createdScenarioTime);
        // Provenance columns round-trip too (staff/telemetry-only; NOT NULL Origin/ActingHumanId/CreatedWallClock, NULL InjectId).
        reloaded.Origin.Should().Be("participant");
        reloaded.ActingHumanId.Should().Be("human-test");
        reloaded.CreatedWallClock.Should().Be(createdWallClock);
        reloaded.InjectId.Should().BeNull();
        reloaded.RumorRef.Should().BeNull();
        reloaded.MutationOf.Should().BeNull();
        reloaded.DeletedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task TelemetryEvent_RoundTrips_WithRealExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var eventId = Guid.NewGuid().ToString();
        var wallClockTime = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var emittedAt = wallClockTime.AddSeconds(1);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Telemetry Round Trip Exercise" });
            writeContext.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = eventId,
                SchemaVersion = "v0",
                ExerciseId = exerciseId,
                EventType = "post",
                Channel = "social",
                Actor = new TelemetryActor
                {
                    Kind = "participant",
                    ParticipantId = "participant-42",
                    PersonaId = null,
                    ActingHumanId = null,
                    SessionId = "session-abc",
                    Role = "evaluator",
                },
                Origin = "participant",
                InjectId = null,
                CorrelationId = "corr-1",
                CausationId = "cause-1",
                Sequence = 7,
                Source = "social-feed",
                WallClockTime = wallClockTime,
                ScenarioTime = scenarioTime,
                TimeZone = "America/Chicago",
                Target = new TelemetryTarget
                {
                    EntityType = "post",
                    EntityId = "post-99",
                },
                Payload = "{\"text\":\"hello\"}",
                EmittedAt = emittedAt,
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: persistence round-trip, not an isolation test (see Persona_RoundTrips).
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        reloaded.EventId.Should().Be(eventId);
        reloaded.SchemaVersion.Should().Be("v0");
        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.EventType.Should().Be("post");
        reloaded.Channel.Should().Be("social");
        reloaded.Actor.Kind.Should().Be("participant");
        reloaded.Actor.ParticipantId.Should().Be("participant-42");
        reloaded.Actor.PersonaId.Should().BeNull();
        reloaded.Actor.ActingHumanId.Should().BeNull();
        reloaded.Actor.SessionId.Should().Be("session-abc");
        reloaded.Actor.Role.Should().Be("evaluator");
        reloaded.Origin.Should().Be("participant");
        reloaded.InjectId.Should().BeNull();
        reloaded.CorrelationId.Should().Be("corr-1");
        reloaded.CausationId.Should().Be("cause-1");
        reloaded.Sequence.Should().Be(7);
        reloaded.Source.Should().Be("social-feed");
        reloaded.WallClockTime.Should().Be(wallClockTime);
        reloaded.ScenarioTime.Should().Be(scenarioTime);
        reloaded.TimeZone.Should().Be("America/Chicago");
        reloaded.Target.Should().NotBeNull();
        reloaded.Target!.EntityType.Should().Be("post");
        reloaded.Target!.EntityId.Should().Be("post-99");
        reloaded.Payload.Should().Be("{\"text\":\"hello\"}");
        reloaded.EmittedAt.Should().Be(emittedAt);
    }

    /// <summary>
    /// Gate-1 review S-001: proves the OPTIONAL owned <c>Target</c> round-trips as a real <c>null</c> —
    /// not an empty/all-null-fields owned instance — when the event has no target. Read back through a
    /// separate context from the one that wrote it, same as every other round-trip test here, so this
    /// proves the actual mapping (EF's owned-type-is-null-when-every-column-is-null convention), not just
    /// an in-memory default.
    /// </summary>
    [RequiresDockerFact]
    public async Task TelemetryEvent_RoundTrips_WithNullTarget()
    {
        var exerciseId = Guid.NewGuid();
        var eventId = Guid.NewGuid().ToString();
        var wallClockTime = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Null Target Round Trip Exercise" });
            writeContext.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = eventId,
                SchemaVersion = "v0",
                ExerciseId = exerciseId,
                EventType = "login",
                Channel = "system",
                Actor = new TelemetryActor { Kind = "system" },
                WallClockTime = wallClockTime,
                ScenarioTime = scenarioTime,
                TimeZone = "America/Chicago",
                Target = null,
                EmittedAt = wallClockTime,
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: persistence round-trip, not an isolation test (see Persona_RoundTrips).
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.TelemetryEvents.IgnoreQueryFilters().SingleAsync(e => e.EventId == eventId);

        reloaded.Target.Should().BeNull(
            "an event with no target must round-trip as a real null, not an owned instance with all-null sub-fields");
    }

    // --- B2 Wave-0 additions: IdentitySchemaSeamFreeze (new columns + new tables) --------------------------
    //
    // NOTE: MsSqlContainerFixture.InitializeAsync already runs Database.MigrateAsync() ONCE per collection,
    // applying EVERY migration (including IdentitySchemaSeamFreeze) before any test in this collection runs,
    // and it does NOT swallow a failure (Gate-1 W-001) — so every [RequiresDockerFact] test that ran at all is
    // already implicit proof "the full migration chain applies cleanly against a real SQL Server". These
    // tests add the value the generic proof does NOT cover: that each NEW table's columns actually round-trip
    // with the right types/nullability (mirroring the per-entity round-trip tests above), not just that the
    // migration executed without throwing.

    [RequiresDockerFact]
    public async Task Exercise_RoundTrips_WithB2IdentitySeamFreezeColumns()
    {
        var id = Guid.NewGuid();
        var currentScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = id,
            Name = $"Identity Seam Freeze Exercise {id}",
            Hostname = $"atl-cie-{id:N}.example.com",
            BrandedDomain = $"branded-{id:N}.example.org",
            TimeZone = "America/New_York",
            Status = "active",
            CurrentScenarioTime = currentScenarioTime,
        };

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(exercise);
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.Hostname.Should().Be(exercise.Hostname);
        reloaded.BrandedDomain.Should().Be(exercise.BrandedDomain);
        reloaded.TimeZone.Should().Be("America/New_York");
        reloaded.Status.Should().Be(
            "active",
            "the legacy vocabulary is still storable through the COR-032 transition — there is no CHECK constraint");
        reloaded.CurrentScenarioTime.Should().Be(currentScenarioTime);
    }

    [RequiresDockerFact]
    public async Task Exercise_RoundTrips_WithDefaultTimeZoneAndStatus_WhenNotSet()
    {
        var id = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = id, Name = "Defaulted Exercise" });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.TimeZone.Should().Be("UTC", "the C# default applies when TimeZone is left unset on the entity");
        reloaded.Status.Should().Be(
            "build",
            "exercise-configuration story 01a moved the default to the COR-032 vocabulary — an exercise created " +
            "and never configured is still in staff-only content development (Build), not the legacy 'scheduled'");
        reloaded.Hostname.Should().BeNull();
        reloaded.BrandedDomain.Should().BeNull();
        reloaded.CurrentScenarioTime.Should().BeNull();
    }

    // --- Exercise-configuration story 01a: the settings / chrome / watermark / practice columns -------------

    /// <summary>
    /// Story exercise-configuration/01a (AC1, AC-watermark): every column the feature's ONE migration adds
    /// actually round-trips through real SQL Server with the right type and nullability — the COR-030
    /// settings, the COR-031 chrome config, the NFR-008 watermark switch and the COR-033 practice flag. If
    /// one of these is wrong, stories 01b/02/04 discover it with no migration of their own to fix it.
    /// </summary>
    [RequiresDockerFact]
    public async Task Exercise_RoundTrips_WithExerciseConfigurationColumns()
    {
        var id = Guid.NewGuid();
        var scheduledStart = new DateTimeOffset(2033, 6, 14, 8, 0, 0, TimeSpan.FromHours(-5));
        var scheduledEnd = scheduledStart.AddDays(2);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = id,
                Name = "Configured Exercise",
                Status = "staged",
                WorldName = "Fairhaven County",
                Locale = "en-US",
                ScheduledStartAt = scheduledStart,
                ScheduledEndAt = scheduledEnd,
                EnabledChannels = "social,news",
                BrandName = "Fairhaven Exercise Network",
                BrandPrimary = "#2b5f75",
                BrandAccent = "#d97706",
                BrandSurface = "#ffffff",
                BrandOnSurface = "#1c1c1c",
                OutletNamesJson = """{"news":"Newsline 7","weather":"Fairhaven Weather Service"}""",
                ComplianceChromeEnabled = false,
                ChromeTopText = "UNCLASSIFIED // EXERCISE",
                ChromeTopFg = "#eaf5e6",
                ChromeTopBg = "#2e6b2e",
                ChromeBottomText = "SIMULATED INFORMATION SPACE",
                ChromeBottomFg = "#eaf5e6",
                ChromeBottomBg = "#2e6b2e",
                WatermarkEnabled = true,
                IsPracticeMode = true,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.Status.Should().Be("staged", "the COR-032 vocabulary stores verbatim, no mapping");
        reloaded.WorldName.Should().Be("Fairhaven County");
        reloaded.Locale.Should().Be("en-US");
        reloaded.ScheduledStartAt.Should().Be(scheduledStart);
        reloaded.ScheduledEndAt.Should().Be(scheduledEnd);
        reloaded.EnabledChannels.Should().Be("social,news");
        reloaded.BrandName.Should().Be("Fairhaven Exercise Network");
        reloaded.BrandPrimary.Should().Be("#2b5f75");
        reloaded.BrandAccent.Should().Be("#d97706");
        reloaded.BrandSurface.Should().Be("#ffffff");
        reloaded.BrandOnSurface.Should().Be("#1c1c1c");
        reloaded.OutletNamesJson.Should().Be("""{"news":"Newsline 7","weather":"Fairhaven Weather Service"}""");
        reloaded.ComplianceChromeEnabled.Should().BeFalse("chrome-off is a legal stored state (D7-008)");
        reloaded.ChromeTopText.Should().Be("UNCLASSIFIED // EXERCISE");
        reloaded.ChromeTopFg.Should().Be("#eaf5e6");
        reloaded.ChromeTopBg.Should().Be("#2e6b2e");
        reloaded.ChromeBottomText.Should().Be("SIMULATED INFORMATION SPACE");
        reloaded.ChromeBottomFg.Should().Be("#eaf5e6");
        reloaded.ChromeBottomBg.Should().Be("#2e6b2e");
        reloaded.WatermarkEnabled.Should().BeTrue(
            "the NFR-008 watermark switch is real per-exercise state story 02's guard reads, not a constant");
        reloaded.IsPracticeMode.Should().BeTrue();
    }

    /// <summary>
    /// Story exercise-configuration/01a: an exercise nobody has configured carries NULL for every settings
    /// column — which is what lets story 01b's projection keep serving the shipped Phase-1 constants — and
    /// the three switches carry their SAFE defaults (chrome ON + watermark ON, so NFR-008's "never both off"
    /// holds by construction; practice OFF, so a never-flagged exercise is real conduct).
    /// </summary>
    [RequiresDockerFact]
    public async Task Exercise_RoundTrips_WithUnconfiguredSettings_CarryingSafeDefaults()
    {
        var id = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = id, Name = "Unconfigured Exercise" });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Exercises.SingleAsync(e => e.Id == id);

        reloaded.WorldName.Should().BeNull();
        reloaded.Locale.Should().BeNull();
        reloaded.ScheduledStartAt.Should().BeNull();
        reloaded.ScheduledEndAt.Should().BeNull();
        reloaded.EnabledChannels.Should().BeNull();
        reloaded.BrandName.Should().BeNull();
        reloaded.BrandPrimary.Should().BeNull();
        reloaded.BrandAccent.Should().BeNull();
        reloaded.BrandSurface.Should().BeNull();
        reloaded.BrandOnSurface.Should().BeNull();
        reloaded.OutletNamesJson.Should().BeNull();
        reloaded.ChromeTopText.Should().BeNull();
        reloaded.ChromeTopFg.Should().BeNull();
        reloaded.ChromeTopBg.Should().BeNull();
        reloaded.ChromeBottomText.Should().BeNull();
        reloaded.ChromeBottomFg.Should().BeNull();
        reloaded.ChromeBottomBg.Should().BeNull();

        reloaded.ComplianceChromeEnabled.Should().BeTrue("compliance chrome defaults ON (COR-031/NFR-008)");
        reloaded.WatermarkEnabled.Should().BeTrue("the in-content watermark defaults ON (NFR-008)");
        reloaded.IsPracticeMode.Should().BeFalse("an exercise that has never been flagged is real conduct (COR-033)");
    }

    // --- exercise-lifecycle-admin story 02: the one column that feature's migration adds ------------------

    /// <summary>
    /// Story exercise-lifecycle-admin/02 (COR-075) AC2: <c>Exercise.CreatedAt</c> round-trips, and is NULL for
    /// a row nobody stamped. The nullability is the point, not an oversight — the creation instant of every
    /// exercise that predates the column is genuinely unknown, and a backfilled migration-run-time would be a
    /// fabricated date the org-scoped list would render to a staff human as fact.
    /// </summary>
    [RequiresDockerFact]
    public async Task Exercise_RoundTrips_WithTheOrgAdminCreatedAtColumn()
    {
        var stampedId = Guid.NewGuid();
        var unstampedId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = stampedId,
                Name = $"Created-At Exercise {stampedId}",
                CreatedAt = createdAt,
            });
            writeContext.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = unstampedId,
                Name = $"Unstamped Exercise {unstampedId}",
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();

        var stamped = await readContext.Exercises.SingleAsync(e => e.Id == stampedId);
        stamped.CreatedAt.Should().Be(createdAt, "the column must round-trip as a real datetimeoffset");

        var unstamped = await readContext.Exercises.SingleAsync(e => e.Id == unstampedId);
        unstamped.CreatedAt.Should().BeNull(
            "the migration adds the column NULLABLE with no default and no backfill, so an unstamped row "
            + "reads as 'unknown' rather than as a plausible-looking date nobody chose");
    }

    [RequiresDockerFact]
    public async Task Account_RoundTrips_WithRealExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var lastLoginAt = createdAt.AddDays(1);
        var lockedOutUntil = createdAt.AddMinutes(15);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Account Round Trip Exercise" });
            writeContext.Accounts.Add(new Account
            {
                Id = accountId,
                ExerciseId = exerciseId,
                Username = "jferry",
                DisplayName = "Jordan Ferry",
                Role = "pio",
                PersonaId = personaId,
                ActingHumanId = "human-42",
                CredentialHash = "hashed-credential",
                CreatedAt = createdAt,
                LastLoginAt = lastLoginAt,
                FailedLoginCount = 2,
                LockedOutUntil = lockedOutUntil,
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: persistence round-trip, not an isolation test (see Persona_RoundTrips).
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Accounts.IgnoreQueryFilters().SingleAsync(a => a.Id == accountId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.Username.Should().Be("jferry");
        reloaded.DisplayName.Should().Be("Jordan Ferry");
        reloaded.Role.Should().Be("pio");
        reloaded.PersonaId.Should().Be(personaId);
        reloaded.ActingHumanId.Should().Be("human-42");
        reloaded.CredentialHash.Should().Be("hashed-credential");
        reloaded.CreatedAt.Should().Be(createdAt);
        reloaded.LastLoginAt.Should().Be(lastLoginAt);
        reloaded.FailedLoginCount.Should().Be(2);
        reloaded.LockedOutUntil.Should().Be(lockedOutUntil);
    }

    [RequiresDockerFact]
    public async Task SharedCredential_RoundTrips_WithRealExerciseId()
    {
        var exerciseId = Guid.NewGuid();
        var credentialId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var graceExpiresAt = createdAt.AddDays(7);
        var updatedAt = createdAt.AddHours(2);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Exercises.Add(new Exercise { OrganizationId = Organization.DefaultOrganizationId, Id = exerciseId, Name = "Shared Credential Round Trip Exercise" });
            writeContext.SharedCredentials.Add(new SharedCredential
            {
                Id = credentialId,
                ExerciseId = exerciseId,
                CurrentHash = "current-hash",
                PreviousHash = "previous-hash",
                PreviousHashGraceExpiresAt = graceExpiresAt,
                IsEnabled = true,
                RevokedAt = null,
                FailedAttemptCount = 3,
                LockedOutUntil = null,
                CreatedAt = createdAt,
                UpdatedAt = updatedAt,
            });
            await writeContext.SaveChangesAsync();
        }

        // IgnoreQueryFilters: persistence round-trip, not an isolation test (see Persona_RoundTrips).
        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.SharedCredentials.IgnoreQueryFilters().SingleAsync(c => c.Id == credentialId);

        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.ExerciseId.Should().NotBe(Guid.Empty, "scoped rows must carry a real ExerciseId");
        reloaded.CurrentHash.Should().Be("current-hash");
        reloaded.PreviousHash.Should().Be("previous-hash");
        reloaded.PreviousHashGraceExpiresAt.Should().Be(graceExpiresAt);
        reloaded.IsEnabled.Should().BeTrue();
        reloaded.RevokedAt.Should().BeNull();
        reloaded.FailedAttemptCount.Should().Be(3);
        reloaded.LockedOutUntil.Should().BeNull();
        reloaded.CreatedAt.Should().Be(createdAt);
        reloaded.UpdatedAt.Should().Be(updatedAt);
    }

    [RequiresDockerFact]
    public async Task StaffUser_RoundTrips()
    {
        var staffUserId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var lastLoginAt = createdAt.AddDays(3);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.StaffUsers.Add(new StaffUser
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = staffUserId,
                ExternalSubject = $"idp-sub-{staffUserId:N}",
                Username = "controller.jane",
                DisplayName = "Jane Controller",
                CreatedAt = createdAt,
                LastLoginAt = lastLoginAt,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.StaffUsers.SingleAsync(u => u.Id == staffUserId);

        reloaded.ExternalSubject.Should().Be($"idp-sub-{staffUserId:N}");
        reloaded.Username.Should().Be("controller.jane");
        reloaded.DisplayName.Should().Be("Jane Controller");
        reloaded.CreatedAt.Should().Be(createdAt);
        reloaded.LastLoginAt.Should().Be(lastLoginAt);
    }

    [RequiresDockerFact]
    public async Task StaffAssignment_RoundTrips()
    {
        var staffUserId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();
        var createdAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.StaffAssignments.Add(new StaffAssignment
            {
                Id = assignmentId,
                StaffUserId = staffUserId,
                ExerciseId = exerciseId,
                Role = "evaluator",
                CreatedAt = createdAt,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.StaffAssignments.SingleAsync(a => a.Id == assignmentId);

        reloaded.StaffUserId.Should().Be(staffUserId);
        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.Role.Should().Be("evaluator");
        reloaded.CreatedAt.Should().Be(createdAt);
    }

    [RequiresDockerFact]
    public async Task Session_RoundTrips()
    {
        var sessionId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var issuedAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);
        var expiresAt = issuedAt.AddHours(8);
        var refreshExpiresAt = issuedAt.AddDays(1);

        await using (var writeContext = _fixture.CreateContext())
        {
            writeContext.Sessions.Add(new Session
            {
                Id = sessionId,
                TokenHash = $"token-hash-{sessionId:N}",
                RefreshTokenHash = $"refresh-hash-{sessionId:N}",
                Kind = "participant",
                ExerciseId = exerciseId,
                PrincipalId = accountId.ToString(),
                AccountId = accountId,
                StaffUserId = null,
                Role = "participant",
                PersonaId = personaId,
                ActingHumanId = "human-77",
                IsReadOnly = false,
                IssuedAt = issuedAt,
                ExpiresAt = expiresAt,
                RefreshExpiresAt = refreshExpiresAt,
                RevokedAt = null,
            });
            await writeContext.SaveChangesAsync();
        }

        await using var readContext = _fixture.CreateContext();
        var reloaded = await readContext.Sessions.SingleAsync(s => s.Id == sessionId);

        reloaded.TokenHash.Should().Be($"token-hash-{sessionId:N}");
        reloaded.RefreshTokenHash.Should().Be($"refresh-hash-{sessionId:N}");
        reloaded.Kind.Should().Be("participant");
        reloaded.ExerciseId.Should().Be(exerciseId);
        reloaded.PrincipalId.Should().Be(accountId.ToString());
        reloaded.AccountId.Should().Be(accountId);
        reloaded.StaffUserId.Should().BeNull();
        reloaded.Role.Should().Be("participant");
        reloaded.PersonaId.Should().Be(personaId);
        reloaded.ActingHumanId.Should().Be("human-77");
        reloaded.IsReadOnly.Should().BeFalse();
        reloaded.IssuedAt.Should().Be(issuedAt);
        reloaded.ExpiresAt.Should().Be(expiresAt);
        reloaded.RefreshExpiresAt.Should().Be(refreshExpiresAt);
        reloaded.RevokedAt.Should().BeNull();
    }
}
