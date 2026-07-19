namespace Pulse.Core.Features.Autonomy.Services;

/// <summary>
/// Quantifies the four demand-reduction mechanisms that make the CTL-034 workload contract hold (E8
/// architecture §8.5) — burst-level review, storyline-level autonomy, pre-filtering, and match suggestion.
/// Pure functions: they express how many controller decisions a burst <i>demands</i> under the reducing
/// design versus a naïve per-post design, so "each mechanism measurably lowers demanded decisions" is a
/// checkable property, not an aspiration. The counts here are what <see cref="WorkloadDemandMeter"/> would
/// record; keeping the arithmetic separate makes the contract testable without the reaction loop.
/// </summary>
public static class DemandAccounting
{
    /// <summary>
    /// Naïve baseline: review demanded <b>per post</b> (one decision each). This is the design the engine
    /// must beat; it scales with burst size and blows the budget under NFR-002 load.
    /// </summary>
    public static int PerPostReviewDemand(int postCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(postCount);
        return postCount;
    }

    /// <summary>
    /// <b>Burst-level review</b> (ADP-040 batch approve): a whole burst is one review decision regardless of
    /// how many posts it contains — so an N-post burst costs 1, not N. An empty burst costs nothing.
    /// </summary>
    public static int BurstReviewDemand(int postCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(postCount);
        return postCount > 0 ? 1 : 0;
    }

    /// <summary>
    /// <b>Pre-filtering</b> (§8.5, §9): a burst that fails the fiction/injection guard is auto-re-rolled or
    /// dropped and <b>never reaches the queue</b>, so it demands zero controller decisions — the human never
    /// spends a decision rejecting an obvious fiction-break. A guard-passing burst costs its burst-level review.
    /// </summary>
    public static int ReviewDemand(bool guardPassed, int postCount) =>
        guardPassed ? BurstReviewDemand(postCount) : 0;

    /// <summary>
    /// <b>Storyline-level autonomy</b>: the autonomy level is set once per storyline (a rare human action),
    /// not per burst or per post — so routing a burst by its storyline's level demands <b>no</b> additional
    /// decision. Contrast <see cref="PerBurstAutonomyDemand"/>, the rejected design where each burst would
    /// prompt for how to ship it.
    /// </summary>
    public static int StorylineLevelAutonomyDemand => 0;

    /// <summary>The rejected baseline: a per-burst autonomy prompt (one decision per burst).</summary>
    public static int PerBurstAutonomyDemand => 1;

    /// <summary>
    /// <b>Match suggestion</b> (ADP-002a, §7.2): the engine proposes the storyline match; the controller
    /// confirms with one key (1 decision). Once the trust curve earns opt-in auto-confirm, the prompt is
    /// retired entirely (0). Either way it beats manual matching, where the controller must find and link
    /// the storyline themselves (<see cref="ManualMatchDemand"/>).
    /// </summary>
    public static int MatchPromptDemand(bool autoConfirmEarned) => autoConfirmEarned ? 0 : 1;

    /// <summary>The rejected baseline: the controller manually finds and links the matching storyline (2 decisions: locate + confirm).</summary>
    public static int ManualMatchDemand => 2;

    /// <summary>
    /// The total decisions a guard-passing burst demands under the reducing design: burst-level review +
    /// storyline-level autonomy (0) + one match confirmation if this burst is a response-match
    /// (auto-confirm retires even that). Use against <see cref="NaiveBurstDemand"/> to see the reduction.
    /// </summary>
    public static int ReducedBurstDemand(int postCount, bool isResponseMatch, bool autoConfirmEarned)
    {
        var demand = ReviewDemand(guardPassed: true, postCount) + StorylineLevelAutonomyDemand;
        if (isResponseMatch)
        {
            demand += MatchPromptDemand(autoConfirmEarned);
        }

        return demand;
    }

    /// <summary>
    /// The naïve design's total for the same burst: per-post review + a per-burst autonomy prompt + manual
    /// matching when it's a response-match. The gap between this and <see cref="ReducedBurstDemand"/> is the
    /// CTL-034 headroom the engine's design buys.
    /// </summary>
    public static int NaiveBurstDemand(int postCount, bool isResponseMatch)
    {
        var demand = PerPostReviewDemand(postCount) + PerBurstAutonomyDemand;
        if (isResponseMatch)
        {
            demand += ManualMatchDemand;
        }

        return demand;
    }
}
