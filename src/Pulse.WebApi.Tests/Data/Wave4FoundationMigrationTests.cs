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
/// demo-feedback/17 (#535) — the proofs for Wave 4's ONE migration, <c>DemoFeedbackWave4RuntimeAndEdits</c>:
/// <list type="bullet">
///   <item><description>model-only: it is the one migration, directly after <c>DemoFeedbackPinsNoiseImport</c>; the snapshot
///   matches the model; every column, length, default, key, foreign key and index is the one WAVE-4.md's schema table
///   names;</description></item>
///   <item><description>real SQL Server: the column types and defaults, the edit-number key refusing a duplicate, a round trip
///   of both new tables, the migration over a database that already holds posts (<c>EditCount = 0</c>), and Down/Up.</description></item>
/// </list>
/// The deploy-script replay lives in <see cref="IdempotentMigrationScriptTests"/>; isolation in
/// <see cref="Wave4FoundationIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class Wave4FoundationMigrationTests
{
    /// <summary>The migration immediately before the one under test.</summary>
    private const string PreviousMigration = "20261014202342_DemoFeedbackPinsNoiseImport";

    /// <summary>The migration under test.</summary>
    private const string MigrationName = "DemoFeedbackWave4RuntimeAndEdits";

    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private readonly MsSqlContainerFixture _fixture;

    public Wave4FoundationMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- model-only ------------------------------------------------------------------------------

    [Fact]
    public void TheMigration_IsWave4sOnlyOne_DirectlyAfterDemoFeedbackPinsNoiseImport()
    {
        using var context = ModelOnlyContext();
        var migrations = context.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "DemoFeedbackWave4RuntimeAndEdits exists as Wave 4's one migration");
        migrations.Count(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal)).Should().Be(1);
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of the Wave 0 migration");
        index.Should().Be(migrations.Count - 1, "it is the latest migration — stories 18-25 never add one");
    }

    [Fact]
    public void TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration()
    {
        using var context = ModelOnlyContext();

        context.Database.HasPendingModelChanges().Should().BeFalse(
            "the committed migration snapshot must describe the current model exactly");
    }

    [Fact]
    public void ExerciseRuntimeState_IsKeyedByItsExercise_WithACascadeForeignKeyToExercises()
    {
        using var context = ModelOnlyContext();
        var state = context.Model.FindEntityType(typeof(ExerciseRuntimeState))!;

        state.GetTableName().Should().Be("ExerciseRuntimeStates");
        state.FindPrimaryKey()!.Properties.Select(p => p.Name).Should().Equal(nameof(ExerciseRuntimeState.ExerciseId));
        var foreignKey = state.GetForeignKeys().Should().ContainSingle().Subject;
        foreignKey.PrincipalEntityType.ClrType.Should().Be(typeof(Exercise));
        foreignKey.Properties.Select(p => p.Name).Should().Equal(nameof(ExerciseRuntimeState.ExerciseId));
        foreignKey.DeleteBehavior.Should().Be(DeleteBehavior.Cascade, "deleting an exercise removes its runtime state");
        foreignKey.IsUnique.Should().BeTrue("one runtime-state row per exercise");
        typeof(IExerciseScoped).IsAssignableFrom(typeof(ExerciseRuntimeState)).Should().BeTrue();
    }

    [Fact]
    public void ExerciseRuntimeState_HasTheContractColumns_LengthsAndDefaults()
    {
        using var context = ModelOnlyContext();
        var state = context.Model.FindEntityType(typeof(ExerciseRuntimeState))!;

        state.GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            new[]
            {
                "ExerciseId", "PauseTier", "ClockScenarioStart", "ClockTimeZone", "ClockElapsedAtAnchorTicks",
                "ClockWallAnchorUtc", "ClockFrozen", "OverlayState", "OverlayRegister", "OverlayMessage",
                "OverlaySequence", "UpdatedAt",
            },
            "ExerciseRuntimeState has exactly the columns WAVE-4.md names");

        AssertColumn(state, nameof(ExerciseRuntimeState.PauseTier), nullable: false, maxLength: 16, defaultValue: "running");
        AssertColumn(state, nameof(ExerciseRuntimeState.ClockScenarioStart), nullable: true);
        AssertColumn(state, nameof(ExerciseRuntimeState.ClockTimeZone), nullable: true, maxLength: 64);
        AssertColumn(state, nameof(ExerciseRuntimeState.ClockElapsedAtAnchorTicks), nullable: true);
        AssertColumn(state, nameof(ExerciseRuntimeState.ClockWallAnchorUtc), nullable: true);
        AssertColumn(state, nameof(ExerciseRuntimeState.ClockFrozen), nullable: false, defaultValue: false);
        AssertColumn(state, nameof(ExerciseRuntimeState.OverlayState), nullable: false, maxLength: 16, defaultValue: "none");
        AssertColumn(state, nameof(ExerciseRuntimeState.OverlayRegister), nullable: true, maxLength: 16);
        AssertColumn(state, nameof(ExerciseRuntimeState.OverlayMessage), nullable: true, maxLength: 500);
        AssertColumn(state, nameof(ExerciseRuntimeState.OverlaySequence), nullable: false, defaultValue: 0L);
        AssertColumn(state, nameof(ExerciseRuntimeState.UpdatedAt), nullable: false);

        var fresh = new ExerciseRuntimeState();
        fresh.PauseTier.Should().Be("running", "a new row starts with the world running");
        fresh.OverlayState.Should().Be("none");
        fresh.OverlaySequence.Should().Be(0);
        fresh.ClockFrozen.Should().BeFalse();
        fresh.ClockScenarioStart.Should().BeNull("a new row's clock is unstarted: all clock columns null");
        fresh.ClockTimeZone.Should().BeNull();
        fresh.ClockElapsedAtAnchorTicks.Should().BeNull();
        fresh.ClockWallAnchorUtc.Should().BeNull();
    }

    [Fact]
    public void PostEdit_HasTheContractColumns_ARestrictForeignKeyToPosts_AndTheUniqueEditNumberIndex()
    {
        using var context = ModelOnlyContext();
        var edit = context.Model.FindEntityType(typeof(PostEdit))!;
        var post = context.Model.FindEntityType(typeof(Post))!;

        edit.GetTableName().Should().Be("PostEdits");
        edit.GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            new[]
            {
                "Id", "ExerciseId", "PostId", "EditNumber", "PreviousBody", "EditedAt", "EditedScenarioTime", "ActingHumanId",
            },
            "PostEdit has exactly the columns WAVE-4.md names");

        AssertColumn(edit, nameof(PostEdit.ExerciseId), nullable: false);
        AssertColumn(edit, nameof(PostEdit.EditNumber), nullable: false);
        AssertColumn(edit, nameof(PostEdit.EditedAt), nullable: false);
        AssertColumn(edit, nameof(PostEdit.EditedScenarioTime), nullable: false);
        var previousBody = edit.FindProperty(nameof(PostEdit.PreviousBody))!;
        previousBody.IsNullable.Should().BeFalse();
        previousBody.GetMaxLength().Should().Be(
            post.FindProperty(nameof(Post.Body))!.GetMaxLength(), "PreviousBody is bounded exactly like Post.Body");
        previousBody.GetColumnType().Should().Be(post.FindProperty(nameof(Post.Body))!.GetColumnType());
        var actingHuman = edit.FindProperty(nameof(PostEdit.ActingHumanId))!;
        actingHuman.IsNullable.Should().BeTrue();
        actingHuman.ClrType.Should().Be(typeof(string), "same type as Post.ActingHumanId");
        actingHuman.GetColumnType().Should().Be(post.FindProperty(nameof(Post.ActingHumanId))!.GetColumnType());

        var foreignKey = edit.GetForeignKeys().Should().ContainSingle().Subject;
        foreignKey.PrincipalEntityType.ClrType.Should().Be(typeof(Post));
        foreignKey.Properties.Select(p => p.Name).Should().Equal(nameof(PostEdit.PostId));
        foreignKey.DeleteBehavior.Should().Be(DeleteBehavior.Restrict, "no cascade, no hard-delete path (XC-010)");

        var unique = FindIndex(edit, nameof(PostEdit.PostId), nameof(PostEdit.EditNumber));
        unique.IsUnique.Should().BeTrue("one row per edit number per post");
        unique.GetFilter().Should().BeNull();
        FindIndex(edit, nameof(PostEdit.ExerciseId)).IsUnique.Should().BeFalse("the standard scoped lookup index");
        typeof(IExerciseScoped).IsAssignableFrom(typeof(PostEdit)).Should().BeTrue();
    }

    [Fact]
    public void ThePostEditColumns_DefaultToNeverEdited()
    {
        using var context = ModelOnlyContext();
        var post = context.Model.FindEntityType(typeof(Post))!;

        AssertColumn(post, nameof(Post.EditCount), nullable: false, defaultValue: 0);
        AssertColumn(post, nameof(Post.LastEditedAt), nullable: true);
        AssertColumn(post, nameof(Post.LastEditedScenarioTime), nullable: true);
    }

    // ---- real SQL Server --------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Up_CreatesTheColumnsWithTheContractTypes_AndTheirDefaults()
    {
        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Posts.EditCount"] = "int NOT NULL",
            ["Posts.LastEditedAt"] = "datetimeoffset NULL",
            ["Posts.LastEditedScenarioTime"] = "datetimeoffset NULL",
            ["ExerciseRuntimeStates.ExerciseId"] = "uniqueidentifier NOT NULL",
            ["ExerciseRuntimeStates.PauseTier"] = "nvarchar(16) NOT NULL",
            ["ExerciseRuntimeStates.ClockScenarioStart"] = "datetimeoffset NULL",
            ["ExerciseRuntimeStates.ClockTimeZone"] = "nvarchar(64) NULL",
            ["ExerciseRuntimeStates.ClockElapsedAtAnchorTicks"] = "bigint NULL",
            ["ExerciseRuntimeStates.ClockWallAnchorUtc"] = "datetimeoffset NULL",
            ["ExerciseRuntimeStates.ClockFrozen"] = "bit NOT NULL",
            ["ExerciseRuntimeStates.OverlayState"] = "nvarchar(16) NOT NULL",
            ["ExerciseRuntimeStates.OverlayRegister"] = "nvarchar(16) NULL",
            ["ExerciseRuntimeStates.OverlayMessage"] = "nvarchar(500) NULL",
            ["ExerciseRuntimeStates.OverlaySequence"] = "bigint NOT NULL",
            ["ExerciseRuntimeStates.UpdatedAt"] = "datetimeoffset NOT NULL",
            ["PostEdits.Id"] = "uniqueidentifier NOT NULL",
            ["PostEdits.ExerciseId"] = "uniqueidentifier NOT NULL",
            ["PostEdits.PostId"] = "uniqueidentifier NOT NULL",
            ["PostEdits.EditNumber"] = "int NOT NULL",
            ["PostEdits.PreviousBody"] = "nvarchar(-1) NOT NULL",
            ["PostEdits.EditedAt"] = "datetimeoffset NOT NULL",
            ["PostEdits.EditedScenarioTime"] = "datetimeoffset NOT NULL",
            ["PostEdits.ActingHumanId"] = "nvarchar(-1) NULL",
        };

        var actual = await ReadColumnsAsync(["Posts", "ExerciseRuntimeStates", "PostEdits"]);

        foreach (var (column, type) in expected)
        {
            actual.Should().ContainKey(column);
            actual[column].Should().Be(type, "{0} is specified as {1}", column, type);
        }

        actual.Keys.Count(k => k.StartsWith("ExerciseRuntimeStates.", StringComparison.Ordinal)).Should().Be(12);
        actual.Keys.Count(k => k.StartsWith("PostEdits.", StringComparison.Ordinal)).Should().Be(8);
        (await ScalarAsync<string>(DefaultConstraintSql("Posts", "EditCount"))).Should().Be(
            "((0))", "existing and raw-inserted posts read 'never edited'");
        (await ScalarAsync<string>(DefaultConstraintSql("ExerciseRuntimeStates", "PauseTier"))).Should().Be("(N'running')");
        (await ScalarAsync<string>(DefaultConstraintSql("ExerciseRuntimeStates", "OverlayState"))).Should().Be("(N'none')");
        (await ScalarAsync<string>(DefaultConstraintSql("ExerciseRuntimeStates", "ClockFrozen"))).Should().Be("(CONVERT([bit],(0)))");
        (await ScalarAsync<string>(DefaultConstraintSql("ExerciseRuntimeStates", "OverlaySequence"))).Should().Be("(CONVERT([bigint],(0)))");
    }

    [RequiresDockerFact]
    public async Task TheEditNumberKey_RefusesASecondRowForTheSameEdit_ButAllowsTheNextNumber()
    {
        var exerciseId = Guid.NewGuid();
        var post = NewPost(exerciseId);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(post);
            seed.PostEdits.Add(NewEdit(exerciseId, post.Id, 1));
            await seed.SaveChangesAsync();
        }

        await using (var duplicate = _fixture.CreateContext())
        {
            duplicate.PostEdits.Add(NewEdit(exerciseId, post.Id, 1));
            var act = async () => await duplicate.SaveChangesAsync();
            var thrown = await act.Should().ThrowAsync<DbUpdateException>(
                "two rows for edit 1 of one post is exactly the double-submit the unique index forbids");
            thrown.Which.InnerException.Should().BeOfType<SqlException>()
                .Which.Number.Should().BeOneOf(DuplicateKeyErrors);
        }

        await using var next = _fixture.CreateContext();
        next.PostEdits.Add(NewEdit(exerciseId, post.Id, 2));
        var save = async () => await next.SaveChangesAsync();
        await save.Should().NotThrowAsync("the next edit number of the same post is a distinct row");
    }

    [RequiresDockerFact]
    public async Task TheNewColumns_RoundTrip_AndNewRowsTakeTheDefaults()
    {
        var exerciseId = Guid.NewGuid();
        var post = NewPost(exerciseId);
        post.EditCount = 1;
        post.LastEditedAt = new DateTimeOffset(2026, 10, 15, 18, 0, 0, TimeSpan.Zero);
        post.LastEditedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.FromHours(-4));
        var edit = NewEdit(exerciseId, post.Id, 1);
        edit.PreviousBody = new string('p', 5000);
        var running = new ExerciseRuntimeState { ExerciseId = exerciseId, UpdatedAt = DateTimeOffset.UtcNow };
        var otherExerciseId = Guid.NewGuid();
        var frozen = new ExerciseRuntimeState
        {
            ExerciseId = otherExerciseId,
            PauseTier = "freeze",
            ClockScenarioStart = new DateTimeOffset(2033, 9, 4, 8, 0, 0, TimeSpan.FromHours(-4)),
            ClockTimeZone = "America/New_York",
            ClockElapsedAtAnchorTicks = TimeSpan.FromMinutes(95).Ticks,
            ClockWallAnchorUtc = new DateTimeOffset(2026, 10, 15, 17, 30, 0, TimeSpan.Zero),
            ClockFrozen = true,
            OverlayState = "pause",
            OverlayRegister = "out-of-fiction",
            OverlayMessage = new string('m', ExerciseRuntimeState.MaxOverlayMessageLength),
            OverlaySequence = long.MaxValue - 1,
            UpdatedAt = new DateTimeOffset(2026, 10, 15, 17, 31, 0, TimeSpan.Zero),
        };

        await using (var write = _fixture.CreateContext())
        {
            write.Exercises.Add(NewExercise(exerciseId));
            write.Exercises.Add(NewExercise(otherExerciseId));
            write.Posts.Add(post);
            write.PostEdits.Add(edit);
            write.ExerciseRuntimeStates.AddRange(running, frozen);
            await write.SaveChangesAsync();
        }

        await using (var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            (await read.Posts.SingleAsync(p => p.Id == post.Id)).Should().BeEquivalentTo(
                post, "the edit columns round-trip, including the scenario offset");
            (await read.PostEdits.SingleAsync(e => e.Id == edit.Id)).Should().BeEquivalentTo(
                edit, "every PostEdit column round-trips, including an unbounded previous body");
            var storedRunning = await read.ExerciseRuntimeStates.SingleAsync();
            storedRunning.Should().BeEquivalentTo(running);
            storedRunning.PauseTier.Should().Be("running");
            storedRunning.OverlayState.Should().Be("none");
            storedRunning.OverlaySequence.Should().Be(0);
            storedRunning.ClockFrozen.Should().BeFalse();
        }

        await using var readOther = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = otherExerciseId });
        (await readOther.ExerciseRuntimeStates.SingleAsync()).Should().BeEquivalentTo(
            frozen, "every runtime-state column round-trips, including the full-length message and a huge sequence");
    }

    [RequiresDockerFact]
    public async Task Up_OverADatabaseThatAlreadyHasPosts_GivesThemEditCountZero_AndDownUpReapplies()
    {
        var name = $"PulseWave4Test_{Guid.NewGuid():N}";
        var master = new SqlConnectionStringBuilder(_fixture.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
        var connectionString = new SqlConnectionStringBuilder(_fixture.ConnectionString) { InitialCatalog = name }.ConnectionString;
        await ExecuteAsync(master, $"CREATE DATABASE [{name}];");

        try
        {
            await using (var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(connectionString).Options))
            {
                var migrator = context.Database.GetService<IMigrator>();
                await migrator.MigrateAsync(PreviousMigration);

                var postId = Guid.NewGuid();
                await ExecuteAsync(connectionString, $"""
                    INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [Origin],
                                         [ActingHumanId], [CreatedWallClock])
                    VALUES ('{postId}', '{Guid.NewGuid()}', '{Guid.NewGuid()}', N'Pre-Wave-4 post', '2033-09-04T13:00:00+00:00',
                            N'participant', N'human-legacy', SYSDATETIMEOFFSET());
                    """);

                await context.Database.MigrateAsync();

                (await CountAsync(
                        connectionString,
                        $"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{postId}' AND [Body] = N'Pre-Wave-4 post' " +
                        "AND [EditCount] = 0 AND [LastEditedAt] IS NULL AND [LastEditedScenarioTime] IS NULL;"))
                    .Should().Be(1, "an existing post survives untouched and reads 'never edited' (EditCount = 0)");

                await migrator.MigrateAsync(PreviousMigration);

                (await CountAsync(
                        connectionString,
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (N'ExerciseRuntimeStates', N'PostEdits');"))
                    .Should().Be(0, "Down drops both new tables");
                (await CountAsync(
                        connectionString,
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'Posts' AND COLUMN_NAME IN " +
                        "(N'EditCount', N'LastEditedAt', N'LastEditedScenarioTime');"))
                    .Should().Be(0, "Down drops every added column");

                await context.Database.MigrateAsync();
            }

            (await CountAsync(
                    connectionString,
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN (N'ExerciseRuntimeStates', N'PostEdits');"))
                .Should().Be(2, "Up re-applies cleanly after a Down");
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

    private static void AssertColumn(
        IReadOnlyEntityType entity, string property, bool nullable, int? maxLength = null, object? defaultValue = null)
    {
        var column = entity.FindProperty(property)!;
        column.Should().NotBeNull("{0}.{1} exists", entity.ClrType.Name, property);
        column.IsNullable.Should().Be(nullable, "{0}.{1} nullability is fixed by the contract", entity.ClrType.Name, property);
        column.GetMaxLength().Should().Be(maxLength, "{0}.{1} length is fixed by the contract", entity.ClrType.Name, property);
        if (defaultValue is null)
        {
            column.TryGetDefaultValue(out _).Should().BeFalse("{0}.{1} has no column default", entity.ClrType.Name, property);
        }
        else
        {
            column.GetDefaultValue().Should().Be(defaultValue, "{0}.{1} default is fixed by the contract", entity.ClrType.Name, property);
        }
    }

    private static Exercise NewExercise(Guid id) => new()
    {
        Id = id,
        OrganizationId = Organization.DefaultOrganizationId,
        Name = $"DF17 {id:N}",
    };

    private static Post NewPost(Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = "current text",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero),
        Origin = "participant",
        ActingHumanId = "human-1",
        CreatedWallClock = DateTimeOffset.UtcNow,
    };

    private static PostEdit NewEdit(Guid exerciseId, Guid postId, int editNumber) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PostId = postId,
        EditNumber = editNumber,
        PreviousBody = "original text",
        EditedAt = new DateTimeOffset(2026, 10, 15, 18, 0, 0, TimeSpan.Zero),
        EditedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.FromHours(-4)),
        ActingHumanId = null,
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
