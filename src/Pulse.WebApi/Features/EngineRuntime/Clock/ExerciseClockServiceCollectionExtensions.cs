namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// Composition-root extension for the native scenario clock (story 03). The orchestrator wires the single
/// <c>AddExerciseClock()</c> call into <c>Program.cs</c> between waves; no builder edits <c>Program.cs</c>.
/// Provider selection mirrors <c>AddEngineGeneration</c>: the native <see cref="ExerciseClockService"/> is the
/// v1 default behind <see cref="IExerciseClock"/>, and a Cadence-linked provider is a Phase-4 swap behind the
/// same interface — a registration change, not an engine change.
/// </summary>
public static class ExerciseClockServiceCollectionExtensions
{
    /// <summary>
    /// Registers the native exercise clock and the engine-facing scenario-clock adapter:
    /// <list type="bullet">
    ///   <item><see cref="IExerciseClock"/> → <see cref="ExerciseClockService"/> as a <b>singleton</b> — the
    ///   one clock the whole host reads, holding per-exercise state (COR-001).</item>
    ///   <item><see cref="IScenarioClock"/> → <see cref="ScenarioClockAdapter"/> as <b>scoped</b>, so the
    ///   engine reads the current scope's exercise minute via <see cref="Pulse.WebApi.Data.IExerciseContext"/>
    ///   (registered by <c>AddExerciseScoping</c>, a prerequisite).</item>
    /// </list>
    /// A <see cref="TimeProvider"/> is registered (<see cref="TimeProvider.System"/>) only if the host has not
    /// already supplied one, so the monotonic time source is swappable for tests.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseClock(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IExerciseClock, ExerciseClockService>();
        services.TryAddScoped<IScenarioClock, ScenarioClockAdapter>();

        return services;
    }
}
