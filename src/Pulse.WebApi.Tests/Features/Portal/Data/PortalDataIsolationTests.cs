namespace Pulse.WebApi.Tests.Features.Portal.Data;

using FluentAssertions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Portal.Data;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// exercise-portal/01 (XC-001, always-Critical; XC-010) — the behavioural proof over F01's portal tables through the
/// portal's own data layer (<see cref="PortalDataQueries"/>, <see cref="PortalWriteScope"/>), on a real SQL Server with
/// fresh exercise ids per test. It mirrors the Outlet proofs in <see cref="ChannelsIsolationTests"/>, which already sweep
/// both portal tables:
/// <list type="bullet">
///   <item><description>a read under exercise B never returns A's config or resources, and an unresolved scope reads
///   nothing (config "absent", no resources, an empty AAR export);</description></item>
///   <item><description>a write naming the wrong exercise is refused: an insert by <see cref="PortalWriteScope"/>, an
///   update or delete by the <c>ExerciseId</c> concurrency token, a bulk update by the filter, an empty id by the
///   central guard;</description></item>
///   <item><description>a deleted resource is retained with <c>DeletedAt</c>, hidden from normal reads and the limit
///   count, and present in the AAR export;</description></item>
///   <item><description>an exercise with no config reads "absent" and the read creates no row; the database allows one
///   config per exercise.</description></item>
/// </list>
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PortalDataIsolationTests
{
    /// <summary>SQL Server's duplicate-key errors: unique INDEX (2601) and unique CONSTRAINT (2627).</summary>
    private static readonly int[] DuplicateKeyErrors = [2601, 2627];

    private readonly MsSqlContainerFixture _fixture;

    public PortalDataIsolationTests(MsSqlContainerFixture fixture)
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
    public async Task AsConfig_ReadsAbsentUnderB_AndUnderAnUnresolvedScope()
    {
        var exerciseA = Guid.NewGuid();
        var configA = await SeedAsync(ChannelRows.PortalConfig(exerciseA));

        await using (var readB = _fixture.CreateContext(ScopeFor(Guid.NewGuid())))
        {
            (await readB.FindPortalConfigAsync()).Should().BeNull("exercise B never sees A's portal config (XC-001)");
            (await readB.PortalConfigs.FindAsync(configA.Id)).Should().BeNull("not even by A's real id (IDOR)");
        }

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.FindPortalConfigAsync()).Should().BeNull("an unresolved scope fails closed");
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.FindPortalConfigAsync())!.Id.Should().Be(configA.Id);
    }

    [RequiresDockerFact]
    public async Task AsResources_AreInvisibleUnderB_AndUnderAnUnresolvedScope_InEveryPortalRead()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var resourceA = await SeedAsync(ChannelRows.PortalResource(exerciseA));
        var resourceB = await SeedAsync(ChannelRows.PortalResource(exerciseB));

        await using (var readB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            (await readB.LivePortalResources().Select(r => r.Id).ToListAsync()).Should().Equal(resourceB.Id);
            (await readB.CountLivePortalResourcesAsync()).Should().Be(1);
            (await readB.ExportPortalResourcesForAarAsync()).Select(r => r.Id).Should().Equal(resourceB.Id);
            (await readB.PortalResources.FindAsync(resourceA.Id)).Should().BeNull("A's real id resolves nothing under B");
        }

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.LivePortalResources().AnyAsync()).Should().BeFalse("an unresolved scope reads nothing");
            (await read.CountLivePortalResourcesAsync()).Should().Be(0);
            (await read.ExportPortalResourcesForAarAsync()).Should().BeEmpty("the AAR export keeps the scope too");
        }

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.PortalResources.IgnoreQueryFilters().CountAsync(r => r.Id == resourceA.Id || r.Id == resourceB.Id))
            .Should().Be(2, "the rows exist; only the scope hides them");
    }

    // ---- writes ---------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AWriteNamingAnotherExercise_ThroughTheGuardedPath_IsRefused_AndNothingPersists()
    {
        // The guarded path stories 03/04 follow: EnsureInScope, then the write. Under B, an insert of a row naming A and a
        // stub update of A's real row (the stub the context alone would accept) are both refused before SaveChanges.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var resourceA = await SeedAsync(ChannelRows.PortalResource(exerciseA));
        var scopeB = ScopeFor(exerciseB);
        var insert = ChannelRows.PortalResource(exerciseA);

        await using (var writeB = _fixture.CreateContext(scopeB))
        {
            var add = () => GuardedWriteAsync(writeB, scopeB, insert, db => db.Add(insert));
            await add.Should().ThrowAsync<ExerciseScopeViolationException>("B's request cannot add a row to exercise A");
        }

        await using (var writeB = _fixture.CreateContext(scopeB))
        {
            var stub = ChannelRows.PortalResource(exerciseA);
            stub.Id = resourceA.Id;
            var update = () => GuardedWriteAsync(writeB, scopeB, stub, db =>
            {
                db.Attach(stub);
                stub.Title = "Hijacked";
            });
            await update.Should().ThrowAsync<ExerciseScopeViolationException>("nor change A's row with a stub naming A");
        }

        await using var verify = _fixture.CreateContext();
        (await verify.PortalResources.IgnoreQueryFilters().AnyAsync(r => r.Id == insert.Id)).Should().BeFalse();
        (await verify.PortalResources.IgnoreQueryFilters().SingleAsync(r => r.Id == resourceA.Id)).Title
            .Should().Be(resourceA.Title);
    }

    [RequiresDockerFact]
    public async Task AsRows_AreUnwritableUnderB_ByStubUpdateDeleteOrBulkUpdate()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var configA = await SeedAsync(ChannelRows.PortalConfig(exerciseA));
        var resourceA = await SeedAsync(ChannelRows.PortalResource(exerciseA));

        await using (var writeB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            var stub = ChannelRows.PortalConfig(exerciseB);
            stub.Id = configA.Id;
            writeB.Attach(stub);
            stub.PortalName = "Hijacked Today";
            var act = async () => await writeB.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>("B's stub of A's config matches no row");
        }

        await using (var writeB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            var stub = ChannelRows.PortalResource(exerciseB);
            stub.Id = resourceA.Id;
            writeB.Attach(stub);
            stub.Title = "Hijacked";
            var act = async () => await writeB.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>("B's stub of A's resource matches no row");
        }

        await using (var deleteB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            var stub = ChannelRows.PortalResource(exerciseB);
            stub.Id = resourceA.Id;
            deleteB.Remove(stub);
            var act = async () => await deleteB.SaveChangesAsync();
            await act.Should().ThrowAsync<DbUpdateConcurrencyException>("nor can B soft-delete A's resource");
        }

        await using (var bulkB = _fixture.CreateContext(ScopeFor(exerciseB)))
        {
            (await bulkB.PortalConfigs.Where(p => p.Id == configA.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.PortalName, "Hijacked"))).Should().Be(0);
            (await bulkB.PortalResources.Where(r => r.Id == resourceA.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.Title, "Hijacked"))).Should().Be(0);
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.FindPortalConfigAsync())!.PortalName.Should().Be(configA.PortalName);
        var resource = await readA.PortalResources.SingleAsync(r => r.Id == resourceA.Id);
        resource.Title.Should().Be(resourceA.Title);
        resource.DeletedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task AnEmptyExerciseId_IsRefusedByTheCentralWriteGuard_ForBothTables()
    {
        var config = ChannelRows.PortalConfig(Guid.Empty);
        var resource = ChannelRows.PortalResource(Guid.Empty);

        foreach (var row in new object[] { config, resource })
        {
            await using var write = _fixture.CreateContext();
            write.Add(row);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>();
        }

        await using var verify = _fixture.CreateContext();
        (await verify.PortalConfigs.IgnoreQueryFilters().AnyAsync(p => p.Id == config.Id)).Should().BeFalse();
        (await verify.PortalResources.IgnoreQueryFilters().AnyAsync(r => r.Id == resource.Id)).Should().BeFalse();
    }

    // ---- soft delete and the AAR export -------------------------------------------------------

    [RequiresDockerFact]
    public async Task ADeletedResource_IsRetained_HiddenFromNormalReads_AndInTheAarExport()
    {
        var exerciseId = Guid.NewGuid();
        var first = await SeedAsync(ChannelRows.PortalResource(exerciseId, sortOrder: 0));
        var deleted = await SeedAsync(ChannelRows.PortalResource(exerciseId, sortOrder: 1));
        var last = await SeedAsync(ChannelRows.PortalResource(exerciseId, sortOrder: 2));

        await using (var delete = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            var row = await delete.PortalResources.SingleAsync(r => r.Id == deleted.Id);
            delete.PortalResources.Remove(row);
            await delete.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext(ScopeFor(exerciseId));
        (await read.LivePortalResources().Select(r => r.Id).ToListAsync()).Should().Equal(
            [first.Id, last.Id], "a deleted resource is excluded from normal reads");
        (await read.CountLivePortalResourcesAsync()).Should().Be(2, "and does not count against the 25-resource cap");

        var export = await read.ExportPortalResourcesForAarAsync();
        export.Select(r => r.Id).Should().Equal([first.Id, deleted.Id, last.Id], "the AAR sees every resource, in order");
        export.Single(r => r.Id == deleted.Id).DeletedAt.Should().NotBeNull("the row was retained with DeletedAt (XC-010)");
        export.Where(r => r.Id != deleted.Id).Should().OnlyContain(r => r.DeletedAt == null);
        export.Single(r => r.Id == deleted.Id).Title.Should().Be(deleted.Title, "the retained row is intact");
    }

    [RequiresDockerFact]
    public async Task TheResourceCap_CountsLiveResourcesOnly()
    {
        var exerciseId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < PortalLimits.MaxResources; i++)
            {
                seed.PortalResources.Add(ChannelRows.PortalResource(exerciseId, sortOrder: i));
            }

            await seed.SaveChangesAsync();
        }

        await using (var full = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            PortalLimits.CheckResourceCount(await full.CountLivePortalResourcesAsync()).IsValid.Should().BeFalse(
                "a 26th resource is over the cap");

            full.PortalResources.Remove(await full.PortalResources.FirstAsync());
            await full.SaveChangesAsync();
        }

        await using var afterDelete = _fixture.CreateContext(ScopeFor(exerciseId));
        PortalLimits.CheckResourceCount(await afterDelete.CountLivePortalResourcesAsync()).IsValid.Should().BeTrue(
            "deleting one frees a slot even though the row is retained");
    }

    // ---- defaults without rows ----------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AnExerciseWithNoConfig_ReadsAbsent_AndTheReadCreatesNoRow()
    {
        var exerciseId = Guid.NewGuid();

        await using (var read = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            (await read.FindPortalConfigAsync()).Should().BeNull("no row means the defaults (story 03 resolves them)");
            await read.SaveChangesAsync();
        }

        await using var verify = _fixture.CreateContext();
        (await verify.PortalConfigs.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(
            0, "a read never creates the config row");
    }

    [RequiresDockerFact]
    public async Task TheDatabase_AllowsOneConfigPerExercise()
    {
        var exerciseA = Guid.NewGuid();
        await SeedAsync(ChannelRows.PortalConfig(exerciseA));

        await using (var second = _fixture.CreateContext(ScopeFor(exerciseA)))
        {
            second.PortalConfigs.Add(ChannelRows.PortalConfig(exerciseA));
            var act = async () => await second.SaveChangesAsync();
            (await act.Should().ThrowAsync<DbUpdateException>()).Which.InnerException.Should().BeOfType<SqlException>()
                .Which.Number.Should().BeOneOf(DuplicateKeyErrors);
        }

        var other = async () => await SeedAsync(ChannelRows.PortalConfig(Guid.NewGuid()));
        await other.Should().NotThrowAsync("another exercise has its own config");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    /// <summary>A service's write: the scope check, then the change, then <c>SaveChanges</c>.</summary>
    private static async Task GuardedWriteAsync(
        PulseDbContext db, IExerciseContext scope, IExerciseScoped row, Action<PulseDbContext> change)
    {
        PortalWriteScope.EnsureInScope(scope, row);
        change(db);
        await db.SaveChangesAsync();
    }

    private async Task<T> SeedAsync<T>(T row)
        where T : class
    {
        await using var seed = _fixture.CreateContext();
        seed.Add(row);
        await seed.SaveChangesAsync();
        return row;
    }
}
