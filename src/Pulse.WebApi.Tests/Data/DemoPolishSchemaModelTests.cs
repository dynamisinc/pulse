namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// demo-polish B1 (<c>docs/features/demo-polish/02-schema-media-replies-reactions.md</c>) — the STRUCTURAL proof
/// that the EF model matches the frozen contract (<c>implementation.md</c> §1.2 entities, §1.3 configuration).
/// Model-only: they read <see cref="PulseDbContext.Model"/> without opening a connection, so they run everywhere
/// (no Docker). The database-level proofs (legacy rows survive, unique indexes reject duplicates, Restrict holds
/// at the server) live in <see cref="DemoPolishMigrationTests"/>.
/// </summary>
public class DemoPolishSchemaModelTests
{
    private static PulseDbContext BuildModelOnlyContext()
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer("Server=model-only;Database=none;")
            .Options;
        return new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = Guid.NewGuid() });
    }

    private static IEntityType EntityOf<TEntity>(PulseDbContext context) =>
        context.Model.FindEntityType(typeof(TEntity))
        ?? throw new InvalidOperationException($"{typeof(TEntity).Name} is not in the EF model.");

    // AC-1 — names, types, nullability and lengths per §1.2. One row per mapped column the contract names.
    [Theory]
    [InlineData(typeof(MediaAsset), "Id", typeof(Guid), false, null)]
    [InlineData(typeof(MediaAsset), "ExerciseId", typeof(Guid), false, null)]
    [InlineData(typeof(MediaAsset), "Kind", typeof(string), false, 16)]
    [InlineData(typeof(MediaAsset), "ContentType", typeof(string), false, 64)]
    [InlineData(typeof(MediaAsset), "BlobName", typeof(string), false, 256)]
    [InlineData(typeof(MediaAsset), "Bytes", typeof(long), false, null)]
    [InlineData(typeof(MediaAsset), "Width", typeof(int?), true, null)]
    [InlineData(typeof(MediaAsset), "Height", typeof(int?), true, null)]
    [InlineData(typeof(MediaAsset), "DurationSec", typeof(double?), true, null)]
    [InlineData(typeof(MediaAsset), "OriginalFileName", typeof(string), false, 255)]
    [InlineData(typeof(MediaAsset), "UploadedByHumanId", typeof(string), false, 256)]
    [InlineData(typeof(MediaAsset), "CreatedScenarioTime", typeof(DateTimeOffset), false, null)]
    [InlineData(typeof(MediaAsset), "CreatedWallClock", typeof(DateTimeOffset), false, null)]
    [InlineData(typeof(MediaAsset), "PosterMediaAssetId", typeof(Guid?), true, null)]
    [InlineData(typeof(PostMediaItem), "Id", typeof(Guid), false, null)]
    [InlineData(typeof(PostMediaItem), "ExerciseId", typeof(Guid), false, null)]
    [InlineData(typeof(PostMediaItem), "PostId", typeof(Guid), false, null)]
    [InlineData(typeof(PostMediaItem), "MediaAssetId", typeof(Guid), false, null)]
    [InlineData(typeof(PostMediaItem), "PosterMediaAssetId", typeof(Guid?), true, null)]
    [InlineData(typeof(PostMediaItem), "Alt", typeof(string), false, 1000)]
    [InlineData(typeof(PostMediaItem), "Order", typeof(int), false, null)]
    [InlineData(typeof(PostReaction), "Id", typeof(Guid), false, null)]
    [InlineData(typeof(PostReaction), "ExerciseId", typeof(Guid), false, null)]
    [InlineData(typeof(PostReaction), "PostId", typeof(Guid), false, null)]
    [InlineData(typeof(PostReaction), "PersonaId", typeof(Guid), false, null)]
    [InlineData(typeof(PostReaction), "Kind", typeof(string), false, 16)]
    [InlineData(typeof(PostReaction), "CreatedScenarioTime", typeof(DateTimeOffset), false, null)]
    [InlineData(typeof(PostReaction), "DeletedAt", typeof(DateTimeOffset?), true, null)] // DP-15 soft delete
    [InlineData(typeof(Post), "ParentPostId", typeof(Guid?), true, null)]
    [InlineData(typeof(Post), "BaselineLikeCount", typeof(int), false, null)]
    [InlineData(typeof(Post), "BaselineRepostCount", typeof(int), false, null)]
    [InlineData(typeof(Post), "BaselineReplyCount", typeof(int), false, null)]
    [InlineData(typeof(Persona), "AvatarMediaId", typeof(Guid?), true, null)]
    [InlineData(typeof(Persona), "BannerMediaId", typeof(Guid?), true, null)]
    [InlineData(typeof(Persona), "Location", typeof(string), true, 100)]
    public void FrozenColumn_HasTheContractedTypeNullabilityAndLength(
        Type entity, string property, Type clrType, bool nullable, int? maxLength)
    {
        using var context = BuildModelOnlyContext();

        var column = context.Model.FindEntityType(entity)?.FindProperty(property);

        column.Should().NotBeNull("{0}.{1} is in the frozen §1.2 shape", entity.Name, property);
        column!.ClrType.Should().Be(clrType, "{0}.{1}'s CLR type is frozen", entity.Name, property);
        column.IsNullable.Should().Be(nullable, "{0}.{1}'s nullability is frozen", entity.Name, property);
        column.GetMaxLength().Should().Be(maxLength, "{0}.{1}'s length is frozen", entity.Name, property);
    }

    [Theory]
    [InlineData(typeof(MediaAsset), new[]
    {
        "Id", "ExerciseId", "Kind", "ContentType", "BlobName", "Bytes", "Width", "Height", "DurationSec",
        "OriginalFileName", "UploadedByHumanId", "CreatedScenarioTime", "CreatedWallClock", "PosterMediaAssetId",
    })]
    [InlineData(typeof(PostMediaItem), new[]
    {
        "Id", "ExerciseId", "PostId", "MediaAssetId", "PosterMediaAssetId", "Alt", "Order",
    })]
    [InlineData(typeof(PostReaction), new[]
    {
        "Id", "ExerciseId", "PostId", "PersonaId", "Kind", "CreatedScenarioTime", "DeletedAt",
    })]
    public void NewEntity_MapsExactlyTheFrozenColumns_AndNoNavigations(Type entity, string[] columns)
    {
        using var context = BuildModelOnlyContext();

        var entityType = context.Model.FindEntityType(entity);

        entityType.Should().NotBeNull();
        entityType!.GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            columns, "{0} must map exactly the §1.2 columns — no more, no fewer", entity.Name);
        entityType.GetNavigations().Should().BeEmpty(
            "§1.3: no navigation properties — readers join explicitly (avoids query-filter / fix-up surprises)");
    }

    [Fact]
    public void NewEntities_AreExerciseScoped_WithARequiredIndexedExerciseId()
    {
        using var context = BuildModelOnlyContext();

        foreach (var type in new[] { typeof(MediaAsset), typeof(PostMediaItem), typeof(PostReaction) })
        {
            typeof(IExerciseScoped).IsAssignableFrom(type).Should().BeTrue(
                "{0} is exercise-scoped by the frozen contract (DP-2 for PostMediaItem)", type.Name);

            var entityType = context.Model.FindEntityType(type)!;
            entityType.FindProperty(nameof(IExerciseScoped.ExerciseId))!.IsNullable.Should().BeFalse();
            entityType.GetIndexes()
                .Should().Contain(
                    i => i.Properties.Count == 1 && i.Properties[0].Name == nameof(IExerciseScoped.ExerciseId),
                    "{0} carries the standard scoped lookup index (house style — Follow)", type.Name);
        }
    }

    // AC-2 — the four contracted indexes, by their database names (+ the scoped lookup indexes). The reaction
    // key is FILTERED to active rows (DP-15): un-liked history rows never collide with a re-like.
    [Theory]
    [InlineData(typeof(PostReaction), "IX_PostReactions_PostId_PersonaId_Kind", new[] { "PostId", "PersonaId", "Kind" }, true, "[DeletedAt] IS NULL")]
    [InlineData(typeof(PostMediaItem), "IX_PostMediaItems_PostId_Order", new[] { "PostId", "Order" }, true, null)]
    [InlineData(typeof(MediaAsset), "IX_MediaAssets_BlobName", new[] { "BlobName" }, true, null)]
    [InlineData(typeof(Post), "IX_Posts_ParentPostId", new[] { "ParentPostId" }, false, null)]
    [InlineData(typeof(MediaAsset), "IX_MediaAssets_ExerciseId", new[] { "ExerciseId" }, false, null)]
    [InlineData(typeof(PostMediaItem), "IX_PostMediaItems_ExerciseId", new[] { "ExerciseId" }, false, null)]
    [InlineData(typeof(PostReaction), "IX_PostReactions_ExerciseId", new[] { "ExerciseId" }, false, null)]
    public void ContractedIndex_Exists_WithItsColumnsUniquenessAndFilter(
        Type entity, string name, string[] columns, bool unique, string? filter)
    {
        using var context = BuildModelOnlyContext();

        var index = context.Model.FindEntityType(entity)!.GetIndexes()
            .SingleOrDefault(i => i.GetDatabaseName() == name);

        index.Should().NotBeNull("§1.3 names the index {0}", name);
        index!.Properties.Select(p => p.Name).Should().Equal(columns, "{0}'s key columns are frozen, in order", name);
        index.IsUnique.Should().Be(unique, "{0}'s uniqueness is frozen", name);
        index.GetFilter().Should().Be(filter, "{0}'s filter is frozen (DP-15 for the reaction key)", name);
    }

    // AC-2 — every FK is Restrict (no cascade path; no hard-delete path, XC-010).
    [Fact]
    public void EveryRelationalForeignKey_IsRestrictOrNoAction_SoNoCascadePathExists()
    {
        using var context = BuildModelOnlyContext();

        var cascading = context.Model.GetEntityTypes()
            .SelectMany(t => t.GetForeignKeys())
            .Where(fk => !fk.IsOwnership) // owned types (TelemetryActor, review-item JSON) are not relational FKs
            .Where(fk => fk.DeleteBehavior is not (DeleteBehavior.Restrict or DeleteBehavior.NoAction or DeleteBehavior.ClientNoAction))
            .Select(fk => $"{fk.DeclaringEntityType.ClrType.Name}.{string.Join(",", fk.Properties.Select(p => p.Name))} ({fk.DeleteBehavior})")
            .ToList();

        cascading.Should().BeEmpty(
            "every foreign key is Restrict/NoAction: a cascade path could hard-delete exercise history (XC-010) " +
            "and two of them would trip SQL Server's multiple-cascade-path error");
    }

    [Theory]
    [InlineData(typeof(MediaAsset), "PosterMediaAssetId", typeof(MediaAsset))]
    [InlineData(typeof(PostMediaItem), "PostId", typeof(Post))]
    [InlineData(typeof(PostMediaItem), "MediaAssetId", typeof(MediaAsset))]
    [InlineData(typeof(PostMediaItem), "PosterMediaAssetId", typeof(MediaAsset))]
    [InlineData(typeof(PostReaction), "PostId", typeof(Post))]
    [InlineData(typeof(Post), "ParentPostId", typeof(Post))]
    [InlineData(typeof(Persona), "AvatarMediaId", typeof(MediaAsset))]
    [InlineData(typeof(Persona), "BannerMediaId", typeof(MediaAsset))]
    public void ContractedForeignKey_Exists_AndIsRestrict(Type dependent, string property, Type principal)
    {
        using var context = BuildModelOnlyContext();

        var foreignKey = context.Model.FindEntityType(dependent)!.GetForeignKeys()
            .SingleOrDefault(fk => fk.Properties.Count == 1 && fk.Properties[0].Name == property);

        foreignKey.Should().NotBeNull("§1.2/§1.3 make {0}.{1} a foreign key", dependent.Name, property);
        foreignKey!.PrincipalEntityType.ClrType.Should().Be(principal);
        foreignKey.DeleteBehavior.Should().Be(DeleteBehavior.Restrict, "§1.3: every FK is Restrict");
    }

    [Fact]
    public void PostReactionPersonaId_IsALogicalReference_WithNoForeignKey()
    {
        using var context = BuildModelOnlyContext();

        EntityOf<PostReaction>(context).GetForeignKeys()
            .Should().NotContain(
                fk => fk.Properties.Any(p => p.Name == nameof(PostReaction.PersonaId)),
                "PersonaId is a logical reference resolved through the scoped Personas set (house style — Follow)");
    }

    [Fact]
    public void PostBaselines_DefaultToZero_SoExistingRowsBackfill()
    {
        using var context = BuildModelOnlyContext();
        var post = EntityOf<Post>(context);

        foreach (var name in new[]
                 {
                     nameof(Post.BaselineLikeCount), nameof(Post.BaselineRepostCount), nameof(Post.BaselineReplyCount),
                 })
        {
            post.FindProperty(name)!.GetDefaultValue().Should().Be(
                0, "{0} is NOT NULL DEFAULT 0 so the migration backfills existing posts", name);
        }
    }

    [Fact]
    public void Vocabularies_AreTheFrozenLiterals()
    {
        MediaKinds.Image.Should().Be("image");
        MediaKinds.Video.Should().Be("video");
        ReactionKinds.Like.Should().Be("like");
        ReactionKinds.Repost.Should().Be("repost");
        Persona.MaxLocationLength.Should().Be(100);
    }
}
