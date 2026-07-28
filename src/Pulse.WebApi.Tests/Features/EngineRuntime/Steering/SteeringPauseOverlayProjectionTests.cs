namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ParticipantShell;
using Xunit;

/// <summary>
/// The OVERLAY PRECEDENCE MATRIX (world-steering/08; Tom's ruling 2026-07-27:
/// <c>endex</c> &gt; <c>pre-start</c> &gt; <c>pause</c> &gt; <c>none</c>) asserted directly against
/// <see cref="SteeringPauseOverlayProjection"/> — the pure half, no Docker and no HTTP, so every lifecycle state
/// is cheap to cover. The same cells are proven end to end over real HTTP + real SQL in
/// <see cref="OverlayStateEndpointTests"/> and <see cref="PauseTierEndpointsTests"/>.
/// </summary>
/// <remarks>
/// The decorated inner projection is the REAL <see cref="LifecycleOverlayStateProjection"/> over the real
/// <see cref="NoSteeringOverlaySource"/> floor — never a stub — because the whole point of the ruling is that the
/// lifecycle's own answer is what survives. A stubbed inner would let this suite pass while the composition it
/// exists to prove was wrong.
/// </remarks>
public sealed class SteeringPauseOverlayProjectionTests
{
    // ---- the four ruling cells --------------------------------------------------------------------

