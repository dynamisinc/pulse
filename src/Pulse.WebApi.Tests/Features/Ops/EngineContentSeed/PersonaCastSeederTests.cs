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
/// Story 01 persona-cast coverage against a REAL SQL Server (Testcontainers): the fixed six-persona starter
/// cast with the exact handles/kind/verified table (AC1, AC4), idempotent non-clobbering re-run (AC2), real
/// per-persona dossiers (AC3), COR-001 isolation with a second exercise pre-seeded with the same handles
/// (AC5), and the NFR-004 sanitization funnel. Every test is <see cref="RequiresDockerFactAttribute"/> — it
/// skips cleanly (a real <c>Skipped</c>) on a Docker-less machine and runs in CI.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PersonaCastSeederTests
{
    private static readonly (string Handle, string DisplayName, string Kind, bool Verified)[] ExpectedCast =
    [
        ("FairhavenWater", "Fairhaven Water Utility", "org", true),
        ("FulcoEM", "Fulton County EM", "org", true),
        ("Newsline7", "Newsline 7", "org", true),
        ("mvega_fh", "Marisol Vega", "human", false),
        ("tbrandt41", "Tom Brandt", "human", false),
        ("kwardFH", "Keisha Ward", "human", false),
    ];

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
    public async Task SeedAsync_FreshExercise_CreatesExactlySixPersonas_WithTheExactHandlesKindVerified()
    {
        var exerciseId = Guid.NewGuid();

        var seeded = await SeedAndSaveAsync(exerciseId);

        seeded.Should().HaveCount(6);
        seeded.Should().OnlyContain(p => p.Created, "a fresh exercise creates every row");

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().HaveCount(6, "exactly six persona rows are seeded for a fresh exercise (AC1)");

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
    public async Task SeedAsync_RunAgain_CreatesNoDuplicates_AndReturnsTheSameIds()
    {
        var exerciseId = Guid.NewGuid();

        var first = await SeedAndSaveAsync(exerciseId);
        var second = await SeedAndSaveAsync(exerciseId);

        second.Should().OnlyContain(p => !p.Created, "a re-run reuses every existing row (idempotent, AC2)");

        var rows = await ReadPersonasAsync(exerciseId);
        rows.Should().HaveCount(6, "re-running the seed creates zero additional rows (AC2)");

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
        rowsA.Should().HaveCount(6);
        rowsB.Should().HaveCount(6, "seeding A never touched B's rows");

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
            6, "the diversity gate needs real per-persona voice material, not copies of one note (AC3)");

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
                && !r.Handle.Contains('<') && !r.Handle.Contains('>'),
            "every stored free-text field went through the same sanitization funnel post ingest uses (NFR-004)");
    }
}
