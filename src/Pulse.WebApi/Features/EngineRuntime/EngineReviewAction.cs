namespace Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The controller/auto review action captured on an <c>engine.reviewed</c> XC-004 event (E8 architecture
/// §11, ADP-041). Serialized to the kebab wire literals by <see cref="EngineReviewActionJsonConverter"/>.
/// <see cref="HoldOnExpiry"/> is the load-bearing safety outcome (silence is never approval, D5-014/1.1);
/// <see cref="AutoSend"/> is only reachable behind the lead-gated swamped mode.
/// </summary>
public enum EngineReviewAction
{
    /// <summary>The controller approved the draft as-is.</summary>
    Approve,

    /// <summary>The controller edited the draft (re-sanitized, NFR-004) then approved it.</summary>
    Edit,

    /// <summary>The controller vetoed the draft; it never publishes.</summary>
    Veto,

    /// <summary>The controller requested a fresh re-generated draft.</summary>
    ReRoll,

    /// <summary>A Delayed-auto countdown expired with no decision → auto-HELD for the controller (never auto-sent).</summary>
    HoldOnExpiry,

    /// <summary>A Delayed-auto draft auto-sent on expiry — only behind the lead-gated swamped mode.</summary>
    AutoSend,
}
