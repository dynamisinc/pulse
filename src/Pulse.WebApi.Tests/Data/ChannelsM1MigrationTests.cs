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
/// channels-foundation/01 (#697) — the proofs for M1, <c>Channels_M1_ContentFoundation</c>, the December channels release's
/// one up-front schema migration (Q-28, Tom 10/29):
/// <list type="bullet">
///   <item><description>model-only: it is the one M1, directly after <c>AdminIdentityFoundation</c>, carrying the ledger
///   token; the snapshot matches the model; every entity has exactly the columns FC-2 / PC-2 / the weather zone model name,
///   is exercise-scoped and (all but <see cref="PortalConfig"/>) soft-deleted; the slug, Cadence-seam and per-exercise
///   indexes, the concurrency tokens, the same-exercise foreign keys and the scenario-time rules hold; no
///   <c>PortalDisplay</c> exists;</description></item>
///   <item><description>real SQL Server: the column types, the uniqueness rules refusing and accepting what FC-1 says,
///   a stale write raising <see cref="DbUpdateConcurrencyException"/>, and Up over a database that already holds an
///   inject item, then Down/Up.</description></item>
/// </list>
/// The deploy-script replay lives in <see cref="IdempotentMigrationScriptTests"/>; isolation and soft delete in
/// <see cref="ChannelsIsolationTests"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ChannelsM1MigrationTests
{
    /// <summary>The migration immediately before the one under test.</summary>
    private const string PreviousMigration = "20261017120000_AdminIdentityFoundation";

    /// <summary>The migration under test; the <c>Channels_M1_</c> prefix is the ledger token story 20's ledger test reads.</summary>
    private const string MigrationName = "Channels_M1_ContentFoundation";

    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private static readonly string[] M1Tables =
    [
        "Outlets", "ContentItems", "ContentItemRevisions", "ContentItemMedia", "ChannelAlerts",
        "PortalConfigs", "PortalResources", "WeatherZones",
    ];

    private readonly MsSqlContainerFixture _fixture;

    public ChannelsM1MigrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- model-only ------------------------------------------------------------------------------

    [Fact]
    public void TheMigration_IsTheOneM1_DirectlyAfterAdminIdentityFoundation()
    {
        using var context = ModelOnlyContext();
        var migrations = context.Database.GetMigrations().ToList();

        var index = migrations.FindIndex(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        index.Should().BeGreaterThan(0, "Channels_M1_ContentFoundation exists");
        migrations.Count(m => m.Contains("_Channels_M1_", StringComparison.Ordinal)).Should().Be(
            1, "the ledger allows exactly one M1 (Q-28: the folded tables ride it, not a second migration)");
        migrations[index - 1].Should().Be(PreviousMigration, "it is applied directly on top of the A1 migration");
    }

    [Fact]
    public void TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration()
    {
        using var context = ModelOnlyContext();

        context.Database.HasPendingModelChanges().Should().BeFalse(
            "the committed migration snapshot must describe the current model exactly");
    }

    public static TheoryData<Type, string, string[]> ContractColumns() => new()
    {
        {
            typeof(Outlet), "Outlets",
            [
                "Id", "ExerciseId", "DeletedAt", "ChannelId", "Slug", "Name", "Tagline", "ParentOutletId", "PairedPersonaId",
                "LogoMediaId", "CategoriesJson", "SkinKey", "SkinOverridesJson", "SortOrder", "Enabled", "Version",
            ]
        },
        {
            typeof(ContentItem), "ContentItems",
            [
                "Id", "ExerciseId", "DeletedAt", "ChannelId", "Kind", "OutletId", "Slug", "Status", "Headline", "Dek", "Kicker",
                "Category", "BylineName", "BylinePersonaId", "BodyHtml", "HeroMediaId", "PayloadJson", "Background",
                "FeaturedRank", "ScheduledScenarioTime", "PublishedScenarioTime", "PublishedWallClock",
                "RetractedScenarioTime", "CreatedScenarioTime", "CreatedWallClock", "Origin", "ActingHumanId", "InjectId",
                "PairedPostId", "AlertId", "ExternalSource", "ExternalRef", "UpdatedScenarioTime", "PublishOptionsJson",
                "LastError", "RevisionCount", "Version",
            ]
        },
        {
            typeof(ContentItemRevision), "ContentItemRevisions",
            [
                "Id", "ExerciseId", "DeletedAt", "ContentItemId", "Number", "Kind", "Note", "SnapshotJson", "ScenarioTime",
                "WallClock", "ActingHumanId", "Visible",
            ]
        },
        {
            typeof(ContentItemMedia), "ContentItemMedia",
            ["Id", "ExerciseId", "DeletedAt", "ContentItemId", "MediaAssetId", "Role", "SortOrder", "Alt"]
        },
        {
            typeof(ChannelAlert), "ChannelAlerts",
            [
                "Id", "ExerciseId", "DeletedAt", "Severity", "Headline", "SourceChannel", "SourceContentId", "Href",
                "IssuedScenarioTime", "ExpiresScenarioTime", "ClearedScenarioTime", "Origin", "ActingHumanId", "Version",
            ]
        },
        {
            typeof(PortalConfig), "PortalConfigs",
            [
                "Id", "ExerciseId", "PortalName", "CityName", "Tagline", "LogoMediaId", "LayoutKey", "ModulesJson",
                "SkinOverridesJson", "Version",
            ]
        },
        {
            typeof(PortalResource), "PortalResources",
            ["Id", "ExerciseId", "Title", "Summary", "BodyHtml", "MediaAssetId", "SortOrder", "Visible", "DeletedAt", "Version"]
        },
        {
            typeof(WeatherZone), "WeatherZones",
            ["Id", "ExerciseId", "Slug", "Name", "Kind", "Description", "SortOrder", "IsDefault", "Version", "DeletedAt"]
        },
    };

    [Theory]
    [MemberData(nameof(ContractColumns))]
    public void EachM1Entity_HasExactlyTheFrozenContractColumns_AndIsExerciseScoped(Type type, string table, string[] columns)
    {
        using var context = ModelOnlyContext();
        var entity = context.Model.FindEntityType(type)!;

        entity.Should().NotBeNull("{0} is in the model", type.Name);
        entity.GetTableName().Should().Be(table);
        entity.GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            columns, "{0} has exactly the columns its frozen spec names (FC-2 / PC-2 / the weather zone model)", type.Name);
        typeof(IExerciseScoped).IsAssignableFrom(type).Should().BeTrue("{0} is exercise-scoped (XC-001)", type.Name);
        entity.FindProperty(nameof(IExerciseScoped.ExerciseId))!.IsNullable.Should().BeFalse();
        entity.FindDeclaredQueryFilter(null).Should().NotBeNull("the central exercise filter covers {0}", type.Name);
    }

    [Fact]
    public void EveryM1EntityButPortalConfig_IsSoftDeleted_AndItsFilterKeepsTheExerciseScope()
    {
        using var context = ModelOnlyContext();

        foreach (var type in ChannelRows.M1EntityTypes)
        {
            var softDeleted = typeof(ISoftDeletable).IsAssignableFrom(type);
            softDeleted.Should().Be(type != typeof(PortalConfig), "PC-2 gives PortalConfig no DeletedAt; every other M1 entity has one");

            var filter = context.Model.FindEntityType(type)!.FindDeclaredQueryFilter(null)!.Expression!.ToString();
            filter.Should().Contain("ExerciseId", "{0}'s filter is still the exercise filter", type.Name);
            if (softDeleted)
            {
                filter.Should().Contain("DeletedAt", "{0}'s filter also hides soft-deleted rows (XC-010)", type.Name);
            }
        }
    }

    [Fact]
    public void TheVersionColumns_AreConcurrencyTokens()
    {
        using var context = ModelOnlyContext();

        foreach (var type in new[]
                 {
                     typeof(ContentItem), typeof(Outlet), typeof(ChannelAlert), typeof(PortalConfig), typeof(PortalResource),
                     typeof(WeatherZone),
                 })
        {
            var version = context.Model.FindEntityType(type)!.FindProperty("Version")!;
            version.IsConcurrencyToken.Should().BeTrue("{0}.Version is the optimistic-concurrency token (the InjectItem pattern)", type.Name);
            version.ClrType.Should().Be(typeof(int));
        }
    }

    [Fact]
    public void TheUniquenessRules_AreTheFrozenOnes()
    {
        using var context = ModelOnlyContext();

        var outletSlug = FindIndex(context, typeof(Outlet), "ExerciseId", "ChannelId", "Slug");
        outletSlug.IsUnique.Should().BeTrue("outlet slugs are unique per (ExerciseId, ChannelId) (FC-1)");
        outletSlug.GetFilter().Should().BeNull("a deleted outlet keeps its slug reserved");

        var contentSlug = FindIndex(context, typeof(ContentItem), "ExerciseId", "OutletId", "Slug");
        contentSlug.IsUnique.Should().BeTrue("content slugs are unique per (ExerciseId, OutletId) (FC-1)");
        contentSlug.GetFilter().Should().BeNull("a permalink is never reused, even after a delete (NWS-011)");

        var cadence = FindIndex(context, typeof(ContentItem), "ExerciseId", "ExternalSource", "ExternalRef");
        cadence.IsUnique.Should().BeTrue("the PDF-06 seam is idempotent by its external reference");
        cadence.GetFilter().Should().Be("[ExternalSource] IS NOT NULL AND [ExternalRef] IS NOT NULL");

        FindIndex(context, typeof(WeatherZone), "ExerciseId", "Slug").IsUnique.Should().BeTrue("zone slugs are unique per exercise");
        FindIndex(context, typeof(PortalConfig), "ExerciseId").IsUnique.Should().BeTrue("one portal config per exercise (PC-2)");
        FindIndex(context, typeof(PortalResource), "ExerciseId", "SortOrder").IsUnique.Should().BeFalse("SortOrder indexed per exercise");
        FindIndex(context, typeof(ContentItemRevision), "ExerciseId", "ContentItemId", "Number").IsUnique.Should().BeTrue();
    }

    [Fact]
    public void ReferencesBetweenM1Tables_AreSameExerciseCompositeKeys_AndEveryForeignKeyIsRestrict()
    {
        using var context = ModelOnlyContext();

        AssertSameExercise(context, typeof(Outlet), typeof(Outlet), nameof(Outlet.ParentOutletId));
        var toOutlet = context.Model.FindEntityType(typeof(ContentItem))!.GetForeignKeys()
            .Single(fk => fk.PrincipalEntityType.ClrType == typeof(Outlet));
        toOutlet.Properties.Select(p => p.Name).Should().Equal(
            ["ExerciseId", "OutletId", "ChannelId"], "an item is filed under an outlet of its own exercise AND channel");
        toOutlet.PrincipalKey.Properties.Select(p => p.Name).Should().Equal(["ExerciseId", "Id", "ChannelId"]);
        AssertSameExercise(context, typeof(ContentItemRevision), typeof(ContentItem), nameof(ContentItemRevision.ContentItemId));
        AssertSameExercise(context, typeof(ContentItemMedia), typeof(ContentItem), nameof(ContentItemMedia.ContentItemId));
        AssertSameExercise(context, typeof(InjectItem), typeof(ContentItem), nameof(InjectItem.ContentItemId));
        AssertSameExercise(context, typeof(Outlet), typeof(MediaAsset), nameof(Outlet.LogoMediaId));
        AssertSameExercise(context, typeof(ContentItem), typeof(MediaAsset), nameof(ContentItem.HeroMediaId));
        AssertSameExercise(context, typeof(ContentItemMedia), typeof(MediaAsset), nameof(ContentItemMedia.MediaAssetId));
        AssertSameExercise(context, typeof(PortalConfig), typeof(MediaAsset), nameof(PortalConfig.LogoMediaId));
        AssertSameExercise(context, typeof(PortalResource), typeof(MediaAsset), nameof(PortalResource.MediaAssetId));

        foreach (var type in ChannelRows.M1EntityTypes)
        {
            var exerciseId = context.Model.FindEntityType(type)!.FindProperty(nameof(IExerciseScoped.ExerciseId))!;
            exerciseId.IsConcurrencyToken.Should().BeTrue("{0}: every tracked UPDATE is confined to the row's original exercise", type.Name);
            exerciseId.GetAfterSaveBehavior().Should().Be(
                PropertySaveBehavior.Throw, "{0}: a row can never be moved into another exercise", type.Name);
        }

        foreach (var type in ChannelRows.M1EntityTypes.Append(typeof(InjectItem)))
        {
            context.Model.FindEntityType(type)!.GetForeignKeys().Where(fk => fk.DeleteBehavior != DeleteBehavior.Restrict)
                .Should().BeEmpty("{0}: no cascade path, no hard delete (XC-010)", type.Name);
        }
    }

    [Fact]
    public void InjectItemContentItemId_IsNullable_Indexed_AndChangesNoOtherInjectColumn()
    {
        using var context = ModelOnlyContext();
        var inject = context.Model.FindEntityType(typeof(InjectItem))!;

        var column = inject.FindProperty(nameof(InjectItem.ContentItemId))!;
        column.IsNullable.Should().BeTrue("existing post/burst injects carry no content (no behaviour change)");
        column.ClrType.Should().Be(typeof(Guid?));
        inject.GetIndexes().Should().Contain(
            i => i.Properties.Select(p => p.Name).SequenceEqual(new[] { "ExerciseId", "ContentItemId" }),
            "the column is indexed (the composite foreign key's index)");
        new InjectItem { Kind = "post", Title = "t", Status = "pending" }.ContentItemId.Should().BeNull();
    }

    [Fact]
    public void TimeColumns_AreDateTimeOffset_NeverStoreDefaulted_AndWallClocksAreNamedSo()
    {
        using var context = ModelOnlyContext();

        foreach (var type in ChannelRows.M1EntityTypes)
        {
            foreach (var property in context.Model.FindEntityType(type)!.GetProperties()
                         .Where(p => Nullable.GetUnderlyingType(p.ClrType) == typeof(DateTimeOffset) || p.ClrType == typeof(DateTimeOffset)))
            {
                var name = $"{type.Name}.{property.Name}";
                (property.Name.EndsWith("ScenarioTime", StringComparison.Ordinal)
                        || property.Name.EndsWith("WallClock", StringComparison.Ordinal)
                        || property.Name == nameof(ISoftDeletable.DeletedAt))
                    .Should().BeTrue("{0}: an instant is scenario time, or a *WallClock staff/telemetry column (COR-053)", name);
                property.GetRelationalTypeMapping().StoreType.Should().Be("datetimeoffset", "{0} is datetimeoffset", name);
                property.TryGetDefaultValue(out _).Should().BeFalse("{0} is never defaulted", name);
                property.GetDefaultValueSql().Should().BeNull("{0} is never defaulted from the wall clock", name);
            }
        }
    }

    [Fact]
    public void ThereIsNoPortalDisplay_ItIsDeferredPostDecember()
    {
        using var context = ModelOnlyContext();

        context.Model.GetEntityTypes().Should().NotContain(
            t => t.ClrType.Name == "PortalDisplay" || t.GetTableName() == "PortalDisplays",
            "display sessions are Deferred (Q-35); M1 creates no PortalDisplay table");
    }

    // ---- real SQL Server --------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Up_CreatesEveryM1Table_WithDateTimeOffsetTimeColumns_AndTheNullableInjectColumn()
    {
        var columns = await ReadColumnsAsync([.. M1Tables, "InjectItems"]);

        foreach (var table in M1Tables)
        {
            columns.Keys.Should().Contain(k => k.StartsWith(table + ".", StringComparison.Ordinal), "Up creates {0}", table);
        }

        columns["ContentItems.CreatedScenarioTime"].Should().Be("datetimeoffset NOT NULL");
        columns["ContentItems.PublishedScenarioTime"].Should().Be("datetimeoffset NULL");
        columns["ContentItems.ScheduledScenarioTime"].Should().Be("datetimeoffset NULL");
        columns["ContentItems.Slug"].Should().Be("nvarchar(80) NOT NULL");
        columns["ContentItems.PayloadJson"].Should().Be("nvarchar(-1) NOT NULL");
        columns["ChannelAlerts.IssuedScenarioTime"].Should().Be("datetimeoffset NOT NULL");
        columns["InjectItems.ContentItemId"].Should().Be("uniqueidentifier NULL");
        columns.Keys.Should().NotContain(k => k.StartsWith("PortalDisplays.", StringComparison.Ordinal));
    }

    [RequiresDockerFact]
    public async Task ContentSlugs_AreUniquePerOutlet_ButFreeAcrossOutletsAndExercises()
    {
        var exerciseA = Guid.NewGuid();
        var (outlet, item) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseA);

        await AssertDuplicateRefusedAsync(
            ChannelRows.ContentItem(exerciseA, outlet.Id, item.Slug), "a second item with the same slug in one outlet");

        var otherOutlet = ChannelRows.Outlet(exerciseA, slug: "courier-ledger");
        var (outletB, _) = await ChannelRows.SeedOutletAndItemAsync(_fixture, Guid.NewGuid());
        await using var write = _fixture.CreateContext();
        write.Outlets.Add(otherOutlet);
        write.ContentItems.Add(ChannelRows.ContentItem(exerciseA, otherOutlet.Id, item.Slug));
        write.ContentItems.Add(ChannelRows.ContentItem(outletB.ExerciseId, outletB.Id, "a-different-slug"));
        var save = async () => await write.SaveChangesAsync();
        await save.Should().NotThrowAsync("the same slug in a different outlet, or in another exercise, is accepted");
    }

    [RequiresDockerFact]
    public async Task OutletSlugs_AreUniquePerExerciseAndChannel()
    {
        var exerciseId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Outlets.Add(ChannelRows.Outlet(exerciseId, "weather-desk", "weather"));
            await seed.SaveChangesAsync();
        }

        await AssertDuplicateRefusedAsync(ChannelRows.Outlet(exerciseId, "weather-desk", "weather"), "a second weather-desk on one channel");

        await using var write = _fixture.CreateContext();
        write.Outlets.Add(ChannelRows.Outlet(exerciseId, "weather-desk", "news"));
        write.Outlets.Add(ChannelRows.Outlet(Guid.NewGuid(), "weather-desk", "weather"));
        var save = async () => await write.SaveChangesAsync();
        await save.Should().NotThrowAsync("the slug on another channel, or in another exercise, is accepted");
    }

    [RequiresDockerFact]
    public async Task TheCadenceSeam_IsUniqueWhenBothPartsAreSet_AndNullsCoexist()
    {
        var exerciseId = Guid.NewGuid();
        var (outlet, _) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseId);

        ContentItem Pushed(string slug, string? source, string? reference)
        {
            var item = ChannelRows.ContentItem(exerciseId, outlet.Id, slug);
            item.ExternalSource = source;
            item.ExternalRef = reference;
            return item;
        }

        await using (var seed = _fixture.CreateContext())
        {
            seed.ContentItems.Add(Pushed("pushed-1", "cadence", "inject-42"));
            seed.ContentItems.Add(Pushed("local-1", null, null));
            seed.ContentItems.Add(Pushed("local-2", null, null));
            seed.ContentItems.Add(Pushed("half-1", "cadence", null));
            seed.ContentItems.Add(Pushed("half-2", "cadence", null));
            var save = async () => await seed.SaveChangesAsync();
            await save.Should().NotThrowAsync("rows without both parts set coexist freely");
        }

        await AssertDuplicateRefusedAsync(Pushed("pushed-2", "cadence", "inject-42"), "a second push of the same Cadence inject");

        var (otherOutlet, _) = await ChannelRows.SeedOutletAndItemAsync(_fixture, Guid.NewGuid());
        await using var other = _fixture.CreateContext();
        var elsewhere = ChannelRows.ContentItem(otherOutlet.ExerciseId, otherOutlet.Id, "pushed-1");
        elsewhere.ExternalSource = "cadence";
        elsewhere.ExternalRef = "inject-42";
        other.ContentItems.Add(elsewhere);
        var saveOther = async () => await other.SaveChangesAsync();
        await saveOther.Should().NotThrowAsync("the same external reference in another exercise is accepted");
    }

    [RequiresDockerFact]
    public async Task AStaleWrite_ToAContentItemOutletOrAlert_RaisesDbUpdateConcurrencyException()
    {
        var exerciseId = Guid.NewGuid();
        var rows = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseId);
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };

        await using var first = _fixture.CreateContext(scope);
        await using var stale = _fixture.CreateContext(scope);

        var item = await first.ContentItems.SingleAsync(c => c.Id == rows[typeof(ContentItem)]);
        var outlet = await first.Outlets.SingleAsync(o => o.Id == rows[typeof(Outlet)]);
        var alert = await first.ChannelAlerts.SingleAsync(a => a.Id == rows[typeof(ChannelAlert)]);
        var staleItem = await stale.ContentItems.SingleAsync(c => c.Id == item.Id);
        var staleOutlet = await stale.Outlets.SingleAsync(o => o.Id == outlet.Id);
        var staleAlert = await stale.ChannelAlerts.SingleAsync(a => a.Id == alert.Id);

        item.Headline = "First writer"; item.Version++;
        outlet.Name = "First writer"; outlet.Version++;
        alert.Headline = "First writer"; alert.Version++;
        await first.SaveChangesAsync();

        foreach (var (entity, change) in new (object, Action)[]
                 {
                     (staleItem, () => { staleItem.Headline = "Stale"; staleItem.Version++; }),
                     (staleOutlet, () => { staleOutlet.Name = "Stale"; staleOutlet.Version++; }),
                     (staleAlert, () => { staleAlert.Headline = "Stale"; staleAlert.Version++; }),
                 })
        {
            stale.ChangeTracker.Clear();
            stale.Attach(entity);
            change();
            var act = async () => await stale.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>(
                "{0} was read at the old Version, so its write is stale", entity.GetType().Name);
        }
    }

    [RequiresDockerFact]
    public async Task Up_OverADatabaseThatAlreadyHasAnInject_LeavesItsContentItemIdNull_AndDownUpReapplies()
    {
        var name = $"PulseChannelsM1Test_{Guid.NewGuid():N}";
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

                var injectId = Guid.NewGuid();
                await ExecuteAsync(connectionString, $"""
                    INSERT INTO [InjectItems] ([Id], [ExerciseId], [Kind], [Title], [Order], [Status], [Version],
                                               [CreatedByHumanId], [CreatedAt], [UpdatedAt], [ShiftSeconds])
                    VALUES ('{injectId}', '{Guid.NewGuid()}', N'post', N'Pre-M1 inject', 1, N'pending', 0,
                            '{Guid.NewGuid()}', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(), 0);
                    """);

                await context.Database.MigrateAsync();

                (await CountAsync(
                        connectionString,
                        $"SELECT COUNT(*) FROM [InjectItems] WHERE [Id] = '{injectId}' AND [Title] = N'Pre-M1 inject' " +
                        "AND [ContentItemId] IS NULL;"))
                    .Should().Be(1, "an existing inject survives untouched and carries no content (no behaviour change)");

                await migrator.MigrateAsync(PreviousMigration);

                (await CountAsync(connectionString, TableCountSql())).Should().Be(0, "Down drops every M1 table");
                (await CountAsync(
                        connectionString,
                        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'InjectItems' AND COLUMN_NAME = N'ContentItemId';"))
                    .Should().Be(0, "Down drops the inject column");

                await context.Database.MigrateAsync();
            }

            (await CountAsync(connectionString, TableCountSql())).Should().Be(M1Tables.Length, "Up re-applies cleanly after a Down");
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

    private static IReadOnlyIndex FindIndex(PulseDbContext context, Type type, params string[] columns) =>
        context.Model.FindEntityType(type)!.GetIndexes().Single(i => i.Properties.Select(p => p.Name).SequenceEqual(columns));

    private static void AssertSameExercise(PulseDbContext context, Type dependent, Type principal, string referenceProperty)
    {
        var foreignKey = context.Model.FindEntityType(dependent)!.GetForeignKeys()
            .Single(fk => fk.Properties.Any(p => p.Name == referenceProperty));

        foreignKey.PrincipalEntityType.ClrType.Should().Be(principal);
        foreignKey.Properties.Select(p => p.Name).Should().Equal(
            ["ExerciseId", referenceProperty], "{0}.{1} is a same-exercise composite reference", dependent.Name, referenceProperty);
        foreignKey.PrincipalKey.Properties.Select(p => p.Name).Should().Equal(["ExerciseId", "Id"]);
    }

    private async Task AssertDuplicateRefusedAsync(object row, string because)
    {
        await using var duplicate = _fixture.CreateContext();
        duplicate.Add(row);
        var act = async () => await duplicate.SaveChangesAsync();
        var thrown = await act.Should().ThrowAsync<DbUpdateException>("{0} is refused by the database", because);
        thrown.Which.InnerException.Should().BeOfType<SqlException>().Which.Number.Should().BeOneOf(DuplicateKeyErrors);
    }

    private static string TableCountSql() =>
        $"SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ({string.Join(", ", M1Tables.Select(t => $"N'{t}'"))});";

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
