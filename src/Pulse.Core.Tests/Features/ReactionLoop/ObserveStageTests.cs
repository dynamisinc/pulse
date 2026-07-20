namespace Pulse.Core.Tests.Features.ReactionLoop;

using FluentAssertions;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.Storylines.Models;

public class ObserveStageTests
{
    private static Storyline SeededStoryline(int window = 20)
    {
        var s = Storyline.Create(Guid.NewGuid(), "Water fears", "County advisory", responseWindowMin: window);
        s.Seed(0);
        return s;
    }

    private static readonly IReadOnlyList<AddressingObservation> NoAddressing = [];

    [Fact]
    public void WhenSilenceWindowElapses_RaisesAnInactionTrigger()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(20)); // window elapses → Escalating, silence = 20

        var signals = ObserveStage.Observe([s], NoAddressing, clock);

        signals.InactionTriggers.Should().ContainSingle()
            .Which.Should().BeEquivalentTo(new { StorylineId = s.Id, MinutesSilent = 20, ScenarioMinute = 20 });
    }

    [Fact]
    public void BeforeTheWindowElapses_RaisesNothing()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(10)); // still within the window

        ObserveStage.Observe([s], NoAddressing, clock).InactionTriggers.Should().BeEmpty();
    }

    [Fact]
    public void AFreeze_HaltsTheTimer_NoTriggerAccrues()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(10)); // 10 minutes of silence, within window

        // Freeze: the scenario clock does not advance, so the tick accrues 0 and the window never elapses.
        s.Tick(clock); // elapsed 0
        ObserveStage.Observe([s], NoAddressing, clock).InactionTriggers.Should().BeEmpty();
    }

    [Fact]
    public void ATimeJump_AdvancesTheTimer_PastTheWindow()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(5)); // barely started

        // Time-jump: the clock leaps well past the window; one tick accrues the whole jump.
        s.Tick(clock.Set(90));
        ObserveStage.Observe([s], NoAddressing, clock).InactionTriggers.Should().ContainSingle();
    }

    [Fact]
    public void AnOffPlatformMarker_IsSurfacedAsAnAddressingCandidate_NotMatchedHere()
    {
        var s = SeededStoryline();
        var clock = new FakeScenarioClock(12);
        var addressing = new[]
        {
            new AddressingObservation(AddressingSource.OffPlatformMarker, "marker-1", StorylineHintId: s.Id),
        };

        var signals = ObserveStage.Observe([s], addressing, clock);

        signals.AddressingCandidates.Should().ContainSingle()
            .Which.Should().BeEquivalentTo(new { Source = AddressingSource.OffPlatformMarker, Reference = "marker-1", ScenarioMinute = 12 });
    }
}
