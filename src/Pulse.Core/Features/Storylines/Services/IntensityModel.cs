namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The pure intensity update (ADP-012, §6.2). Given the current intensity, the scenario minutes elapsed,
/// the phase, and the curve, it advances intensity: rising along <see cref="EscalationCurve.RiseRateUnaddressed"/>
/// while a concern is unaddressed (bent <b>up</b> by amplification velocity + audience magnitude), decaying
/// along <see cref="EscalationCurve.DecayRateAddressed"/> once addressed, and holding otherwise. The
/// result is clamped to the curve's [floor, ceiling]. Deterministic and side-effect-free — the
/// <see cref="Storyline"/> aggregate composes it; the math is unit-tested directly.
///
/// <para><b>Fractional rates (D1).</b> Intensity is an integer but curve rates are not (Standard rises
/// 2.5/min). Rounding each per-minute step independently quantizes every +2.5 to +2 (banker's rounding),
/// so a loop ticking each scenario minute ran the Standard curve at 2.0/min. When the caller supplies the
/// absolute scenario minute the tick starts from, the curve step is instead computed as
/// <c>floor(rate × to) − floor(rate × from)</c> — a quantization anchored to scenario time itself. Summed
/// over consecutive ticks it telescopes to <c>floor(rate × end) − floor(rate × start)</c>, so the realized
/// rate matches the curve rate (within one point) regardless of tick granularity, with no fractional state
/// to persist.</para>
/// </summary>
public static class IntensityModel
{
    /// <summary>Intensity points per scenario minute a full-velocity (1.0) amplification adds, before audience scaling.</summary>
    public const double VelocityGainPerScenarioMinute = 3.0;

    /// <summary>Each audience band above 0 adds this fraction to the amplification bend (band 5 ⇒ +50%).</summary>
    public const double AudienceWeightPerBand = 0.1;

    /// <summary>Audience band is clamped to this ceiling so a wild input can't unbound the bend.</summary>
    public const int MaxAudienceBand = 10;

    // Absorbs binary floating-point error in rate × minute (e.g. 1.4 × 45 = 62.999…) so an exact product
    // floors to itself rather than one point short.
    private const double QuantizationEpsilon = 1e-9;

