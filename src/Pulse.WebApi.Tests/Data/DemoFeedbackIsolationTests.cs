namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// demo-feedback/01 (Isolation AC, XC-001/COR-001) — the always-Critical behavioural proof for the feature's one new
/// <see cref="IExerciseScoped"/> entity, <see cref="NoisePost"/> (the white-noise pool). Same rigor as
/// <see cref="EasyLoginIsolationTests"/>: real SQL Server, fresh ids per test, because-reasons. It proves the central
/// filter and write guard cover the pool with no per-entity code: exercise B's entries are invisible under A's scope
/// (by list, by id, by the pacer's least-posted-first read, and by aggregate), an unset or empty scope sees ZERO rows
/// while the rows provably exist, and saving one with no resolved scope throws.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class DemoFeedbackIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public DemoFeedbackIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static NoisePost NewNoise(Guid exerciseId, int order = 1) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PersonaId = Guid.NewGuid(),
        Text = $"Traffic on Peachtree is a mess again {Guid.NewGuid():N}",
        Order = order,
        CreatedWallClock = DateTimeOffset.UtcNow,
    };

    [RequiresDockerFact]
    public async Task NoisePostQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var noiseA = NewNoise(exerciseA);
        var noiseB = NewNoise(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.NoisePosts.AddRange(noiseA, noiseB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.NoisePosts
            .Where(n => n.Id == noiseA.Id || n.Id == noiseB.Id)
            .Select(n => n.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            noiseA.Id, "a query in exercise A must see only A's noise pool — B's text would publish into A's feed");
    }

    [RequiresDockerFact]
    public async Task ThePacersLeastPostedFirstRead_UnderExerciseA_NeverPicksExerciseBsEntry()
    {
        // The exact shape story 05's pacer performs: no predicate of its own beyond ordering, so the central filter
        // is the ONLY thing standing between it and another exercise's pool. B's entry is the least-posted overall.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var noiseA = NewNoise(exerciseA);
        noiseA.PostedCount = 5;
        var noiseB = NewNoise(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.NoisePosts.AddRange(noiseA, noiseB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var next = await readA.NoisePosts
            .OrderBy(n => n.PostedCount)
            .ThenBy(n => n.Order)
            .FirstAsync();

        next.Id.Should().Be(noiseA.Id, "the pacer under A's scope must pick A's entry even when B's is used less");
        next.ExerciseId.Should().Be(exerciseA);
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByAKnownCrossExerciseId_ReturnsNull()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var noiseA = NewNoise(exerciseA);
        var noiseB = NewNoise(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.NoisePosts.AddRange(noiseA, noiseB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.NoisePosts.FindAsync(noiseB.Id)).Should().BeNull(
            "FindAsync by exercise B's real noise id from an exercise-A scope must fail closed (IDOR)");
        (await readA.NoisePosts.SingleOrDefaultAsync(n => n.PersonaId == noiseB.PersonaId)).Should().BeNull(
            "a lookup by B's persona id must be filtered out too");
        (await readA.NoisePosts.FindAsync(noiseA.Id)).Should().NotBeNull("A's own entry still resolves");
    }

    [RequiresDockerFact]
    public async Task AggregateCounts_DoNotLeakAnotherExercisesPoolSize()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.NoisePosts.Add(NewNoise(exerciseA));
            seed.NoisePosts.AddRange(NewNoise(exerciseB, 1), NewNoise(exerciseB, 2), NewNoise(exerciseB, 3));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.NoisePosts.CountAsync()).Should().Be(
            1, "a count under exercise A's scope is A's pool size alone (story 05's poolSize) — B's must not leak");
        (await readA.NoisePosts.SumAsync(n => n.PostedCount)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowsExist()
    {
        var noise = NewNoise(Guid.NewGuid());

        await using (var seed = _fixture.CreateContext())
        {
            seed.NoisePosts.Add(noise);
            await seed.SaveChangesAsync();
        }

        var unresolvedScopes = new IExerciseContext?[]
        {
            null,
            new ExerciseContext(),
            new ExerciseContext { CurrentExerciseId = Guid.Empty },
        };

        foreach (var scope in unresolvedScopes)
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.NoisePosts.CountAsync(n => n.Id == noise.Id)).Should().Be(
                0, "an unresolved scope collapses to Guid.Empty, which no NoisePost can carry — zero rows, never all");
        }

        // The zeros above are the filter closing the door, not an empty table.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.NoisePosts.IgnoreQueryFilters().CountAsync(n => n.Id == noise.Id)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task SavingANoisePost_WithNoResolvedScope_ThrowsAndPersistsNothing()
    {
        var noise = NewNoise(Guid.Empty);

        await using (var write = _fixture.CreateContext())
        {
            write.NoisePosts.Add(noise);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses a NoisePost with an empty ExerciseId — no per-entity code needed");
        }

        await using var verify = _fixture.CreateContext();
        (await verify.NoisePosts.IgnoreQueryFilters().CountAsync(n => n.Id == noise.Id)).Should().Be(
            0, "the guard throws before SaveChanges reaches the database");
    }
}
