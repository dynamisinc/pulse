namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The two contributed projections and — above all — the COR-032 ↔ CTL-023 overlay COMPOSITION
/// (integration hazard 1). Pure: no database, no HTTP, plain <see cref="FactAttribute"/>s outside
/// <c>MsSqlCollection</c>.
/// </summary>
public sealed class LifecycleProjectionTests
{
    private static ExerciseShellConfigSource SourceIn(string status, Guid? exerciseId = null) => new()
    {
        ExerciseId = exerciseId ?? Guid.NewGuid(),
        TimeZone = "UTC",
        Status = status,
    };

    /// <summary>AC6: the lifecycle decides the shell variant, on the unchanged frozen shape.</summary>
    [Theory]
    [InlineData("build", "preview")]
    [InlineData("staged", "full")]
    [InlineData("live", "full")]
    [InlineData("paused", "readOnly")]
    [InlineData("completed", "readOnly")]
    [InlineData("archived", "readOnly")]
    public async Task ShellVariantProjection_MapsEachLifecycleStateOntoItsVariant(string status, string expected)
    {
        var response = await new LifecycleShellVariantProjection().ProjectAsync(SourceIn(status));

        response.Variant.Should().Be(expected, "the lifecycle dictates the variant (COR-032 / AC6)");
    }

    /// <summary>
    /// <b>Tier-2 human ruling, decision 1 — pinned so nobody "tidies" Staged back to <c>readOnly</c>.</b>
    /// <c>readOnly</c> is not a cosmetic downgrade: <c>mountContract.ts</c>'s
    /// <c>affordancesAvailable(variant) =&gt; variant === 'full'</c> is what gates the realtime feed stream
    /// (<c>Feed.tsx</c>: <c>useFeedStream({ enabled: affordances })</c>), the "▲ N new posts" pill and the
    /// composer — so a <c>readOnly</c> Staged is a frozen snapshot with no error, during the very pre-StartEx
    /// familiarization window COR-032 gives Staged for. It also has to agree with this story's own AC7 hooks,
    /// asserted here alongside it.
    /// </summary>
    [Fact]
    public void ShellVariantProjection_Staged_IsFull_BecauseAffordancesAreGatedOnFullAlone()
    {
        LifecycleShellVariantProjection.VariantFor("staged").Should().Be(
            ShellVariants.Full,
            "affordancesAvailable() grants the feed stream, the new-posts pill and authoring to 'full' ALONE — " +
            "any other variant silently ships Staged as a dead snapshot (decision 1)");

        var staged = ExerciseLifecycleStates.BehaviourOf("staged");
        staged.AmbientWorldRuns.Should().BeTrue(
            "the variant must agree with AC7: a Staged world whose ambient content runs needs a live stream to show it");
        staged.ParticipantWritesAccepted.Should().BeTrue(
            "and a Staged world that accepts participant writes needs the composer the 'full' variant carries");
    }

    /// <summary>Every emitted variant is inside the frozen client union — a coined value blanks the shell.</summary>
    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    [InlineData("active")]
    [InlineData("nonsense")]
    public void ShellVariantProjection_OnlyEverEmitsAFrozenVariantLiteral(string status) =>
        LifecycleShellVariantProjection.VariantFor(status).Should().BeOneOf(
            [ShellVariants.Full, ShellVariants.ReadOnly, ShellVariants.Kiosk, ShellVariants.Preview],
            "shellState.ts's guard fails closed on anything outside full|readOnly|kiosk|preview");

    /// <summary>Fail closed: an unrecognized status yields the safe read-only shell, never the interactive one.</summary>
    [Fact]
    public void ShellVariantProjection_FailsClosedToReadOnly_OnAnUnknownStatus() =>
        LifecycleShellVariantProjection.VariantFor("nonsense").Should().Be(ShellVariants.ReadOnly);

    /// <summary>AC6: Paused serves the holding page through the unchanged frozen overlay shape.</summary>
    [Fact]
    public async Task OverlayProjection_Paused_ServesTheHoldingPage()
    {
        var response = await new LifecycleOverlayStateProjection(new NoSteeringOverlaySource())
            .ProjectAsync(SourceIn("paused"));

        response.State.Should().Be("pause");
        response.Register.Should().Be(
            "out-of-fiction",
            "with NEITHER side authoring a register the composer falls back to the fail-closed floor (decision 3)");
        response.Message.Should().BeEmpty("holding-page CONTENT authoring is out of scope for this story");
    }

    /// <summary>
    /// <b>Tier-2 human ruling, decision 3.</b> The lifecycle contributes an UNSPECIFIED register: COR-032 says
    /// the holding page is "configurable (in-fiction or out-of-fiction, CTL-023)", so the choice is CTL-023's.
    /// Hardcoding <c>out-of-fiction</c> here made in-fiction unreachable by construction once rule 2's
    /// domination applied.
    /// </summary>
    [Fact]
    public void OverlayComposition_TheLifecycleAuthorsNoRegister()
    {
        LifecycleOverlayComposer.FromLifecycle("paused").Register.Should().BeNull(
            "the register is CTL-023's to author (COR-032) — the lifecycle only says 'a pause is in effect'");
        LifecycleOverlayComposer.FromLifecycle("live").Should().Be(
            OverlayContribution.None, "no other state contributes an overlay at all");
    }

