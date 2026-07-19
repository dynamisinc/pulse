namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class StorylineStateMachineTests
{
    public static TheoryData<StorylinePhase, StorylineTrigger, StorylinePhase> LegalTransitions() => new()
    {
        { StorylinePhase.Dormant, StorylineTrigger.Seed, StorylinePhase.Seeded },
        { StorylinePhase.Seeded, StorylineTrigger.WindowOpened, StorylinePhase.Escalating },
        { StorylinePhase.Seeded, StorylineTrigger.ActivityDetected, StorylinePhase.Escalating },
        { StorylinePhase.Seeded, StorylineTrigger.OfficialResponseMatched, StorylinePhase.Addressed },
        { StorylinePhase.Escalating, StorylineTrigger.LeftUnaddressed, StorylinePhase.Peak },
        { StorylinePhase.Escalating, StorylineTrigger.OfficialResponseMatched, StorylinePhase.Addressed },
        { StorylinePhase.Peak, StorylineTrigger.OfficialResponseMatched, StorylinePhase.Addressed },
        { StorylinePhase.Addressed, StorylineTrigger.DecayBegan, StorylinePhase.Decaying },
        { StorylinePhase.Decaying, StorylineTrigger.ReachedFloor, StorylinePhase.Resolved },
        { StorylinePhase.Decaying, StorylineTrigger.NewUnaddressedTrigger, StorylinePhase.Escalating },
        { StorylinePhase.Resolved, StorylineTrigger.NewUnaddressedTrigger, StorylinePhase.Escalating },
    };

    [Theory]
    [MemberData(nameof(LegalTransitions))]
    public void Target_LegalTransition_ReturnsExpectedPhase(StorylinePhase from, StorylineTrigger trigger, StorylinePhase expected)
    {
        StorylineStateMachine.CanTransition(from, trigger).Should().BeTrue();
        StorylineStateMachine.Target(from, trigger).Should().Be(expected);
    }

    [Theory]
    [InlineData(StorylinePhase.Dormant, StorylineTrigger.LeftUnaddressed)] // can't skip straight to Peak
    [InlineData(StorylinePhase.Dormant, StorylineTrigger.OfficialResponseMatched)]
    [InlineData(StorylinePhase.Seeded, StorylineTrigger.Seed)] // no re-seed
    [InlineData(StorylinePhase.Resolved, StorylineTrigger.OfficialResponseMatched)] // resolved can only re-open
    [InlineData(StorylinePhase.Peak, StorylineTrigger.LeftUnaddressed)] // already at peak
    [InlineData(StorylinePhase.Escalating, StorylineTrigger.Seed)]
    public void Target_IllegalTransition_ReturnsNull(StorylinePhase from, StorylineTrigger trigger)
    {
        StorylineStateMachine.CanTransition(from, trigger).Should().BeFalse();
        StorylineStateMachine.Target(from, trigger).Should().BeNull();
    }

    [Theory]
    [InlineData(StorylineTrigger.Seed, StorylineCause.Seed)]
    [InlineData(StorylineTrigger.WindowOpened, StorylineCause.WindowOpened)]
    [InlineData(StorylineTrigger.ActivityDetected, StorylineCause.Activity)]
    [InlineData(StorylineTrigger.LeftUnaddressed, StorylineCause.Unaddressed)]
    [InlineData(StorylineTrigger.OfficialResponseMatched, StorylineCause.MatchedResponse)]
    [InlineData(StorylineTrigger.DecayBegan, StorylineCause.CurveDecay)]
    [InlineData(StorylineTrigger.NewUnaddressedTrigger, StorylineCause.ReOpened)]
    public void DefaultCause_MapsTriggerToCause(StorylineTrigger trigger, StorylineCause expected)
    {
        StorylineStateMachine.DefaultCause(trigger).Should().Be(expected);
    }
}
