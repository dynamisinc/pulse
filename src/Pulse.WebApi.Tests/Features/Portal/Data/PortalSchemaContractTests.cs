namespace Pulse.WebApi.Tests.Features.Portal.Data;

using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// exercise-portal/01 (Q-28, Q-35) — the schema contract over F01's portal tables. Model-only, so it runs everywhere:
/// <list type="bullet">
///   <item><description>the EF model's <see cref="PortalConfig"/> and <see cref="PortalResource"/> columns and their
///   nullability equal the PC-2 table in <c>docs/features/exercise-portal/implementation.md</c>, read from the file
///   itself, so a drift on either side fails the build;</description></item>
///   <item><description>the unique-per-exercise config index and the per-exercise <c>SortOrder</c> index;</description></item>
///   <item><description>no <c>PortalDisplay</c> exists (model, context, assembly; Deferred, Q-35);</description></item>
///   <item><description>only F01's M1 touches the portal tables, so this feature adds no migration;</description></item>
///   <item><description>nothing in <c>Features/Portal</c> hard-deletes or bypasses the filters (XC-010).</description></item>
/// </list>
/// </summary>
public class PortalSchemaContractTests
{
    private const string ImplementationDoc = "docs/features/exercise-portal/implementation.md";

    private static readonly string[] PortalTables = ["PortalConfigs", "PortalResources", "PortalDisplays"];

    public static TheoryData<Type, string> Pc2Rows => new()
    {
        { typeof(PortalConfig), "PortalConfig" },
        { typeof(PortalResource), "PortalResource" },
    };

    [Theory]
    [MemberData(nameof(Pc2Rows))]
    public void TheEfModelsColumns_AreExactlyThePc2Table_NamesAndNullability(Type type, string pc2Name)
    {
        var expected = ReadPc2Columns(pc2Name);
        using var context = ModelOnlyContext();
        var entity = context.Model.FindEntityType(type)!;

        var actual = entity.GetProperties().ToDictionary(p => p.Name, p => p.IsNullable);

        actual.Should().BeEquivalentTo(
            expected,
            "PC-2 is the frozen contract for {0}; change the doc and the entity together (additive only, via the orchestrator)",
            pc2Name);
    }

    [Fact]
    public void ThePc2Parser_ReadsTheDocumentedColumns()
    {
        // Guards the parser: if the table's layout changed so nothing is read, the contract test above would compare
        // against an empty set and fail for the wrong reason.
        ReadPc2Columns("PortalConfig").Should().ContainKeys("Id", "ExerciseId", "LayoutKey", "ModulesJson", "Version")
            .And.Contain("PortalName", true);
        ReadPc2Columns("PortalResource").Should().ContainKeys("Title", "SortOrder", "Visible", "Version")
            .And.Contain("DeletedAt", true);
    }

    [Fact]
    public void PortalConfig_IsUniquePerExercise_AndResourceSortOrder_IsIndexedPerExercise()
    {
        using var context = ModelOnlyContext();

        var config = context.Model.FindEntityType(typeof(PortalConfig))!.GetIndexes()
            .Single(i => i.Properties.Select(p => p.Name).SequenceEqual([nameof(PortalConfig.ExerciseId)]));
        config.IsUnique.Should().BeTrue("one portal config per exercise; an absent row means the defaults");

        context.Model.FindEntityType(typeof(PortalResource))!.GetIndexes().Should().Contain(
            i => i.Properties.Select(p => p.Name).SequenceEqual(
                new[] { nameof(PortalResource.ExerciseId), nameof(PortalResource.SortOrder) }),
            "the resources page reads in SortOrder within one exercise");
    }

    [Theory]
    [InlineData(typeof(PortalConfig), false)]
    [InlineData(typeof(PortalResource), true)]
    public void BothTables_AreExerciseScopedAndFiltered_AndOnlyResourcesAreSoftDeleted(Type type, bool softDeleted)
    {
        using var context = ModelOnlyContext();
        var entity = context.Model.FindEntityType(type)!;

        typeof(IExerciseScoped).IsAssignableFrom(type).Should().BeTrue("XC-001");
        entity.FindDeclaredQueryFilter(null).Should().NotBeNull("the central exercise filter covers {0}", type.Name);
        entity.FindProperty(nameof(IExerciseScoped.ExerciseId))!.IsConcurrencyToken.Should().BeTrue(
            "an UPDATE carries the original ExerciseId, so a write naming another exercise matches no row");
        typeof(ISoftDeletable).IsAssignableFrom(type).Should().Be(softDeleted, "PC-2 gives only PortalResource a DeletedAt");
    }

