namespace Pulse.Core.Features.ReactionLoop.Models;

/// <summary>
/// Where an addressing observation came from (E8 architecture §7). An official on-platform post and an
/// off-platform marker (CTL-026 / #29) satisfy a storyline's expectation identically — the source is
/// recorded for telemetry, not for different handling.
/// </summary>
public enum AddressingSource
{
    /// <summary>An official/agency post observed in the E2 feed.</summary>
    OfficialPost,

    /// <summary>A controller off-platform response marker (CTL-026 / #29).</summary>
    OffPlatformMarker,
}

/// <summary>
/// A raw observation that <i>might</i> address a storyline, handed to the observe stage from E2 activity or
/// the off-platform marker. It is only a <b>candidate</b>: the actual match (does this address #WaterIssues?)
/// is decided by response-reaction (§7), not here — observe never treats an unmatched post as silence
/// (ADP-002a). The <see cref="StorylineHintId"/> is an optional controller/loop hint, not a confirmed match.
/// </summary>
/// <param name="Source">On-platform official post or off-platform marker.</param>
/// <param name="Reference">Opaque ref to the post/marker (for matching + telemetry lineage).</param>
/// <param name="Text">The official content text, for the matcher (response-reaction). Empty for a bare marker.</param>
/// <param name="StorylineHintId">Optional hint at the storyline this addresses; null when unknown.</param>
public sealed record AddressingObservation(
    AddressingSource Source,
    string Reference,
    string Text = "",
    Guid? StorylineHintId = null);

/// <summary>
/// The "fail to do" half of the loop (ADP-001): a storyline whose silence window has elapsed in scenario
/// time without a qualifying official response. Raised by <c>ObserveStage</c> and consumed by
/// silence-escalation to drive escalating anxiety/speculation. Carries how long the silence has run so the
/// behavior can scale the escalation.
/// </summary>
/// <param name="StorylineId">The silent storyline.</param>
/// <param name="MinutesSilent">Scenario minutes since the last qualifying official response.</param>
/// <param name="ScenarioMinute">Scenario minute the trigger was observed (COR-050/051).</param>
public sealed record InactionTrigger(Guid StorylineId, int MinutesSilent, int ScenarioMinute);

/// <summary>
/// A candidate storyline-addressing event surfaced to the decide stage (an official response / off-platform
/// marker). Matching happens in response-reaction; observe only surfaces it. Carries through the source,
/// reference, text, and any hint from the originating <see cref="AddressingObservation"/>.
/// </summary>
public sealed record AddressingCandidate(
    AddressingSource Source,
    string Reference,
    string Text,
    Guid? StorylineHintId,
    int ScenarioMinute);

/// <summary>
/// The observe stage's output for one tick (§1.2): the inaction triggers (silence signals) and the
/// addressing candidates gathered at <see cref="ScenarioMinute"/>. Dial targets are read from storyline
/// state directly by the decide stage. Staff/backend, exercise-scoped (COR-001 / XC-002).
/// </summary>
public sealed record ObservedSignals(
    int ScenarioMinute,
    IReadOnlyList<InactionTrigger> InactionTriggers,
    IReadOnlyList<AddressingCandidate> AddressingCandidates);
