namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Story <c>backend-host/03-persona-handle-uniqueness</c>: <c>(ExerciseId, Handle)</c> is unique on
/// <c>Persona</c> — the constraint <c>PersonaCastSeeder</c>'s idempotency read and every by-handle resolver
/// already assumed but nothing enforced. Resolves <c>docs/01-platform-core-isolation.md</c> §7 Q3 as
/// per-exercise, NOT org-global.
/// </summary>
/// <remarks>
/// <para>
/// Real SQL Server only (<see cref="RequiresDockerFactAttribute"/> — Testcontainers in CI, or a local
/// <c>PULSE_TEST_SQL_CONNECTION</c> target). An index constraint and a collation are database behaviour: an
/// in-memory provider would happily accept every row these tests require the server to reject, so a
/// provider-agnostic stand-in could not prove any of this. On a machine with neither target these report a real
/// <c>Skipped</c>, never a silent <c>Passed</c> (Gate-1 W-001).
/// </para>
/// <para>
/// Every test uses a fresh <see cref="Guid.NewGuid"/> exercise id, per the shared-fixture contract
/// (<see cref="MsSqlContainerFixture"/> migrates ONE database for the whole collection and never truncates
/// between tests) — so no test's handles can collide with a sibling's under the new unique index.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class PersonaHandleUniquenessTests
{
    /// <summary>SQL Server: "Cannot insert duplicate key row in object ... with unique index".</summary>
    private const int DuplicateKeyInUniqueIndex = 2601;

    /// <summary>SQL Server: "Violation of UNIQUE KEY constraint" — accepted too, so the assertion is about the
    /// uniqueness guarantee rather than whether it is spelled as an index or a constraint.</summary>
    private const int UniqueConstraintViolation = 2627;

    private readonly MsSqlContainerFixture _fixture;

    public PersonaHandleUniquenessTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task SameExercise_SameHandle_IsRejected()
    {
        var exerciseId = Guid.NewGuid();
        var handle = $"dupe_{Guid.NewGuid():N}";

        await InsertAsync(NewPersona(exerciseId, handle));

        await AssertUniquenessViolationAsync(
            () => InsertAsync(NewPersona(exerciseId, handle)),
            "a second persona with the same handle in the same exercise must not be persistable");

        await using var read = _fixture.CreateContext();
        var rows = await read.Personas
            .IgnoreQueryFilters()
            .CountAsync(p => p.ExerciseId == exerciseId);
        rows.Should().Be(1, "the rejected insert must leave exactly the original row behind");
    }

    [RequiresDockerFact]
    public async Task SameExercise_HandleDifferingOnlyByCase_IsAlsoRejected()
    {
        // The consistency requirement: the seeder groups handles with OrdinalIgnoreCase and the resolvers match
        // them with a server-side (CI-collation) `==`, so the index has to fold case the SAME way. Under
        // SQL_Latin1_General_CP1_CI_AS an index key comparison uses the column's collation — "mvega_fh" and
        // "MVega_FH" COLLIDE. If the database were ever provisioned CS/BIN, this test is what catches it.
        var exerciseId = Guid.NewGuid();
        var discriminator = Guid.NewGuid().ToString("N");

        await InsertAsync(NewPersona(exerciseId, $"mvega_fh_{discriminator}"));

        await AssertUniquenessViolationAsync(
            () => InsertAsync(NewPersona(exerciseId, $"MVega_FH_{discriminator.ToUpperInvariant()}")),
            "case-variant handles must collide, not coexist — a lookalike handle differing only in case " +
            "would defeat the case-insensitive matching the seeder and the by-handle resolvers rely on");
    }

    [RequiresDockerFact]
    public async Task DifferentExercises_MayEachUseTheSameHandle()
    {
        // Per-exercise, NOT org-global (§7 Q3, resolved): each isolated world runs its own "@FulcoEM". A globally
        // unique index would have made a second exercise's cast unseedable — the opposite of COR-001's intent.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var handle = $"FulcoEM_{Guid.NewGuid():N}";

        await InsertAsync(NewPersona(exerciseA, handle), NewPersona(exerciseB, handle));

        await using var read = _fixture.CreateContext();
        var rows = await read.Personas
            .IgnoreQueryFilters()
            .Where(p => p.Handle == handle)
            .ToListAsync();

        rows.Should().HaveCount(2);
        rows.Select(p => p.ExerciseId).Should().BeEquivalentTo(new[] { exerciseA, exerciseB });
    }

    [RequiresDockerFact]
    public async Task TheMigratedSchema_CarriesAUniqueIndexOnExerciseIdAndHandle()
    {
        // Schema-level proof that the MIGRATION (not merely the C# model) applied: the behavioural tests above
        // would also pass against a leftover database whose index came from somewhere else.
        await using var context = _fixture.CreateContext();
        await using var connection = new SqlConnection(context.Database.GetConnectionString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT i.is_unique, c.name AS column_name, ic.key_ordinal
            FROM sys.indexes AS i
            JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id = OBJECT_ID('Personas') AND i.name = 'IX_Personas_ExerciseId_Handle'
            ORDER BY ic.key_ordinal;
            """;

        var keyColumns = new List<string>();
        var isUnique = false;
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                isUnique = reader.GetBoolean(0);
                keyColumns.Add(reader.GetString(1));
            }
        }

        isUnique.Should().BeTrue("IX_Personas_ExerciseId_Handle must be UNIQUE, not a plain lookup index");
        keyColumns.Should().Equal("ExerciseId", "Handle");
    }

    [RequiresDockerFact]
    public async Task TheHandleColumn_IsBoundedAndCaseInsensitive()
    {
        // The two schema properties the index depends on: nvarchar(max) is not index-key eligible (hence the
        // narrowing ALTER in the migration), and the CI collation is what makes the case test above true.
        await using var context = _fixture.CreateContext();
        await using var connection = new SqlConnection(context.Database.GetConnectionString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.max_length, c.collation_name
            FROM sys.columns AS c
            WHERE c.object_id = OBJECT_ID('Personas') AND c.name = 'Handle';
            """;

        await using var reader = await command.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("Personas.Handle must exist");

        // max_length is in BYTES for nvarchar (-1 would mean nvarchar(max)); 256 chars => 512 bytes.
        reader.GetInt16(0).Should().Be(512, "Handle must be nvarchar(256) — nvarchar(max) cannot be an index key");
        reader.GetString(1).Should().Be("SQL_Latin1_General_CP1_CI_AS");
    }

    /// <summary>
    /// Asserts <paramref name="insert"/> is refused BY THE DATABASE — an EF <see cref="DbUpdateException"/>
    /// wrapping a SQL Server uniqueness error — rather than by any client-side check, which is the whole point of
    /// moving the guarantee into the schema.
    /// </summary>
    private static async Task AssertUniquenessViolationAsync(Func<Task> insert, string because)
    {
        var act = async () => await insert();

        var thrown = (await act.Should().ThrowAsync<DbUpdateException>(because)).And;

        thrown.InnerException.Should().BeOfType<SqlException>(
                "the refusal must come from the server's unique index, not from application code")
            .Which.Number.Should().BeOneOf(DuplicateKeyInUniqueIndex, UniqueConstraintViolation);
    }

    private static Persona NewPersona(Guid exerciseId, string handle) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        DisplayName = handle,
        Handle = handle,
        Kind = "human",
        Verified = false,
    };

    private async Task InsertAsync(params Persona[] personas)
    {
        await using var write = _fixture.CreateContext();
        write.Personas.AddRange(personas);
        await write.SaveChangesAsync();
    }
}