    [Fact]
    public void ThereIsNoPortalDisplay_InTheModelTheContextOrTheAssembly()
    {
        using var context = ModelOnlyContext();

        context.Model.GetEntityTypes().Should().NotContain(
            t => t.ClrType.Name.StartsWith("PortalDisplay", StringComparison.Ordinal) || t.GetTableName() == "PortalDisplays",
            "display sessions are Deferred (Q-35)");
        typeof(PulseDbContext).GetProperties().Should().NotContain(p => p.Name.StartsWith("PortalDisplay", StringComparison.Ordinal));
        typeof(PulseDbContext).Assembly.GetTypes().Should().NotContain(
            t => t.Name == "PortalDisplay", "no display entity is written until the Deferred stories 05/08/20 land");
    }

    [Fact]
    public void OnlyChannelsM1_TouchesThePortalTables_SoThisFeatureAddsNoMigration()
    {
        using var context = ModelOnlyContext();
        var migrations = context.GetService<IMigrationsAssembly>();
        var provider = context.Database.ProviderName!;

        var touching = migrations.Migrations
            .Where(m => TouchesPortalTables(migrations.CreateMigration(m.Value, provider)))
            .Select(m => m.Key)
            .ToList();

        touching.Should().ContainSingle("F01's M1 creates the portal tables (Q-28); no other migration may change them")
            .Which.Should().EndWith("_Channels_M1_ContentFoundation");
        typeof(PulseDbContext).Assembly.GetTypes()
            .Where(t => typeof(Migration).IsAssignableFrom(t))
            .Should().NotContain(t => t.Namespace != null && t.Namespace.Contains(".Portal", StringComparison.Ordinal));
    }

    [Fact]
    public void NothingInThePortalFeature_HardDeletes_OrBypassesTheFilters()
    {
        var root = Path.Combine(RepoRoot(), "src", "Pulse.WebApi", "Features", "Portal");
        Directory.Exists(root).Should().BeTrue();

        var offences = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .SelectMany(file => File.ReadLines(file).Select((line, i) => (file, line, number: i + 1)))
            .Where(x => !x.line.TrimStart().StartsWith("//", StringComparison.Ordinal))
            .Where(x => Regex.IsMatch(x.line, @"ExecuteDelete|IgnoreQueryFilters|DELETE\s+FROM", RegexOptions.IgnoreCase))
            .Select(x => $"{Path.GetRelativePath(root, x.file)}:{x.number}")
            .ToList();

        offences.Should().BeEmpty(
            "XC-010: portal rows are soft-deleted through the context, and deleted rows are read only via IncludingSoftDeleted");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static PulseDbContext ModelOnlyContext() =>
        new(new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);

    /// <summary>
    /// The PC-2 row for <paramref name="entity"/>: every backticked column name in its second cell, nullable when it ends
    /// in <c>?</c>, plus the implicit non-null <c>Id</c> and <c>ExerciseId</c> ("Columns (beyond Id, ExerciseId)").
    /// </summary>
    private static Dictionary<string, bool> ReadPc2Columns(string entity)
    {
        var doc = File.ReadAllLines(Path.Combine(RepoRoot(), ImplementationDoc));
        var start = Array.FindIndex(doc, l => l.StartsWith("### PC-2", StringComparison.Ordinal));
        start.Should().BeGreaterThanOrEqualTo(0, "{0} has a PC-2 section", ImplementationDoc);

        var row = doc.Skip(start + 1)
            .TakeWhile(l => !l.StartsWith("### ", StringComparison.Ordinal))
            .Single(l => l.StartsWith($"| `{entity}`", StringComparison.Ordinal));
        var columnsCell = row.Split('|', StringSplitOptions.TrimEntries)[2];

        var columns = new Dictionary<string, bool> { ["Id"] = false, ["ExerciseId"] = false };
        foreach (Match match in Regex.Matches(columnsCell, @"`([A-Za-z]+)(\?)?`"))
        {
            columns.Add(match.Groups[1].Value, match.Groups[2].Success);
        }

        return columns;
    }

    private static bool TouchesPortalTables(Migration migration) =>
        migration.UpOperations.Concat(migration.DownOperations).Any(op => op switch
        {
            SqlOperation sql => PortalTables.Any(t => sql.Sql.Contains(t, StringComparison.OrdinalIgnoreCase)),
            RenameTableOperation rename => PortalTables.Contains(rename.Name) || PortalTables.Contains(rename.NewName),
            ITableMigrationOperation table => PortalTables.Contains(table.Table),
            _ => false,
        });

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, ImplementationDoc)))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException($"Could not find {ImplementationDoc} above {AppContext.BaseDirectory}.");
    }
}
