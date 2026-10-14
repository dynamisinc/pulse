namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// demo-feedback/01 (#497) — the proofs for the feature's ONE migration, <c>DemoFeedbackPinsNoiseImport</c>:
/// <list type="bullet">
///   <item><description>model-only: it is the one migration, directly after <c>EasyLoginSchema</c>; the snapshot matches the
///   model; every column, length, default and index is the one <c>implementation.md</c> names;</description></item>
///   <item><description>real SQL Server: the column types and the <c>'off'</c> default, the three indexes with their filters,
///   the import key refusing a second LIVE reference while allowing a deleted one, another exercise, or none, a
///   <see cref="NoisePost"/> round trip, and Down/Up.</description></item>
/// </list>
/// The deploy-script replay over pre-migration rows lives in <see cref="IdempotentMigrationScriptTests"/> (#413);
/// isolation in <see cref="DemoFeedbackIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class DemoFeedbackMigrationTests
{
    /// <summary>The migration immediately before the one under test.</summary>
    private const string PreviousMigration = "20261013144332_EasyLoginSchema";

    /// <summary>The migration under test.</summary>
    private const string MigrationName = "DemoFeedbackPinsNoiseImport";

    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private readonly MsSqlContainerFixture _fixture;

    public DemoFeedbackMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- model-only ------------------------------------------------------------------------------

    [Fact]
    public void TheMigration_IsTheFeaturesOnlyOne_DirectlyAfterEasyLogin()
    {
        using var context = ModelOnlyContext();
        var migrations = context.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "DemoFeedbackPinsNoiseImport exists as the feature's one migration");
        migrations.Count(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal)).Should().Be(1);
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of the easy-login migration");
    }

    [Fact]
    public void TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration()
    {
        // Stories 03/04/05 must never add a migration (implementation.md, "One migration"). A builder who changes an
        // entity without one turns this red in their own run.
        using var context = ModelOnlyContext();

        context.Database.HasPendingModelChanges().Should().BeFalse(
            "the committed migration snapshot must describe the current model exactly");
    }

    [Fact]
    public void ThePostPinColumns_AreNullable_BoundedAndIndexedOnPinnedRowsOnly()
    {
        using var context = ModelOnlyContext();
        var post = context.Model.FindEntityType(typeof(Post))!;

        post.FindProperty(nameof(Post.PinnedForAllAt))!.IsNullable.Should().BeTrue("existing posts read 'not pinned'");
        var pinnedBy = post.FindProperty(nameof(Post.PinnedForAllByHumanId))!;
        pinnedBy.IsNullable.Should().BeTrue();
        pinnedBy.GetMaxLength().Should().Be(128);

        var index = FindIndex(post, nameof(Post.ExerciseId), nameof(Post.PinnedForAllAt));
        index.IsUnique.Should().BeFalse("many posts may be pinned for everyone in one exercise");
        index.GetFilter().Should().Be("[PinnedForAllAt] IS NOT NULL");
    }

    [Fact]
    public void TheImportKey_IsBounded_AndUniquePerExerciseAmongLiveItems()
    {
        using var context = ModelOnlyContext();
        var item = context.Model.FindEntityType(typeof(InjectItem))!;

        var externalRef = item.FindProperty(nameof(InjectItem.ExternalRef))!;
        externalRef.IsNullable.Should().BeTrue("a console-authored item has no MSEL reference");
        externalRef.GetMaxLength().Should().Be(64);

        var index = FindIndex(item, nameof(InjectItem.ExerciseId), nameof(InjectItem.ExternalRef));
        index.IsUnique.Should().BeTrue("re-import updates, never duplicates (DF-10)");
        index.GetFilter().Should().Be("[ExternalRef] IS NOT NULL AND [DeletedAt] IS NULL");
    }

    [Fact]
    public void TheNoiseLevel_IsRequired_Bounded_AndDefaultsToOff()
    {
        using var context = ModelOnlyContext();
        var noiseLevel = context.Model.FindEntityType(typeof(Exercise))!.FindProperty(nameof(Exercise.NoiseLevel))!;

        noiseLevel.IsNullable.Should().BeFalse();
        noiseLevel.GetMaxLength().Should().Be(8);
        noiseLevel.GetDefaultValue().Should().Be("off", "existing exercises must read 'off' (DF-12)");
        new Exercise { Name = "fresh" }.NoiseLevel.Should().Be("off", "a new exercise starts with noise off");
    }

    [Fact]
    public void NoisePost_HasTheContractColumns_NoForeignKey_AndTheLeastPostedFirstIndex()
    {
        using var context = ModelOnlyContext();
        var noise = context.Model.FindEntityType(typeof(NoisePost))!;

        noise.GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            new[]
            {
                "Id", "ExerciseId", "PersonaId", "Text", "Order", "PostedCount", "LastPostedWallClock", "CreatedWallClock",
            },
            "NoisePost has exactly the columns implementation.md names");
        noise.FindProperty(nameof(NoisePost.Text))!.GetMaxLength().Should().Be(
            1024, "the column is sized in UTF-16 code units for 280 code points (emoji take two)");
        noise.FindProperty(nameof(NoisePost.Text))!.IsNullable.Should().BeFalse();
        noise.FindProperty(nameof(NoisePost.PostedCount))!.GetDefaultValue().Should().Be(0);
        noise.FindProperty(nameof(NoisePost.LastPostedWallClock))!.IsNullable.Should().BeTrue();
        noise.GetForeignKeys().Should().BeEmpty("PersonaId is a logical reference resolved through the scoped Personas set");
        noise.GetIndexes().Select(i => string.Join(",", i.Properties.Select(p => p.Name))).Should().BeEquivalentTo(
            new[] { "ExerciseId,PostedCount,Order" }, "one exercise-leading index serves the pacer's least-posted-first read");
        typeof(IExerciseScoped).IsAssignableFrom(typeof(NoisePost)).Should().BeTrue();
    }

    [Fact]
    public void ThePinReactionKind_IsTheConstantOnly_AndFitsTheKindColumn()
    {
        ReactionKinds.Pin.Should().Be("pin");
        ReactionKinds.Pin.Length.Should().BeLessThanOrEqualTo(PostReaction.MaxKindLength);
    }

    // ---- real SQL Server --------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Up_CreatesTheColumnsWithTheContractTypes_AndTheOffDefault()
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Posts.PinnedForAllAt"] = "datetimeoffset NULL",
            ["Posts.PinnedForAllByHumanId"] = "nvarchar(128) NULL",
            ["InjectItems.ExternalRef"] = "nvarchar(64) NULL",
            ["Exercises.NoiseLevel"] = "nvarchar(8) NOT NULL",
            ["NoisePosts.Id"] = "uniqueidentifier NOT NULL",
            ["NoisePosts.ExerciseId"] = "uniqueidentifier NOT NULL",
            ["NoisePosts.PersonaId"] = "uniqueidentifier NOT NULL",
            ["NoisePosts.Text"] = "nvarchar(1024) NOT NULL",
            ["NoisePosts.Order"] = "int NOT NULL",
            ["NoisePosts.PostedCount"] = "int NOT NULL",
            ["NoisePosts.LastPostedWallClock"] = "datetimeoffset NULL",
            ["NoisePosts.CreatedWallClock"] = "datetimeoffset NOT NULL",
        };

        var actual = await ReadColumnsAsync(["Posts", "InjectItems", "Exercises", "NoisePosts"]);

        foreach (var (column, type) in expected)
        {
            actual.Should().ContainKey(column);
            actual[column].Should().Be(type, "{0} is specified as {1}", column, type);
        }

        actual.Keys.Count(k => k.StartsWith("NoisePosts.", StringComparison.Ordinal)).Should().Be(
            8, "NoisePost has exactly the eight columns the contract names");
        (await ScalarAsync<string>(DefaultConstraintSql("Exercises", "NoiseLevel"))).Should().Be(
            "(N'off')", "existing and raw-inserted exercises read 'off'");
        (await ScalarAsync<string>(DefaultConstraintSql("NoisePosts", "PostedCount"))).Should().Be("((0))");
    }

    [RequiresDockerFact]
    public async Task Up_CreatesTheThreeIndexes_ScopeLeading_WithTheirFilters()
    {
        (await ReadIndexAsync("Posts", "IX_Posts_ExerciseId_PinnedForAllAt")).Should().Be(
            ("ExerciseId,PinnedForAllAt", false, "([PinnedForAllAt] IS NOT NULL)"));
        (await ReadIndexAsync("InjectItems", "IX_InjectItems_ExerciseId_ExternalRef")).Should().Be(
            ("ExerciseId,ExternalRef", true, "([ExternalRef] IS NOT NULL AND [DeletedAt] IS NULL)"));
        (await ReadIndexAsync("NoisePosts", "IX_NoisePosts_ExerciseId_PostedCount_Order")).Should().Be(
            ("ExerciseId,PostedCount,Order", false, (string?)null));
    }

    [RequiresDockerFact]
    public async Task TheImportKey_RefusesASecondLiveItem_ButAllowsADeletedOne_AnotherExercise_AndNone()
    {
        var exerciseId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.InjectItems.Add(NewItem(exerciseId, "MSEL-001"));
            seed.InjectItems.Add(NewItem(exerciseId, "MSEL-002", deleted: true));
            await seed.SaveChangesAsync();
        }

        await using (var duplicate = _fixture.CreateContext())
        {
            duplicate.InjectItems.Add(NewItem(exerciseId, "MSEL-001"));
            var act = async () => await duplicate.SaveChangesAsync();
            var thrown = await act.Should().ThrowAsync<DbUpdateException>(
                "a second LIVE item with the same Inject # in one exercise is exactly the duplicate DF-10 forbids");
            thrown.Which.InnerException.Should().BeOfType<SqlException>()
                .Which.Number.Should().BeOneOf(DuplicateKeyErrors);
        }

        await using var allowed = _fixture.CreateContext();
        allowed.InjectItems.Add(NewItem(exerciseId, "MSEL-002"));        // the earlier holder is soft-deleted
        allowed.InjectItems.Add(NewItem(Guid.NewGuid(), "MSEL-001"));    // another exercise
        allowed.InjectItems.Add(NewItem(exerciseId, externalRef: null));  // console items carry no reference
        allowed.InjectItems.Add(NewItem(exerciseId, externalRef: null));
        var save = async () => await allowed.SaveChangesAsync();
        await save.Should().NotThrowAsync(
            "only live, referenced items in one exercise collide — a deleted item frees its reference");
    }

    [RequiresDockerFact]
    public async Task TheNewColumns_RoundTrip_AndNewRowsTakeTheDefaults()
    {
        var exerciseId = Guid.NewGuid();
        var exercise = new Exercise { Id = exerciseId, OrganizationId = Organization.DefaultOrganizationId, Name = $"DF01 {exerciseId:N}" };
        var post = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "pinned for everyone",
            CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero),
            Origin = "noise",
            ActingHumanId = string.Empty,
            CreatedWallClock = DateTimeOffset.UtcNow,
            PinnedForAllAt = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.FromHours(-4)),
            PinnedForAllByHumanId = new string('h', Post.MaxPinnedForAllByHumanIdLength),
        };
        var noise = new NoisePost
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            PersonaId = Guid.NewGuid(),
            Text = new string('n', NoisePost.MaxTextColumnLength),
            Order = 3,
            CreatedWallClock = new DateTimeOffset(2026, 10, 14, 20, 0, 0, TimeSpan.Zero),
        };

        await using (var write = _fixture.CreateContext())
        {
            write.Exercises.Add(exercise);
            write.Posts.Add(post);
            write.NoisePosts.Add(noise);
            await write.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        (await read.Exercises.SingleAsync(e => e.Id == exerciseId)).NoiseLevel.Should().Be("off");
        (await read.Posts.SingleAsync(p => p.Id == post.Id)).Should().BeEquivalentTo(
            post, "both pin columns round-trip, including the full-length human id and the scenario offset");
        var storedNoise = await read.NoisePosts.SingleAsync(n => n.Id == noise.Id);
        storedNoise.Should().BeEquivalentTo(noise, "every NoisePost column round-trips");
        storedNoise.PostedCount.Should().Be(0);
        storedNoise.LastPostedWallClock.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task Down_RemovesTheSchema_AndUpReappliesIt()
    {
        var name = $"PulseDemoFeedbackTest_{Guid.NewGuid():N}";
        var master = new SqlConnectionStringBuilder(_fixture.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
        var connectionString = new SqlConnectionStringBuilder(_fixture.ConnectionString) { InitialCatalog = name }.ConnectionString;
        await ExecuteAsync(master, $"CREATE DATABASE [{name}];");

        try
        {
            await using (var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(connectionString).Options))
            {
                var migrator = context.Database.GetService<IMigrator>();
                await context.Database.MigrateAsync();
                await migrator.MigrateAsync(PreviousMigration);

                (await CountAsync(connectionString, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = N'NoisePosts';"))
                    .Should().Be(0, "Down drops the noise pool");
                (await CountAsync(
                        connectionString,
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME IN " +
                        "(N'PinnedForAllAt', N'PinnedForAllByHumanId', N'ExternalRef', N'NoiseLevel');"))
                    .Should().Be(0, "Down drops every added column");

                await context.Database.MigrateAsync();
            }

            (await CountAsync(connectionString, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = N'NoisePosts';"))
                .Should().Be(1, "Up re-applies cleanly after a Down");
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await ExecuteAsync(
                master,
                $"IF DB_ID('{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
                $"DROP DATABASE [{name}]; END");
        }
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static PulseDbContext ModelOnlyContext() =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);

    private static IReadOnlyIndex FindIndex(IReadOnlyEntityType entity, params string[] columns) =>
        entity.GetIndexes().Single(i => i.Properties.Select(p => p.Name).SequenceEqual(columns));

    private static InjectItem NewItem(Guid exerciseId, string? externalRef, bool deleted = false) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        Kind = "post",
        Title = "Imported item",
        Status = "pending",
        Order = 1,
        CreatedByHumanId = Guid.NewGuid(),
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
        ExternalRef = externalRef,
        DeletedAt = deleted ? DateTimeOffset.UtcNow : null,
    };

    private static string DefaultConstraintSql(string table, string column) =>
        "SELECT dc.definition FROM sys.default_constraints dc JOIN sys.columns c " +
        "ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id " +
        $"WHERE dc.parent_object_id = OBJECT_ID(N'[{table}]') AND c.name = N'{column}';";

    private async Task<Dictionary<string, string>> ReadColumnsAsync(IReadOnlyList<string> tables)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var connection = new SqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME IN ({string.Join(", ", tables.Select(t => $"N'{t}'"))});
            """;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var type = reader.GetString(2);
            if (!reader.IsDBNull(3))
            {
                type += $"({reader.GetInt32(3)})";
            }

            result[$"{reader.GetString(0)}.{reader.GetString(1)}"] =
                $"{type} {(reader.GetString(4) == "YES" ? "NULL" : "NOT NULL")}";
        }

        return result;
    }

    /// <summary>An index's key columns in key order, its uniqueness, and its filter (null when unfiltered).</summary>
    private async Task<(string Keys, bool IsUnique, string? Filter)> ReadIndexAsync(string table, string index)
    {
        await using var connection = new SqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal), MAX(CAST(i.is_unique AS int)),
                   MAX(i.filter_definition)
            FROM sys.indexes i
            JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
            JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE i.object_id = OBJECT_ID(@table) AND i.name = @index AND ic.is_included_column = 0;
            """;
        command.Parameters.AddWithValue("@table", $"[{table}]");
        command.Parameters.AddWithValue("@index", index);

        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        if (reader.IsDBNull(0))
        {
            throw new InvalidOperationException($"Index {index} does not exist on [{table}].");
        }

        return (reader.GetString(0), reader.GetInt32(1) == 1, reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var connection = new SqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        var value = await command.ExecuteScalarAsync();
        return value is T typed ? typed : throw new InvalidOperationException($"Expected a {typeof(T).Name} from: {sql}");
    }

    private static async Task<int> CountAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}
