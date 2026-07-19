namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The exercise-scoped holder of the active rate governance (ADP-011). Parallels the storyline aggregate
/// for exercise-level config: it owns the current <see cref="RateGovernanceConfig"/> so a controller
/// change takes effect <b>live</b> — every subsequent cap/floor check reads the new config — and returns
/// a <see cref="RateGovernanceChanged"/> to log (XC-004). The reaction loop holds one per exercise and
/// supplies the per-minute counts to the check methods.
/// </summary>
public sealed class ExerciseRateGovernor
{
    /// <summary>Creates a governor for an exercise, defaulting to <see cref="RateGovernanceConfig.Default"/>.</summary>
    public ExerciseRateGovernor(Guid exerciseId, RateGovernanceConfig? config = null)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Rate governance is exercise-scoped (COR-001).", nameof(exerciseId));
        }

        ExerciseId = exerciseId;
        Current = config ?? RateGovernanceConfig.Default;
    }

    /// <summary>The exercise this governor is scoped to (COR-001).</summary>
    public Guid ExerciseId { get; }

    /// <summary>The active config; swapped atomically by <see cref="Update"/>.</summary>
    public RateGovernanceConfig Current { get; private set; }

    /// <inheritdoc cref="RateGovernance.WithinCap"/>
    public CapDecision WithinCap(int postsThisMinute, int requestedCount) =>
        RateGovernance.WithinCap(Current, postsThisMinute, requestedCount);

    /// <inheritdoc cref="RateGovernance.BelowFloor"/>
    public bool BelowFloor(int postsThisMinute) => RateGovernance.BelowFloor(Current, postsThisMinute);

    /// <inheritdoc cref="RateGovernance.AmbientDeficit"/>
    public int AmbientDeficit(int postsThisMinute) => RateGovernance.AmbientDeficit(Current, postsThisMinute);

    /// <summary>
    /// Applies a new cap/floor config live and returns the steering action to log (XC-004). Subsequent
    /// checks use the new config immediately.
    /// </summary>
    public RateGovernanceChanged Update(RateGovernanceConfig config, int scenarioMinute)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);

        var from = Current;
        Current = config;
        return new RateGovernanceChanged(ExerciseId, from, config, scenarioMinute);
    }
}
