namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class StorylineTests
{
    private static readonly Guid Exercise = Guid.NewGuid();

    private static Storyline NewStoryline(int initialIntensity = 0) => Storyline.Create(
        Exercise,
        title: "Water main contamination fears",
        expectation: "County issues a water-safety advisory",
        curveName: "Standard",
        responseWindowMin: 20,
        initialIntensity: initialIntensity,
        participatingPersonas: ["@localmom", "@wxwatcher"],
        hashtags: ["#WaterIssues"]);

    [Fact]
    public void Create_PopulatesAllFields_ScopedToExercise_StartsDormant()
    {
        var storyline = NewStoryline(initialIntensity: 40);

        storyline.Id.Should().NotBe(Guid.Empty);
        storyline.ExerciseId.Should().Be(Exercise);
        storyline.Title.Should().Be("Water main contamination fears");
        storyline.Expectation.Should().Be("County issues a water-safety advisory");
        storyline.CurveName.Should().Be("Standard");
        storyline.ResponseWindowMin.Should().Be(20);
        storyline.Intensity.Should().Be(40);
        storyline.Sentiment.Should().Be(0.0);
        storyline.TargetIntensity.Should().BeNull();
        storyline.Phase.Should().Be(StorylinePhase.Dormant);
        storyline.ParticipatingPersonas.Should().Equal("@localmom", "@wxwatcher");
        storyline.Hashtags.Should().Equal("#WaterIssues");
    }

    [Fact]
    public void Create_ReservedV1_1AndPhase4Slots_ArePresentAndEmptyByDefault()
    {
        var storyline = NewStoryline();

        storyline.ExpectedActionRef.Should().BeNull("the Phase-4 Cadence binding hook is reserved/null in v1");
        storyline.RumorRefs.Should().BeEmpty("the v1.1 rumor lineage slot is reserved but unused in v1");
    }

    [Fact]
    public void Create_AcceptsReservedSlotValues_WithoutMigration()
    {
        var actionRef = Guid.NewGuid();
        var rumor = Guid.NewGuid();

        var storyline = Storyline.Create(
            Exercise,
            "t",
            "e",
            expectedActionRef: actionRef,
            rumorRefs: [rumor]);

        storyline.ExpectedActionRef.Should().Be(actionRef);
        storyline.RumorRefs.Should().ContainSingle().Which.Should().Be(rumor);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void Create_IntensityOutsideCanonicalScale_Throws(int intensity)
    {
        var act = () => Storyline.Create(Exercise, "t", "e", initialIntensity: intensity);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_BlankRequiredField_Throws(string blank)
    {
        var badTitle = () => Storyline.Create(Exercise, blank, "e");
        var badExpectation = () => Storyline.Create(Exercise, "t", blank);
        badTitle.Should().Throw<ArgumentException>();
        badExpectation.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_EmptyExerciseId_Throws()
    {
        var act = () => Storyline.Create(Guid.Empty, "t", "e");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_DefensivelyCopiesCollections()
    {
        var personas = new List<string> { "@a" };
        var storyline = Storyline.Create(Exercise, "t", "e", participatingPersonas: personas);

        personas.Add("@b"); // mutating the source must not leak into the storyline

        storyline.ParticipatingPersonas.Should().ContainSingle().Which.Should().Be("@a");
    }

    [Fact]
    public void Seed_MovesDormantToSeeded_AndEmitsStateChange()
    {
        var storyline = NewStoryline();

        var evt = storyline.Seed(scenarioMinute: 5);

        storyline.Phase.Should().Be(StorylinePhase.Seeded);
        evt.From.Should().Be(StorylinePhase.Dormant);
        evt.To.Should().Be(StorylinePhase.Seeded);
        evt.Cause.Should().Be(StorylineCause.Seed);
        evt.ScenarioMinute.Should().Be(5);
        evt.StorylineId.Should().Be(storyline.Id);
    }

    [Fact]
    public void Transition_FollowsTheFullHappyPath_ToResolved()
    {
        var storyline = NewStoryline();

        storyline.Seed(0);
        storyline.Transition(StorylineTrigger.WindowOpened, 20).To.Should().Be(StorylinePhase.Escalating);
        storyline.Transition(StorylineTrigger.LeftUnaddressed, 35).To.Should().Be(StorylinePhase.Peak);
        storyline.Transition(StorylineTrigger.OfficialResponseMatched, 40).To.Should().Be(StorylinePhase.Addressed);
        storyline.Transition(StorylineTrigger.DecayBegan, 41).To.Should().Be(StorylinePhase.Decaying);
        storyline.Transition(StorylineTrigger.ReachedFloor, 60).To.Should().Be(StorylinePhase.Resolved);

        storyline.Phase.Should().Be(StorylinePhase.Resolved);
    }

    [Fact]
    public void Transition_ResolvedReOpensToEscalating_OnNewUnaddressedTrigger()
    {
        var storyline = NewStoryline();
        storyline.Seed(0);
        storyline.Transition(StorylineTrigger.WindowOpened, 20);
        storyline.Transition(StorylineTrigger.OfficialResponseMatched, 25);
        storyline.Transition(StorylineTrigger.DecayBegan, 26);
        storyline.Transition(StorylineTrigger.ReachedFloor, 50);

        var evt = storyline.Transition(StorylineTrigger.NewUnaddressedTrigger, 70);

        storyline.Phase.Should().Be(StorylinePhase.Escalating);
        evt.Cause.Should().Be(StorylineCause.ReOpened);
    }

    [Fact]
    public void Transition_IllegalTransition_ThrowsAndLeavesPhaseUnchanged()
    {
        var storyline = NewStoryline(); // Dormant

        var act = () => storyline.Transition(StorylineTrigger.LeftUnaddressed, 10);

        act.Should().Throw<InvalidStorylineTransitionException>();
        storyline.Phase.Should().Be(StorylinePhase.Dormant);
    }

    [Fact]
    public void Transition_OffPlatformMarker_SatisfiesExpectationWithDistinctCause()
    {
        var storyline = NewStoryline();
        storyline.Seed(0);
        storyline.Transition(StorylineTrigger.WindowOpened, 20);

        // Off-platform response (CTL-026) addresses the storyline identically to an on-platform match,
        // but telemetry records the distinct cause.
        var evt = storyline.Transition(StorylineTrigger.OfficialResponseMatched, 30, StorylineCause.OffPlatformMarker);

        storyline.Phase.Should().Be(StorylinePhase.Addressed);
        evt.Cause.Should().Be(StorylineCause.OffPlatformMarker);
    }

    [Fact]
    public void Transition_NegativeScenarioMinute_Throws()
    {
        var storyline = NewStoryline();
        var act = () => storyline.Seed(-1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void MinutesInPhase_MeasuresFromPhaseEntry()
    {
        var storyline = NewStoryline();
        storyline.Seed(10);

        storyline.MinutesInPhase(34).Should().Be(24);
        storyline.MinutesInPhase(5).Should().Be(0, "time-in-phase is never negative even if the clock is behind entry");
    }

    [Fact]
    public void RecordEngineReaction_SetsTheMinute_AndIsMonotonic()
    {
        var storyline = NewStoryline();
        storyline.LastEngineReactionScenarioMinute.Should().BeNull("the engine has not reacted to this storyline yet");

        storyline.RecordEngineReaction(20);
        storyline.LastEngineReactionScenarioMinute.Should().Be(20);

        storyline.RecordEngineReaction(35);
        storyline.LastEngineReactionScenarioMinute.Should().Be(35, "a later reaction advances the cadence marker");

        storyline.RecordEngineReaction(30);
        storyline.LastEngineReactionScenarioMinute.Should().Be(
            35, "a smaller minute never moves the marker backward — the cadence marker is monotonic");
    }

    [Fact]
    public void RecordEngineReaction_NegativeMinute_Throws()
    {
        var storyline = NewStoryline();
        var act = () => storyline.RecordEngineReaction(-1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void RecordEngineReaction_DoesNotResetTheSilenceClock()
    {
        var storyline = NewStoryline();
        var clock = new FakeScenarioClock();
        storyline.Seed(0);
        storyline.Tick(clock.Set(30)); // 30 scenario minutes of official silence accrue

        storyline.RecordEngineReaction(30);

        storyline.MinutesSinceLastOfficialResponse.Should().Be(
            30, "an engine reaction is not an official response — the crowd keeps building while officials stay silent");
    }
}
