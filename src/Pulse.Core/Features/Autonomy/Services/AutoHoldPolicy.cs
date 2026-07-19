namespace Pulse.Core.Features.Autonomy.Services;

using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The load-bearing auto-HOLD decision (E8 architecture §8.2, ADP-040, D5-014/1.1 which supersedes
/// D5-005). Pure and stateless: it maps a Delayed-auto draft's countdown snapshot + the current
/// safety-adjusted autonomy + the current scenario minute to what should happen — with the safety
/// invariant baked in that <b>silence is never approval</b>. An expired countdown with no controller
/// decision resolves to <see cref="TimeoutDisposition.Hold"/> ("timer expired — held for you", surfaces in
/// NEEDS YOU), <b>never</b> a silent auto-send.
///
/// <para>The <i>only</i> path to auto-send on expiry is the explicit, lead-controller-gated swamped mode
/// (#36) applied to a still-effective Delayed-auto draft. Any safety clamp — kill switch or degraded mode —
/// drops the effective level below Delayed-auto (or stops the engine), which suspends in-flight countdowns:
/// they hold instead of sending, even under swamped mode. Timers are evaluated in scenario time
/// (COR-050/051), so a freeze holds the deadline and a time-jump that carries the deadline past resolves to
/// a HOLD, not a missed auto-send.</para>
/// </summary>
public static class AutoHoldPolicy
{
    /// <summary>
    /// The disposition for a countdown at <paramref name="currentScenarioMinute"/>, given the draft's
    /// safety-adjusted effective autonomy and whether swamped mode is on. Precedence:
    /// <list type="number">
    ///   <item>A fully-stopped engine holds everything (kill switch full stop).</item>
    ///   <item>An explicit controller decision wins: <see cref="ControllerDecision.Approved"/> →
    ///   <see cref="TimeoutDisposition.Publish"/>; <see cref="ControllerDecision.Vetoed"/> →
    ///   <see cref="TimeoutDisposition.Hold"/>.</item>
    ///   <item>No decision + not yet expired → <see cref="TimeoutDisposition.AwaitDecision"/>.</item>
    ///   <item>No decision + expired → <see cref="TimeoutDisposition.Hold"/>, unless swamped mode is on and
    ///   the effective level is still Delayed-auto, which is the sole auto-send path.</item>
    /// </list>
    /// </summary>
    public static TimeoutDisposition Decide(
        DelayedAutoCountdown countdown,
        EffectiveAutonomy effective,
        int currentScenarioMinute,
        bool swampedMode)
    {
        ArgumentNullException.ThrowIfNull(countdown);
        ArgumentOutOfRangeException.ThrowIfNegative(currentScenarioMinute);

        // A full stop (kill switch) suspends everything outstanding — nothing publishes.
        if (effective.GenerationStopped)
        {
            return TimeoutDisposition.Hold;
        }

        // Explicit human decisions are the controller's will and are honoured directly. (DropToSuggest
        // suspends only the AUTO paths; an approval is a manual publish. A full stop, handled above, is the
        // one control that overrides even a standing approval.)
        switch (countdown.Decision)
        {
            case ControllerDecision.Approved:
                return TimeoutDisposition.Publish;
            case ControllerDecision.Vetoed:
                return TimeoutDisposition.Hold;
        }

        if (!countdown.HasExpired(currentScenarioMinute))
        {
            return TimeoutDisposition.AwaitDecision;
        }

        // Expired with no decision. Silence is never approval → HOLD, unless swamped mode is explicitly on
        // and the draft is still effectively Delayed-auto (a safety clamp having lowered it suspends this).
        var autoSend = swampedMode && effective.Level == AutonomyLevel.DelayedAuto;
        return autoSend ? TimeoutDisposition.Publish : TimeoutDisposition.Hold;
    }

    /// <summary>
    /// Evaluates the countdown and, when it has reached a terminal outcome <i>on expiry with no controller
    /// decision</i> (the auto-HOLD, or the swamped-mode auto-send), also returns the
    /// <see cref="DraftTimeoutResolved"/> event to log (XC-004 <c>engine.reviewed</c> hold-on-expiry /
    /// auto-send). While the countdown is still running, or when the outcome is a human approve/veto (logged
    /// on the review-action path, not here), the event is null. The disposition is always returned.
    /// </summary>
    public static TimeoutEvaluation Evaluate(
        DelayedAutoCountdown countdown,
        EffectiveAutonomy effective,
        int currentScenarioMinute,
        bool swampedMode)
    {
        var disposition = Decide(countdown, effective, currentScenarioMinute, swampedMode);

        // Only an on-expiry, no-decision resolution is an autonomy-layer transition to log here.
        var isTimeoutTransition = countdown.Decision == ControllerDecision.None
            && !effective.GenerationStopped
            && countdown.HasExpired(currentScenarioMinute);

        if (!isTimeoutTransition)
        {
            return new TimeoutEvaluation(disposition, false, null);
        }

        var viaSwamped = disposition == TimeoutDisposition.Publish;
        var evt = new DraftTimeoutResolved(
            countdown.ExerciseId, countdown.StorylineId, countdown.DraftId, disposition, viaSwamped, currentScenarioMinute);
        return new TimeoutEvaluation(disposition, viaSwamped, evt);
    }
}

/// <summary>
/// The result of <see cref="AutoHoldPolicy.Evaluate"/>: the disposition, whether an auto-send happened via
/// swamped mode, and the transition event to log (non-null only for an on-expiry, no-decision resolution).
/// </summary>
public readonly record struct TimeoutEvaluation(
    TimeoutDisposition Disposition,
    bool ViaSwampedMode,
    DraftTimeoutResolved? Event);
