namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// A named escalation profile (ADP-010, E8 architecture §6.1) that shapes a storyline's intensity
/// trajectory with just four numbers so a planner can reason about it: how fast intensity rises while
/// unaddressed, how fast it decays once addressed, and the bounds it moves between. Rates are
/// <b>intensity points per scenario minute</b> (COR-050/051 scenario time), applied by the intensity
/// update (story 02).
/// </summary>
public sealed record EscalationCurve
{
    /// <summary>
    /// Creates a validated curve. <paramref name="floor"/> must be below <paramref name="ceiling"/> and
    /// both must sit on the canonical 0–100 scale; rates must be non-negative.
    /// </summary>
    public EscalationCurve(
        string name,
        double riseRateUnaddressed,
        double decayRateAddressed,
        int ceiling,
        int floor)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("An escalation curve needs a name.", nameof(name));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(riseRateUnaddressed);
        ArgumentOutOfRangeException.ThrowIfNegative(decayRateAddressed);
        ArgumentOutOfRangeException.ThrowIfLessThan(floor, Storyline.MinIntensity);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(ceiling, Storyline.MaxIntensity);

        if (floor >= ceiling)
        {
            throw new ArgumentException(
                $"Curve '{name}' floor ({floor}) must be below its ceiling ({ceiling}).", nameof(floor));
        }

        Name = name.Trim();
        RiseRateUnaddressed = riseRateUnaddressed;
        DecayRateAddressed = decayRateAddressed;
        Ceiling = ceiling;
        Floor = floor;
    }

    /// <summary>The profile name a storyline references via <see cref="Storyline.CurveName"/>.</summary>
    public string Name { get; init; }

    /// <summary>Intensity points gained per scenario minute while the concern is unaddressed.</summary>
    public double RiseRateUnaddressed { get; init; }

    /// <summary>Intensity points shed per scenario minute once the concern is addressed.</summary>
    public double DecayRateAddressed { get; init; }

    /// <summary>Upper bound intensity can rise to under this curve (≤ 100).</summary>
    public int Ceiling { get; init; }

    /// <summary>Lower bound intensity decays to under this curve; at the floor the storyline resolves (≥ 0).</summary>
    public int Floor { get; init; }
}
