namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The built-in escalation curve registry (ADP-010, E8 architecture §6.1). Three named defaults ship:
/// <b>Slow burn</b> (low rise, slow decay), <b>Standard</b>, and <b>Flash panic</b> (steep rise, fast
/// decay). Curves are data — reusable profiles referenced by <see cref="Storyline.CurveName"/> — so this
/// registry is a static lookup, not a service.
/// </summary>
public static class EscalationCurves
{
    /// <summary>The default when a storyline names no curve, or names one the registry doesn't know.</summary>
    public const string DefaultCurveName = "Standard";

    /// <summary>Low rise, slow decay: a concern that simmers rather than spikes.</summary>
    public static EscalationCurve SlowBurn { get; } = new("Slow burn", riseRateUnaddressed: 1.0, decayRateAddressed: 0.6, ceiling: 85, floor: 5);

    /// <summary>The middle profile: a steady rise and a steady decay.</summary>
    public static EscalationCurve Standard { get; } = new(DefaultCurveName, riseRateUnaddressed: 2.5, decayRateAddressed: 2.0, ceiling: 95, floor: 5);

    /// <summary>Steep rise, fast decay: a panic that spikes hard and burns off quickly once addressed.</summary>
    public static EscalationCurve FlashPanic { get; } = new("Flash panic", riseRateUnaddressed: 6.0, decayRateAddressed: 5.0, ceiling: 100, floor: 0);

    // Case-insensitive so a planner's "standard" / "Standard" / "STANDARD" all resolve.
    private static readonly Dictionary<string, EscalationCurve> ByName =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [SlowBurn.Name] = SlowBurn,
            [Standard.Name] = Standard,
            [FlashPanic.Name] = FlashPanic,
        };

    /// <summary>All built-in curves.</summary>
    public static IReadOnlyCollection<EscalationCurve> All => ByName.Values;

    /// <summary>
    /// Resolves a curve by name (case-insensitive), falling back to <see cref="Standard"/> for an unknown
    /// name so a typo in a planner config degrades to the middle profile rather than crashing the loop.
    /// Use <see cref="TryGet"/> when the caller wants to detect an unknown name.
    /// </summary>
    public static EscalationCurve CurveFor(string? name)
    {
        if (!string.IsNullOrWhiteSpace(name) && ByName.TryGetValue(name.Trim(), out var curve))
        {
            return curve;
        }

        return Standard;
    }

    /// <summary>Resolves a curve by name, reporting whether the name was known.</summary>
    public static bool TryGet(string? name, out EscalationCurve curve)
    {
        if (!string.IsNullOrWhiteSpace(name) && ByName.TryGetValue(name.Trim(), out var found))
        {
            curve = found;
            return true;
        }

        curve = Standard;
        return false;
    }
}
