namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// An immutable, persistence-shaped copy of one exercise's <see cref="Services.EngineAutonomyState"/> (engine-runtime
/// story 07, "Engine state survives a restart"): everything the autonomy/safety layer holds in process memory, so a
/// write-through store can persist it and the startup rehydrator can hand it back through
/// <see cref="Services.EngineAutonomyState.Restore"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>A snapshot is a description, not an instruction.</b> Producing one (<see cref="Services.EngineAutonomyState.ToSnapshot"/>)
/// records the live state exactly; restoring one applies only the parts that <i>lower</i> or keep the engine's reach
/// (story 07 decision Q1). The raises it carries — a Delayed-auto default or override, swamped mode ON — are withheld
/// and reported back as <see cref="EngineHeldRaises"/> for a later, human, audited restore.
/// </para>
/// <para>
/// <b>How the kill switch is encoded.</b> <see cref="SafetyClamp"/> and <see cref="Stopped"/> together carry the kill
/// switch's mode: a clamp with <see cref="Stopped"/> false is <c>DropToSuggest</c> (or the degraded-mode clamp when
/// <see cref="DegradedReason"/> is set); <see cref="Stopped"/> true is <c>FullStop</c>. Both are the exact private
/// fields of the state, so a snapshot round-trips without interpretation.
/// </para>
/// <para>Staff/backend only (XC-002); exercise-scoped (COR-001) — <see cref="ExerciseId"/> must match the state it is
/// restored onto.</para>
/// </remarks>
/// <param name="ExerciseId">The exercise the state belongs to (COR-001).</param>
/// <param name="ExerciseDefault">The per-exercise default autonomy level (before any override or clamp).</param>
/// <param name="StorylineOverrides">The per-storyline overrides, keyed by storyline id.</param>
/// <param name="SwampedMode">Whether swamped mode (the only timeout auto-send path, #36) was on.</param>
/// <param name="SafetyClamp">The active safety clamp (the kill switch or the degraded-mode clamp), or <c>null</c> for none.</param>
/// <param name="Stopped">Whether the kill switch had fully stopped generation (<c>FullStop</c>, §8.4).</param>
/// <param name="DegradedReason">The provider-degraded reason driving the NFR-003 alert, or <c>null</c> when healthy.</param>
public sealed record EngineAutonomySnapshot(
    Guid ExerciseId,
    AutonomyLevel ExerciseDefault,
    IReadOnlyDictionary<Guid, AutonomyLevel> StorylineOverrides,
    bool SwampedMode,
    AutonomyLevel? SafetyClamp,
    bool Stopped,
    string? DegradedReason);

/// <summary>
/// The raising settings a restart withheld (engine-runtime story 07, decision Q1): the exercise was booted at the
/// floor instead, and these are the values that were in effect before, kept so a controller can re-apply them with
/// one confirmed, logged action (through the same code paths as a manual raise — never automatically).
/// </summary>
/// <remarks>
/// Returned by <see cref="Services.EngineAutonomyState.Restore"/>. Nothing in it has been applied; it exists only to be
/// persisted as "previous" and shown on the controller cockpit banner. Automation never raises its own autonomy
/// (E8 §8.2), so there is deliberately no method here that applies anything.
/// </remarks>
/// <param name="ExerciseDefault">The withheld Delayed-auto exercise default, or <c>null</c> when the default was the floor.</param>
/// <param name="StorylineOverrides">The withheld Delayed-auto storyline overrides, keyed by storyline id (empty when none).</param>
/// <param name="SwampedMode"><c>true</c> when swamped mode was ON and was booted OFF.</param>
public sealed record EngineHeldRaises(
    AutonomyLevel? ExerciseDefault,
    IReadOnlyDictionary<Guid, AutonomyLevel> StorylineOverrides,
    bool SwampedMode)
{
    /// <summary>The empty value: nothing was withheld.</summary>
    public static EngineHeldRaises None { get; } = new(null, new Dictionary<Guid, AutonomyLevel>(), false);

    /// <summary><c>true</c> when the restore withheld nothing (no banner, nothing to restore).</summary>
    public bool IsEmpty => ExerciseDefault is null && StorylineOverrides.Count == 0 && !SwampedMode;
}