    /// <summary>
    /// Advances intensity one tick. <paramref name="elapsedScenarioMinutes"/> is scenario time
    /// (COR-050/051): 0 (frozen) holds intensity unchanged; a large value (time-jump) advances
    /// proportionally.
    /// </summary>
    /// <param name="currentIntensity">Intensity before the tick.</param>
    /// <param name="elapsedScenarioMinutes">Scenario minutes since the previous tick, non-negative.</param>
    /// <param name="phase">The storyline phase governing rise / decay / hold.</param>
    /// <param name="curve">The escalation curve supplying the rates and bounds.</param>
    /// <param name="amplification">Optional amplification signal that bends the rise upward.</param>
    /// <param name="fromScenarioMinute">
    /// The absolute scenario minute this tick starts from (the previous tick's minute). When supplied, the
    /// curve's rise/decay step is quantized against scenario time (<see cref="CurveStep"/>) so fractional
    /// rates accrue correctly across per-minute ticks (D1). When <c>null</c>, the step is
    /// <c>rate × elapsed</c> rounded once — correct for a single isolated step, but it under-runs a
    /// fractional rate when called every minute.
    /// </param>
    public static int Tick(
        int currentIntensity,
        int elapsedScenarioMinutes,
        StorylinePhase phase,
        EscalationCurve curve,
        IAmplificationSignal? amplification = null,
        int? fromScenarioMinute = null)
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
                var baseRise = CurveStep(curve.RiseRateUnaddressed, elapsedScenarioMinutes, fromScenarioMinute);
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
                var decayed = currentIntensity - CurveStep(curve.DecayRateAddressed, elapsedScenarioMinutes, fromScenarioMinute);
                var floored = Math.Max(decayed, curve.Floor);
                return ClampHard((int)Math.Round(Math.Min(floored, currentIntensity)));
            }

            default:
                // Dormant / Seeded / Resolved: intensity holds at its current value.
                return ClampHard(currentIntensity);
        }
    }

    /// <summary>
    /// Drives intensity toward a controller-set dial target (CTL-022, story 05) instead of following the
    /// raw curve. It uses the curve's rates for how fast to move — rising (bent up by amplification) when
    /// below the target, decaying when above — but the <b>target</b> is the goal and the hard bound: it
    /// never overshoots the target, and when the target is below the current value (a controller lowered
    /// it) it only ever moves <i>down</i> — amplification cannot push intensity past a lowered target
    /// (controller authority is absolute). The target overrides the curve's own floor/ceiling.
    /// </summary>
    /// <param name="currentIntensity">Intensity before the tick.</param>
    /// <param name="target">The controller-set dial target (clamped to 0–100).</param>
    /// <param name="elapsedScenarioMinutes">Scenario minutes since the previous tick, non-negative.</param>
    /// <param name="curve">The escalation curve supplying the rates.</param>
    /// <param name="amplification">Optional amplification signal that helps the rise toward the target.</param>
    /// <param name="fromScenarioMinute">
    /// The absolute scenario minute this tick starts from; when supplied the rate step is quantized against
    /// scenario time exactly as in <see cref="Tick"/> (D1).
    /// </param>
    public static int TickTowardTarget(
        int currentIntensity,
        int target,
        int elapsedScenarioMinutes,
        EscalationCurve curve,
        IAmplificationSignal? amplification = null,
        int? fromScenarioMinute = null)
    {
        ArgumentNullException.ThrowIfNull(curve);
        ArgumentOutOfRangeException.ThrowIfNegative(elapsedScenarioMinutes);

        var goal = Math.Clamp(target, Storyline.MinIntensity, Storyline.MaxIntensity);

        if (elapsedScenarioMinutes == 0 || currentIntensity == goal)
        {
            return ClampHard(currentIntensity == goal ? goal : currentIntensity);
        }

        if (currentIntensity < goal)
        {
            // Raise toward the target; amplification helps, but never overshoot the target.
            var rise = CurveStep(curve.RiseRateUnaddressed, elapsedScenarioMinutes, fromScenarioMinute) + AmplificationBend(amplification, elapsedScenarioMinutes);
            return ClampHard((int)Math.Round(Math.Min(currentIntensity + rise, goal)));
        }

        // Above the target: taper down toward it — no upward bend past a controller-lowered target.
        var fall = CurveStep(curve.DecayRateAddressed, elapsedScenarioMinutes, fromScenarioMinute);
        return ClampHard((int)Math.Round(Math.Max(currentIntensity - fall, goal)));
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

    /// <summary>
    /// The curve's rise or decay magnitude over one tick. With an anchor minute it is
    /// <c>floor(rate × (from + elapsed)) − floor(rate × from)</c> — an integer step quantized against
    /// absolute scenario time, so consecutive ticks telescope to the true accumulated rate (D1: Standard's
    /// 2.5/min no longer collapses to 2/min under per-minute ticks). Without an anchor it is the raw
    /// <c>rate × elapsed</c> (the caller rounds once).
    /// </summary>
    /// <param name="ratePerMinute">The curve rate, intensity points per scenario minute (non-negative).</param>
    /// <param name="elapsedScenarioMinutes">Scenario minutes this tick covers, non-negative.</param>
    /// <param name="fromScenarioMinute">The absolute scenario minute the tick starts from, or <c>null</c>.</param>
    public static double CurveStep(double ratePerMinute, int elapsedScenarioMinutes, int? fromScenarioMinute)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(ratePerMinute);
        ArgumentOutOfRangeException.ThrowIfNegative(elapsedScenarioMinutes);

        if (fromScenarioMinute is not int from)
        {
            return ratePerMinute * elapsedScenarioMinutes;
        }

        ArgumentOutOfRangeException.ThrowIfNegative(from);

        var to = from + elapsedScenarioMinutes;
        return Math.Floor((ratePerMinute * to) + QuantizationEpsilon) - Math.Floor((ratePerMinute * from) + QuantizationEpsilon);
    }

    private static int ClampHard(int value) => Math.Clamp(value, Storyline.MinIntensity, Storyline.MaxIntensity);
}
