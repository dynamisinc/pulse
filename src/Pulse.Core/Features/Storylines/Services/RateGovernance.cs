namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Pure evaluation of the per-exercise rate caps and quiet floors (ADP-011, §6.2). Stateless: the caller
/// (the reaction loop) owns the per-minute counting window and passes in how many engine posts have
/// already landed this minute. This keeps the cap/floor arithmetic trivially testable and identical
/// wherever it's applied — the loop's publish stage enforces the cap; ambient-chatter subscribes to the
/// floor.
/// </summary>
public static class RateGovernance
{
    /// <summary>
    /// How many of <paramref name="requestedCount"/> posts may publish this minute without breaching
    /// <see cref="RateGovernanceConfig.MaxEnginePostsPerMinute"/>, given
    /// <paramref name="postsThisMinute"/> already emitted. The overflow is reported as
    /// <see cref="CapDecision.Throttled"/> for the loop to queue.
    /// </summary>
    public static CapDecision WithinCap(RateGovernanceConfig config, int postsThisMinute, int requestedCount)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentOutOfRangeException.ThrowIfNegative(postsThisMinute);
        ArgumentOutOfRangeException.ThrowIfNegative(requestedCount);

        var remaining = Math.Max(0, config.MaxEnginePostsPerMinute - postsThisMinute);
        var allowed = Math.Min(requestedCount, remaining);
        return new CapDecision(requestedCount, allowed);
    }

    /// <summary>
    /// Whether engine+world activity this minute is below the believable floor
    /// (<see cref="RateGovernanceConfig.MinBelievableActivity"/>), i.e. the world is going too quiet and
    /// ambient chatter should fill it.
    /// </summary>
    public static bool BelowFloor(RateGovernanceConfig config, int postsThisMinute)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentOutOfRangeException.ThrowIfNegative(postsThisMinute);

        return postsThisMinute < config.MinBelievableActivity;
    }

    /// <summary>
    /// How many posts short of the floor the world is this minute (0 when at/above the floor) — the amount
    /// of ambient chatter needed to reach <see cref="RateGovernanceConfig.MinBelievableActivity"/>.
    /// </summary>
    public static int AmbientDeficit(RateGovernanceConfig config, int postsThisMinute)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentOutOfRangeException.ThrowIfNegative(postsThisMinute);

        return Math.Max(0, config.MinBelievableActivity - postsThisMinute);
    }
}
