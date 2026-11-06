namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// engine-runtime/08 (CLK-2) — the ONE "scenario now" resolver against real SQL: the running clock wins; with no clock
/// the exercise's latest post; with neither, the caller's wall clock. Isolation (COR-001, always-Critical): another
/// exercise's LATER post never informs this exercise's scenario now, whether the read goes through the scoped set (the
/// request is scoped to the exercise) or by explicit id (an ops path, a session refresh, a staff switch).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ScenarioNowResolverTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 19, 15, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset World = new(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-4));

    private readonly MsSqlContainerFixture _fixture;

    public ScenarioNowResolverTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task NoClock_ReturnsTheExercisesLatestPost_IncludingATakenDownOne()
    {
        var exerciseId = Guid.NewGuid();
        await AddPostAsync(exerciseId, World);
        await AddPostAsync(exerciseId, World.AddMinutes(45), deleted: true);
        await AddPostAsync(exerciseId, World.AddMinutes(10));

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var resolver = Resolver(context, new ExerciseClockService(new ManualTimeProvider(WallNow)));

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(
            World.AddMinutes(45), "with no running clock, scenario now is where the world is: the latest post (a takedown "
            + "does not move the world's time back)");
        (await resolver.FindAsync(exerciseId)).Should().Be(World.AddMinutes(45));
    }

    [RequiresDockerFact]
    public async Task RunningClock_Wins_OverALaterPost()
    {
        var exerciseId = Guid.NewGuid();
        await AddPostAsync(exerciseId, World.AddHours(5));
        var time = new ManualTimeProvider(WallNow);
        var clock = new ExerciseClockService(time);
        clock.Start(exerciseId, World, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(3));

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var resolver = Resolver(context, clock);

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(
            World.AddMinutes(3), "a running clock is authoritative (live, or rehydrated by demo-feedback/18)");
    }

    [Fact]
    public async Task RunningClock_AnswersWithoutTouchingTheDatabase()
    {
        // A model-only context: any query would throw (there is no server). The clock tier must not query.
        var exerciseId = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options;
        await using var context = new PulseDbContext(options);
        var clock = new ExerciseClockService(new ManualTimeProvider(WallNow));
        clock.Start(exerciseId, World, TimeZoneInfo.Utc);

        var resolver = Resolver(context, clock);

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(World, "the clock tier is in memory");
        (await resolver.FindAsync(exerciseId)).Should().Be(World);
    }

    [RequiresDockerFact]
    public async Task NoClock_NoPosts_ReturnsTheCallersWallClock_AndFindReturnsNull()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(WallNow.AddSeconds(7));

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var resolver = new ScenarioNowResolver(context, new ExerciseClockService(time), time);

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(
            WallNow, "a fresh exercise behaves exactly as before: the operation's own wall-clock read");
        (await resolver.GetAsync(exerciseId)).Should().Be(WallNow.AddSeconds(7), "the overload without a now reads the TimeProvider");
        (await resolver.FindAsync(exerciseId)).Should().BeNull();
        (await resolver.FindAsync(Guid.Empty)).Should().BeNull("an empty id names no exercise (fail closed)");
    }

    [RequiresDockerFact]
    public async Task AnotherExercisesLaterPost_NeverInformsThisExercisesScenarioNow_ScopedOrByExplicitId()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await AddPostAsync(exerciseA, World);
        await AddPostAsync(exerciseB, World.AddYears(1));
        var clock = new ExerciseClockService(new ManualTimeProvider(WallNow));

        // 1. The request is scoped to A: the scoped set (central filter + explicit predicate).
        await using (var scopedToA = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseA }))
        {
            (await Resolver(scopedToA, clock).GetAsync(exerciseA, WallNow)).Should().Be(
                World, "B's later post is invisible to A (COR-001)");
        }

        // 2. No request scope (an ops path): IgnoreQueryFilters + the explicit ExerciseId predicate, still only A's posts.
        await using (var unscoped = _fixture.CreateContext())
        {
            (await Resolver(unscoped, clock).GetAsync(exerciseA, WallNow)).Should().Be(World);
        }

        // 3. The request is scoped to B but asks for A (a staff switch, a session bound to A): A's posts only, never B's.
        await using (var scopedToB = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseB }))
        {
            (await Resolver(scopedToB, clock).GetAsync(exerciseA, WallNow)).Should().Be(
                World, "reading another server-resolved exercise names it explicitly; the scope's own posts never leak in");
            (await Resolver(scopedToB, clock).GetAsync(exerciseB, WallNow)).Should().Be(World.AddYears(1));
        }

        // 4. The rows exist: a zero for an unknown exercise is the predicate closing the door, not an empty table.
        await using var verify = _fixture.CreateContext();
        (await verify.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseB)).Should().Be(1);
        (await Resolver(verify, clock).FindAsync(Guid.NewGuid())).Should().BeNull(
            "an exercise with no posts and no clock has no scenario now of its own, whatever other exercises hold");
    }

    /// <summary>Adds one post to <paramref name="exerciseId"/> at <paramref name="scenarioTime"/> through an unscoped context.</summary>
    internal static async Task AddPostAsync(
        MsSqlContainerFixture fixture, Guid exerciseId, DateTimeOffset scenarioTime, bool deleted = false)
    {
        await using var seed = fixture.CreateContext();
        seed.Posts.Add(new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "where the world is",
            CreatedScenarioTime = scenarioTime,
            Origin = "participant",
            ActingHumanId = "human-scenario-now",
            CreatedWallClock = WallNow,
            DeletedAt = deleted ? scenarioTime.AddMinutes(1) : null,
        });
        await seed.SaveChangesAsync();
    }

    private Task AddPostAsync(Guid exerciseId, DateTimeOffset scenarioTime, bool deleted = false) =>
        AddPostAsync(_fixture, exerciseId, scenarioTime, deleted);

    /// <summary>The resolver over <paramref name="context"/>; the request scope (if any) lives on the context's filter.</summary>
    private static ScenarioNowResolver Resolver(PulseDbContext context, IExerciseClock clock) =>
        new(context, clock, new ManualTimeProvider(WallNow));
}
