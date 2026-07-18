namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The pure intensity update (ADP-012, §6.2). Given the current intensity, the scenario minutes elapsed,
/// the phase, and the curve, it advances intensity: rising along <see cref="EscalationCurve.RiseRateUnaddressed"/>
/// while a concern is unaddressed (bent <b>up</b> by amplification velocity + audience magnitude), decaying
/// along <see cref="EscalationCurve.DecayRateAddressed"/> once addressed, and holding otherwise. The
/// result is clamped to the curve's [floor, ceiling]. Deterministic and side-effect-free — the
/// <see cref="Storyline"/> aggregate composes it; the math is unit-tested directly.
/// </summary>
public static class IntensityModel
{
    /// <summary>Intensity points per scenario minute a full-velocity (1.0) amplification adds, before audience scaling.</summary>
    public const double VelocityGainPerScenarioMinute = 3.0;

    /// <summary>Each audience band above 0 adds this fraction to the amplification bend (band 5 ⇒ +50%).</summary>
    public const double AudienceWeightPerBand = 0.1;

    /// <summary>Audience band is clamped to this ceiling so a wild input can't unbound the bend.</summary>
    public const int MaxAudienceBand = 10;

    /// <summary>
    /// Advances intensity one tick. <paramref name="elapsedScenarioMinutes"/> is scenario time
    /// (COR-050/051): 0 (frozen) holds intensity unchanged; a large value (time-jump) advances
    /// proportionally.
    /// </summary>
    public static int Tick(
        int currentIntensity,
        int elapsedScenarioMinutes,
        StorylinePhase phase,
        EscalationCurve curve,
        IAmplificationSignal? amplification = null)
    {
        ArgumentNullException.ThrowIfNull(curve);
        ArgumentOutOfRangeException.ThrowIfNegative(elapsedScenarioMinutes);

        if (elapsedScenarioMinutes == 0)
        {
            // Frozen (or no time passed): intensity does not move.
            return Math.Clamp(currentIntensity, Storyline.MinIntensity, Storyline.MaxIntensity);
        }

        switch (phase)
        {
            case StorylinePhase.Escalating:
            case StorylinePhase.Peak:
            {
                var baseRise = curve.RiseRateUnaddressed * elapsedScenarioMinutes;
                var bendUp = AmplificationBend(amplification, elapsedScenarioMinutes);
                var raised = currentIntensity + baseRise + bendUp;

                // Bounded by the curve ceiling. If the current value already exceeds the ceiling (e.g. the
                // curve was swapped to a lower-ceiling profile), this eases it back down to the ceiling.
                var capped = Math.Min(raised, curve.Ceiling);
                return ClampHard((int)Math.Round(capped));
            }

            case StorylinePhase.Addressed:
            case StorylinePhase.Decaying:
            {
                var decayed = currentIntensity - (curve.DecayRateAddressed * elapsedScenarioMinutes);
                var floored = Math.Max(decayed, curve.Floor);
                return ClampHard((int)Math.Round(Math.Min(floored, currentIntensity)));
            }

            default:
                // Dormant / Seeded / Resolved: intensity holds at its current value.
                return ClampHard(currentIntensity);
        }
    }

    /// <summary>
    /// The upward bend from amplification this tick (ADP-004 velocity scaled by SOC-054 audience). Zero
    /// when there is no amplification signal.
    /// </summary>
    public static double AmplificationBend(IAmplificationSignal? amplification, int elapsedScenarioMinutes)
    {
        if (amplification is null)
        {
            return 0.0;
        }

        ArgumentOutOfRangeException.ThrowIfNegative(elapsedScenarioMinutes);

        var velocity = Math.Clamp(amplification.Velocity, 0.0, 1.0);
        var band = Math.Clamp(amplification.AudienceBand, 0, MaxAudienceBand);
        var audienceMultiplier = 1.0 + (AudienceWeightPerBand * band);

        return velocity * VelocityGainPerScenarioMinute * elapsedScenarioMinutes * audienceMultiplier;
    }

    private static int ClampHard(int value) => Math.Clamp(value, Storyline.MinIntensity, Storyline.MaxIntensity);
}
