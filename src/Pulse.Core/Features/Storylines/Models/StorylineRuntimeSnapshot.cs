namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// An immutable copy of a <see cref="Storyline"/>'s MUTABLE runtime state (engine-runtime story 07, inventory row 9):
/// the arc the reaction loop has advanced in scenario time, so a restart resumes the storyline where it was instead of
/// replaying a fresh arc from <see cref="StorylinePhase.Dormant"/> at minute 0 mid-exercise.
/// </summary>
/// <remarks>
/// <para>
/// <b>Runtime state only.</b> The storyline's definition (title, expectation, response window, cast, hashtags) is not
/// in the snapshot: it is re-derived at startup from the seed inputs (story 07, "What is persisted vs re-derived"), a
/// <see cref="Storyline.Create"/> with the persisted id, and this snapshot is then applied through
/// <see cref="Storyline.Restore"/>. Produced by <see cref="Storyline.ToSnapshot"/>; the two round-trip to an equal
/// record (value equality — every member is a scalar).
/// </para>
/// <para>
/// Not an egress control (no autonomy, no provider), so it is restored exactly; ranges are validated on restore so a
/// corrupt row fails loudly rather than ticking a nonsense arc (Q7 fail-closed in the rehydrator). Staff-only (XC-002);
/// exercise-scoped (COR-001). Scenario minutes only (COR-050/053) — no wall-clock field.
/// </para>
/// </remarks>
/// <param name="ExerciseId">The exercise the storyline belongs to (COR-001); must match the target storyline.</param>
/// <param name="StorylineId">The storyline's stable id; must match the target storyline.</param>
/// <param name="Phase">The lifecycle phase (§6.1).</param>
/// <param name="Intensity">Intensity on the canonical 0–100 scale.</param>
/// <param name="Sentiment">Sentiment in −1.0…+1.0.</param>
/// <param name="TargetIntensity">The controller's dial target (0–100), or <c>null</c> when unset.</param>
/// <param name="MinutesSinceLastOfficialResponse">Scenario minutes of accrued silence (non-negative).</param>
/// <param name="PhaseEnteredScenarioMinute">The scenario minute the current phase began (non-negative).</param>
/// <param name="LastTickScenarioMinute">The scenario minute of the last tick (may be negative before StartEx).</param>
/// <param name="LastEngineReactionScenarioMinute">The scenario minute of the last engine reaction, or <c>null</c> for never.</param>
/// <param name="CurveName">The escalation-profile name (ADP-010).</param>
public sealed record StorylineRuntimeSnapshot(
    Guid ExerciseId,
    Guid StorylineId,
    StorylinePhase Phase,
    int Intensity,
    double Sentiment,
    int? TargetIntensity,
    int MinutesSinceLastOfficialResponse,
    int PhaseEnteredScenarioMinute,
    int LastTickScenarioMinute,
    int? LastEngineReactionScenarioMinute,
    string CurveName);
