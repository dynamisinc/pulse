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
/// demo-feedback story 33 (#588, DF-49): the proofs for its ONE migration, <c>DemoFeedbackNamedLookalikePairs</c>, which
/// adds the nullable <c>Personas.ImitatesPersonaId</c> column and nothing else (a logical reference: no foreign key, no
/// index). Model-only. The column is covered by the central exercise filter and write guard because
/// <see cref="Persona"/> is already <see cref="IExerciseScoped"/>; the deploy-script replay is
/// <see cref="IdempotentMigrationScriptTests"/>.
/// </summary>
public sealed class NamedLookalikePairsMigrationTests
{
    private const string PreviousMigration = "20261015192237_DemoFeedbackWave4RuntimeAndEdits";

    private const string MigrationName = "DemoFeedbackNamedLookalikePairs";

    [Fact]
    public void TheMigration_IsTheStorysOnlyOne_DirectlyAfterWave4()
    {
        using var context = ModelOnlyContext();
        var migrations = context.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "DemoFeedbackNamedLookalikePairs exists as story 33's one migration");
        migrations.Count(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal)).Should().Be(1);
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of the Wave 4 migration");
    }

    [Fact]
    public void ImitatesPersonaId_IsANullableGuid_WithNoForeignKeyAndNoIndex()
    {
        using var context = ModelOnlyContext();
        var persona = context.Model.FindEntityType(typeof(Persona))!;
        var column = persona.FindProperty(nameof(Persona.ImitatesPersonaId))!;

        column.Should().NotBeNull();
        column.IsNullable.Should().BeTrue("every pre-existing persona reads NULL: no named pair");
        column.ClrType.Should().Be<Guid?>();
        persona.GetForeignKeys().Should().NotContain(
            fk => fk.Properties.Any(p => p.Name == nameof(Persona.ImitatesPersonaId)), "a logical reference, as PostReaction/NoisePost");
        persona.GetIndexes().Should().NotContain(
            ix => ix.Properties.Any(p => p.Name == nameof(Persona.ImitatesPersonaId)));
        typeof(IExerciseScoped).IsAssignableFrom(typeof(Persona)).Should().BeTrue(
            "the column rides the central exercise filter and write guard with its row");
    }

    [Fact]
    public void Up_AddsOnlyTheNullableColumn_AndDown_DropsOnlyIt()
    {
        var migration = new DemoFeedbackNamedLookalikePairs();

        var add = migration.UpOperations.Should().ContainSingle("a regeneration must not slip in other changes").Subject
            .Should().BeOfType<AddColumnOperation>().Subject;
        add.Table.Should().Be("Personas");
        add.Name.Should().Be(nameof(Persona.ImitatesPersonaId));
        add.ClrType.Should().Be<Guid>();
        add.IsNullable.Should().BeTrue();

        var drop = migration.DownOperations.Should().ContainSingle().Subject
            .Should().BeOfType<DropColumnOperation>().Subject;
        drop.Table.Should().Be("Personas");
        drop.Name.Should().Be(nameof(Persona.ImitatesPersonaId));
    }

    private static PulseDbContext ModelOnlyContext() =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);
}
