namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Migrations;
using Xunit;

/// <summary>
/// engine-runtime/08 (CLK-2, W-1): the proofs for its ONE migration, <c>EngineRuntimeScenarioNowPostIndex</c>, which adds
/// the <c>(ExerciseId, CreatedScenarioTime)</c> index on <c>Posts</c> that serves the scenario-now resolver's
/// <c>MAX(CreatedScenarioTime) WHERE ExerciseId = @id</c>, and nothing else. Model-only; the deploy-script replay is
/// <see cref="IdempotentMigrationScriptTests"/>.
/// </summary>
public sealed class ScenarioNowPostIndexMigrationTests
{
    private const string PreviousMigration = "20261017120000_AdminIdentityFoundation";

    private const string MigrationName = "EngineRuntimeScenarioNowPostIndex";

    private const string IndexName = "IX_Posts_ExerciseId_CreatedScenarioTime";

    [Fact]
    public void TheMigration_IsTheStorysOnlyOne_DirectlyAfterAdminIdentityFoundation()
    {
        using var context = ModelOnlyContext();
        var migrations = context.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "EngineRuntimeScenarioNowPostIndex exists as story 08's one migration");
        migrations.Count(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal)).Should().Be(1);
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of AdminIdentityFoundation");
    }

    [Fact]
    public void Post_HasTheExerciseIdThenCreatedScenarioTimeIndex_AndKeepsTheExerciseIdIndex()
    {
        using var context = ModelOnlyContext();
        var post = context.Model.FindEntityType(typeof(Post))!;

        var composite = post.GetIndexes().Should().ContainSingle(
                ix => ix.Properties.Select(p => p.Name).SequenceEqual(
                    new[] { nameof(Post.ExerciseId), nameof(Post.CreatedScenarioTime) }),
                "the scenario-now MAX is one seek per exercise, ExerciseId leading")
            .Subject;
        composite.GetFilter().Should().BeNull("every post counts toward scenario now, soft-deleted ones included");
        composite.IsUnique.Should().BeFalse();
        composite.GetDatabaseName().Should().Be(IndexName);

        post.GetIndexes().Should().Contain(
            ix => ix.Properties.Count == 1 && ix.Properties[0].Name == nameof(Post.ExerciseId),
            "the single-column ExerciseId index is kept (this story only adds an index)");
    }

    [Fact]
    public void Up_CreatesOnlyTheIndex_AndDown_DropsOnlyIt()
    {
        var migration = new EngineRuntimeScenarioNowPostIndex();

        var create = migration.UpOperations.Should().ContainSingle("a regeneration must not slip in other changes").Subject
            .Should().BeOfType<CreateIndexOperation>().Subject;
        create.Name.Should().Be(IndexName);
        create.Table.Should().Be("Posts");
        create.Columns.Should().Equal(nameof(Post.ExerciseId), nameof(Post.CreatedScenarioTime));
        create.IsUnique.Should().BeFalse();
        create.Filter.Should().BeNull();

        var drop = migration.DownOperations.Should().ContainSingle().Subject
            .Should().BeOfType<DropIndexOperation>().Subject;
        drop.Name.Should().Be(IndexName);
        drop.Table.Should().Be("Posts");
    }

    private static PulseDbContext ModelOnlyContext() =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);
}
