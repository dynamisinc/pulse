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
    public void ReactedWithinTheCadence_SuppressesAFreshTrigger()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(20)); // window elapses → Escalating, silence = 20
        s.RecordEngineReaction(20); // the engine just reacted at minute 20

        // Two scenario minutes later the storyline is still silent, but the cadence (3) has not elapsed, so
        // observe does NOT re-raise — the loop stops re-reacting to the same ongoing silence every tick (ADP-011).
        ObserveStage.Observe([s], NoAddressing, clock.Set(22), minMinutesBetweenReactions: 3)
            .InactionTriggers.Should().BeEmpty("the engine reacted 2 minutes ago; cadence 3 has not elapsed");
    }

    [Fact]
    public void OnceTheCadenceElapses_RaisesTheTriggerAgain()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(20));
        s.RecordEngineReaction(20);

        // minute - last (23 - 20) >= cadence 3 → the still-unaddressed silence re-fires (escalation continues).
        ObserveStage.Observe([s], NoAddressing, clock.Set(23), minMinutesBetweenReactions: 3)
            .InactionTriggers.Should().ContainSingle("the cadence elapsed, so the ongoing silence re-fires");
    }

    [Fact]
    public void ANeverReactedStoryline_FiresImmediately_EvenWithACadence()
    {
        var s = SeededStoryline(window: 20);
        var clock = new FakeScenarioClock();
        s.Tick(clock.Set(20)); // window blows; the engine has never reacted (LastEngineReactionScenarioMinute == null)

        // The first reaction is immediate when the window opens — the cadence only gates RE-reaction.
        ObserveStage.Observe([s], NoAddressing, clock, minMinutesBetweenReactions: 3)
            .InactionTriggers.Should().ContainSingle("a never-reacted storyline is never suppressed by the cadence");
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
