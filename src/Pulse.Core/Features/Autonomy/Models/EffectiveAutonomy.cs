namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The engine's resolved disposition for one storyline: whether generation is stopped, and, if not, the
/// effective <see cref="AutonomyLevel"/> after applying the per-storyline override, the exercise default,
/// and any safety clamp (kill switch / degraded mode). This is what the reaction loop's generate→review
/// stage routes on — check <see cref="GenerationStopped"/> first, then dispatch by <see cref="Level"/>.
/// </summary>
/// <param name="GenerationStopped">
/// True when the engine is fully stopped (kill switch <see cref="KillSwitchMode.FullStop"/>): no
/// generation happens at all. <see cref="Level"/> is <see cref="AutonomyLevel.Suggest"/> and moot.
/// </param>
/// <param name="Level">The effective autonomy level when generation is running.</param>
public readonly record struct EffectiveAutonomy(bool GenerationStopped, AutonomyLevel Level)
{
    /// <summary>The fully-stopped disposition (kill switch full stop).</summary>
    public static EffectiveAutonomy Stopped { get; } = new(true, AutonomyLevel.Suggest);

    /// <summary>A running disposition at <paramref name="level"/>.</summary>
    public static EffectiveAutonomy Running(AutonomyLevel level) => new(false, level);
}
