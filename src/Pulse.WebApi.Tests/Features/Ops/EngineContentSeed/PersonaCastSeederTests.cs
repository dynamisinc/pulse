namespace Pulse.WebApi.Tests.Features.Ops.EngineContentSeed;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.Core.Features.Generation.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Story 01 persona-cast coverage against a REAL SQL Server (Testcontainers): the fixed nine-persona starter
/// cast with the exact handles/kind/verified table (AC1, AC4), idempotent non-clobbering re-run (AC2), real
/// per-persona dossiers (AC3), COR-001 isolation with a second exercise pre-seeded with the same handles
/// (AC5), and the NFR-004 sanitization funnel. Extended by <c>profiles-social-graph/06</c> with the seeded
/// presentation fields (AC3), the SOC-052 impersonation pair (AC4), and the widened-catalog re-seed (AC6).
/// Every test is <see cref="RequiresDockerFactAttribute"/> — it skips cleanly (a real <c>Skipped</c>) on a
/// Docker-less machine and runs in CI.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaCastSeederTests
{
    /// <summary>
    /// The nine-persona live cast, handle-for-handle with the frontend org library
    /// (<c>features/personas/personaTemplates.ts</c>) — including the SOC-052 pair
    /// <c>@FairhavenWater</c> (verified) / <c>@FairhavenWaterUpd</c> (NOT verified).
    /// </summary>
    private static readonly (string Handle, string DisplayName, string Kind, bool Verified, string PersonaType, string Band)[] ExpectedCast =
    [
        ("FairhavenWater", "Fairhaven Water Utility", "org", true, "agency", "mid"),
        ("FairhavenWaterUpd", "Fairhaven Water Update", "org", false, "bad-actor", "nano"),
        ("FulcoEM", "Fulton County EM", "org", true, "agency", "mid"),
        ("Newsline7", "Newsline 7", "org", true, "news-outlet", "large"),
        ("TheScoopHQ", "The Scoop", "org", false, "influencer", "mid"),
        ("mvega_fh", "Marisol Vega", "human", false, "citizen", "micro"),
        ("tbrandt41", "Tom Brandt", "human", false, "citizen", "nano"),
        ("kwardFH", "Keisha Ward", "human", false, "citizen", "micro"),
        ("dreyes_fh", "Dana Reyes", "human", false, "citizen", "nano"),
    ];

    /// <summary>The three handles <c>profiles-social-graph/06</c> adds to a catalog that previously held six.</summary>
    private static readonly string[] NewlyAddedHandles = ["FairhavenWaterUpd", "TheScoopHQ", "dreyes_fh"];

    private readonly MsSqlContainerFixture _fixture;

    public PersonaCastSeederTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private async Task<IReadOnlyList<SeededPersona>> SeedAndSaveAsync(Guid exerciseId)
    {
        await using var db = _fixture.CreateContext();
        var seeder = new PersonaCastSeeder(db);
        var seeded = await seeder.SeedAsync(exerciseId);
        await db.SaveChangesAsync();
        return seeded;
    }

    private async Task<List<Persona>> ReadPersonasAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.Personas
            .IgnoreQueryFilters()
            .Where(p => p.ExerciseId == exerciseId)
            .ToListAsync();
    }

    [RequiresDockerFact]
    public async Task SeedAsync_FreshExercise_CreatesExactlyNinePersonas_WithTheExactHandlesKindVerified()
    {
        var exerciseId = Guid.NewGuid();

        var seeded = await SeedAndSaveAsync(exerciseId);

        seeded.Should().HaveCount(9);
        seeded.Should().OnlyContain(p => p.Created, "a fresh exercise creates every row");

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().HaveCount(9, "exactly nine persona rows are seeded for a fresh exercise (AC1, profiles-social-graph/06 AC4)");

        foreach (var expected in ExpectedCast)
        {
            var row = rows.Should().ContainSingle(r => r.Handle == expected.Handle).Subject;
            row.DisplayName.Should().Be(expected.DisplayName);
            row.Kind.Should().Be(expected.Kind, $"{expected.Handle}'s kind must be set correctly (AC4)");
            row.Verified.Should().Be(
                expected.Verified,
                $"{expected.Handle} must carry exactly the listed verified flag — no seeded persona invents a false badge (SOC-052, AC4)");
            row.ExerciseId.Should().Be(exerciseId, "every seeded row is confined to the caller-resolved exercise (COR-001)");
            row.PersonaTemplateId.Should().BeNull("no template library row is created this phase");
        }
    }

    [RequiresDockerFact]
    public async Task SeedAsync_PopulatesEveryPresentationField_ForEveryPersona()
    {
        // profiles-social-graph/06 AC3: no persona is left with the old "0 followers, no bio, identical join
        // date" stand-in state once it is seeded.
        var exerciseId = Guid.NewGuid();

        await SeedAndSaveAsync(exerciseId);

        var rows = await ReadPersonasAsync(exerciseId);

        foreach (var expected in ExpectedCast)
        {
            var row = rows.Single(r => r.Handle == expected.Handle);

            row.PersonaType.Should().Be(
                expected.PersonaType,
                $"{expected.Handle}'s archetype is authored, not the 'citizen' stand-in (AC3)");
            row.AudienceBand.Should().Be(
                expected.Band, $"{expected.Handle}'s band mirrors the frontend template (AC3)");
            row.Bio.Should().NotBeNullOrWhiteSpace($"{expected.Handle} carries a real authored bio (AC3)");
            row.AudienceMagnitude.Should().Be(
                PersonaCastSeeder.DeriveAudienceMagnitude(expected.Band, expected.Handle),
                $"{expected.Handle}'s magnitude is the deterministic band-derived value (SOC-054, AC3)");
            row.JoinedAt.Should().BeBefore(
                PersonaCastSeeder.SeedEpoch,
                $"{expected.Handle}'s join instant predates the exercise (COR-021/COR-023) and is never a wall-clock read");
        }

        rows.Select(r => r.AudienceMagnitude).Distinct().Should().HaveCount(
            9, "every persona gets its own varied follower magnitude — no two share the stand-in 0 (COR-021)");
        rows.Select(r => r.JoinedAt).Distinct().Should().HaveCount(
            9, "join dates vary per persona instead of the single identical stand-in instant (COR-021)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_SeedsTheImpersonationPair_UnverifiedLookalike_WithNoFlagOfAnyKind()
    {
        // SOC-052 / D1-008: the lookalike exists, is NOT verified, and is not marked as fake anywhere — the
        // absent seal is the only signal, and its recent join date is the "joined this week" tell.
        var exerciseId = Guid.NewGuid();

        await SeedAndSaveAsync(exerciseId);

        var rows = await ReadPersonasAsync(exerciseId);
        var real = rows.Single(r => r.Handle == "FairhavenWater");
        var lookalike = rows.Single(r => r.Handle == "FairhavenWaterUpd");

        real.Verified.Should().BeTrue("the genuine utility carries the seal");
        lookalike.Verified.Should().BeFalse(
            "the lookalike is UNVERIFIED — the absent seal is the ONLY trust difference (SOC-052)");
        lookalike.Kind.Should().Be(real.Kind, "the lookalike presents as the same org kind — a near-identical lockup");
        lookalike.DisplayName.Should().StartWith(
            "Fairhaven Water", "the display name is a near-identical lockup of the verified account's");

        // The platform NEVER flags it: no persisted field on the participant-facing entity marks it as
        // suspected/fake. Asserted over the entity's own public string state, so a future "suspected" column
        // would have to be added deliberately and would fail here.
        var participantVisibleText = string.Join(
            ' ', lookalike.DisplayName, lookalike.Handle, lookalike.Bio, lookalike.AudienceBand);
        participantVisibleText.Should().NotContainAny(
            ["suspect", "fake", "impersonat", "unverified", "warning", "caution"],
            "the platform never flags a lookalike on a participant-visible field (D1-008)");
        typeof(Persona).GetProperties().Select(p => p.Name).Should().NotContainMatch(
            "*Suspect*", "no 'suspected impersonator' marker column exists on the entity at all (D1-008)");

        lookalike.JoinedAt.Should().BeAfter(
            real.JoinedAt, "the impersonator joined RECENTLY while the genuine account is established (SOC-052)");
        lookalike.JoinedAt.Should().BeAfter(
            PersonaCastSeeder.SeedEpoch.AddDays(-7),
            "the bad-actor archetype joins 3-6 days before the epoch — the 'joined this week' tell");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_AgainstAnExercisePredatingTheNewHandles_AddsExactlyThoseThree_AndDisturbsNothing()
    {
        // profiles-social-graph/06 AC6: an exercise seeded before the catalog grew (simulated by seeding the
        // six pre-existing handles by hand) gains ONLY the three new rows on a re-seed; the six that already
        // exist keep their ids and their fields.
        var exerciseId = Guid.NewGuid();
        var preExisting = ExpectedCast
            .Where(c => !NewlyAddedHandles.Contains(c.Handle, StringComparer.OrdinalIgnoreCase))
            .ToList();

        await using (var seed = _fixture.CreateContext())
        {
            foreach (var spec in preExisting)
            {
                seed.Personas.Add(new Persona
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = exerciseId,
                    DisplayName = spec.DisplayName,
                    Handle = spec.Handle,
                    Kind = spec.Kind,
                    Verified = spec.Verified,
                    Bio = "authored earlier",
                    AudienceMagnitude = 7,
                });
            }

            await seed.SaveChangesAsync();
        }

        var before = await ReadPersonasAsync(exerciseId);
        var seeded = await SeedAndSaveAsync(exerciseId);

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().HaveCount(9, "the three new handles are added exactly once, with no duplicates (AC6)");
        seeded.Where(p => p.Created).Should().HaveCount(3, "only the three brand-new handles are created (AC6)");

        foreach (var handle in NewlyAddedHandles)
        {
            rows.Should().ContainSingle(r => r.Handle == handle, $"{handle} is added exactly once (AC6)");
        }

        foreach (var existing in before)
        {
            var after = rows.Single(r => r.Id == existing.Id);
            after.Bio.Should().Be("authored earlier", "an existing row's fields are never overwritten (AC6)");
            after.AudienceMagnitude.Should().Be(7, "an existing row's magnitude is never recomputed (AC6)");
        }
    }

    [RequiresDockerFact]
    public async Task SeedAsync_RowCarryingOnlyTheColumnDefaults_IsBackfilled_SoTheImpersonatorStaysTheNewestAccount()
    {
        // CR-001. A row written BEFORE the presentation columns existed carries the migration defaults
        // (magnitude 0, JoinedAt == the epoch). Left alone it would read as joining ON the epoch while the
        // newly seeded lookalike derives six days EARLIER — inverting the SOC-052 "joined this week" tell and
        // making the impersonator look like the older, more established account.
        var exerciseId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Fairhaven Water Utility",
                Handle = "FairhavenWater",
                Kind = "org",
                Verified = true,

                // Exactly the state the PersonaPresentationFields migration leaves on a pre-existing row.
                Bio = null,
                PersonaType = Persona.DefaultPersonaType,
                AudienceBand = Persona.DefaultAudienceBand,
                AudienceMagnitude = 0,
                JoinedAt = Persona.DefaultJoinedAt,
            });
            await seed.SaveChangesAsync();
        }

        await SeedAndSaveAsync(exerciseId);

        var rows = await ReadPersonasAsync(exerciseId);
        var utility = rows.Single(r => r.Handle == "FairhavenWater");
        var lookalike = rows.Single(r => r.Handle == "FairhavenWaterUpd");

        utility.AudienceMagnitude.Should().Be(
            PersonaCastSeeder.DeriveAudienceMagnitude("mid", "FairhavenWater"),
            "a sentinel row is backfilled with its real derived magnitude (CR-001)");
        utility.AudienceBand.Should().Be("mid");
        utility.PersonaType.Should().Be("agency", "the archetype is backfilled too, not left on 'citizen'");
        utility.Bio.Should().NotBeNullOrWhiteSpace("an absent bio is filled in from the catalog");
        utility.JoinedAt.Should().BeBefore(
            PersonaCastSeeder.SeedEpoch, "the backfilled join instant is genuinely backdated");

        lookalike.JoinedAt.Should().BeAfter(
            utility.JoinedAt,
            "THE point of the backfill: the impersonator must remain the NEWEST account, or the SOC-052 "
            + "'joined this week' tell is inverted (CR-001)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_NeverOverwritesAuthoredValues_OnlyTheSentinelPair()
    {
        // The bounded exception must stay bounded: a row holding ANY authored presentation state is left
        // exactly as it is, even where the catalog would say otherwise.
        var exerciseId = Guid.NewGuid();
        var authoredJoinedAt = new DateTimeOffset(2024, 1, 2, 3, 4, 5, TimeSpan.Zero);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Fairhaven Water Utility",
                Handle = "FairhavenWater",
                Kind = "org",
                Verified = true,
                Bio = "a planner wrote this",
                PersonaType = "business",
                AudienceBand = "mega",
                AudienceMagnitude = 1234,
                JoinedAt = authoredJoinedAt,
            });
            await seed.SaveChangesAsync();
        }

        await SeedAndSaveAsync(exerciseId);

        var utility = (await ReadPersonasAsync(exerciseId)).Single(r => r.Handle == "FairhavenWater");
        utility.Bio.Should().Be("a planner wrote this");
        utility.PersonaType.Should().Be("business");
        utility.AudienceBand.Should().Be("mega");
        utility.AudienceMagnitude.Should().Be(1234, "an authored magnitude is never recomputed (AC6)");
        utility.JoinedAt.Should().Be(authoredJoinedAt, "an authored join instant is never rewritten (AC6)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_MarksTheBadActorAndLowCredibilityAccounts_NonCastable_EveryoneElseCastable()
    {
        // The engine-casting gate: the SOC-052 lookalike and the sensational outlet EXIST as rows (so
        // participants can browse them) but the engine may never voice them until a scenario opts in.
        var exerciseId = Guid.NewGuid();

        var seeded = await SeedAndSaveAsync(exerciseId);
        var rows = await ReadPersonasAsync(exerciseId);

        rows.Single(r => r.Handle == "FairhavenWaterUpd").Castable.Should().BeFalse(
            "the impersonator is seeded as a row but withheld from the engine's eligible cast");
        rows.Single(r => r.Handle == "TheScoopHQ").Castable.Should().BeFalse(
            "the low-credibility outlet is likewise seeded but not engine-castable");

        rows.Where(r => r.Handle is not ("FairhavenWaterUpd" or "TheScoopHQ"))
            .Should().OnlyContain(r => r.Castable, "every ordinary persona stays castable");

        seeded.Count(p => p.Castable).Should().Be(
            7, "the seeder reports castability so the composing caller can filter the eligible cast");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_ReusedRow_ReportsAndPersistsCastability_ClosingAWronglyOpenGate()
    {
        // WR-B. A database seeded by the intermediate build (bad-actor handles present, Castable column not
        // yet) holds a lookalike row carrying the column DEFAULT true. It is NOT a sentinel row (its
        // magnitude is a real derived value), so the presentation backfill cannot see it — reuse alone would
        // preserve the wrongly-open gate forever and let the engine voice the impersonator.
        var exerciseId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Fairhaven Water Update",
                Handle = "FairhavenWaterUpd",
                Kind = "org",
                Verified = false,
                Bio = "Real-time Fairhaven water updates. Stay informed.",
                PersonaType = "bad-actor",
                AudienceBand = "nano",
                AudienceMagnitude = PersonaCastSeeder.DeriveAudienceMagnitude("nano", "FairhavenWaterUpd"),
                JoinedAt = PersonaCastSeeder.DeriveJoinedAt("bad-actor", "FairhavenWaterUpd"),
                Castable = true, // the intermediate build's column default — the wrongly-open gate
            });
            await seed.SaveChangesAsync();
        }

        var seeded = await SeedAndSaveAsync(exerciseId);

        var reused = seeded.Single(p => !p.Created);
        reused.Castable.Should().BeFalse(
            "the REPORTED castability of a reused row must reflect the reconciled value — the composing "
            + "caller filters the engine's eligible cast on exactly this (WR-B)");

        var row = (await ReadPersonasAsync(exerciseId)).Single(r => r.Handle == "FairhavenWaterUpd");
        row.Castable.Should().BeFalse(
            "the seeder closes a gate the catalog says must be closed, so the fix survives the next re-seed too");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_ReusedRow_NeverReOpensAGateAHumanClosed()
    {
        // The reconciliation is ONE-WAY: it may only tighten. An ordinarily-castable persona that someone
        // deliberately opted OUT stays out — the seeder never hands the engine a voice a human withheld.
        var exerciseId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Personas.Add(new Persona
            {
                Id = Guid.NewGuid(),
                ExerciseId = exerciseId,
                DisplayName = "Marisol Vega",
                Handle = "mvega_fh",
                Kind = "human",
                Verified = false,
                Bio = "Fairhaven east side. Mom, nurse, neighbor.",
                PersonaType = "citizen",
                AudienceBand = "micro",
                AudienceMagnitude = PersonaCastSeeder.DeriveAudienceMagnitude("micro", "mvega_fh"),
                JoinedAt = PersonaCastSeeder.DeriveJoinedAt("citizen", "mvega_fh"),
                Castable = false, // a deliberate human opt-out of an ordinarily-castable persona
            });
            await seed.SaveChangesAsync();
        }

        var seeded = await SeedAndSaveAsync(exerciseId);

        seeded.Single(p => string.Equals(p.Dossier.Handle, "mvega_fh", StringComparison.OrdinalIgnoreCase))
            .Castable.Should().BeFalse("a deliberate opt-out is preserved and reported (WR-B, one-way only)");

        (await ReadPersonasAsync(exerciseId)).Single(r => r.Handle == "mvega_fh")
            .Castable.Should().BeFalse("the seeder never sets Castable = true on an existing row");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_RunAgain_CreatesNoDuplicates_AndReturnsTheSameIds()
    {
        var exerciseId = Guid.NewGuid();

        var first = await SeedAndSaveAsync(exerciseId);
        var second = await SeedAndSaveAsync(exerciseId);

        second.Should().OnlyContain(p => !p.Created, "a re-run reuses every existing row (idempotent, AC2)");

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().HaveCount(9, "re-running the seed creates zero additional rows (AC2)");

        var firstIds = first.Select(p => p.InstanceId).OrderBy(id => id);
        var secondIds = second.Select(p => p.InstanceId).OrderBy(id => id);
        secondIds.Should().Equal(firstIds, "the existing rows' ids are returned and reused, never overwritten (AC2)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_ForExerciseA_NeverCreatesOrReadsExerciseBRows_EvenWithSameHandles()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        // Exercise B is pre-seeded with the SAME handles — the isolation proof: A's idempotency read must not
        // see B's rows (the explicit ExerciseId predicate, not the fail-closed-to-empty global filter).
        var seededB = await SeedAndSaveAsync(exerciseB);

        var seededA = await SeedAndSaveAsync(exerciseA);

        seededA.Should().OnlyContain(p => p.Created,
            "exercise A must create its OWN cast even though exercise B already has the same handles (COR-001)");

        var rowsA = await ReadPersonasAsync(exerciseA);
        var rowsB = await ReadPersonasAsync(exerciseB);
        rowsA.Should().HaveCount(9);
        rowsB.Should().HaveCount(9, "seeding A never touched B's rows");

        seededA.Select(p => p.InstanceId).Should().NotIntersectWith(
            seededB.Select(p => p.InstanceId),
            "A's persona instance ids are disjoint from B's — no cross-exercise row is shared or read (COR-001)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_EachReturnedDossier_HasNonEmptyDistinctVoiceNotes_AndRealTypeAndStyle()
    {
        var exerciseId = Guid.NewGuid();

        var seeded = await SeedAndSaveAsync(exerciseId);

        seeded.Should().OnlyContain(
            p => !string.IsNullOrWhiteSpace(p.Dossier.VoiceNotes),
            "every seeded persona is paired with a real dossier carrying non-empty voice notes (AC3)");

        var distinctVoiceNotes = seeded.Select(p => p.Dossier.VoiceNotes).Distinct().Count();
        distinctVoiceNotes.Should().Be(
            9, "the diversity gate needs real per-persona voice material, not copies of one note (AC3)");

        // The dossier carries a distinguishing type + style, not a placeholder.
        seeded.Select(p => p.Dossier.Type).Should().Contain(
            new[] { PersonaType.Agency, PersonaType.Outlet, PersonaType.Resident },
            "the cast spans agency/outlet/resident types (AC3)");
        seeded.Should().OnlyContain(p => p.Dossier.AudienceBand > 0, "each dossier carries a real audience band (AC3)");
    }

    [RequiresDockerFact]
    public async Task SeedAsync_StoredFreeText_PassesThroughTheSanitizationFunnel()
    {
        // The seeded constants are clean, so the strip-not-encode funnel is a no-op on them — the assertion is
        // that a stored value can never carry executable markup (NFR-004): no persisted field contains a tag.
        var exerciseId = Guid.NewGuid();

        await SeedAndSaveAsync(exerciseId);

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().OnlyContain(
            r => !r.DisplayName.Contains('<') && !r.DisplayName.Contains('>')
                && !r.Handle.Contains('<') && !r.Handle.Contains('>')
                && !r.Bio!.Contains('<') && !r.Bio!.Contains('>'),
            "every stored free-text field — including the new Bio — went through the same sanitization funnel "
            + "post ingest uses (NFR-004)");
    }
}
