namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// Domain events the autonomy-safety layer emits as autonomy state changes. Like the storyline model,
/// this feature is <b>pure domain logic</b>: it <i>produces</i> these events and returns them from its
/// operations; it does not depend on a telemetry sink. <c>engine-telemetry-tuning</c> maps them onto the
/// XC-004 taxonomy (autonomy changes, <c>engine.reviewed</c> hold-on-expiry/auto-send transitions, the
/// kill-switch trip) and stamps wall-clock time. Every event carries scenario time (COR-050/051) and is
/// <b>staff-only</b> (XC-002) — no autonomy state is ever participant-visible.
/// </summary>
public interface IAutonomyEvent
{
    /// <summary>The exercise the event is about. All autonomy state is exercise-scoped (COR-001).</summary>
    Guid ExerciseId { get; }

    /// <summary>Scenario minutes since exercise start when the event occurred (COR-050/051).</summary>
    int ScenarioMinute { get; }
}

/// <summary>
/// What caused an autonomy level to change — so a hotwash can attribute a shift to a controller decision
/// versus an automatic safety action (EVL-014, no sentiment circularity). The distinction also encodes
/// the §8.2 invariant: only <see cref="Human"/> may <i>raise</i> a level; every other cause only lowers.
/// </summary>
public enum AutonomyChangeCause
{
    /// <summary>A controller set the level (the only cause permitted to raise autonomy).</summary>
    Human,

    /// <summary>The manual kill switch dropped the engine (§8.4).</summary>
    KillSwitch,

    /// <summary>The automatic degraded-mode fallback dropped the engine on a provider circuit trip (§3.5).</summary>
    DegradedMode,
}

/// <summary>The scope an autonomy level applies at — the whole exercise, or one storyline's override.</summary>
public enum AutonomyScope
{
    /// <summary>The per-exercise default (applies to every storyline without its own override).</summary>
    Exercise,

    /// <summary>A per-storyline override (wins over the exercise default for that storyline).</summary>
    Storyline,
}

/// <summary>
/// An autonomy level change (maps to an XC-004 autonomy-change log entry). Carries from→to, the scope, the
/// actor, and the cause. A human change names the controller; an automatic safety change names the
/// mechanism (e.g. <c>"degraded-mode:provider"</c>). Raising is only ever legal when
/// <see cref="Cause"/> is <see cref="AutonomyChangeCause.Human"/> (§8.2).
/// </summary>
public sealed record AutonomyLevelChanged(
    Guid ExerciseId,
    AutonomyScope Scope,
    Guid? StorylineId,
    AutonomyLevel From,
    AutonomyLevel To,
    AutonomyChangeCause Cause,
    string Actor,
    int ScenarioMinute) : IAutonomyEvent;

/// <summary>What the kill switch drops the engine to (§8.4).</summary>
public enum KillSwitchMode
{
    /// <summary>Drop the whole engine to Suggest — nothing auto-publishes, but generation continues for review.</summary>
    DropToSuggest,

    /// <summary>Full stop — no generation at all until a controller explicitly resumes.</summary>
    FullStop,
}

/// <summary>
/// The kill switch fired (ADP-042, maps to an XC-004 engine-control log entry): one control dropped the
/// entire engine to Suggest or full stop instantly. The manual sibling of the automatic degraded-mode
/// fallback; both move autonomy only <i>down</i> and neither auto-recovers it. Staff-only (XC-002).
/// </summary>
public sealed record EngineKillSwitchFired(
    Guid ExerciseId,
    KillSwitchMode Mode,
    string Actor,
    int ScenarioMinute) : IAutonomyEvent;

/// <summary>
/// The lead-controller-gated "swamped mode" toggle changed (engine-review-cockpit #36). Swamped mode is
/// the <b>only</b> path by which a timed draft auto-sends on expiry (D5-014/1.1); enabling it is an
/// explicit human action and the engine <b>never</b> turns it on by itself (§8.2). Staff-only (XC-002).
/// </summary>
public sealed record SwampedModeChanged(
    Guid ExerciseId,
    bool Enabled,
    string Actor,
    int ScenarioMinute) : IAutonomyEvent;

/// <summary>
/// A Delayed-auto draft's scenario-time countdown reached a terminal outcome (maps to
/// <c>engine.reviewed</c> with action <c>hold-on-expiry</c> or <c>auto-send</c>, §11). Silence resolves to
/// <see cref="TimeoutDisposition.Hold"/> unless swamped mode auto-sent it — the transition is logged with
/// trigger + storyline + scenario time and, when held, feeds the NEEDS-YOU to-dos. Staff-only (XC-002).
/// </summary>
public sealed record DraftTimeoutResolved(
    Guid ExerciseId,
    Guid StorylineId,
    Guid DraftId,
    TimeoutDisposition Disposition,
    bool ViaSwampedMode,
    int ScenarioMinute) : IAutonomyEvent;
