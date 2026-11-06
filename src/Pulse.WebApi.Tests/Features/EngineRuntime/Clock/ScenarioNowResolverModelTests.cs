namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// engine-runtime/08 (CLK-2) — the scenario-now resolver's model-only proof, outside the SQL collection so it runs on
/// every machine: a running clock answers in memory and never touches the database; participant posts never move the
/// world's time (review CR-001). Real-SQL translation is <c>ScenarioNowResolverTests</c>.
/// </summary>
public sealed class ScenarioNowResolverModelTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 19, 15, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset World = new(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-4));

    [Fact]
    public async Task RunningClock_AnswersWithoutTouchingTheDatabase()
    {
        // A model-only context: any query would throw (there is no server). The clock tier must not query.
        var exerciseId = Guid.NewGuid();
        var options = new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options;
        await using var context = new PulseDbContext(options);
        var clock = new ExerciseClockService(new ManualTimeProvider(WallNow));
        clock.Start(exerciseId, World, TimeZoneInfo.Utc);

        var resolver = new ScenarioNowResolver(context, clock, new ManualTimeProvider(WallNow));

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(World, "the clock tier is in memory");
        (await resolver.FindAsync(exerciseId)).Should().Be(World);
        (await resolver.FindAsync(Guid.Empty)).Should().BeNull("an empty id names no exercise (fail closed)");
    }

    [Fact]
    public async Task NoClock_IgnoresParticipantPosts_EvenALaterOrAnOverflowingOne()
    {
        // Review CR-001: with no clock running a participant post carries the CLIENT's instant (the frontend mock clock
        // sends wall new Date(); a hostile client anything at all). It must never become the world's time.
        var exerciseId = Guid.NewGuid();
        var participantOnly = Guid.NewGuid();
        await using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        context.Posts.AddRange(
            NewPost(exerciseId, World, "controller-as-persona"),
            NewPost(exerciseId, World.AddMinutes(-30), "engine"),
            NewPost(exerciseId, WallNow.AddDays(30), "participant"),
            NewPost(exerciseId, new DateTimeOffset(9999, 12, 31, 0, 0, 0, TimeSpan.Zero), "participant"),
            NewPost(participantOnly, World.AddDays(1), "participant"));
        await context.SaveChangesAsync();

        var resolver = new ScenarioNowResolver(
            context, new ExerciseClockService(new ManualTimeProvider(WallNow)), new ManualTimeProvider(WallNow));

        (await resolver.GetAsync(exerciseId, WallNow)).Should().Be(
            World, "only staff-authored and server-paced posts say where the world is; the later participant posts do not");
        (await resolver.FindAsync(participantOnly)).Should().BeNull(
            "a world with only participant posts has no scenario now of its own");
        (await resolver.GetAsync(participantOnly, WallNow)).Should().Be(WallNow, "it falls through to the wall clock");
    }

    private static Post NewPost(Guid exerciseId, DateTimeOffset scenarioTime, string origin) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = "a post",
        CreatedScenarioTime = scenarioTime,
        Origin = origin,
        ActingHumanId = "human-model",
        CreatedWallClock = WallNow,
    };
}
