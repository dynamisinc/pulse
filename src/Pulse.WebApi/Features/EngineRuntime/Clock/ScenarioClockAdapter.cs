namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using Pulse.Core.Features.Storylines.Services;
using Pulse.WebApi.Data;

/// <summary>
/// Adapts the native <see cref="IExerciseClock"/> onto the engine's hand-cranked
/// <see cref="IScenarioClock"/> seam (<c>Pulse.Core.Features.Storylines.Services.IScenarioClock</c>) — so
/// <c>ObserveStage</c>, <c>Storyline.Tick</c>, and the Delayed-auto countdown read scenario minutes from the
/// one native clock rather than a parallel stub. This adapts <b>onto</b> the engine seam without changing any
/// <c>Pulse.Core</c> code: the interface exposes only <see cref="CurrentScenarioMinute"/>, and the design
/// contract it already documents ("leaps on a time-jump; holds constant while frozen") is exactly what the
/// native clock delivers.
///
/// <para><b>Exercise binding (COR-001).</b> <see cref="IScenarioClock"/> carries no exercise identity, so the
/// adapter resolves the current exercise from the scoped <see cref="IExerciseContext"/> — the same fail-closed
/// scoping seam every read inherits. An unresolved scope (<c>null</c> / <see cref="Guid.Empty"/>) reads
/// scenario minute 0, never another exercise's minute. Registered Scoped: story 01's loop sets
/// <c>ExerciseContext.CurrentExerciseId</c> on its per-exercise scope, then resolves this adapter to read that
/// exercise's clock.</para>
/// </summary>
public sealed class ScenarioClockAdapter : IScenarioClock
{
    private readonly IExerciseClock _exerciseClock;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the adapter over the native clock and the current exercise scope.</summary>
    /// <param name="exerciseClock">The native per-exercise clock to read.</param>
    /// <param name="exerciseContext">The scoped exercise context that names which exercise to read.</param>
    public ScenarioClockAdapter(IExerciseClock exerciseClock, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(exerciseClock);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        _exerciseClock = exerciseClock;
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    public int CurrentScenarioMinute
    {
        get
        {
            var scope = _exerciseContext.CurrentExerciseId ?? Guid.Empty;
            return scope == Guid.Empty ? 0 : _exerciseClock.CurrentScenarioMinute(scope);
        }
    }
}
