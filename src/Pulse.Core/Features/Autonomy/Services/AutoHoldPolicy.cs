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
/// a HOLD, not a missed auto-send. A full stop is no exception: a countdown whose deadline passes while the engine
/// is stopped resolves to the ordinary hold-on-expiry (held, not left counting down to auto-send after a restore);
/// a countdown still inside its window while stopped keeps counting.</para>
///
/// <para><b>Hold-on-cut.</b> An active generation-provider cut to Fake (the ADP-042 manual egress brake) is
/// treated as one more safety clamp on the auto paths: while the exercise is cut, an expired countdown with no
/// controller decision HOLDs even under swamped mode, so a live draft generated before the cut can never
/// auto-send after it. Like DropToSuggest, the cut suspends only the AUTO path — an explicit controller
/// approval is a manual publish and still publishes. A countdown already resolved to HOLD while cut stays held
/// after a restore (it is no longer counting down); only still-running countdowns resume the ordinary rules.</para>
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
    ///   <item>No decision + expired → <see cref="TimeoutDisposition.Hold"/>, unless swamped mode is on, the
    ///   effective level is still Delayed-auto, AND the exercise is not cut to Fake — the sole auto-send path.</item>
    /// </list>
    /// </summary>
    /// <param name="countdown">The draft's countdown snapshot.</param>
    /// <param name="effective">The draft's safety-adjusted effective autonomy.</param>
    /// <param name="currentScenarioMinute">The current scenario minute (COR-050/051).</param>
    /// <param name="swampedMode">Whether the lead-gated swamped mode (#36) is on for the exercise.</param>
    /// <param name="providerCutToFake">
    /// Whether the exercise's generation is currently cut to the Fake provider (ADP-042). A cut is a safety
    /// clamp on the auto paths: it suspends the swamped-mode auto-send (expiry → HOLD) but never overrides an
    /// explicit controller approval. Defaults to false (no cut).
    /// </param>
    /// <returns>The disposition for the countdown.</returns>
    public static TimeoutDisposition Decide(
        DelayedAutoCountdown countdown,
        EffectiveAutonomy effective,
        int currentScenarioMinute,
        bool swampedMode,
        bool providerCutToFake = false)
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
        // and the draft is still effectively Delayed-auto (a safety clamp having lowered it suspends this) and
        // the exercise is not cut to Fake (hold-on-cut: a pre-cut live draft must never auto-send after the cut).
        var autoSend = swampedMode && !providerCutToFake && effective.Level == AutonomyLevel.DelayedAuto;
        return autoSend ? TimeoutDisposition.Publish : TimeoutDisposition.Hold;
    }

    /// <summary>
    /// Evaluates the countdown and, when it has reached a terminal outcome <i>on expiry with no controller
    /// decision</i> (the auto-HOLD, or the swamped-mode auto-send), also returns the
    /// <see cref="DraftTimeoutResolved"/> event to log (XC-004 <c>engine.reviewed</c> hold-on-expiry /
    /// auto-send). While the countdown is still running, or when the outcome is a human approve/veto (logged
    /// on the review-action path, not here), the event is null. The disposition is always returned. An expiry
    /// held because the exercise is cut to Fake is the ordinary hold-on-expiry transition (not via swamped mode).
    /// while the engine is fully stopped (kill switch FullStop) is the ordinary hold-on-expiry transition.
    /// </summary>
    /// <param name="countdown">The draft's countdown snapshot.</param>
    /// <param name="effective">The draft's safety-adjusted effective autonomy.</param>
    /// <param name="currentScenarioMinute">The current scenario minute (COR-050/051).</param>
    /// <param name="swampedMode">Whether the lead-gated swamped mode (#36) is on for the exercise.</param>
    /// <param name="providerCutToFake">
    /// Whether the exercise's generation is currently cut to the Fake provider (ADP-042); see
    /// <see cref="Decide"/>. Defaults to false (no cut).
    /// </param>
    /// <returns>The disposition, the swamped-mode flag, and the transition event (if any).</returns>
    public static TimeoutEvaluation Evaluate(
        DelayedAutoCountdown countdown,
        EffectiveAutonomy effective,
        int currentScenarioMinute,
        bool swampedMode,
        bool providerCutToFake = false)
    {
        var disposition = Decide(countdown, effective, currentScenarioMinute, swampedMode, providerCutToFake);

        // Only an on-expiry, no-decision resolution is an autonomy-layer transition to log here. A full stop is no
        // exception: a countdown that expires while the engine is stopped resolves to the ordinary hold-on-expiry
        // (Decide already returns Hold), so it is never left counting down to auto-send after a restore.
        var isTimeoutTransition = countdown.Decision == ControllerDecision.None
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
