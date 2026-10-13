namespace Pulse.WebApi.Tests.Data;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// easy-login/01 (Schema AC) — the database-level proofs for the feature's ONE migration, <c>EasyLoginSchema</c>,
/// against a REAL SQL Server:
/// <list type="bullet">
///   <item><description>it applies on top of the previous migration, and an account created before it keeps every
///   value, reads the five new columns as NULL / false, and STILL SIGNS IN with its password;</description></item>
///   <item><description>the deploy's idempotent script applies it batch by batch (as <c>sqlcmd -b</c> does) and
///   replays as a no-op;</description></item>
///   <item><description>the column types and the three unique indexes are the ones the story names, and the indexes
///   refuse duplicates;</description></item>
///   <item><description>both new entities round-trip every column, and the migration rolls back and re-applies.</description></item>
/// </list>
/// The structural (model-only) side is pinned by <see cref="QueryFilterModelTests"/>; behavioural isolation by
/// <see cref="EasyLoginIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class EasyLoginMigrationTests
{
    /// <summary>The migration immediately before the one under test — the UAT shape on deploy day.</summary>
    private const string PreviousMigration = "20261009164256_InjectQueueItems";

    /// <summary>The migration under test.</summary>
    private const string MigrationName = "EasyLoginSchema";

    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private readonly MsSqlContainerFixture _fixture;

    public EasyLoginMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task TheMigration_DirectlyFollowsThePreviousOne()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        var migrations = database.AllMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "EasyLoginSchema exists exactly once, as the feature's one migration (EL-17)");
        migrations.Count(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal)).Should().Be(1);
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of the inject-queue migration");
    }

    [Fact]
    public void TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration()
    {
        // Model-only: compares the EF model with the committed snapshot, opening no connection. A parallel builder who
        // changes an entity without a migration (EL-17: only story 01 adds one) turns this red in their own run.
        using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);

        context.Database.HasPendingModelChanges().Should().BeFalse(
            "the committed migration snapshot must describe the current model exactly");
    }

    [RequiresDockerFact]
    public async Task Up_KeepsALegacyAccount_WithNullRosterColumns_AndItStillSignsInWithItsPassword()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var hasher = new ParticipantPasswordHasher();
        var exerciseId = await database.InsertLegacyExerciseAsync();
        var accountId = await database.InsertLegacyAccountAsync(exerciseId, "legacy_user", hasher.Hash("legacy-pass-123"));

        await database.MigrateToLatestAsync();

        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Accounts] WHERE [Id] = '{accountId}' AND [Username] = N'legacy_user' " +
                "AND [Agency] IS NULL AND [JobRole] IS NULL AND [Email] IS NULL AND [DisabledAt] IS NULL " +
                "AND [PersonaAutoCreated] = 0;"))
            .Should().Be(1, "an existing account keeps its values and reads every new column as NULL / false");

        // The behavioural half of "no existing row changes behaviour": the legacy account signs in exactly as before.
        var issuer = new RecordingSessionIssuer();
        await using (var context = database.NewContext(exerciseId))
        {
            var service = new ParticipantLoginService(
                context, new ExerciseContext { CurrentExerciseId = exerciseId }, issuer, hasher);

            var result = await service.LoginAsync(
                new ParticipantLoginRequest { Username = "legacy_user", Password = "legacy-pass-123" });

            result.Outcome.Should().Be(
                ParticipantLoginOutcome.Authenticated, "a pre-existing password account must still sign in after the migration");
        }

        issuer.LastRequest!.AccountId.Should().Be(accountId);
    }

    [RequiresDockerFact]
    public async Task Up_CreatesTheColumnsWithTheStoryTypes()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToLatestAsync();

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Accounts.Agency"] = "nvarchar(128) NULL",
            ["Accounts.JobRole"] = "nvarchar(128) NULL",
            ["Accounts.Email"] = "nvarchar(254) NULL",
            ["Accounts.DisabledAt"] = "datetimeoffset NULL",
            ["Accounts.PersonaAutoCreated"] = "bit NOT NULL",
            ["ParticipantLinks.Id"] = "uniqueidentifier NOT NULL",
            ["ParticipantLinks.ExerciseId"] = "uniqueidentifier NOT NULL",
            ["ParticipantLinks.AccountId"] = "uniqueidentifier NOT NULL",
            ["ParticipantLinks.TokenHash"] = "nvarchar(64) NOT NULL",
            ["ParticipantLinks.ProtectedToken"] = "nvarchar(512) NULL",
            ["ParticipantLinks.Generation"] = "int NOT NULL",
            ["ParticipantLinks.IssuedAt"] = "datetimeoffset NOT NULL",
            ["ParticipantLinks.IssuedByStaffUserId"] = "uniqueidentifier NULL",
            ["ParticipantLinks.RevokedAt"] = "datetimeoffset NULL",
            ["ParticipantLinks.RevokedByStaffUserId"] = "uniqueidentifier NULL",
            ["ParticipantLinks.LastUsedAt"] = "datetimeoffset NULL",
            ["ParticipantLinks.UseCount"] = "int NOT NULL",
            ["ExerciseDayWords.Id"] = "uniqueidentifier NOT NULL",
            ["ExerciseDayWords.ExerciseId"] = "uniqueidentifier NOT NULL",
            ["ExerciseDayWords.ForDate"] = "date NOT NULL",
            ["ExerciseDayWords.WordHash"] = "nvarchar(256) NOT NULL",
            ["ExerciseDayWords.SetAt"] = "datetimeoffset NOT NULL",
            ["ExerciseDayWords.SetByStaffUserId"] = "uniqueidentifier NOT NULL",
            ["ExerciseDayWords.ReplacedCount"] = "int NOT NULL",
        };

        var actual = await database.ReadColumnsAsync(["Accounts", "ParticipantLinks", "ExerciseDayWords"]);

        foreach (var (column, type) in expected)
        {
            actual.Should().ContainKey(column);
            actual[column].Should().Be(type, "{0} is specified as {1}", column, type);
        }

        actual.Keys.Where(k => k.StartsWith("ParticipantLinks.", StringComparison.Ordinal)).Should().HaveCount(
            12, "ParticipantLink has exactly the twelve columns the story names, no more");
        actual.Keys.Where(k => k.StartsWith("ExerciseDayWords.", StringComparison.Ordinal)).Should().HaveCount(
            7, "ExerciseDayWord has exactly the seven columns the story names, no more");

        (await database.ScalarAsync<int>(
                "SELECT COUNT(*) FROM sys.default_constraints dc JOIN sys.columns c " +
                "ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id " +
                "WHERE dc.parent_object_id = OBJECT_ID(N'[Accounts]') AND c.name = N'PersonaAutoCreated' " +
                "AND dc.definition IN (N'((0))', N'(CONVERT([bit],(0)))');"))
            .Should().Be(1, "PersonaAutoCreated carries a DEFAULT 0 so a raw insert that omits it stays valid");
    }

    [RequiresDockerFact]
    public async Task Up_CreatesTheThreeUniqueIndexes_ScopeLeading()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToLatestAsync();

        (await database.ReadUniqueIndexKeyAsync("ParticipantLinks", "IX_ParticipantLinks_ExerciseId_AccountId"))
            .Should().Be("ExerciseId,AccountId", "one link per account, scope first");
        (await database.ReadUniqueIndexKeyAsync("ParticipantLinks", "IX_ParticipantLinks_TokenHash"))
            .Should().Be("TokenHash", "the join lookup key is globally unique");
        (await database.ReadUniqueIndexKeyAsync("ExerciseDayWords", "IX_ExerciseDayWords_ExerciseId_ForDate"))
            .Should().Be("ExerciseId,ForDate", "one word per exercise per local date, scope first");
    }

    [RequiresDockerFact]
    public async Task UniqueIndexes_RefuseASecondLinkForAnAccount_ADuplicateTokenHash_AndASecondWordForADate()
    {
        var exerciseId = Guid.NewGuid();
        var accountId = Guid.NewGuid();
        var first = NewLink(exerciseId, accountId);
        var word = NewDayWord(exerciseId, new DateOnly(2026, 10, 20));

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.Add(first);
            seed.ExerciseDayWords.Add(word);
            await seed.SaveChangesAsync();
        }

        await AssertDuplicateRejectedAsync(
            context => context.ParticipantLinks.Add(NewLink(exerciseId, accountId)),
            "a second link row for the same account in the same exercise (a reissue rotates in place)");

        var sameHash = NewLink(Guid.NewGuid());
        sameHash.TokenHash = first.TokenHash;
        await AssertDuplicateRejectedAsync(
            context => context.ParticipantLinks.Add(sameHash),
            "a token hash already in use, even in another exercise");

        await AssertDuplicateRejectedAsync(
            context => context.ExerciseDayWords.Add(NewDayWord(exerciseId, word.ForDate)),
            "a second word for the same exercise and date (setting it again replaces in place)");

        await using (var write = _fixture.CreateContext())
        {
            write.ExerciseDayWords.Add(NewDayWord(Guid.NewGuid(), word.ForDate));
            write.ParticipantLinks.Add(NewLink(Guid.NewGuid(), accountId));
            var act = async () => await write.SaveChangesAsync();
            await act.Should().NotThrowAsync(
                "the composite keys lead with the exercise, so the same date or account id in ANOTHER exercise is fine");
        }
    }

    [RequiresDockerFact]
    public async Task BothEntities_RoundTripEveryColumn()
    {
        var exerciseId = Guid.NewGuid();
        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AccountId = Guid.NewGuid(),
            TokenHash = ParticipantLinkTokens.Hash(ParticipantLinkTokens.Generate()),
            ProtectedToken = new string('p', ParticipantLink.MaxProtectedTokenLength),
            Generation = 3,
            IssuedAt = new DateTimeOffset(2026, 10, 14, 8, 30, 0, TimeSpan.FromHours(-4)),
            IssuedByStaffUserId = Guid.NewGuid(),
            RevokedAt = new DateTimeOffset(2026, 10, 15, 9, 0, 0, TimeSpan.Zero),
            RevokedByStaffUserId = Guid.NewGuid(),
            LastUsedAt = new DateTimeOffset(2026, 10, 14, 12, 0, 0, TimeSpan.Zero),
            UseCount = 7,
        };
        var word = new ExerciseDayWord
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            ForDate = new DateOnly(2026, 10, 20),
            WordHash = "AQAAAAIAAYagAAAAE" + new string('x', 60),
            SetAt = new DateTimeOffset(2026, 10, 19, 22, 0, 0, TimeSpan.Zero),
            SetByStaffUserId = Guid.NewGuid(),
            ReplacedCount = 2,
        };

        await using (var write = _fixture.CreateContext())
        {
            write.ParticipantLinks.Add(link);
            write.ExerciseDayWords.Add(word);
            await write.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        (await read.ParticipantLinks.SingleAsync(l => l.Id == link.Id)).Should().BeEquivalentTo(
            link, "every ParticipantLink column must round-trip, including the full-length protected copy");
        (await read.ExerciseDayWords.SingleAsync(w => w.Id == word.Id)).Should().BeEquivalentTo(
            word, "every ExerciseDayWord column must round-trip; ForDate as a SQL date");
    }

    [RequiresDockerFact]
    public async Task Down_RemovesTheSchema_AndUpReappliesIt()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToLatestAsync();

        await database.MigrateToAsync(PreviousMigration);

        (await database.TableExistsAsync("ParticipantLinks")).Should().BeFalse("Down drops the links table");
        (await database.TableExistsAsync("ExerciseDayWords")).Should().BeFalse("Down drops the day-word table");
        (await database.ColumnExistsAsync("Accounts", "PersonaAutoCreated")).Should().BeFalse("Down drops the new columns");

        await database.MigrateToLatestAsync();

        (await database.TableExistsAsync("ParticipantLinks")).Should().BeTrue("Up re-applies cleanly after a Down");
        (await database.TableExistsAsync("ExerciseDayWords")).Should().BeTrue();
        (await database.ColumnExistsAsync("Accounts", "Email")).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task TheDeployScript_AppliesItOverALegacyAccount_BatchByBatch_AndReplaysAsANoOp()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var exerciseId = await database.InsertLegacyExerciseAsync();
        var accountId = await database.InsertLegacyAccountAsync(exerciseId, "script_user", credentialHash: null);
        var script = database.GenerateIdempotentScript();

        script.Should().Contain("IX_ParticipantLinks_ExerciseId_AccountId")
            .And.Contain("IX_ExerciseDayWords_ExerciseId_ForDate")
            .And.Contain("IX_ParticipantLinks_TokenHash");

        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(
            database.AllMigrations(), "the EasyLoginSchema batch must compile and run in the script, not just under Migrate()");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Accounts] WHERE [Id] = '{accountId}' AND [PersonaAutoCreated] = 0 AND [Email] IS NULL;"))
            .Should().Be(1, "the legacy account survives the script with the new columns defaulted");

        // The deploy re-applies the same script on every merge: a second apply must be a no-op.
        await database.ApplyScriptAsync(script);

        (await database.AppliedMigrationsAsync()).Should().BeEquivalentTo(database.AllMigrations());
        (await database.ScalarAsync<int>("SELECT COUNT(*) FROM [Accounts];")).Should().Be(1, "a replay changes no data");
    }

    private static ParticipantLink NewLink(Guid exerciseId, Guid? accountId = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AccountId = accountId ?? Guid.NewGuid(),
        TokenHash = ParticipantLinkTokens.Hash(ParticipantLinkTokens.Generate()),
        Generation = 1,
        IssuedAt = DateTimeOffset.UtcNow,
    };

    private static ExerciseDayWord NewDayWord(Guid exerciseId, DateOnly forDate) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ForDate = forDate,
        WordHash = $"hash-{Guid.NewGuid():N}",
        SetAt = DateTimeOffset.UtcNow,
        SetByStaffUserId = Guid.NewGuid(),
    };

    private async Task AssertDuplicateRejectedAsync(Action<PulseDbContext> addDuplicate, string because)
    {
        await using var write = _fixture.CreateContext();
        addDuplicate(write);

        var act = async () => await write.SaveChangesAsync();
        var thrown = await act.Should().ThrowAsync<DbUpdateException>("the database must refuse {0}", because);
        thrown.Which.InnerException.Should().BeOfType<SqlException>()
            .Which.Number.Should().BeOneOf(DuplicateKeyErrors, "the refusal must be the unique index, not some other error");
    }

    /// <summary>A throwaway database on whichever real SQL Server the shared fixture resolved.</summary>
    private sealed class EphemeralDatabase : IAsyncDisposable
    {
        private readonly string _masterConnectionString;
        private readonly string _name;
        private readonly string _connectionString;

        private EphemeralDatabase(string masterConnectionString, string name, string connectionString)
        {
            _masterConnectionString = masterConnectionString;
            _name = name;
            _connectionString = connectionString;
        }

        public static async Task<EphemeralDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            if (fixture.ConnectionString is null)
            {
                throw new InvalidOperationException(
                    "The shared MSSQL fixture has no connection string — it did not initialize.");
            }

            // GUID-derived name: no injection surface, and bracket-quoted regardless.
            var name = $"PulseEasyLoginTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new EphemeralDatabase(master, name, connectionString);
        }

        public PulseDbContext NewContext(Guid? exerciseId = null) =>
            new(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options,
                exerciseId is null ? null : new ExerciseContext { CurrentExerciseId = exerciseId });

        public IReadOnlyList<string> AllMigrations()
        {
            using var context = NewContext();
            return context.Database.GetMigrations().ToList();
        }

        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = NewContext();
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        public async Task MigrateToLatestAsync()
        {
            await using var context = NewContext();
            await context.Database.MigrateAsync();
        }

        public string GenerateIdempotentScript()
        {
            using var context = NewContext();
            return context.Database.GetService<IMigrator>()
                .GenerateScript(options: MigrationsSqlGenerationOptions.Idempotent);
        }

        /// <summary>Runs the script as <c>sqlcmd -b</c> does: split on <c>GO</c>, each batch one command, one session.</summary>
        public async Task ApplyScriptAsync(string script)
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();

            foreach (var batch in SplitOnGo(script))
            {
                await using var command = connection.CreateCommand();
                command.CommandText = batch;
                command.CommandTimeout = 120;
                await command.ExecuteNonQueryAsync();
            }
        }

        public async Task<IReadOnlyList<string>> AppliedMigrationsAsync()
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT [MigrationId] FROM [__EFMigrationsHistory];";

            var applied = new List<string>();
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                applied.Add(reader.GetString(0));
            }

            return applied;
        }

        /// <summary>Inserts an exercise by RAW SQL in the pre-migration schema.</summary>
        public async Task<Guid> InsertLegacyExerciseAsync()
        {
            var id = Guid.NewGuid();
            await ExecuteNonQueryAsync(_connectionString, $"""
                INSERT INTO [Exercises] ([Id], [OrganizationId], [Name], [TimeZone], [Status])
                VALUES ('{id}', '{Organization.DefaultOrganizationId}', N'Legacy Exercise {id:N}', N'UTC', N'live');
                """);
            return id;
        }

        /// <summary>
        /// Inserts an account by RAW SQL in the pre-migration schema, which has none of the new columns — the current
        /// entity model could not write it.
        /// </summary>
        public async Task<Guid> InsertLegacyAccountAsync(Guid exerciseId, string username, string? credentialHash)
        {
            var id = Guid.NewGuid();
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO [Accounts] ([Id], [ExerciseId], [Username], [DisplayName], [Role], [CredentialHash],
                                        [CreatedAt], [FailedLoginCount])
                VALUES (@id, @exerciseId, @username, N'Legacy Account', N'participant', @hash, SYSDATETIMEOFFSET(), 0);
                """;
            command.Parameters.AddWithValue("@id", id);
            command.Parameters.AddWithValue("@exerciseId", exerciseId);
            command.Parameters.AddWithValue("@username", username);
            command.Parameters.AddWithValue("@hash", (object?)credentialHash ?? DBNull.Value);
            await command.ExecuteNonQueryAsync();
            return id;
        }

        /// <summary>Reads <c>Table.Column</c> → <c>type(len) NULL|NOT NULL</c> for the given tables.</summary>
        public async Task<Dictionary<string, string>> ReadColumnsAsync(IReadOnlyList<string> tables)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            await using var connection = new SqlConnection(_connectionString);
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

                var nullability = reader.GetString(4) == "YES" ? "NULL" : "NOT NULL";
                result[$"{reader.GetString(0)}.{reader.GetString(1)}"] = $"{type} {nullability}";
            }

            return result;
        }

        /// <summary>The comma-joined key columns of a UNIQUE index, in key order, or null when it is missing or not unique.</summary>
        public async Task<string?> ReadUniqueIndexKeyAsync(string table, string index)
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal)
                FROM sys.indexes i
                JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                WHERE i.object_id = OBJECT_ID(@table) AND i.name = @index AND i.is_unique = 1 AND ic.is_included_column = 0;
                """;
            command.Parameters.AddWithValue("@table", $"[{table}]");
            command.Parameters.AddWithValue("@index", index);
            var value = await command.ExecuteScalarAsync();
            return value as string;
        }

        public async Task<bool> TableExistsAsync(string table) =>
            await ScalarAsync<int>($"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = N'{table}';") == 1;

        public async Task<bool> ColumnExistsAsync(string table, string column) =>
            await ScalarAsync<int>(
                $"SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'{table}' AND COLUMN_NAME = N'{column}';") == 1;

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            var value = await command.ExecuteScalarAsync();
            return value is T typed
                ? typed
                : throw new InvalidOperationException($"Expected a {typeof(T).Name} from: {sql}");
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                SqlConnection.ClearAllPools();
                await ExecuteNonQueryAsync(
                    _masterConnectionString,
                    $"IF DB_ID('{_name}') IS NOT NULL " +
                    $"BEGIN ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
                    $"DROP DATABASE [{_name}]; END");
            }
            catch (SqlException)
            {
                // Leaving a uniquely-named throwaway database behind beats failing the run on teardown.
            }
        }

        private static IEnumerable<string> SplitOnGo(string script)
        {
            var batch = new StringBuilder();
            foreach (var line in script.Split('\n'))
            {
                if (line.Trim().Equals("GO", StringComparison.OrdinalIgnoreCase))
                {
                    if (batch.ToString().Trim().Length > 0)
                    {
                        yield return batch.ToString();
                    }

                    batch.Clear();
                    continue;
                }

                batch.Append(line).Append('\n');
            }

            if (batch.ToString().Trim().Length > 0)
            {
                yield return batch.ToString();
            }
        }

        private static async Task ExecuteNonQueryAsync(string connectionString, string sql)
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }
}
