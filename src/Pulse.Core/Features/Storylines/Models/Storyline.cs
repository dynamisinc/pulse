namespace Pulse.Core.Features.Storylines.Models;

using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// The engine's unit of narrative (E8 architecture §1.1): a tracked public concern with mutable state
/// that the reaction loop advances in scenario time. Storylines are created by planners (pre-seeded) or
/// controllers (ad hoc) — automatic detection from participant activity is deferred post-v1. Every
/// storyline is scoped to one exercise (COR-001) and is staff-only (XC-002); no participant surface
/// exposes it.
///
/// <para>This story (01) owns the object and its <see cref="StorylinePhase"/> lifecycle. Intensity and
/// sentiment <i>computation</i> (story 02), curve <i>definitions</i> (story 03), rate caps (story 04) and
/// the dial-target follow loop (story 05) layer on top: they read this state and call the controlled
/// mutators here.</para>
/// </summary>
public sealed class Storyline
{
    // Hard canonical bounds (§1.1). Per-curve floor/ceiling (story 03) further constrain within these.
    internal const int MinIntensity = 0;
    internal const int MaxIntensity = 100;
    internal const double MinSentiment = -1.0;
    internal const double MaxSentiment = 1.0;

    private Storyline()
    {
    }

    /// <summary>Stable identity. Generated when omitted; accept one for deterministic tests/replay.</summary>
    public Guid Id { get; init; }

    /// <summary>The exercise this storyline belongs to. All storyline state is exercise-scoped (COR-001).</summary>
    public Guid ExerciseId { get; init; }

    /// <summary>Short human title, e.g. "Water main contamination fears".</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>
    /// What official action would address this concern — the silence test (ADP-001). When a matched
    /// response satisfies it (§7), the storyline moves to <see cref="StorylinePhase.Addressed"/>.
    /// </summary>
    public string Expectation { get; init; } = string.Empty;

    /// <summary>
    /// Phase-4 Cadence binding hook (ADP-006): the inject <c>ExpectedAction</c> this expectation binds to.
    /// <b>Reserved / null in v1 and v1.1</b> — present so the binding needs no schema migration later.
    /// </summary>
    public Guid? ExpectedActionRef { get; init; }

    /// <summary>The escalation-profile name (story 03) that shapes this storyline's trajectory (ADP-010).</summary>
    public string CurveName { get; private set; } = "Standard";

    /// <summary>The silence budget in scenario minutes before escalation opens (COR-050/051).</summary>
    public int ResponseWindowMin { get; init; }

    /// <summary>Handles of the personas eligible to voice this storyline (bad-actors only if scenario-enabled, ADP-022).</summary>
    public IReadOnlyList<string> ParticipatingPersonas { get; init; } = [];

    /// <summary>Tags used for match/amplification (ADP-004).</summary>
    public IReadOnlyList<string> Hashtags { get; init; } = [];

    /// <summary>
    /// Seeded rumor lineage (F8.4 / §10.1). <b>Reserved slot for v1.1</b> (rumor-model). Empty in v1 so
    /// v1.1 rumor lineage needs no migration.
    /// </summary>
    public IReadOnlyList<Guid> RumorRefs { get; init; } = [];

    // ---- Mutable tracked state (§1.1) ------------------------------------------------------------

    /// <summary>Current phase in the lifecycle (§6.1). Starts <see cref="StorylinePhase.Dormant"/>.</summary>
    public StorylinePhase Phase { get; private set; } = StorylinePhase.Dormant;

    /// <summary>
    /// Intensity on the canonical <b>0–100</b> scale (§1.1). The D5 dial reads this as actual-fill; the
    /// planner's coarse "0–10" maps ×10.
    /// </summary>
    public int Intensity { get; private set; }

    /// <summary>Continuous sentiment −1.0…+1.0 (ADP-012), maintained by story 02.</summary>
    public double Sentiment { get; private set; }

    /// <summary>
    /// Controller-set target on the 0–100 scale, or <c>null</c> when unset. When set (via the #25 dial),
    /// the engine drives actual → target (CTL-022, story 05) rather than following the raw curve.
    /// </summary>
    public int? TargetIntensity { get; private set; }

    /// <summary>
    /// Scenario minutes since the last qualifying official response (COR-050/051). Drives silence
    /// escalation; reset to 0 when a response is matched.
    /// </summary>
    public int MinutesSinceLastOfficialResponse { get; private set; }

    /// <summary>The scenario minute the storyline entered its current phase (for time-in-state displays).</summary>
    public int PhaseEnteredScenarioMinute { get; private set; }

    /// <summary>The scenario minute of the last tick, so elapsed scenario time is measured, not wall-clock.</summary>
    public int LastTickScenarioMinute { get; private set; }

