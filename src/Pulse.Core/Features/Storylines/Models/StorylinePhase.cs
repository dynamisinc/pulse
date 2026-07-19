namespace Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The lifecycle phase of a storyline (E8 architecture §6.1). A storyline is a tracked public concern
/// that moves through these phases as officials stay silent or respond. Canonical order:
/// <c>Dormant → Seeded → Escalating → Peak → Addressed → Decaying → Resolved</c>, with a re-open back to
/// <see cref="Escalating"/> on a new unaddressed trigger. Staff-only (XC-002); no participant surface
/// exposes it.
/// </summary>
public enum StorylinePhase
{
    /// <summary>Created but not yet active — the concern exists but the world isn't reacting to it yet.</summary>
    Dormant,

    /// <summary>Planted (planner pre-seed or controller ad hoc) and armed; the silence window is running.</summary>
    Seeded,

    /// <summary>Officials are silent past the window (or activity opened it); intensity is rising per the curve.</summary>
    Escalating,

    /// <summary>Intensity has topped out (ceiling / blown window) and the concern is at maximum public pressure.</summary>
    Peak,

    /// <summary>A qualifying official response was matched (ADP-002); pressure begins to come off.</summary>
    Addressed,

    /// <summary>Intensity is decaying per the curve toward the floor.</summary>
    Decaying,

    /// <summary>Intensity has reached the floor; the concern has burned out (re-openable by a new trigger).</summary>
    Resolved,
}

/// <summary>
/// A discrete event that drives a storyline phase transition (E8 architecture §6.1). Triggers are the
/// *inputs* to the state machine; the resulting <see cref="StorylineCause"/> is what telemetry records.
/// </summary>
public enum StorylineTrigger
{
    /// <summary>Plant the storyline: <see cref="StorylinePhase.Dormant"/> → <see cref="StorylinePhase.Seeded"/>.</summary>
    Seed,

    /// <summary>The silence window elapsed with no qualifying response: Seeded → Escalating.</summary>
    WindowOpened,

    /// <summary>Participant/world activity on the concern opened it early: Seeded → Escalating.</summary>
    ActivityDetected,

    /// <summary>The concern stayed unaddressed and intensity topped out: Escalating → Peak.</summary>
    LeftUnaddressed,

    /// <summary>A qualifying official response was matched (ADP-002): Seeded/Escalating/Peak → Addressed.</summary>
    OfficialResponseMatched,

    /// <summary>Decay has begun after being addressed: Addressed → Decaying.</summary>
    DecayBegan,

    /// <summary>Intensity reached the floor: Decaying → Resolved.</summary>
    ReachedFloor,

    /// <summary>A new unaddressed trigger re-opened the concern: Decaying/Resolved → Escalating.</summary>
    NewUnaddressedTrigger,
}

/// <summary>
/// Why a storyline changed state — the cause recorded on the <c>storyline.state_changed</c> telemetry
/// event (E8 architecture §11). Distinct from <see cref="StorylineTrigger"/> so telemetry can tell
/// "matched an on-platform response" from "an off-platform marker satisfied it" even though both drive
/// the same transition.
/// </summary>
public enum StorylineCause
{
    /// <summary>The storyline was planted.</summary>
    Seed,

    /// <summary>The scenario-time silence window elapsed.</summary>
    WindowOpened,

    /// <summary>Participant/world activity opened the concern.</summary>
    Activity,

    /// <summary>The concern stayed unaddressed and escalated to peak.</summary>
    Unaddressed,

    /// <summary>An on-platform official response was matched (ADP-002).</summary>
    MatchedResponse,

    /// <summary>An off-platform response marker satisfied the expectation identically (CTL-026).</summary>
    OffPlatformMarker,

    /// <summary>The controller's dial target drove the transition (CTL-022).</summary>
    DialTarget,

    /// <summary>Natural decay per the escalation curve.</summary>
    CurveDecay,

    /// <summary>A new unaddressed trigger re-opened a decaying/resolved concern.</summary>
    ReOpened,
}
