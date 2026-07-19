namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The dial-target follow loop (CTL-022 / #25, story 05). The escalation dial was amended (D5-014/2.2) to
/// show actual fill + a controller-set target tick; the controller sets a target and <b>the engine drives
/// actual toward it</b>. This service is the engine half: it reads <see cref="Storyline.TargetIntensity"/>
/// and tells the decide stage which way to steer generation (raise = more/hotter, lower = taper, hold =
/// steady). With no target set it says "follow the curve". The engine follows the controller and never
/// overrides the target; the intensity bound itself is enforced in
/// <see cref="IntensityModel.TickTowardTarget"/>.
/// </summary>
public static class TargetFollow
{
    /// <summary>Within this many points of the target the loop holds rather than chasing (avoids oscillation/overshoot).</summary>
    public const int Deadband = 3;

    /// <summary>Approximate intensity points one generated post contributes — sizes the suggested burst.</summary>
    public const int PointsPerPost = 2;

    /// <summary>
    /// Computes the decide-stage modulation for a storyline. When a rate cap is supplied, the suggested
    /// post count is bounded by <see cref="RateGovernanceConfig.MaxEnginePostsPerMinute"/> (ADP-011) so the
    /// follow loop can never request a burst that breaches the cap.
    /// </summary>
    public static IntentModulation Modulate(Storyline storyline, RateGovernanceConfig? rateCap = null)
    {
        ArgumentNullException.ThrowIfNull(storyline);

        if (storyline.TargetIntensity is not int target)
        {
            return IntentModulation.NoTarget;
        }

        var gap = target - storyline.Intensity;

        if (Math.Abs(gap) <= Deadband)
        {
            return new IntentModulation { Direction = TargetFollowDirection.Hold, HasTarget = true, Gap = gap };
        }

        if (gap < 0)
        {
            // Below target requested: taper — the engine stops adding heat and lets decay bring it down.
            return new IntentModulation { Direction = TargetFollowDirection.Lower, HasTarget = true, Gap = gap };
        }

        var posts = (int)Math.Ceiling(gap / (double)PointsPerPost);
        if (rateCap is not null)
        {
            posts = Math.Min(posts, rateCap.MaxEnginePostsPerMinute);
        }

        return new IntentModulation
        {
            Direction = TargetFollowDirection.Raise,
            HasTarget = true,
            Gap = gap,
            SuggestedPostCount = Math.Max(1, posts),
        };
    }
}