    /// <summary>
    /// Creates a storyline in <see cref="StorylinePhase.Dormant"/> with all §1.1 fields populated and the
    /// reserved <see cref="ExpectedActionRef"/> / <see cref="RumorRefs"/> slots present. Call
    /// <see cref="Seed"/> to arm it.
    /// </summary>
    public static Storyline Create(
        Guid exerciseId,
        string title,
        string expectation,
        string curveName = "Standard",
        int responseWindowMin = 20,
        int initialIntensity = 0,
        double initialSentiment = 0.0,
        IReadOnlyList<string>? participatingPersonas = null,
        IReadOnlyList<string>? hashtags = null,
        Guid? expectedActionRef = null,
        IReadOnlyList<Guid>? rumorRefs = null,
        Guid? id = null)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A storyline must belong to an exercise (COR-001).", nameof(exerciseId));
        }

        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("A storyline needs a title.", nameof(title));
        }

        if (string.IsNullOrWhiteSpace(expectation))
        {
            throw new ArgumentException("A storyline needs an expectation — the silence test (ADP-001).", nameof(expectation));
        }

        if (string.IsNullOrWhiteSpace(curveName))
        {
            throw new ArgumentException("A storyline needs an escalation curve name (ADP-010).", nameof(curveName));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(responseWindowMin);
        ArgumentOutOfRangeException.ThrowIfLessThan(initialIntensity, MinIntensity);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(initialIntensity, MaxIntensity);
        ArgumentOutOfRangeException.ThrowIfLessThan(initialSentiment, MinSentiment);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(initialSentiment, MaxSentiment);

        return new Storyline
        {
            Id = id ?? Guid.NewGuid(),
            ExerciseId = exerciseId,
            Title = title.Trim(),
            Expectation = expectation.Trim(),
            CurveName = curveName.Trim(),
            ResponseWindowMin = responseWindowMin,
            Intensity = initialIntensity,
            Sentiment = initialSentiment,
            ParticipatingPersonas = participatingPersonas is null ? [] : [.. participatingPersonas],
            Hashtags = hashtags is null ? [] : [.. hashtags],
            ExpectedActionRef = expectedActionRef,
            RumorRefs = rumorRefs is null ? [] : [.. rumorRefs],
        };
    }

    /// <summary>
    /// Drives the storyline through the state machine (§6.1). Validates the transition against
    /// <see cref="StorylineStateMachine"/>, updates <see cref="Phase"/>, and returns the
    /// <see cref="StorylineStateChanged"/> event (which telemetry maps to <c>storyline.state_changed</c>).
    /// Throws <see cref="InvalidStorylineTransitionException"/> for an illegal transition — a storyline can
    /// never skip escalation or resurrect from Resolved without an explicit re-open.
    /// </summary>
    /// <param name="trigger">The event driving the transition.</param>
    /// <param name="scenarioMinute">Scenario minutes since exercise start (COR-050/051), non-negative.</param>
    /// <param name="cause">Optional cause override (e.g. off-platform marker, dial target); defaults from the trigger.</param>
    public StorylineStateChanged Transition(StorylineTrigger trigger, int scenarioMinute, StorylineCause? cause = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);

        var to = StorylineStateMachine.Target(Phase, trigger)
            ?? throw InvalidStorylineTransitionException.For(Phase, trigger);

        var from = Phase;
        Phase = to;
        PhaseEnteredScenarioMinute = scenarioMinute;

        return new StorylineStateChanged(Id, from, to, cause ?? StorylineStateMachine.DefaultCause(trigger), scenarioMinute);
    }

    /// <summary>Arms the storyline: <see cref="StorylinePhase.Dormant"/> → <see cref="StorylinePhase.Seeded"/>.</summary>
    public StorylineStateChanged Seed(int scenarioMinute) => Transition(StorylineTrigger.Seed, scenarioMinute);

    /// <summary>
    /// Reassigns the escalation curve live (ADP-010, story 03) and returns the steering action to log
    /// (XC-004). Takes effect on the next tick — the curve is the natural trajectory the intensity update
    /// (story 02) reads. No-ops silently only if the name is unchanged.
    /// </summary>
    public SteeringActionLogged AssignCurve(string curveName, int scenarioMinute)
    {
        if (string.IsNullOrWhiteSpace(curveName))
        {
            throw new ArgumentException("A storyline needs an escalation curve name (ADP-010).", nameof(curveName));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);

        var from = CurveName;
        CurveName = curveName.Trim();
        return new SteeringActionLogged(Id, SteeringActionKind.CurveChanged, $"{from} → {CurveName}", scenarioMinute);
    }

    /// <summary>Scenario minutes the storyline has spent in its current phase, given the current scenario minute.</summary>
    public int MinutesInPhase(int currentScenarioMinute) => Math.Max(0, currentScenarioMinute - PhaseEnteredScenarioMinute);
}
