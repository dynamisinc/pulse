namespace Pulse.WebApi.Tests.Data;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// identity-auth-roles/21 (#576, Tier-2) — the <c>A2CredentialFoundation</c> migration over a database holding
/// representative A1 rows: the new table and columns (no backfill needed, nothing invalidated), the default
/// <c>SignInMethods</c> = all, the rewritten filtered unique indexes that let a revoked person be enrolled again, the
/// new CHECKs (trusted, validated against every existing row), and a Down→Up round trip.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class A2CredentialFoundationMigrationTests
{
    private const string PreviousMigration = "20261017120000_AdminIdentityFoundation";
    private const string MigrationUnderTest = "20261019200000_A2CredentialFoundation";

    private readonly MsSqlContainerFixture _fixture;

    public A2CredentialFoundationMigrationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public void TheMigration_IsTheLatest_AndSortsAfterAdminIdentityFoundation()
    {
        using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);
        var migrations = context.Database.GetMigrations();
        migrations.Should().EndWith([PreviousMigration, MigrationUnderTest], "A2's one migration follows A1's");
    }

    [RequiresDockerFact]
    public async Task Up_OverA1Rows_AddsTheSchema_DefaultsSignInMethodsToAll_AndChangesNoExistingRow()
    {
        await using var db = await A1Database.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var rows = await db.SeedA1RowsAsync();

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>($"SELECT [SignInMethods] FROM [Exercises] WHERE [Id] = '{rows.Exercise}'"))
            .Should().Be((int)ExerciseSignInMethods.All, "every existing exercise keeps today's behaviour: all three methods");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [ExerciseId] = '{rows.Exercise}' AND [DeletedAt] IS NULL"))
            .Should().Be(3, "every existing enrollment stays live");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{rows.LeadEnrollment}' AND [IsLead] = 1"))
            .Should().Be(1, "the lead is untouched");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [People] WHERE [Id] = '{rows.Person}' AND [AvatarBlobName] IS NULL"))
            .Should().Be(1);
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [MediaAssets] WHERE [Id] = '{rows.MediaAsset}' AND [UploadedByAccountId] IS NULL"))
            .Should().Be(1);
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM [CredentialTokens]")).Should().Be(0);

        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.check_constraints
            WHERE [name] IN ('CK_Enrollments_DeletedAt_StaffOnly', 'CK_Enrollments_DeletedAt_NotLead', 'CK_Exercises_SignInMethods',
                             'CK_CredentialTokens_Purpose', 'CK_CredentialTokens_OneSubject')
              AND [is_not_trusted] = 0 AND [is_disabled] = 0
            """)).Should().Be(5, "every new CHECK exists, enabled, and validated WITH CHECK against the existing rows");

        (await db.ScalarAsync<string>("SELECT [filter_definition] FROM sys.indexes WHERE [name] = 'IX_Enrollments_ExerciseId_PersonId'"))
            .Should().Contain("[DeletedAt] IS NULL").And.Contain("[PersonId] IS NOT NULL");
        (await db.ScalarAsync<string>("SELECT [filter_definition] FROM sys.indexes WHERE [name] = 'IX_Enrollments_ExerciseId_Lead'"))
            .Should().Contain("[DeletedAt] IS NULL").And.Contain("[IsLead]=(1)");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.indexes WHERE [name] = 'IX_CredentialTokens_TokenHash' AND [is_unique] = 1"))
            .Should().Be(1, "the token hash is the unique redemption key");
        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.foreign_keys
            WHERE [name] IN ('FK_MediaAssets_Accounts_UploadedByAccountId', 'FK_CredentialTokens_People_PersonId',
                             'FK_CredentialTokens_Accounts_AccountId', 'FK_CredentialTokens_Organizations_OrganizationId',
                             'FK_CredentialTokens_People_IssuedByPersonId')
              AND [delete_referential_action] = 0
            """)).Should().Be(5, "every new foreign key is Restrict / NO ACTION (XC-010)");
    }

    [RequiresDockerFact]
    public async Task Up_LetsARevokedPersonBeEnrolledAgain_ButStillRefusesTwoLiveEnrollmentsOrARevokedLead()
    {
        await using var db = await A1Database.CreateAsync(_fixture);
        await db.MigrateToAsync(MigrationUnderTest);
        var rows = await db.SeedA1RowsAsync();

        await db.ExecuteAsync($"UPDATE [Enrollments] SET [DeletedAt] = SYSDATETIMEOFFSET() WHERE [Id] = '{rows.PlannerEnrollment}';");
        var regrant = Guid.NewGuid();
        await db.ExecuteAsync($"""
            INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [IsLead], [CreatedAt])
            VALUES ('{regrant}', '{rows.Exercise}', '{rows.Person}', N'evaluator', 0, SYSDATETIMEOFFSET());
            """);
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [PersonId] = '{rows.Person}' AND [ExerciseId] = '{rows.Exercise}'"))
            .Should().Be(2, "the revoked row and the re-grant coexist");

        var secondLive = async () => await db.ExecuteAsync($"""
            INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [IsLead], [CreatedAt])
            VALUES (NEWID(), '{rows.Exercise}', '{rows.Person}', N'planner', 0, SYSDATETIMEOFFSET());
            """);
        (await secondLive.Should().ThrowAsync<SqlException>()).Which.Number.Should().BeOneOf(2601, 2627);

        var revokedLead = async () => await db.ExecuteAsync(
            $"UPDATE [Enrollments] SET [DeletedAt] = SYSDATETIMEOFFSET() WHERE [Id] = '{rows.LeadEnrollment}';");
        (await revokedLead.Should().ThrowAsync<SqlException>("a lead must be released before it is revoked"))
            .Which.Number.Should().Be(547);

        var revokedParticipant = async () => await db.ExecuteAsync(
            $"UPDATE [Enrollments] SET [DeletedAt] = SYSDATETIMEOFFSET() WHERE [Id] = '{rows.AccountEnrollment}';");
        (await revokedParticipant.Should().ThrowAsync<SqlException>("only a staff enrollment is soft-deleted"))
            .Which.Number.Should().Be(547);

        var badMethods = async () => await db.ExecuteAsync($"UPDATE [Exercises] SET [SignInMethods] = 8 WHERE [Id] = '{rows.Exercise}';");
        (await badMethods.Should().ThrowAsync<SqlException>()).Which.Number.Should().Be(547);
    }

    [RequiresDockerFact]
    public async Task DownThenUp_DropsTheA2Schema_HardDeletesRevokedRows_ThenConverges()
    {
        await using var db = await A1Database.CreateAsync(_fixture);
        await db.MigrateToAsync(MigrationUnderTest);
        var rows = await db.SeedA1RowsAsync();
        await db.ExecuteAsync($"UPDATE [Enrollments] SET [DeletedAt] = SYSDATETIMEOFFSET() WHERE [Id] = '{rows.PlannerEnrollment}';");
        await db.ExecuteAsync($"""
            INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [IsLead], [CreatedAt])
            VALUES (NEWID(), '{rows.Exercise}', '{rows.Person}', N'evaluator', 0, SYSDATETIMEOFFSET());
            INSERT INTO [CredentialTokens] ([Id], [TokenHash], [Purpose], [PersonId], [OrganizationId], [ExpiresAt], [CreatedAt])
            VALUES (NEWID(), N'{new string('A', 64)}', N'reset', '{rows.Person}', '{rows.Organization}',
                    DATEADD(hour, 1, SYSDATETIMEOFFSET()), SYSDATETIMEOFFSET());
            """);

        await db.MigrateToAsync(PreviousMigration);

        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.tables WHERE [name] = 'CredentialTokens'")).Should().Be(0);
        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.columns
            WHERE ([object_id] = OBJECT_ID('Enrollments') AND [name] = 'DeletedAt')
               OR ([object_id] = OBJECT_ID('Exercises') AND [name] = 'SignInMethods')
               OR ([object_id] = OBJECT_ID('People') AND [name] = 'AvatarBlobName')
               OR ([object_id] = OBJECT_ID('MediaAssets') AND [name] = 'UploadedByAccountId')
            """)).Should().Be(0, "Down drops every A2 column");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [Id] = '{rows.PlannerEnrollment}'"))
            .Should().Be(0, "a revoked row is hard-deleted, as a revoke did before A2 (not loss-free — OPERATE.md)");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Enrollments] WHERE [PersonId] = '{rows.Person}' AND [ExerciseId] = '{rows.Exercise}'"))
            .Should().Be(1, "the live re-grant survives, so the restored unfiltered unique index holds");
        (await db.ScalarAsync<string>("SELECT [filter_definition] FROM sys.indexes WHERE [name] = 'IX_Enrollments_ExerciseId_PersonId'"))
            .Should().NotContain("DeletedAt");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>($"SELECT [SignInMethods] FROM [Exercises] WHERE [Id] = '{rows.Exercise}'")).Should().Be(7);
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM sys.tables WHERE [name] = 'CredentialTokens'")).Should().Be(1);
    }

    /// <summary>
    /// The raw SQL of an A1-shaped world (valid at A1 and after A2): an org, an exercise, a person (staff facet) with a
    /// planner enrollment, a lead controller, a participant account with its enrollment, and a media asset. Shared with
    /// <c>IdempotentMigrationScriptTests</c>.
    /// </summary>
    /// <returns>The ids and the SQL that writes them.</returns>
    internal static (A1Rows Rows, string Sql) A1Seed()
    {
        var rows = new A1Rows(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var leadPerson = Guid.NewGuid();
        var sql = $"""
            INSERT INTO [Organizations] ([Id], [Name], [Slug], [CreatedAt])
            VALUES ('{rows.Organization}', N'A2 Org {rows.Organization:N}', N'a2-{rows.Organization:N}', SYSDATETIMEOFFSET());
            INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status], [ComplianceChromeEnabled], [WatermarkEnabled],
                                     [IsPracticeMode], [OrganizationId])
            VALUES ('{rows.Exercise}', N'A2 Exercise', N'UTC', N'live', 1, 1, 0, '{rows.Organization}');
            INSERT INTO [People] ([Id], [OrganizationId], [Email], [DisplayName], [FailedLoginCount], [CreatedAt])
            VALUES ('{rows.Person}', '{rows.Organization}', N'a2.{rows.Person:N}@example.com', N'A2 Planner', 0, SYSDATETIMEOFFSET()),
                   ('{leadPerson}', '{rows.Organization}', NULL, N'A2 Lead', 0, SYSDATETIMEOFFSET());
            INSERT INTO [StaffUsers] ([Id], [OrganizationId], [ExternalSubject], [DisplayName], [CreatedAt])
            VALUES ('{rows.Person}', '{rows.Organization}', N'idp|{rows.Person:N}', N'A2 Planner', SYSDATETIMEOFFSET()),
                   ('{leadPerson}', '{rows.Organization}', N'idp|{leadPerson:N}', N'A2 Lead', SYSDATETIMEOFFSET());
            INSERT INTO [Enrollments] ([Id], [ExerciseId], [PersonId], [Role], [IsLead], [CreatedAt])
            VALUES ('{rows.PlannerEnrollment}', '{rows.Exercise}', '{rows.Person}', N'planner', 0, SYSDATETIMEOFFSET()),
                   ('{rows.LeadEnrollment}', '{rows.Exercise}', '{leadPerson}', N'controller', 1, SYSDATETIMEOFFSET()),
                   ('{rows.AccountEnrollment}', '{rows.Exercise}', NULL, N'participant', 0, SYSDATETIMEOFFSET());
            INSERT INTO [Accounts] ([Id], [ExerciseId], [Username], [DisplayName], [CreatedAt], [FailedLoginCount], [EnrollmentId])
            VALUES ('{rows.Account}', '{rows.Exercise}', N'user_{rows.Account:N}', N'A2 Participant', SYSDATETIMEOFFSET(), 0, '{rows.AccountEnrollment}');
            INSERT INTO [MediaAssets] ([Id], [ExerciseId], [Kind], [ContentType], [BlobName], [Bytes], [OriginalFileName],
                                       [UploadedByHumanId], [CreatedScenarioTime], [CreatedWallClock])
            VALUES ('{rows.MediaAsset}', '{rows.Exercise}', N'image', N'image/png', N'{rows.Exercise:D}/{rows.MediaAsset:N}.png', 10,
                    N'a.png', N'{rows.Person}', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());
            """;
        return (rows, sql);
    }

    /// <summary>A throwaway database migrated to a chosen point, with raw-SQL seeding of the A1 shape.</summary>
    internal sealed class A1Database : IAsyncDisposable
    {
        private readonly string _master;
        private readonly string _name;

        private A1Database(string master, string name, string connectionString)
        {
            _master = master;
            _name = name;
            ConnectionString = connectionString;
        }

        public string ConnectionString { get; }

        public static async Task<A1Database> CreateAsync(MsSqlContainerFixture fixture)
        {
            var name = $"PulseA2Test_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
            await ExecuteOnAsync(master, $"CREATE DATABASE [{name}];");
            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }.ConnectionString;
            return new A1Database(master, name, connectionString);
        }

        public async Task MigrateToAsync(string target)
        {
            await using var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(ConnectionString).Options);
            await context.Database.GetService<IMigrator>().MigrateAsync(target);
        }

        /// <summary>
        /// Seeds an A1-shaped world (valid at A1 and after A2): an org, an exercise, a person (staff facet) with a planner
        /// enrollment, a lead controller, a participant account with its enrollment, and a media asset.
        /// </summary>
        public async Task<A1Rows> SeedA1RowsAsync()
        {
            var (rows, sql) = A1Seed();
            await ExecuteAsync(sql);
            return rows;
        }

        public Task ExecuteAsync(string sql) => ExecuteOnAsync(ConnectionString, sql);

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(ConnectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            var value = await command.ExecuteScalarAsync();
            return value is null or DBNull ? default! : (T)value;
        }

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await ExecuteOnAsync(
                _master,
                $"IF DB_ID('{_name}') IS NOT NULL BEGIN ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_name}]; END");
        }

        private static async Task ExecuteOnAsync(string connectionString, string sql)
        {
            await using var connection = new SqlConnection(connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    /// <summary>The ids <see cref="A1Database.SeedA1RowsAsync"/> wrote.</summary>
    internal sealed record A1Rows(
        Guid Organization,
        Guid Exercise,
        Guid Person,
        Guid PlannerEnrollment,
        Guid LeadEnrollment,
        Guid AccountEnrollment,
        Guid Account,
        Guid MediaAsset);
}
