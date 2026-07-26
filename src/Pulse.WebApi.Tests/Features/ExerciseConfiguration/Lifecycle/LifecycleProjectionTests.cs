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
    [InlineData("staged", "readOnly")]
    [InlineData("live", "full")]
    [InlineData("paused", "readOnly")]
    [InlineData("completed", "readOnly")]
    [InlineData("archived", "readOnly")]
    public async Task ShellVariantProjection_MapsEachLifecycleStateOntoItsVariant(string status, string expected)
    {
        var response = await new LifecycleShellVariantProjection().ProjectAsync(SourceIn(status));

        response.Variant.Should().Be(expected, "the lifecycle dictates the variant (COR-032 / AC6)");
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
        response.Register.Should().Be("out-of-fiction");
        response.Message.Should().BeEmpty("holding-page CONTENT authoring is out of scope for this story");
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
    /// <c>pause</c> overlay, in the more-revealing register.
    /// </summary>
    [Fact]
    public async Task OverlayComposition_LifecyclePauseAndFreeze_ProduceOneCoherentOverlay()
    {
        var freeze = new OverlayContribution("pause", "in-fiction", "Standby.");
        var response = await new LifecycleOverlayStateProjection(new StubSteeringOverlaySource(freeze))
            .ProjectAsync(SourceIn("paused"));

        response.State.Should().Be("pause", "two pauses compose into one pause, never two competing overlays");
        response.Register.Should().Be(
            "out-of-fiction",
            "out-of-fiction dominates: staying in-fiction would HIDE a real stop from participants");
        response.Message.Should().Be("Standby.", "the live controller action carries the more specific copy");
    }

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

    /// <summary>The join is order-independent — neither subsystem's write order can change the answer.</summary>
    [Fact]
    public void OverlayComposition_IsCommutativeAcrossTheTwoContributions()
    {
        var lifecyclePause = LifecycleOverlayComposer.FromLifecycle("paused");
        var freeze = new OverlayContribution("pause", "in-fiction", string.Empty);

        var oneWay = LifecycleOverlayComposer.Compose(lifecyclePause, freeze);
        var otherWay = LifecycleOverlayComposer.Compose(
            new OverlayContribution(freeze.State, freeze.Register, freeze.Message), lifecyclePause);

        otherWay.Should().BeEquivalentTo(oneWay, "the composed overlay must not depend on which side was observed first");
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
