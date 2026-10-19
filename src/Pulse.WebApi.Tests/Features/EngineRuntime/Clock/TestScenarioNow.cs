namespace Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

using System;
using System.Threading.Tasks;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;

/// <summary>
/// Builds the production <see cref="ScenarioNowResolver"/> (engine-runtime/08) for tests that construct a service by
/// hand. The real resolver, never a fake: with no clock running and no posts it answers the caller's wall-clock now,
/// which is exactly what those services stamped before the resolver existed.
/// </summary>
internal static class TestScenarioNow
{
    /// <summary>A resolver over <paramref name="dbContext"/>, with an optional shared clock and time source.</summary>
    /// <param name="dbContext">The context the service under test uses (posts are read through it).</param>
    /// <param name="clock">The clock the test drives, or a fresh never-started one.</param>
    /// <param name="timeProvider">The wall clock, or the system clock.</param>
    /// <returns>The resolver.</returns>
    public static IScenarioNow Over(
        PulseDbContext dbContext,
        IExerciseClock? clock = null,
        TimeProvider? timeProvider = null) =>
        new ScenarioNowResolver(
            dbContext,
            clock ?? new ExerciseClockService(timeProvider ?? TimeProvider.System),
            timeProvider ?? TimeProvider.System);

    /// <summary>
    /// Puts an exercise's world at <paramref name="scenarioTime"/> the way engine-runtime/08 reads it: one post carrying
    /// that scenario instant (the retired <c>Exercise.CurrentScenarioTime</c> column is never read). A <c>null</c> time
    /// seeds nothing, so the resolver falls through to the wall clock exactly as an unset column used to.
    /// </summary>
    /// <param name="seed">An unscoped seeding context (the post carries its own exercise id).</param>
    /// <param name="exerciseId">The exercise whose world time is set.</param>
    /// <param name="scenarioTime">The world's latest scenario instant, or <c>null</c>.</param>
    /// <returns>A task that completes once the post is saved.</returns>
    public static async Task SeedWorldTimeAsync(PulseDbContext seed, Guid exerciseId, DateTimeOffset? scenarioTime)
    {
        ArgumentNullException.ThrowIfNull(seed);
        if (scenarioTime is not { } at)
        {
            return;
        }

        seed.Posts.Add(new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = Guid.NewGuid(),
            Body = "The world's latest post (engine-runtime/08 scenario now).",
            CreatedScenarioTime = at,
            Origin = "participant",
            ActingHumanId = "human-world-time",
            CreatedWallClock = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
    }
}
