namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// channels-foundation/01 (XC-001 / COR-001, always-Critical; XC-010) — the behavioural proof that the eight M1 entities
/// (the five FC-2 content entities plus <see cref="PortalConfig"/>, <see cref="PortalResource"/> and
/// <see cref="WeatherZone"/>) and the new <see cref="InjectItem.ContentItemId"/> are isolated by construction. Real SQL
/// Server, fresh exercise ids per test. It proves:
/// <list type="bullet">
///   <item><description>a row written under exercise A is invisible under B (by id, by list, by count), and an unresolved
///   scope sees zero rows while the rows provably exist;</description></item>
///   <item><description>a row written under A is unwritable under B: a bulk update or delete under B touches nothing, and
///   the database refuses any row of B that references A's outlet or content (the same-exercise composite keys);
///   </description></item>
///   <item><description>the central write guard refuses each entity with no resolved scope, with no per-entity code;</description></item>
///   <item><description>a delete through the context keeps the row with <c>DeletedAt</c> set, hides it from default reads,
///   and only <see cref="PulseDbContext.IncludingSoftDeleted{TEntity}"/> — still scoped — sees it.</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ChannelsIsolationTests
{
    /// <summary>SQL Server's foreign-key violation.</summary>
    private const int ForeignKeyViolation = 547;

    private readonly MsSqlContainerFixture _fixture;

    public ChannelsIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static IExerciseContext?[] UnresolvedScopes() =>
    [
        null,
        new ExerciseContext(),
        new ExerciseContext { CurrentExerciseId = Guid.Empty },
    ];

    // ---- reads ----------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task EveryM1Entity_ExerciseBsRow_IsInvisibleUnderA_ByIdAndByCount()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var rowsA = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseA);
        var rowsB = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseB);

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        foreach (var type in ChannelRows.M1EntityTypes)
        {
            (await ChannelRows.FindAsync(readA, type, rowsB[type])).Should().BeNull(
                "FindAsync by exercise B's real {0} id from an exercise-A scope must fail closed (IDOR)", type.Name);
            (await ChannelRows.FindAsync(readA, type, rowsA[type])).Should().NotBeNull("A's own {0} still resolves", type.Name);
            (await CountAsync(readA, type, rowsA[type], rowsB[type])).Should().Be(
                1, "a read of {0} under A sees A's row alone, never B's", type.Name);
        }
    }

    [RequiresDockerFact]
    public async Task EveryM1Entity_UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowsExist()
    {
        var rows = await ChannelRows.SeedOneOfEachAsync(_fixture, Guid.NewGuid());

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            foreach (var type in ChannelRows.M1EntityTypes)
            {
                (await CountAsync(read, type, rows[type])).Should().Be(
                    0, "an unresolved scope collapses to Guid.Empty, which no {0} can carry — zero rows, never all", type.Name);
            }
        }

        await using var unfiltered = _fixture.CreateContext();
        foreach (var type in ChannelRows.M1EntityTypes)
        {
            (await CountAsync(unfiltered, type, ignoreFilters: true, rows[type])).Should().Be(
                1, "the zeros above are the filter closing the door, not a missing {0}", type.Name);
        }
    }

    // ---- writes ---------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task EveryM1Entity_WithNoResolvedScope_IsRefusedByTheWriteGuard_AndNothingPersists()
    {
        var empty = Guid.Empty;
        object[] rows =
        [
            ChannelRows.Outlet(empty), ChannelRows.ContentItem(empty, Guid.NewGuid()),
            ChannelRows.Revision(empty, Guid.NewGuid()), ChannelRows.Media(empty, Guid.NewGuid(), Guid.NewGuid()),
            ChannelRows.Alert(empty), ChannelRows.PortalConfig(empty), ChannelRows.PortalResource(empty),
            ChannelRows.Zone(empty),
        ];

        foreach (var row in rows)
        {
            await using var write = _fixture.CreateContext();
            write.Add(row);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses a {0} with an empty ExerciseId — no per-entity code", row.GetType().Name);
        }

        await using var verify = _fixture.CreateContext();
        foreach (var type in ChannelRows.M1EntityTypes)
        {
            (await CountEmptyScopeAsync(verify, type)).Should().Be(0, "the guard throws before SaveChanges reaches the database");
        }
    }

    [RequiresDockerFact]
    public async Task ARowWrittenUnderA_IsUnwritableUnderB_BulkUpdatesAndDeletesTouchNothing()
    {
        var exerciseA = Guid.NewGuid();
        var rowsA = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseA);

        await using (var writeB = _fixture.CreateContext(ScopeFor(Guid.NewGuid())))
        {
            (await writeB.ContentItems.Where(c => c.Id == rowsA[typeof(ContentItem)])
                    .ExecuteUpdateAsync(s => s.SetProperty(c => c.Headline, "Hijacked")))
                .Should().Be(0, "a bulk update under B is filtered to B's scope and cannot reach A's item");
            (await writeB.Outlets.Where(o => o.Id == rowsA[typeof(Outlet)])
                    .ExecuteUpdateAsync(s => s.SetProperty(o => o.Name, "Hijacked")))
                .Should().Be(0);
            (await writeB.ChannelAlerts.Where(a => a.Id == rowsA[typeof(ChannelAlert)])
                    .ExecuteUpdateAsync(s => s.SetProperty(a => a.ClearedScenarioTime, ChannelRows.ScenarioTime)))
                .Should().Be(0);
            (await writeB.PortalConfigs.Where(p => p.Id == rowsA[typeof(PortalConfig)]).ExecuteDeleteAsync())
                .Should().Be(0, "a bulk delete under B cannot reach A's row either");
            (await writeB.WeatherZones.Where(z => z.Id == rowsA[typeof(WeatherZone)]).ExecuteDeleteAsync())
                .Should().Be(0);
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.ContentItems.SingleAsync(c => c.Id == rowsA[typeof(ContentItem)])).Headline.Should().NotBe("Hijacked");
        (await readA.Outlets.SingleAsync(o => o.Id == rowsA[typeof(Outlet)])).Name.Should().NotBe("Hijacked");
        (await readA.ChannelAlerts.SingleAsync(a => a.Id == rowsA[typeof(ChannelAlert)])).ClearedScenarioTime.Should().BeNull();
        (await readA.PortalConfigs.AnyAsync(p => p.Id == rowsA[typeof(PortalConfig)])).Should().BeTrue();
        (await readA.WeatherZones.AnyAsync(z => z.Id == rowsA[typeof(WeatherZone)])).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task TheDatabaseRefuses_ARowOfB_ThatReferencesAsOutletOrContent()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var (outletA, itemA) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseA);
        var (outletB, itemB) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseB);
        var assetA = ChannelRows.MediaAsset(exerciseA);
        var assetB = ChannelRows.MediaAsset(exerciseB);
        await using (var seed = _fixture.CreateContext())
        {
            seed.MediaAssets.AddRange(assetA, assetB);
            await seed.SaveChangesAsync();
        }

        var heroFromA = ChannelRows.ContentItem(exerciseB, outletB.Id, slug: "hero-from-a");
        heroFromA.HeroMediaId = assetA.Id;
        var logoFromA = ChannelRows.Outlet(exerciseB, slug: "logo-from-a");
        logoFromA.LogoMediaId = assetA.Id;
        var portalLogoFromA = ChannelRows.PortalConfig(exerciseB);
        portalLogoFromA.LogoMediaId = assetA.Id;
        var resourceImageFromA = ChannelRows.PortalResource(exerciseB);
        resourceImageFromA.MediaAssetId = assetA.Id;

        object[] crossExercise =
        [
            ChannelRows.ContentItem(exerciseB, outletA.Id),
            ChannelRows.Outlet(exerciseB, slug: "child", parentOutletId: outletA.Id),
            ChannelRows.Revision(exerciseB, itemA.Id),
            ChannelRows.Media(exerciseB, itemA.Id, assetB.Id),
            ChannelRows.Media(exerciseB, itemB.Id, assetA.Id),
            heroFromA,
            logoFromA,
            portalLogoFromA,
            resourceImageFromA,
            ChannelRows.Inject(exerciseB, itemA.Id),
        ];

        foreach (var row in crossExercise)
        {
            await using var writeB = _fixture.CreateContext(ScopeFor(exerciseB));
            writeB.Add(row);
            var act = async () => await writeB.SaveChangesAsync();
            var thrown = await act.Should().ThrowAsync<DbUpdateException>(
                "a {0} in exercise B naming exercise A's outlet or content is a cross-exercise write", row.GetType().Name);
            thrown.Which.InnerException.Should().BeOfType<SqlException>()
                .Which.Number.Should().Be(ForeignKeyViolation, "the same-exercise composite foreign key is what refuses it");
        }

        // A press release filed under a NEWS outlet of the same exercise is refused too: the outlet key carries the channel.
        await using (var crossChannel = _fixture.CreateContext(ScopeFor(exerciseA)))
        {
            var release = ChannelRows.ContentItem(exerciseA, outletA.Id, slug: "wrong-channel");
            release.ChannelId = "press";
            release.Kind = "release";
            crossChannel.Add(release);
            var act = async () => await crossChannel.SaveChangesAsync();
            (await act.Should().ThrowAsync<DbUpdateException>()).Which.InnerException.Should().BeOfType<SqlException>()
                .Which.Number.Should().Be(ForeignKeyViolation, "an item's channel must be its outlet's channel");
        }

        // The same references inside A's own exercise are accepted.
        await using var writeA = _fixture.CreateContext(ScopeFor(exerciseA));
        writeA.Add(ChannelRows.ContentItem(exerciseA, outletA.Id, slug: "second-item"));
        writeA.Add(ChannelRows.Outlet(exerciseA, slug: "child", parentOutletId: outletA.Id));
        writeA.Add(ChannelRows.Revision(exerciseA, itemA.Id));
        writeA.Add(ChannelRows.Inject(exerciseA, itemA.Id));
        writeA.Add(ChannelRows.Media(exerciseA, itemA.Id, assetA.Id));
        var save = async () => await writeA.SaveChangesAsync();
        await save.Should().NotThrowAsync("same-exercise references are the normal shape");
    }

    [RequiresDockerFact]
    public async Task AStubOrStaleEntity_NamingAsRow_CannotWriteItUnderB_TheExerciseIdTokenMatchesNoRow()
    {
        // The write guard checks only for an EMPTY scope; a detached entity attached under another context is otherwise
        // written by key. ExerciseId is a concurrency token on every M1 entity, so the UPDATE carries the original
        // ExerciseId and an entity that claims B's scope for A's id matches nothing.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var (_, itemA) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseA);

        await using (var writeB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            var stub = ChannelRows.ContentItem(exerciseB, Guid.NewGuid());
            stub.Id = itemA.Id;
            writeB.Attach(stub);
            stub.Headline = "Hijacked";
            var act = async () => await writeB.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>("B's stub of A's item matches no row");
        }

        await using (var deleteB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            var stub = ChannelRows.ContentItem(exerciseB, Guid.NewGuid());
            stub.Id = itemA.Id;
            deleteB.Remove(stub);
            var act = async () => await deleteB.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>("nor can B soft-delete A's item by stub");
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var row = await readA.ContentItems.SingleAsync(c => c.Id == itemA.Id);
        row.Headline.Should().Be(itemA.Headline);
        row.DeletedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task ASoftDeleteByStub_WritesOnlyDeletedAt_AndLeavesEveryOtherColumnIntact()
    {
        var exerciseId = Guid.NewGuid();
        var (_, item) = await ChannelRows.SeedOutletAndItemAsync(_fixture, exerciseId);

        await using (var delete = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            // The delete-by-id idiom: a stub carrying only the keys and the concurrency tokens.
            var stub = new ContentItem
            {
                Id = item.Id, ExerciseId = exerciseId, Version = item.Version, ChannelId = "x", Kind = "x", Slug = "x",
                Status = "x", Headline = "x", Origin = "x", ActingHumanId = "x",
                CreatedScenarioTime = default, CreatedWallClock = default,
            };
            delete.Remove(stub);
            await delete.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        var row = await read.IncludingSoftDeleted<ContentItem>().SingleAsync(c => c.Id == item.Id);
        row.DeletedAt.Should().NotBeNull("the stub delete is a soft delete");
        row.Headline.Should().Be(item.Headline, "only DeletedAt is written; the stub's placeholder values never reach the row");
        row.BodyHtml.Should().Be(item.BodyHtml);
        row.Slug.Should().Be(item.Slug);
        row.OutletId.Should().Be(item.OutletId);
        row.CreatedScenarioTime.Should().Be(item.CreatedScenarioTime);
    }

    [RequiresDockerFact]
    public async Task ARowsExercise_CannotBeChangedAfterInsert()
    {
        var exerciseId = Guid.NewGuid();
        var rows = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseId);

        await using var write = _fixture.CreateContext(ScopeFor(exerciseId));
        var alert = await write.ChannelAlerts.SingleAsync(a => a.Id == rows[typeof(ChannelAlert)]);
        alert.ExerciseId = Guid.NewGuid();
        var act = async () => await write.SaveChangesAsync();
        await act.Should().ThrowAsync<InvalidOperationException>(
            "ExerciseId is save-once on every M1 entity: a row can never be moved into another exercise");
    }

    // ---- soft delete (XC-010) -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task DeletingThroughTheContext_KeepsEverySoftDeletableRow_WithDeletedAtSet_AndHidesIt()
    {
        var exerciseId = Guid.NewGuid();
        var rows = await ChannelRows.SeedOneOfEachAsync(_fixture, exerciseId);
        var softDeletable = ChannelRows.M1EntityTypes.Where(t => typeof(ISoftDeletable).IsAssignableFrom(t)).ToList();
        softDeletable.Should().HaveCount(7, "every M1 entity but PortalConfig (PC-2 gives it no DeletedAt) is soft-deleted");

        // Children first, the order a service would remove them in.
        foreach (var type in softDeletable.OrderBy(t => t == typeof(Outlet) ? 2 : t == typeof(ContentItem) ? 1 : 0))
        {
            await using var delete = _fixture.CreateContext(ScopeFor(exerciseId));
            var row = await ChannelRows.FindAsync(delete, type, rows[type]);
            delete.Remove(row!);
            await delete.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        foreach (var type in softDeletable)
        {
            (await ChannelRows.FindAsync(read, type, rows[type])).Should().BeNull("a deleted {0} is excluded from default reads", type.Name);
            (await CountAsync(read, type, ignoreFilters: true, rows[type])).Should().Be(
                1, "and the {0} row is retained, never hard-deleted", type.Name);
        }

        (await read.IncludingSoftDeleted<ContentItem>().SingleAsync(c => c.Id == rows[typeof(ContentItem)]))
            .DeletedAt.Should().NotBeNull("the delete stamped DeletedAt");
        (await read.IncludingSoftDeleted<WeatherZone>().CountAsync(z => z.Id == rows[typeof(WeatherZone)]))
            .Should().Be(1, "a deleted zone's name stays resolvable for historic products, inside the scope");
    }

    [RequiresDockerFact]
    public async Task IncludingSoftDeleted_KeepsTheExerciseScope_AndFailsClosedWhenUnresolved()
    {
        var exerciseA = Guid.NewGuid();
        var zone = ChannelRows.Zone(exerciseA);
        zone.DeletedAt = DateTimeOffset.UtcNow;
        await using (var seed = _fixture.CreateContext())
        {
            seed.WeatherZones.Add(zone);
            await seed.SaveChangesAsync();
        }

        await using (var readB = _fixture.CreateContext(ScopeFor(Guid.NewGuid())))
        {
            (await readB.IncludingSoftDeleted<WeatherZone>().CountAsync(z => z.Id == zone.Id)).Should().Be(
                0, "including deleted rows must never mean including another exercise's rows");
        }

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.IncludingSoftDeleted<WeatherZone>().CountAsync(z => z.Id == zone.Id)).Should().Be(
                0, "an unresolved scope still sees zero rows through the escape hatch");
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.IncludingSoftDeleted<WeatherZone>().CountAsync(z => z.Id == zone.Id)).Should().Be(1);
        (await readA.WeatherZones.CountAsync(z => z.Id == zone.Id)).Should().Be(0, "the default read still hides it");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static Task<int> CountAsync(PulseDbContext context, Type type, params Guid[] ids) =>
        CountAsync(context, type, ignoreFilters: false, ids);

    private static Task<int> CountAsync(PulseDbContext context, Type type, bool ignoreFilters, params Guid[] ids) => type.Name switch
    {
        nameof(Outlet) => Count(context.Outlets, o => ids.Contains(o.Id), ignoreFilters),
        nameof(ContentItem) => Count(context.ContentItems, c => ids.Contains(c.Id), ignoreFilters),
        nameof(ContentItemRevision) => Count(context.ContentItemRevisions, r => ids.Contains(r.Id), ignoreFilters),
        nameof(ContentItemMedia) => Count(context.ContentItemMedia, m => ids.Contains(m.Id), ignoreFilters),
        nameof(ChannelAlert) => Count(context.ChannelAlerts, a => ids.Contains(a.Id), ignoreFilters),
        nameof(PortalConfig) => Count(context.PortalConfigs, p => ids.Contains(p.Id), ignoreFilters),
        nameof(PortalResource) => Count(context.PortalResources, p => ids.Contains(p.Id), ignoreFilters),
        nameof(WeatherZone) => Count(context.WeatherZones, z => ids.Contains(z.Id), ignoreFilters),
        _ => throw new ArgumentOutOfRangeException(nameof(type), type.Name, "not an M1 entity"),
    };

    private static Task<int> CountEmptyScopeAsync(PulseDbContext context, Type type) => type.Name switch
    {
        nameof(Outlet) => context.Outlets.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(ContentItem) => context.ContentItems.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(ContentItemRevision) => context.ContentItemRevisions.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(ContentItemMedia) => context.ContentItemMedia.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(ChannelAlert) => context.ChannelAlerts.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(PortalConfig) => context.PortalConfigs.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(PortalResource) => context.PortalResources.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        nameof(WeatherZone) => context.WeatherZones.IgnoreQueryFilters().CountAsync(e => e.ExerciseId == Guid.Empty),
        _ => throw new ArgumentOutOfRangeException(nameof(type), type.Name, "not an M1 entity"),
    };

    private static Task<int> Count<T>(IQueryable<T> set, System.Linq.Expressions.Expression<Func<T, bool>> predicate, bool ignoreFilters)
        where T : class =>
        (ignoreFilters ? set.IgnoreQueryFilters() : set).CountAsync(predicate);
}
