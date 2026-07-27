namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Small seeding helpers shared by the exercise-configuration suites. Every test uses a fresh
/// <see cref="Guid.NewGuid"/> exercise id so the suites stay independent on the shared database without
/// truncating tables between tests.
/// </summary>
public static class ExerciseConfigurationTestData
{
    /// <summary>Builds an unscoped <see cref="PulseDbContext"/> against the test database (seeding/read-back).</summary>
    /// <param name="connectionString">The migrated test database.</param>
    /// <returns>A fresh context.</returns>
    public static PulseDbContext CreateContext(string connectionString)
    {
        ArgumentNullException.ThrowIfNull(connectionString);

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(connectionString)
            .Options;

        return new PulseDbContext(options);
    }

    /// <summary>Whether an exercise row already exists (the test host seeds one only if absent).</summary>
    /// <param name="context">The context to query.</param>
    /// <param name="exerciseId">The exercise id.</param>
    /// <returns><c>true</c> when the row exists.</returns>
    public static Task<bool> ExerciseExistsAsync(PulseDbContext context, Guid exerciseId)
    {
        ArgumentNullException.ThrowIfNull(context);
        return context.Exercises.AsNoTracking().AnyAsync(e => e.Id == exerciseId);
    }

    /// <summary>
    /// Builds an exercise row with NO COR-030 settings configured — the state every pre-existing row is in
    /// after story 01a's migration, and the one that must keep serving the shipped Phase-1 constants.
    /// </summary>
    /// <param name="exerciseId">The exercise id.</param>
    /// <param name="name">The staff-facing internal name.</param>
    /// <returns>The entity to add.</returns>
    public static Exercise UnconfiguredExercise(Guid exerciseId, string name = "Unconfigured Exercise") => new()
    {
        Id = exerciseId,
        Name = name,
        TimeZone = "UTC",
        Status = "live",
    };
}
