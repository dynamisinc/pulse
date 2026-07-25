namespace Pulse.WebApi.Tests.Features.Social.Follows;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The always-Critical isolation proof for the new <see cref="Follow"/> entity (COR-001 / XC-001,
/// <c>profiles-social-graph/07</c> AC1 + AC6), extending the standing suite
/// (<c>Data/QueryFilterIsolationTests.cs</c>, <c>exercise-isolation/07</c>) to the follow graph. Against a
/// REAL SQL Server it asserts, at the database, that: exercise A sees only A's edges; an unset scope sees ZERO
/// (fail closed); <c>IgnoreQueryFilters()</c> reveals the rows DO exist (so a zero is the filter closing the
/// door, not an empty table); a lookup by a known cross-exercise edge id returns null (IDOR); an aggregate
/// count never leaks another exercise's graph size; and the write-guard refuses an edge with an empty scope.
/// </summary>
/// <remarks>
/// Every test is <see cref="RequiresDockerFactAttribute"/>: a real <c>Skipped</c> on a Docker-less machine
/// without a local SQL connection string, never a silent <c>Passed</c>. Fresh ids per test keep them
/// independent without truncating tables.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class FollowGraphIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public FollowGraphIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task ScopeA_SeesOnlyItsOwnEdges_NeverExerciseBs()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var edgeA = NewEdge(Guid.NewGuid(), exerciseA);
        var edgeB = NewEdge(Guid.NewGuid(), exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.AddRange(edgeA, edgeB);
            await seed.SaveChangesAsync();
        }

        await using var scopedToA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await scopedToA.Follows
            .Where(edge => edge.Id == edgeA.Id || edge.Id == edgeB.Id)
            .ToListAsync();

        visible.Should().ContainSingle(
            "a query under exercise A's scope must return exactly A's edge and never B's (COR-001)")
            .Which.Id.Should().Be(edgeA.Id);
    }

    [RequiresDockerFact]
    public async Task UnsetScope_SeesZeroEdges_FailClosed_AndIgnoreQueryFiltersProvesTheRowsExist()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var edgeA = NewEdge(Guid.NewGuid(), exerciseA);
        var edgeB = NewEdge(Guid.NewGuid(), exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.AddRange(edgeA, edgeB);
            await seed.SaveChangesAsync();
        }

        // No IExerciseContext at all — the fail-closed Guid.Empty scope.
        await using var unscoped = _fixture.CreateContext(exerciseContext: null);

        var visible = await unscoped.Follows
            .Where(edge => edge.Id == edgeA.Id || edge.Id == edgeB.Id)
            .ToListAsync();
        visible.Should().BeEmpty(
            "an unresolved scope collapses to Guid.Empty, which no persisted edge can carry — it matches ZERO "
            + "rows, never all exercises");

        var revealed = await unscoped.Follows
            .IgnoreQueryFilters()
            .Where(edge => edge.Id == edgeA.Id || edge.Id == edgeB.Id)
            .ToListAsync();
        revealed.Should().HaveCount(
            2, "IgnoreQueryFilters proves the zero above was the FILTER closing the door, not an empty table");
    }

    [RequiresDockerFact]
    public async Task LookupByAKnownCrossExerciseEdgeId_ReturnsNull_Idor()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var edgeB = NewEdge(Guid.NewGuid(), exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(edgeB);
            await seed.SaveChangesAsync();
        }

        await using var scopedToA = _fixture.CreateContext(ScopeFor(exerciseA));

        var byPredicate = await scopedToA.Follows.SingleOrDefaultAsync(edge => edge.Id == edgeB.Id);
        byPredicate.Should().BeNull(
            "knowing another exercise's edge id must not let a scope-A caller read it (COR-001 IDOR)");

        var byFind = await scopedToA.Follows.FindAsync(edgeB.Id);
        byFind.Should().BeNull("FindAsync must not bypass the scope either");
    }

    [RequiresDockerFact]
    public async Task AggregateCount_NeverLeaksAnotherExercisesGraphSize()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var followerA = Guid.NewGuid();
        var followeeA = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseA, followerA, followeeA));
            // Three edges in B pointing at the SAME followee id A uses — a naive unscoped count would return 4.
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseB, Guid.NewGuid(), followeeA));
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseB, Guid.NewGuid(), followeeA));
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseB, Guid.NewGuid(), followeeA));
            await seed.SaveChangesAsync();
        }

        await using var scopedToA = _fixture.CreateContext(ScopeFor(exerciseA));

        var inbound = await scopedToA.Follows.CountAsync(edge => edge.FolloweePersonaId == followeeA);
        inbound.Should().Be(
            1,
            "a follower-count aggregate must report only THIS exercise's edges — leaking B's three would put "
            + "another exercise's graph size on a participant profile (COR-001)");
    }

    [RequiresDockerFact]
    public async Task SamePersonaPairInTwoExercises_AreDistinctEdges_TheUniqueIndexIsScopeLed()
    {
        // The unique index leads with ExerciseId, so the SAME ordered persona pair may exist once per
        // exercise — that is what an isolated world means — while a duplicate WITHIN one exercise cannot.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var follower = Guid.NewGuid();
        var followee = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseA, follower, followee));
            seed.Follows.Add(NewEdge(Guid.NewGuid(), exerciseB, follower, followee));
            await seed.SaveChangesAsync();
        }

        await using var duplicate = _fixture.CreateContext();
        duplicate.Follows.Add(NewEdge(Guid.NewGuid(), exerciseA, follower, followee));

        var act = async () => await duplicate.SaveChangesAsync();
        await act.Should().ThrowAsync<DbUpdateException>(
            "a second edge for the same (exercise, follower, followee) triple must be refused by "
            + "IX_Follows_ExerciseId_FollowerPersonaId_FolloweePersonaId — the database is the last word on "
            + "follow idempotency");
    }

    [RequiresDockerFact]
    public async Task WriteGuard_RefusesAnEdgeWithAnEmptyExerciseId()
    {
        await using var context = _fixture.CreateContext();
        context.Follows.Add(NewEdge(Guid.NewGuid(), Guid.Empty));

        var act = async () => await context.SaveChangesAsync();

        await act.Should().ThrowAsync<ExerciseScopeViolationException>(
            "the central write-time guard must refuse an unscoped edge — it is what makes the read filter's "
            + "Guid.Empty predicate match nothing (COR-001/XC-001)");
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static Follow NewEdge(Guid id, Guid exerciseId, Guid? followerPersonaId = null, Guid? followeePersonaId = null) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        FollowerPersonaId = followerPersonaId ?? Guid.NewGuid(),
        FolloweePersonaId = followeePersonaId ?? Guid.NewGuid(),
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
        CreatedWallClock = DateTimeOffset.UtcNow,
    };
}