    /// <summary>A non-paused exercise with no steering overlay is byte-identical to the shipped constant.</summary>
    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task OverlayProjection_WithoutPauseOrFreeze_IsTheShippedPhase1Constant(string status)
    {
        var response = await new LifecycleOverlayStateProjection(new NoSteeringOverlaySource())
            .ProjectAsync(SourceIn(status));

        response.State.Should().Be(ParticipantShellDefaults.OverlayState);
        response.Register.Should().Be(ParticipantShellDefaults.OverlayRegister);
        response.Message.Should().BeEmpty();
    }

    // ---------------------------------------------------------------------------------------------
    // The reconciliation (integration hazard 1): ONE composed overlay, never two competing ones.
    // ---------------------------------------------------------------------------------------------

    /// <summary>A live CTL-023 Freeze alone drives the overlay, with no lifecycle pause in play.</summary>
    [Fact]
    public async Task OverlayComposition_FreezeAlone_ShowsTheFreeze()
    {
        var freeze = new OverlayContribution("pause", "in-fiction", string.Empty);
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(freeze))
            .ProjectAsync(SourceIn("live"));

        response.State.Should().Be("pause", "a CTL-023 Freeze on a live world is visible to participants");
        response.Register.Should().Be("in-fiction", "an in-fiction Freeze keeps its own register when nothing else is paused");
    }

    /// <summary>
    /// The composition's load-bearing case: a lifecycle Pause AND a CTL-023 Freeze produce exactly ONE
    /// <c>pause</c> overlay, carrying the controller's authored register and copy.
    /// </summary>
    [Fact]
    public async Task OverlayComposition_LifecyclePauseAndFreeze_ProduceOneCoherentOverlay()
    {
        var freeze = new OverlayContribution("pause", "in-fiction", "Standby.");
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(freeze))
            .ProjectAsync(SourceIn("paused"));

        response.State.Should().Be("pause", "two pauses compose into one pause, never two competing overlays");
        response.Register.Should().Be(
            "in-fiction",
            "only CTL-023 authored a register, so its choice stands (decision 3) — the lifecycle authors none");
        response.Message.Should().Be("Standby.", "the live controller action carries the more specific copy");
    }

    /// <summary>
    /// <b>Decision 3, the case the ruling exists for:</b> a controller-authored <c>in-fiction</c> register
    /// SURVIVES a concurrent COR-032 lifecycle pause. Under the old rule the lifecycle's hardcoded
    /// <c>out-of-fiction</c> dominated permanently, so COR-032's "configurable in-fiction or out-of-fiction"
    /// was unreachable and every lifecycle pause broke fiction (a D0 §4 cost).
    /// </summary>
    [Fact]
    public void OverlayComposition_ASteeringChosenInFictionRegister_SurvivesAConcurrentLifecyclePause()
    {
        var composed = LifecycleOverlayComposer.Compose(
            LifecycleOverlayComposer.FromLifecycle("paused"),
            new OverlayContribution("pause", "in-fiction", "We'll be right back."));

        composed.State.Should().Be("pause");
        composed.Register.Should().Be(
            "in-fiction",
            "CTL-023 chooses the register (COR-032); the lifecycle contributes no competing choice to dominate it");
    }

    /// <summary>
    /// Domination is preserved where it belongs: BETWEEN TWO EXPLICIT CHOICES. An out-of-fiction contribution
    /// still wins over an in-fiction one, because wrongly staying in-fiction hides a real stop.
    /// </summary>
    [Theory]
    [InlineData("out-of-fiction", "in-fiction")]
    [InlineData("in-fiction", "out-of-fiction")]
    [InlineData("coined-nonsense", "in-fiction")]
    public void OverlayComposition_OutOfFictionDominates_BetweenTwoExplicitlyChosenRegisters(
        string first,
        string second)
    {
        var composed = LifecycleOverlayComposer.Compose(
            new OverlayContribution("pause", first, string.Empty),
            new OverlayContribution("pause", second, string.Empty));

        composed.Register.Should().Be(
            "out-of-fiction",
            "when both sides chose, the more-revealing register wins — and a coined literal coerces to it too");
    }

    /// <summary>The fail-closed floor: when NOBODY authored a register, the composed pause is out-of-fiction.</summary>
    [Fact]
    public void OverlayComposition_WithNoAuthoredRegisterOnEitherSide_FallsBackToOutOfFiction() =>
        LifecycleOverlayComposer.Compose(
                LifecycleOverlayComposer.FromLifecycle("paused"),
                new OverlayContribution("pause", Register: null, string.Empty))
            .Register.Should().Be(
                "out-of-fiction",
                "the fail-closed default is preserved for the case where nothing else speaks (decision 3)");

    /// <summary>
    /// The regression a naive "steering wins" rule ships: a controller Resume must NOT lift a COR-032
    /// lifecycle Pause.
    /// </summary>
    [Fact]
    public async Task OverlayComposition_FreezeResumedWhileLifecycleStillPaused_KeepsTheHoldingPage()
    {
        var resumed = new OverlayContribution("none", "in-fiction", string.Empty);
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(resumed))
            .ProjectAsync(SourceIn("paused"));

        response.State.Should().Be(
            "pause",
            "the exercise is still administratively Paused (COR-032) — a CTL-023 Resume does not un-pause it");
    }

    /// <summary>The mirror case: ending the lifecycle Pause must not lift a still-live Freeze.</summary>
    [Fact]
    public async Task OverlayComposition_LifecycleResumedWhileFreezeStillHeld_KeepsTheFreeze()
    {
        var freeze = new OverlayContribution("pause", "out-of-fiction", string.Empty);
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(freeze))
            .ProjectAsync(SourceIn("live"));

        response.State.Should().Be("pause", "the controller's Freeze is still held (CTL-023)");
    }

    /// <summary>A non-pause steering overlay (Break Fiction) must never be suppressed by a holding page.</summary>
    [Fact]
    public async Task OverlayComposition_BroadcastDuringALifecyclePause_WinsOutright()
    {
        var broadcast = new OverlayContribution("broadcast", "out-of-fiction", "CONTROLLER: evacuate the building.");
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(broadcast))
            .ProjectAsync(SourceIn("paused"));

        response.State.Should().Be("broadcast", "hiding a Break Fiction broadcast behind a holding page is a safety failure");
        response.Message.Should().Be("CONTROLLER: evacuate the building.");
    }

    /// <summary>
    /// The join is order-independent OVER THE REACHABLE DOMAIN — <see cref="LifecycleOverlayComposer.FromLifecycle"/>
    /// yields only <c>none</c> or an unspecified-register <c>pause</c>, and neither subsystem's write order can
    /// change the answer for those. (Reviewer S-001: the claim is domain-limited, not general — see the
    /// companion test below.)
    /// </summary>
    [Theory]
    [InlineData("paused", "pause", "in-fiction")]
    [InlineData("paused", "none", "in-fiction")]
    [InlineData("live", "pause", "out-of-fiction")]
    [InlineData("live", "none", "in-fiction")]
    public void OverlayComposition_IsCommutativeAcrossTheTwoContributions(
        string lifecycleState,
        string steeringState,
        string steeringRegister)
    {
        var lifecycle = LifecycleOverlayComposer.FromLifecycle(lifecycleState);
        var steering = new OverlayContribution(steeringState, steeringRegister, string.Empty);

        var oneWay = LifecycleOverlayComposer.Compose(lifecycle, steering);
        var otherWay = LifecycleOverlayComposer.Compose(steering, lifecycle);

        otherWay.Should().BeEquivalentTo(oneWay, "the composed overlay must not depend on which side was observed first");
    }

    /// <summary>
    /// <b>Reviewer S-001, pinned rather than over-claimed:</b> the join is NOT commutative in general, and the
    /// asymmetry is deliberate — rule 1 is a STEERING-SIDE privilege. Only an authored controller overlay may
    /// outrank a holding page, so callers must keep passing the lifecycle contribution first.
    /// </summary>
    [Fact]
    public void OverlayComposition_IsNotCommutativeInGeneral_BecauseRule1IsASteeringSidePrivilege()
    {
        var broadcast = new OverlayContribution("broadcast", "out-of-fiction", "CONTROLLER: evacuate.");

        LifecycleOverlayComposer.Compose(OverlayContribution.None, broadcast).State.Should().Be(
            "broadcast", "a controller broadcast on the STEERING side wins outright (rule 1)");
        LifecycleOverlayComposer.Compose(broadcast, OverlayContribution.None).State.Should().Be(
            "pause",
            "the same contribution on the LIFECYCLE side does not — the lifecycle can only ever say 'paused', " +
            "so this argument order is unreachable and the commutativity claim is limited to that domain");
    }

    /// <summary>The fail-closed floor never invents an overlay nobody triggered.</summary>
    [Fact]
    public void NoSteeringOverlaySource_NeverReportsAnActiveOverlay() =>
        new NoSteeringOverlaySource().GetCurrent(Guid.NewGuid()).Should().BeNull();

    /// <summary>Stands in for the world-steering adapter registered at merge time.</summary>
    private sealed class StubSteeringOverlaySource : ISteeringOverlaySource
    {
        private readonly OverlayContribution? _current;

        public StubSteeringOverlaySource(OverlayContribution? current) => _current = current;

        public OverlayContribution? GetCurrent(Guid exerciseId) => _current;
    }
}