    /// <summary>
    /// <b>ENDEX + world frozen → the lifecycle's terminal answer, NEVER the pause holding page.</b> The headline
    /// cell: "We'll be right back" after an exercise has permanently ended is an outright lie to participants.
    /// </summary>
    [Fact]
    public async Task Endex_WithTheWorldFrozen_ServesTheLifecyclesTerminalAnswer_NeverThePauseHoldingPage()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        var unfrozen = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Completed));

        Freeze(store, exerciseId, "in-fiction");
        var frozen = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Completed));

        frozen.State.Should().NotBe(
            "pause",
            "COR-054: ENDEX is terminal — a controller's Freeze must never put the in-fiction holding page over "
            + "an exercise that has permanently ended");
        frozen.Should().BeEquivalentTo(
            unfrozen,
            "the Freeze is a NO-OP in a completed exercise: whatever the lifecycle serves for 'completed' (today "
            + "'none'; 'endex' once COR-054 authors it) is served byte-identically frozen or not");
        store.Get(exerciseId).State.Should().Be(
            "pause", "and the suppression is the PRECEDENCE closing the door, not an empty store");
    }

    /// <summary>
    /// <b>Pre-start + world frozen → pre-start, not pause.</b> StartEx has not happened, the scenario clock does
    /// not run, and a Freeze stops nothing — so it authors no participant overlay.
    /// </summary>
    [Theory]
    [InlineData(ExerciseLifecycleStates.Build)]
    [InlineData(ExerciseLifecycleStates.Staged)]
    public async Task PreStart_WithTheWorldFrozen_ServesTheLifecyclesAnswer_NeverPause(string preStartState)
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        var unfrozen = await projection.ProjectAsync(SourceIn(exerciseId, preStartState));

        Freeze(store, exerciseId, "out-of-fiction");
        var frozen = await projection.ProjectAsync(SourceIn(exerciseId, preStartState));

        frozen.State.Should().NotBe(
            "pause",
            "pre-start outranks pause: before StartEx the clock does not run (COR-032), so there is nothing for a "
            + "Freeze to stop and nothing to tell participants about");
        frozen.Should().BeEquivalentTo(unfrozen, "the Freeze is a no-op in a pre-start world");
    }

    /// <summary>
    /// <b>Running + frozen → pause, in the register the controller selected.</b> The only cell where a Freeze
    /// means anything — and the reason story 08 exists (D5-014/1.3: Freeze is guarded BECAUSE participants notice).
    /// </summary>
    [Theory]
    [InlineData("in-fiction")]
    [InlineData("out-of-fiction")]
    public async Task Running_WithTheWorldFrozen_ServesPause_InTheControllersSelectedRegister(string selected)
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        Freeze(store, exerciseId, selected);

        var overlay = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Live));

        overlay.State.Should().Be(
            "pause", "a live world's Freeze is the participant-visible safety stop (CTL-023, D5-014/1.3)");
        overlay.Register.Should().Be(
            selected, "AC5: the register the controller selected is what the participant's shell renders");
        overlay.Message.Should().BeEmpty("holding-page content authoring (COR-032) stays out of scope");
    }

    /// <summary>
    /// <b>Running + NOT frozen → none.</b> A live exercise nobody froze is byte-identical to the shipped Phase-1
    /// constant: this decorator never invents an overlay.
    /// </summary>
    [Fact]
    public async Task Running_WithNothingFrozen_ServesNone_ByteIdenticalToTheShippedConstant()
    {
        var projection = Build(new OverlayStateService());

        var overlay = await projection.ProjectAsync(SourceIn(Guid.NewGuid(), ExerciseLifecycleStates.Live));

        overlay.State.Should().Be("none");
        overlay.Register.Should().Be("in-fiction", "the exact hyphenated literal the frozen client union expects");
        overlay.Message.Should().BeEmpty();
    }

    // ---- the rest of the chain --------------------------------------------------------------------

    /// <summary>
    /// A COR-032 <c>paused</c> exercise keeps its lifecycle holding page — with or without a controller Freeze.
    /// The lifecycle answer is never suppressed or reshaped by this decorator.
    /// </summary>
    [Fact]
    public async Task LifecyclePaused_KeepsTheCor032HoldingPage_WhetherOrNotAControllerAlsoFroze()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);

        var withoutFreeze = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Paused));
        Freeze(store, exerciseId, "in-fiction");
        var withFreeze = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Paused));

        withoutFreeze.State.Should().Be("pause", "COR-032's own holding page, contributed by the lifecycle");
        withFreeze.State.Should().Be("pause", "and a concurrent Freeze cannot turn it into anything else");
        withFreeze.Register.Should().Be(
            "out-of-fiction",
            "the composed lifecycle register stands (its documented fail-closed floor) — accepted: a controller's "
            + "in-fiction selection does not override it, which is the SAFE direction since an out-of-fiction "
            + "notice cannot hide a real stop from participants");
    }

    /// <summary>
    /// An <c>archived</c> world is terminal too — and an UNRECOGNIZED status fails closed, so a typo in the
    /// <c>Status</c> column can never open a holding page.
    /// </summary>
    [Theory]
    [InlineData(ExerciseLifecycleStates.Archived)]
    [InlineData("sideways")]
    [InlineData("")]
    [InlineData(null)]
    public async Task TerminalOrUnrecognizedStates_SuppressTheFreeze_FailingClosed(string? status)
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        Freeze(store, exerciseId, "in-fiction");

        var overlay = await projection.ProjectAsync(SourceIn(exerciseId, status));

        overlay.State.Should().Be(
            "none",
            "BehaviourOf() reports the fully-closed set for a terminal or unknown state, so the pause store is "
            + "never consulted — the fail-closed direction");
    }

    /// <summary>
    /// The legacy <c>active</c> literal is still a RUNNING world (<c>ExerciseLifecycleStates.TryParse</c> folds it
    /// onto <c>live</c>), so a Freeze reaches participants in a legacy row too — the shape the shipped bootstrap
    /// and UAT seeds actually write.
    /// </summary>
    [Fact]
    public async Task TheLegacyActiveLiteral_IsStillARunningWorld_SoAFreezeReachesParticipants()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        Freeze(store, exerciseId, "out-of-fiction");

        var overlay = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.LegacyActive));

        overlay.State.Should().Be(
            "pause",
            "legacy rows fold onto their canonical literal, so an exercise stored as 'active' must not silently "
            + "lose participant-visible Freeze");
    }

    /// <summary>
    /// A register that is not exactly <c>in-fiction</c> serves as <c>out-of-fiction</c> on the READ path too, so
    /// no coined literal can reach the frozen client union even if a future writer skipped the coercion.
    /// </summary>
    [Fact]
    public async Task ANonContractRegisterInTheStore_IsCoercedOnTheReadPath()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        store.Apply(exerciseId, "pause", "sideways", store.NextSequence(exerciseId));

        var overlay = await Build(store).ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Live));

        overlay.Register.Should().Be("out-of-fiction", "the conservative register — wrongly staying in-fiction hides a real stop");
    }

    // ---- isolation (COR-001/XC-001, always-Critical) ---------------------------------------------

    /// <summary>
    /// A participant in exercise B never reads exercise A's Freeze — the projection reads the store keyed on the
    /// server-resolved exercise it was handed and nothing else.
    /// </summary>
    [Fact]
    public async Task ExerciseB_NeverSeesExerciseAsFreeze()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var store = new OverlayStateService();
        var projection = Build(store);
        Freeze(store, exerciseA, "in-fiction");

        var overlay = await projection.ProjectAsync(SourceIn(exerciseB, ExerciseLifecycleStates.Live));

        overlay.State.Should().Be(
            "none", "COR-001/XC-001: A's Freeze is not B's — a live exercise B sees no overlay at all");
        store.Get(exerciseA).State.Should().Be(
            "pause", "and the zero is the SCOPE closing the door, not an empty store");
    }

    /// <summary>
    /// The fail-closed empty scope reads the cleared overlay, never any exercise's Freeze. (In production an
    /// unresolved scope 401s before a projection is reached at all; this proves the projection would not leak even
    /// if it were.)
    /// </summary>
    [Fact]
    public async Task TheEmptyScope_ReadsTheClearedOverlay_NeverAnExercisesFreeze()
    {
        var store = new OverlayStateService();
        Freeze(store, Guid.NewGuid(), "in-fiction");

        var overlay = await Build(store).ProjectAsync(SourceIn(Guid.Empty, ExerciseLifecycleStates.Live));

        overlay.State.Should().Be("none", "Guid.Empty is the unresolved scope and must match zero overlays");
    }

    // ---- shape + guards --------------------------------------------------------------------------

    /// <summary>XC-002: the served body is the unchanged frozen three-field shape, with no staff field.</summary>
    [Fact]
    public async Task TheServedBody_IsTheFrozenThreeFieldShape()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        Freeze(store, exerciseId, "in-fiction");

        var overlay = await Build(store).ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Live));

        typeof(OverlayStateResponse).GetProperties().Select(property => property.Name).Should().BeEquivalentTo(
            ["State", "Register", "Message"],
            "the frozen OverlayStateResponse is FILLED, never reshaped — and it structurally cannot carry "
            + "actingHumanId, a PauseTier or a timestamp (XC-002/COR-018/COR-053)");
        overlay.Should().NotBeNull();
    }

    /// <summary>
    /// The predicate the ruling turns on, stated once per lifecycle state. It lives in
    /// <see cref="SteeringOverlayPrecedence"/> rather than on either consumer because story 08 has TWO participant
    /// channels — this read and <see cref="PauseOverlayPublisher"/>'s push — and gating only one is no fix at all
    /// (Gate-1 CR-001). Changing the open <c>staged</c> question is one line here, and both channels follow.
    /// </summary>
    [Theory]
    [InlineData(ExerciseLifecycleStates.Build, false)]
    [InlineData(ExerciseLifecycleStates.Staged, false)]
    [InlineData(ExerciseLifecycleStates.Live, true)]
    [InlineData(ExerciseLifecycleStates.Paused, false)]
    [InlineData(ExerciseLifecycleStates.Completed, false)]
    [InlineData(ExerciseLifecycleStates.Archived, false)]
    [InlineData(ExerciseLifecycleStates.LegacyActive, true)]
    [InlineData("not-a-state", false)]
    public void PauseIsParticipantVisibleIn_IsTrueOnlyWhereScenarioTimeActuallyAdvances(string status, bool applies)
    {
        SteeringOverlayPrecedence.PauseIsParticipantVisibleIn(status).Should().Be(
            applies,
            "the gate is COR-032's own ClockRuns hook — 'the exercise is actually running', which is the only "
            + "time a Freeze means anything");
    }

    /// <summary>
    /// <b>The story-04 (Break Fiction) collision, pinned (Gate-1 SG-003).</b> This decorator treats the lifecycle's
    /// answer as final, which INVERTS <see cref="LifecycleOverlayComposer"/>'s rule 1 — an authored controller
    /// broadcast must outrank a holding page, because hiding a Break Fiction broadcast behind "We'll be right back"
    /// is a safety failure. Nothing breaks today because <see cref="OverlayStateWire"/> names no <c>broadcast</c>
    /// literal and this slice can only write <c>none</c>/<c>pause</c>. This test states BOTH halves so whoever
    /// builds story 04 sees the collision here rather than tripping over it: a hand-planted <c>broadcast</c> is
    /// currently NOT served, and that is a documented gap, not the intended end state.
    /// </summary>
    [Fact]
    public async Task ABroadcastStateInTheStore_IsNotYetReachable_AndIsTheDocumentedStory04Collision()
    {
        var exerciseId = Guid.NewGuid();
        var store = new OverlayStateService();
        store.Apply(exerciseId, LifecycleOverlayWire.Broadcast, "out-of-fiction", store.NextSequence(exerciseId));
        var projection = Build(store);

        var overRunning = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Live));
        var overLifecyclePause = await projection.ProjectAsync(SourceIn(exerciseId, ExerciseLifecycleStates.Paused));

        overRunning.State.Should().Be(
            "none",
            "SG-004: the read path allowlists 'pause', so an unreconciled future state is not served rather than "
            + "passed through verbatim onto a participant surface");
        overLifecyclePause.State.Should().Be(
            "pause",
            "and THIS is the collision story 04 must fix: a lifecycle pause currently WINS over a broadcast, "
            + "inverting LifecycleOverlayComposer's rule 1 — the fix belongs in this class (check a non-pause "
            + "steering state BEFORE returning the lifecycle answer), not in a new writer");
    }

    [Fact]
    public void Constructor_RejectsNullDependencies()
    {
        var act = () => new SteeringPauseOverlayProjection(
            new LifecycleOverlayStateProjection(new NoSteeringOverlaySource()), null!);

        act.Should().Throw<ArgumentNullException>();
    }

    private static SteeringPauseOverlayProjection Build(OverlayStateService store) =>
        new(new LifecycleOverlayStateProjection(new NoSteeringOverlaySource()), store);

    private static void Freeze(OverlayStateService store, Guid exerciseId, string register) =>
        store.Apply(exerciseId, "pause", register, store.NextSequence(exerciseId));

    private static ExerciseShellConfigSource SourceIn(Guid exerciseId, string? status) => new()
    {
        ExerciseId = exerciseId,
        TimeZone = "UTC",
        Status = status!,
    };
}
