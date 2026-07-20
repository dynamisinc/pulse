namespace Pulse.WebApi.Data.Extensions;

using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Composition-root extension that registers the read-side exercise-scoping seam — the
/// <see cref="IExerciseContext"/> the <see cref="PulseDbContext"/> injects to drive its global query
/// filter. Kept in its OWN extension (separate from <c>AddPulsePersistence</c>) so the scoping seam is a
/// discrete, independently-registered concern; the orchestrator wires the single call into
/// <c>Program.cs</c>, which this story does NOT edit.
/// </summary>
public static class ExerciseScopingServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="IExerciseContext"/> (default <see cref="ExerciseContext"/>) with a Scoped
    /// lifetime, matching the <see cref="PulseDbContext"/>'s own scoped lifetime so <c>AddDbContext</c>'s
    /// constructor injection resolves it per request / unit of work at runtime.
    /// </summary>
    public static IServiceCollection AddExerciseScoping(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<IExerciseContext, ExerciseContext>();

        return services;
    }
}
