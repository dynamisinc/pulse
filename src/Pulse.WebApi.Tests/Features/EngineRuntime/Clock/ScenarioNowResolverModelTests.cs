namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// engine-runtime/08 (CLK-2) — the scenario-now resolver's model-only proof, outside the SQL collection so it runs on
/// every machine: a running clock answers in memory and never touches the database.
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
}
