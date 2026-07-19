namespace Pulse.Core.Features.Storylines.Models;

/// <summary>Which way the dial-target follow loop wants the decide stage to push generation (CTL-022).</summary>
public enum TargetFollowDirection
{
    /// <summary>Generate more/hotter content to raise intensity toward the target.</summary>
    Raise,

    /// <summary>Taper generation and let decay bring intensity down toward the target.</summary>
    Lower,

    /// <summary>Hold near the target — don't push up (or the target is already met within the deadband).</summary>
    Hold,
}

/// <summary>
/// The dial-target follow loop's advice to the reaction loop's decide stage (CTL-022, story 05): which way
/// to steer generation and roughly how much. When <see cref="HasTarget"/> is false the controller has set
/// no target, so the storyline follows its escalation curve as the natural trajectory (the target is an
/// optional override, not a requirement). <see cref="SuggestedPostCount"/> is already bounded by the rate
/// cap (ADP-011) when a cap was supplied.
/// </summary>
public sealed record IntentModulation
{
    /// <summary>The steering direction.</summary>
    public required TargetFollowDirection Direction { get; init; }

    /// <summary>Whether a controller target is set. When false, follow the curve (see <see cref="FollowCurve"/>).</summary>
    public required bool HasTarget { get; init; }

    /// <summary>Signed distance target − actual (0 when no target). Positive means "raise", negative "lower".</summary>
    public int Gap { get; init; }

    /// <summary>A cap-bounded suggestion for how many posts to generate this tick to move toward the target (0 to hold/lower).</summary>
    public int SuggestedPostCount { get; init; }

    /// <summary>True when no target is set — the storyline should follow its escalation curve.</summary>
    public bool FollowCurve => !HasTarget;

    /// <summary>The no-target modulation: follow the curve, generate nothing extra.</summary>
    public static IntentModulation NoTarget { get; } = new()
    {
        Direction = TargetFollowDirection.Hold,
        HasTarget = false,
    };
}
