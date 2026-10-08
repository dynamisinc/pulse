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
/// demo-polish B1 (<c>docs/features/demo-polish/02-schema-media-replies-reactions.md</c>) — the database-level
/// proofs for the push's ONE migration, <c>DemoPolishMediaRepliesReactions</c>, against a REAL SQL Server:
/// <list type="bullet">
///   <item><description>legacy <c>Posts</c>/<c>Personas</c> rows survive <c>Migrate()</c> from
///   <c>ExerciseCreatedAt</c> with <c>ParentPostId NULL</c>, baselines <c>0</c>, avatar/banner/location
///   <c>NULL</c> (the idempotent-SCRIPT path is proven separately in
///   <see cref="IdempotentMigrationScriptTests"/>);</description></item>
///   <item><description>the three unique indexes reject duplicates — the ACTIVE reaction triple (filtered to
///   <c>[DeletedAt] IS NULL</c>, DP-15: an un-like then re-like is allowed), the media <c>(PostId, [Order])</c>
///   slot, and <c>BlobName</c>; and</description></item>
///   <item><description>the foreign keys are <c>NO ACTION</c> at the server: a hard delete of a referenced row is
///   refused and removes nothing (XC-010).</description></item>
/// </list>
/// Every test is <see cref="RequiresDockerFactAttribute"/> (Gate-1 W-001). The structural (model-only) proofs
/// are in <see cref="DemoPolishSchemaModelTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class DemoPolishMigrationTests
{
    /// <summary>The migration immediately before the one under test — the UAT shape on deploy day.</summary>
    private const string PreviousMigration = "20260802124443_ExerciseCreatedAt";

    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private readonly MsSqlContainerFixture _fixture;

    public DemoPolishMigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Up_KeepsLegacyPostsAndPersonas_WithNullReplyMediaLocation_AndZeroBaselines()
    {
        await using var database = await EphemeralDatabase.CreateAsync(_fixture);
        await database.MigrateToAsync(PreviousMigration);

        var postId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        await database.ExecuteAsync($"""
            INSERT INTO [Posts] ([Id], [ExerciseId], [AuthorPersonaId], [Body], [CreatedScenarioTime], [Origin],
                                 [ActingHumanId], [CreatedWallClock])
            VALUES ('{postId}', '{Guid.NewGuid()}', '{personaId}', N'Legacy post', '2033-09-04T13:00:00+00:00',
                    N'participant', N'human-legacy', SYSDATETIMEOFFSET());
            INSERT INTO [Personas] ([Id], [ExerciseId], [DisplayName], [Handle], [Kind], [Verified])
            VALUES ('{personaId}', '{Guid.NewGuid()}', N'Legacy Persona', N'legacy_{personaId:N}', N'human', 1);
            """);

        await database.MigrateToLatestAsync();

        // Raw SQL, independent of the entity model.
        (await database.ScalarAsync<int>("SELECT COUNT(*) FROM [Posts];")).Should().Be(1, "no post may be lost");
        (await database.ScalarAsync<int>("SELECT COUNT(*) FROM [Personas];")).Should().Be(1, "no persona may be lost");

        (await database.ScalarAsync<string>($"SELECT [Body] FROM [Posts] WHERE [Id] = '{postId}';"))
            .Should().Be("Legacy post");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Posts] WHERE [Id] = '{postId}' AND [ParentPostId] IS NULL " +
                "AND [BaselineLikeCount] = 0 AND [BaselineRepostCount] = 0 AND [BaselineReplyCount] = 0;"))
            .Should().Be(1, "a legacy post reads ParentPostId NULL (top-level) and every baseline 0");

        (await database.ScalarAsync<string>($"SELECT [DisplayName] FROM [Personas] WHERE [Id] = '{personaId}';"))
            .Should().Be("Legacy Persona");
        (await database.ScalarAsync<int>(
                $"SELECT COUNT(*) FROM [Personas] WHERE [Id] = '{personaId}' AND [AvatarMediaId] IS NULL " +
                "AND [BannerMediaId] IS NULL AND [Location] IS NULL AND [Verified] = 1;"))
            .Should().Be(1, "a legacy persona reads avatar/banner/location NULL and keeps its existing columns");
    }

    [RequiresDockerFact]
    public async Task UniqueIndex_RejectsASecondActiveReaction_ButAllowsTheOtherKind()
    {
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var personaId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseId));
            seed.PostReactions.Add(NewReaction(exerciseId, postId, personaId, ReactionKinds.Like));
            seed.PostReactions.Add(NewReaction(exerciseId, postId, personaId, ReactionKinds.Repost));
            await seed.SaveChangesAsync();
        }

        await AssertActiveDuplicateLikeIsRejectedAsync(exerciseId, postId, personaId);

        await using var verify = _fixture.CreateContext();
        (await verify.PostReactions.IgnoreQueryFilters().CountAsync(r => r.PostId == postId)).Should().Be(
            2, "the like and the repost coexist (Kind is in the key); the duplicate active like never landed");
    }

    [RequiresDockerFact]
    public async Task UniqueIndex_AllowsAReLikeAfterAnUnlike_KeepingTheInactiveRowAsHistory()
    {
        // DP-15: un-liking SOFT-deletes (DeletedAt set, never a hard delete — XC-010) and a re-like inserts a NEW
        // row. The unique index is filtered to active rows, so the history row never collides with the re-like —
        // while a second ACTIVE like is still refused.
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var firstLike = NewReaction(exerciseId, postId, personaId, ReactionKinds.Like);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseId));
            seed.PostReactions.Add(firstLike);
            await seed.SaveChangesAsync();
        }

        await using (var unlike = _fixture.CreateContext())
        {
            var row = await unlike.PostReactions.IgnoreQueryFilters().SingleAsync(r => r.Id == firstLike.Id);
            row.DeletedAt = new DateTimeOffset(2033, 9, 4, 13, 20, 0, TimeSpan.Zero);
            await unlike.SaveChangesAsync();
        }

        var reLike = NewReaction(exerciseId, postId, personaId, ReactionKinds.Like);
        await using (var write = _fixture.CreateContext())
        {
            write.PostReactions.Add(reLike);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().NotThrowAsync(
                "an un-liked (DeletedAt set) row is outside the filtered unique index, so re-liking is allowed");
        }

        await AssertActiveDuplicateLikeIsRejectedAsync(exerciseId, postId, personaId);

        await using var verify = _fixture.CreateContext();
        var likes = await verify.PostReactions.IgnoreQueryFilters()
            .Where(r => r.PostId == postId && r.PersonaId == personaId && r.Kind == ReactionKinds.Like)
            .ToListAsync();
        likes.Should().HaveCount(2, "the un-liked row stays as history and the re-like is a NEW row (never revived)");
        likes.Should().ContainSingle(r => r.DeletedAt == null)
            .Which.Id.Should().Be(reLike.Id, "exactly one like is active — the re-like");
    }

    /// <summary>A second ACTIVE like by the same persona on the same post must be refused by the server.</summary>
    private async Task AssertActiveDuplicateLikeIsRejectedAsync(Guid exerciseId, Guid postId, Guid personaId)
    {
        await using var duplicate = _fixture.CreateContext();
        duplicate.PostReactions.Add(NewReaction(exerciseId, postId, personaId, ReactionKinds.Like));

        var act = async () => await duplicate.SaveChangesAsync();

        (await act.Should().ThrowAsync<DbUpdateException>(
                "IX_PostReactions_PostId_PersonaId_Kind is UNIQUE over ACTIVE rows: one active like per (post, persona)"))
            .WithInnerException<SqlException>()
            .Which.Number.Should().BeOneOf(DuplicateKeyErrors);
    }

    [RequiresDockerFact]
    public async Task UniqueIndex_RejectsASecondItemInTheSameMediaSlot_ButAllowsTheNextSlot()
    {
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var mediaA = Guid.NewGuid();
        var mediaB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseId));
            seed.MediaAssets.Add(NewMediaAsset(mediaA, exerciseId));
            seed.MediaAssets.Add(NewMediaAsset(mediaB, exerciseId));
            seed.PostMediaItems.Add(NewMediaItem(exerciseId, postId, mediaA, order: 0));
            seed.PostMediaItems.Add(NewMediaItem(exerciseId, postId, mediaB, order: 1));
            await seed.SaveChangesAsync();
        }

        await using var duplicate = _fixture.CreateContext();
        duplicate.PostMediaItems.Add(NewMediaItem(exerciseId, postId, mediaB, order: 0));

        var act = async () => await duplicate.SaveChangesAsync();

        (await act.Should().ThrowAsync<DbUpdateException>(
                "IX_PostMediaItems_PostId_Order is UNIQUE: one item per display slot"))
            .WithInnerException<SqlException>()
            .Which.Number.Should().BeOneOf(DuplicateKeyErrors);

        await using var verify = _fixture.CreateContext();
        (await verify.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.PostId == postId)).Should().Be(
            2, "slots 0 and 1 coexist; the duplicate slot-0 item never landed");
    }

    [RequiresDockerFact]
    public async Task UniqueIndex_RejectsASecondAssetWithTheSameBlobName()
    {
        var exerciseId = Guid.NewGuid();
        var first = NewMediaAsset(Guid.NewGuid(), exerciseId);

        await using (var seed = _fixture.CreateContext())
        {
            seed.MediaAssets.Add(first);
            await seed.SaveChangesAsync();
        }

        var secondId = Guid.NewGuid();
        await using var duplicate = _fixture.CreateContext();
        var second = NewMediaAsset(secondId, exerciseId);
        second.BlobName = first.BlobName;
        duplicate.MediaAssets.Add(second);

        var act = async () => await duplicate.SaveChangesAsync();

        (await act.Should().ThrowAsync<DbUpdateException>(
                "IX_MediaAssets_BlobName is UNIQUE: two rows can never point at one blob"))
            .WithInnerException<SqlException>()
            .Which.Number.Should().BeOneOf(DuplicateKeyErrors);

        await using var verify = _fixture.CreateContext();
        (await verify.MediaAssets.IgnoreQueryFilters().CountAsync(m => m.Id == secondId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task ForeignKeys_AreNoActionAtTheServer_SoAHardDeleteOfAReferencedPostIsRefused()
    {
        // XC-010: no cascade path exists. A raw DELETE of a post that has a reply, a reaction and a media item is
        // refused by the server and removes NOTHING — not the post, and not (by cascade) any of its dependants.
        var exerciseId = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var replyId = Guid.NewGuid();
        var mediaId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseId));
            var reply = NewPost(replyId, exerciseId);
            reply.ParentPostId = postId;
            seed.Posts.Add(reply);
            seed.MediaAssets.Add(NewMediaAsset(mediaId, exerciseId));
            seed.PostMediaItems.Add(NewMediaItem(exerciseId, postId, mediaId, order: 0));
            seed.PostReactions.Add(NewReaction(exerciseId, postId, Guid.NewGuid(), ReactionKinds.Like));
            await seed.SaveChangesAsync();
        }

        await using var delete = _fixture.CreateContext();
        var act = async () => await delete.Database.ExecuteSqlAsync($"DELETE FROM [Posts] WHERE [Id] = {postId};");

        (await act.Should().ThrowAsync<SqlException>("a referenced post cannot be hard-deleted"))
            .Which.Number.Should().Be(547, "547 is SQL Server's FK constraint conflict");

        await using var verify = _fixture.CreateContext();
        (await verify.Posts.IgnoreQueryFilters().CountAsync(p => p.Id == postId || p.Id == replyId)).Should().Be(2);
        (await verify.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.PostId == postId)).Should().Be(1);
        (await verify.PostReactions.IgnoreQueryFilters().CountAsync(r => r.PostId == postId)).Should().Be(1);
    }

    private static Post NewPost(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = $"Post {id:N}",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero),
        Origin = "participant",
        ActingHumanId = "human-test",
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
    };

    private static MediaAsset NewMediaAsset(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        Kind = MediaKinds.Image,
        ContentType = "image/jpeg",
        BlobName = $"{exerciseId:D}/{id:N}.jpg",
        Bytes = 4096,
        Width = 1200,
        Height = 800,
        OriginalFileName = "street.jpg",
        UploadedByHumanId = "human-test",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 12, 50, 0, TimeSpan.Zero),
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 10, 0, TimeSpan.Zero),
    };

    private static PostMediaItem NewMediaItem(Guid exerciseId, Guid postId, Guid mediaAssetId, int order) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PostId = postId,
        MediaAssetId = mediaAssetId,
        Alt = $"Photo {order}",
        Order = order,
    };

    private static PostReaction NewReaction(Guid exerciseId, Guid postId, Guid personaId, string kind) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PostId = postId,
        PersonaId = personaId,
        Kind = kind,
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.Zero),
    };

    /// <summary>
    /// A throwaway database on the same real SQL Server the shared fixture resolved, created per test and
    /// dropped on disposal, so migrating FROM an older migration never touches the collection's shared database.
    /// Deliberately a local copy of the sibling migration tests' helpers (each is private to its class).
    /// </summary>
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
            var name = $"PulseDemoPolishTest_{Guid.NewGuid():N}";
            var master = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = "master" }
                .ConnectionString;

            await ExecuteNonQueryAsync(master, $"CREATE DATABASE [{name}];");

            var connectionString = new SqlConnectionStringBuilder(fixture.ConnectionString) { InitialCatalog = name }
                .ConnectionString;

            return new EphemeralDatabase(master, name, connectionString);
        }

        /// <summary>Applies (or rolls back to) the given migration through EF.</summary>
        public async Task MigrateToAsync(string targetMigration)
        {
            await using var context = NewContext();
            await context.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }

        /// <summary>Applies every pending migration — the runtime <c>Migrate()</c> path.</summary>
        public async Task MigrateToLatestAsync()
        {
            await using var context = NewContext();
            await context.Database.MigrateAsync();
        }

        /// <summary>Runs raw SQL against this database.</summary>
        public Task ExecuteAsync(string sql) => ExecuteNonQueryAsync(_connectionString, sql);

        /// <summary>Runs a raw scalar query against this database.</summary>
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

        private PulseDbContext NewContext() =>
            new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer(_connectionString).Options);

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
