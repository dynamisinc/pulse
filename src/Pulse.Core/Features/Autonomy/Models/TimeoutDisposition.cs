namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The outcome of evaluating a Delayed-auto draft's scenario-time countdown (E8 architecture §8.2). This
/// is the load-bearing safety decision: <b>silence is never approval</b>, so an expired countdown with no
/// controller decision resolves to <see cref="Hold"/>, never <see cref="Publish"/> — except behind the
/// explicit, lead-controller-gated swamped mode (#36), which is the <i>only</i> auto-send-on-timeout path.
/// </summary>
public enum TimeoutDisposition
{
    /// <summary>The countdown is still running (or is not a Delayed-auto draft): keep waiting for a decision.</summary>
    AwaitDecision,

    /// <summary>
    /// Hold the draft for the controller ("timer expired — held for you"; surfaces in NEEDS YOU). The
    /// default terminal action on expiry — silence is never approval (D5-014/1.1). Also the outcome of a
    /// controller veto, and of any expiry while the effective level is not Delayed-auto (e.g. a kill switch
    /// or degraded mode suspended the countdown).
    /// </summary>
    Hold,

    /// <summary>
    /// Publish the draft. Reached only by an explicit controller approval, or on expiry <i>only</i> when
    /// swamped mode is enabled for a Delayed-auto draft — never from silence alone (§8.2).
    /// </summary>
    Publish,
}
