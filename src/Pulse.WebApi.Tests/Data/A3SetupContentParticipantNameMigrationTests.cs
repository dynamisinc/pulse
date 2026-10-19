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
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// exercise-build-golive/09 (#376, Tier-2 schema) — the A3 migration <c>A3SetupContentParticipantName</c> over a seeded
/// database at the <c>AdminIdentityFoundation</c> shape: one test per backfill branch of <c>Posts.IsSetupContent</c> /
/// <c>Follows.IsSetupContent</c> (ADMIN-IDENTITY-MODEL §5.4) and <c>Exercises.ParticipantName</c> (§8.4), plus the
/// reversible <c>Down</c> and an idempotent Down→Up replay.
/// </summary>
/// <remarks>
/// The backfill rule under test: <c>leftBuildAt</c> is the exercise's earliest <c>exercise.lifecycle.transitioned</c>
/// event whose payload <c>from</c> is <c>build</c> (or the legacy <c>scheduled</c>). A follow is setup when the exercise
/// is in <c>build</c> (or legacy <c>scheduled</c>) now, or was created before <c>leftBuildAt</c>; a post likewise unless it
/// is participant-origin, which is always conduct. No event means conduct (fail safe).
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class A3SetupContentParticipantNameMigrationTests
{
    private const string PreviousMigration = "20261017120000_AdminIdentityFoundation";
    private const string MigrationUnderTest = "20261019230000_A3SetupContentParticipantName";
    private const string Transitioned = "exercise.lifecycle.transitioned";

    private static readonly DateTimeOffset LeftBuildAt = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public A3SetupContentParticipantNameMigrationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task Up_AddsTheThreeColumns_WithTheDeclaredTypesAndDefaults()
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.[object_id] = OBJECT_ID('Exercises') AND c.[name] = 'ParticipantName'
              AND t.[name] = 'nvarchar' AND c.[max_length] = 160 AND c.[is_nullable] = 1
            """)).Should().Be(1, "Exercises.ParticipantName is nvarchar(80) NULL (max_length is in bytes)");

        foreach (var table in new[] { "Posts", "Follows" })
        {
            (await db.ScalarAsync<int>($"""
                SELECT COUNT(*) FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
                JOIN sys.default_constraints d ON d.[object_id] = c.[default_object_id]
                WHERE c.[object_id] = OBJECT_ID('{table}') AND c.[name] = 'IsSetupContent'
                  AND t.[name] = 'bit' AND c.[is_nullable] = 0 AND d.[definition] IN ('((0))', '(CONVERT([bit],(0)))')
                """)).Should().Be(1, "{0}.IsSetupContent is bit NOT NULL DEFAULT 0", table);
        }
    }

    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("scheduled")]
    public async Task Up_InABuildExercise_EveryNonParticipantPostAndEveryFollowIsSetup_AndParticipantPostsAreConduct(
        string status)
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync(status);
        var now = DateTimeOffset.UtcNow;
        var engine = await db.InsertPostAsync(exercise, "engine", now);
        var controller = await db.InsertPostAsync(exercise, "controller-as-persona", now);
        var inject = await db.InsertPostAsync(exercise, "inject", now);
        var participant = await db.InsertPostAsync(exercise, "participant", now);
        var follow = await db.InsertFollowAsync(exercise, now);

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.PostIsSetupAsync(engine)).Should().BeTrue("a build exercise's engine post is setup");
        (await db.PostIsSetupAsync(controller)).Should().BeTrue("a build exercise's controller post is setup");
        (await db.PostIsSetupAsync(inject)).Should().BeTrue("a build exercise's inject post is setup");
        (await db.PostIsSetupAsync(participant)).Should().BeFalse(
            "a participant-origin post is ALWAYS conduct, even in build (Tom-default, story 09 currency check)");
        (await db.FollowIsSetupAsync(follow)).Should().BeTrue("every follow in a build exercise is setup");
    }

    [RequiresDockerTheory]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("completed")]
    public async Task Up_PastBuild_RowsCreatedBeforeTheFirstTransitionOutOfBuild_AreSetup_AndLaterRowsAreConduct(
        string status)
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync(status);

        // A later reopen → build → staged must not move leftBuildAt: the EARLIEST transition out of build wins.
        await db.InsertTelemetryAsync(exercise, Transitioned, """{"from":"build","to":"staged","storedStatusBefore":"build"}""", LeftBuildAt);
        await db.InsertTelemetryAsync(exercise, Transitioned, """{"from":"staged","to":"live","storedStatusBefore":"staged"}""", LeftBuildAt.AddHours(2));
        await db.InsertTelemetryAsync(exercise, Transitioned, """{"from":"build","to":"staged","storedStatusBefore":"build"}""", LeftBuildAt.AddDays(3));

        var setupPost = await db.InsertPostAsync(exercise, "engine", LeftBuildAt.AddMinutes(-1));
        var conductPost = await db.InsertPostAsync(exercise, "engine", LeftBuildAt.AddMinutes(1));
        var atTheInstant = await db.InsertPostAsync(exercise, "controller-as-persona", LeftBuildAt);
        var betweenTransitions = await db.InsertPostAsync(exercise, "inject", LeftBuildAt.AddDays(1));
        var participantBefore = await db.InsertPostAsync(exercise, "participant", LeftBuildAt.AddMinutes(-1));
        var setupFollow = await db.InsertFollowAsync(exercise, LeftBuildAt.AddMinutes(-1));
        var conductFollow = await db.InsertFollowAsync(exercise, LeftBuildAt.AddMinutes(1));

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.PostIsSetupAsync(setupPost)).Should().BeTrue("written before the exercise first left build");
        (await db.PostIsSetupAsync(conductPost)).Should().BeFalse("written after the exercise first left build");
        (await db.PostIsSetupAsync(atTheInstant)).Should().BeFalse("the rule is strictly earlier than leftBuildAt");
        (await db.PostIsSetupAsync(betweenTransitions)).Should().BeFalse(
            "leftBuildAt is the FIRST transition out of build, not a later one");
        (await db.PostIsSetupAsync(participantBefore)).Should().BeFalse("a participant-origin post is always conduct");
        (await db.FollowIsSetupAsync(setupFollow)).Should().BeTrue("a follow created before the exercise first left build");
        (await db.FollowIsSetupAsync(conductFollow)).Should().BeFalse("a follow created after it left build");
    }

    [RequiresDockerFact]
    public async Task Up_AcceptsTheLegacyScheduledLiteral_InTheTransitionsFrom()
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("live");
        await db.InsertTelemetryAsync(exercise, Transitioned, """{"from":"scheduled","to":"live"}""", LeftBuildAt);
        var before = await db.InsertPostAsync(exercise, "engine", LeftBuildAt.AddMinutes(-1));
        var follow = await db.InsertFollowAsync(exercise, LeftBuildAt.AddMinutes(-1));

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.PostIsSetupAsync(before)).Should().BeTrue("a hand-edited legacy 'scheduled' from is read as build");
        (await db.FollowIsSetupAsync(follow)).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task Up_WithNoTransitionOutOfBuild_EveryRowIsConduct_AndAnotherExercisesEventDoesNotCount()
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);

        // Bootstrapped straight into live: only a staged→live transition, a bootstrap event and a malformed payload.
        var noEvent = await db.InsertExerciseAsync("live");
        await db.InsertTelemetryAsync(noEvent, "exercise.bootstrapped", "{}", LeftBuildAt.AddDays(-5));
        await db.InsertTelemetryAsync(noEvent, Transitioned, """{"from":"staged","to":"live"}""", LeftBuildAt);
        await db.InsertTelemetryAsync(noEvent, Transitioned, "not json", LeftBuildAt);
        var post = await db.InsertPostAsync(noEvent, "engine", LeftBuildAt.AddDays(-10));
        var follow = await db.InsertFollowAsync(noEvent, LeftBuildAt.AddDays(-10));

        // Another exercise DID leave build later than these rows were written; its event must not reach noEvent.
        var other = await db.InsertExerciseAsync("live");
        await db.InsertTelemetryAsync(other, Transitioned, """{"from":"build","to":"staged"}""", LeftBuildAt.AddDays(30));

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.PostIsSetupAsync(post)).Should().BeFalse("no transition out of build means conduct (fail safe)");
        (await db.FollowIsSetupAsync(follow)).Should().BeFalse("no transition out of build means conduct (fail safe)");
    }

    [RequiresDockerFact]
    public async Task Up_BackfillsParticipantName_FromWorldNameTruncatedToEighty_AndNeverFromTheInternalName()
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var withWorld = await db.InsertExerciseAsync("live", worldName: "Metro Atlanta");
        var longWorld = await db.InsertExerciseAsync("live", worldName: new string('w', 120));
        var noWorld = await db.InsertExerciseAsync("live", worldName: null);

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.ScalarAsync<string>($"SELECT [ParticipantName] FROM [Exercises] WHERE [Id] = '{withWorld}'"))
            .Should().Be("Metro Atlanta", "the participant-facing name is backfilled from the in-fiction WorldName");
        (await db.ScalarAsync<string>($"SELECT [ParticipantName] FROM [Exercises] WHERE [Id] = '{longWorld}'"))
            .Should().Be(new string('w', 80), "a WorldName longer than the column is truncated to 80");
        (await db.ScalarAsync<string?>($"SELECT [ParticipantName] FROM [Exercises] WHERE [Id] = '{noWorld}'"))
            .Should().BeNull("with no WorldName there is no participant name — NEVER the internal Name (§8.4)");
        (await db.ScalarAsync<int>("SELECT COUNT(*) FROM [Exercises] WHERE [ParticipantName] LIKE N'INTERNAL-%'"))
            .Should().Be(0, "no internal name was copied anywhere");
    }

    [RequiresDockerFact]
    public async Task Down_DropsTheThreeColumns_AndAReplayedUpConverges()
    {
        await using var db = await MigrationDatabase.CreateAsync(_fixture);
        await db.MigrateToAsync(PreviousMigration);
        var exercise = await db.InsertExerciseAsync("build", worldName: "Metro Atlanta");
        var post = await db.InsertPostAsync(exercise, "engine", DateTimeOffset.UtcNow);
        var follow = await db.InsertFollowAsync(exercise, DateTimeOffset.UtcNow);
        await db.MigrateToAsync(MigrationUnderTest);

        await db.MigrateToAsync(PreviousMigration);

        (await db.ScalarAsync<int>("""
            SELECT COUNT(*) FROM sys.columns
            WHERE ([object_id] = OBJECT_ID('Exercises') AND [name] = 'ParticipantName')
               OR ([object_id] IN (OBJECT_ID('Posts'), OBJECT_ID('Follows')) AND [name] = 'IsSetupContent')
            """)).Should().Be(0, "Down removes all three columns");
        (await db.ScalarAsync<int>($"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{post}'"))
            .Should().Be(1, "Down drops columns only; the rows survive");

        await db.MigrateToAsync(MigrationUnderTest);

        (await db.PostIsSetupAsync(post)).Should().BeTrue("a replayed Up re-derives the same flag");
        (await db.FollowIsSetupAsync(follow)).Should().BeTrue();
        (await db.ScalarAsync<string>($"SELECT [ParticipantName] FROM [Exercises] WHERE [Id] = '{exercise}'"))
            .Should().Be("Metro Atlanta");
    }

    /// <summary>A throwaway database, migrated by EF to any target, seeded with raw SQL (the entity model is newer).</summary>
    private sealed class MigrationDatabase : IAsyncDisposable
    {
        private readonly string _master;
        private readonly string _name;
        private readonly string _connectionString;

        private MigrationDatabase(string master, string name, string connectionString)
        {
            _master = master;
            _name = name;
            _connectionString = connectionString;
        }

        public static async Task<MigrationDatabase> CreateAsync(MsSqlContainerFixture fixture)
        {
            var name = $"PulseA3Test_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }.ConnectionString;
            await ExecuteAsync(master, $"CREATE DATABASE [{name}];");
            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }.ConnectionString;
            return new MigrationDatabase(master, name, connectionString);
        }

        public async Task MigrateToAsync(string target)
        {
            await using var context = new PulseDbContext(
                new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options);
            await context.Database.GetService<IMigrator>().MigrateAsync(target);
        }

        /// <summary>Inserts an exercise whose internal Name is an <c>INTERNAL-</c> sentinel (never a participant name).</summary>
        public async Task<Guid> InsertExerciseAsync(string status, string? worldName = null)
        {
            var id = Guid.NewGuid();
            var world = worldName is null ? "NULL" : $"N'{worldName}'";
            await ExecuteAsync(_connectionString, $"""
                INSERT INTO [Exercises] ([Id], [Name], [TimeZone], [Status], [ComplianceChromeEnabled], [WatermarkEnabled],
                                         [IsPracticeMode], [OrganizationId], [WorldName])
                VALUES ('{id}', N'INTERNAL-{id:N}', N'UTC', N'{status}', 1, 1, 0, '{Organization.DefaultOrganizationId}', {world});
                """);
            return id;
        }

        public async Task<Guid> InsertPostAsync(Guid exerciseId, string origin, DateTimeOffset createdWallClock)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(_connectionString, $"""
                INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [Origin],
                                     [ActingHumanId], [CreatedWallClock])
                VALUES ('{id}', '{exerciseId}', '{Guid.NewGuid()}', N'Seeded post', '2033-09-04T13:00:00+00:00',
                        N'{origin}', N'human-1', '{createdWallClock:O}');
                """);
            return id;
        }

        public async Task<Guid> InsertFollowAsync(Guid exerciseId, DateTimeOffset createdWallClock)
        {
            var id = Guid.NewGuid();
            await ExecuteAsync(_connectionString, $"""
                INSERT INTO [Follows] ([Id], [ExerciseId], [FollowerPersonaId], [FolloweePersonaId], [CreatedScenarioTime],
                                       [CreatedWallClock])
                VALUES ('{id}', '{exerciseId}', '{Guid.NewGuid()}', '{Guid.NewGuid()}', '2033-09-04T13:00:00+00:00',
                        '{createdWallClock:O}');
                """);
            return id;
        }

        public async Task InsertTelemetryAsync(Guid exerciseId, string eventType, string payload, DateTimeOffset at)
        {
            await ExecuteAsync(_connectionString, $"""
                INSERT INTO [TelemetryEvents] ([EventId], [SchemaVersion], [ExerciseId], [EventType], [Channel], [Actor_Kind],
                                               [WallClockTime], [ScenarioTime], [TimeZone], [Payload], [EmittedAt])
                VALUES (N'{Guid.NewGuid()}', N'v0', '{exerciseId}', N'{eventType}', N'system', N'system',
                        '{at:O}', '{at:O}', N'UTC', N'{payload}', '{at:O}');
                """);
        }

        public async Task<bool> PostIsSetupAsync(Guid postId) =>
            await ScalarAsync<bool>($"SELECT [IsSetupContent] FROM [Posts] WHERE [Id] = '{postId}'");

        public async Task<bool> FollowIsSetupAsync(Guid followId) =>
            await ScalarAsync<bool>($"SELECT [IsSetupContent] FROM [Follows] WHERE [Id] = '{followId}'");

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            var value = await command.ExecuteScalarAsync();
            return value is null or DBNull ? default! : (T)value;
        }

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await ExecuteAsync(
                _master,
                $"IF DB_ID('{_name}') IS NOT NULL BEGIN ALTER DATABASE [{_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_name}]; END");
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
}
