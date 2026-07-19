namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;

public class StorylineTickTests
{
    private static Storyline SeededStoryline(int initialIntensity = 40, int windowMin = 20, string curve = "Standard")
    {
        var storyline = Storyline.Create(
            Guid.NewGuid(), "Water main fears", "County issues an advisory",
            curveName: curve, responseWindowMin: windowMin, initialIntensity: initialIntensity);
        storyline.Seed(0);
        return storyline;
    }

    [Fact]
    public void Tick_BeforeWindowElapses_StaysSeeded_AndAccruesSilence()
    {
        var storyline = SeededStoryline();
        var clock = new FakeScenarioClock(10);

        storyline.Tick(clock);

        storyline.Phase.Should().Be(StorylinePhase.Seeded);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(10);
    }

    [Fact]
    public void Tick_WhenSilenceWindowElapses_OpensToEscalating()
    {
        var storyline = SeededStoryline(windowMin: 20);
        var clock = new FakeScenarioClock(20);

        var result = storyline.Tick(clock);

        storyline.Phase.Should().Be(StorylinePhase.Escalating);
        result.StateChanges.Should().ContainSingle(e => e.To == StorylinePhase.Escalating);
    }

    [Fact]
    public void Tick_WhileEscalating_RaisesIntensity_AndPeaksAtTheCeiling()
    {
        var storyline = SeededStoryline(initialIntensity: 40, windowMin: 20);
        var clock = new FakeScenarioClock();

        storyline.Tick(clock.Set(20)); // window opens; 40 + 2.5*20 = 90
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
        storyline.Intensity.Should().Be(90);

        var result = storyline.Tick(clock.Set(24)); // 90 + 2.5*4 = 100 -> clamp 95 -> Peak

        storyline.Phase.Should().Be(StorylinePhase.Peak);
        storyline.Intensity.Should().Be(95);
        result.StateChanges.Should().ContainSingle(e => e.To == StorylinePhase.Peak && e.Cause == StorylineCause.Unaddressed);
    }

    [Fact]
    public void Tick_Escalating_DrivesSentimentNegative()
    {
        var storyline = SeededStoryline(initialIntensity: 40);
        storyline.Tick(new FakeScenarioClock(20));

        storyline.Sentiment.Should().BeNegative("a hot, unaddressed concern reads negative (ADP-012)");
    }

    [Fact]
    public void Tick_FrozenScenarioClock_HaltsTimersAndIntensity()
    {
        var storyline = SeededStoryline(initialIntensity: 40, windowMin: 20);
        var clock = new FakeScenarioClock(10);

        storyline.Tick(clock); // silence 10, still Seeded
        var silenceBefore = storyline.MinutesSinceLastOfficialResponse;

        // Freeze: the clock does not advance. Ticks while frozen change nothing.
        storyline.Tick(clock); // elapsed 0
        storyline.Tick(clock); // elapsed 0

        storyline.Phase.Should().Be(StorylinePhase.Seeded);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(silenceBefore, "silence windows don't advance while frozen (§8.3)");

        // Unfreeze and the window opens as normal.
        storyline.Tick(clock.Set(25));
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
    }

    [Fact]
    public void Tick_TimeJump_BlowsMultipleTransitionsInOneTick()
    {
        var storyline = SeededStoryline(initialIntensity: 40, windowMin: 20);
        var clock = new FakeScenarioClock(0);

        // Jump far past the window and the ceiling: the storyline opens AND peaks in a single tick.
        var result = storyline.Tick(clock.Set(200));

        storyline.Phase.Should().Be(StorylinePhase.Peak);
        storyline.Intensity.Should().Be(95);
        result.ElapsedScenarioMinutes.Should().Be(200);
        result.StateChanges.Select(e => e.To)
            .Should().ContainInOrder(StorylinePhase.Escalating, StorylinePhase.Peak);
    }

    [Fact]
    public void Tick_EmitsAMeasuredEventEveryTick_WithCause()
    {
        var storyline = SeededStoryline();
        var result = storyline.Tick(new FakeScenarioClock(20));

        var measured = result.Events.OfType<StorylineMeasured>().Should().ContainSingle().Subject;
        measured.StorylineId.Should().Be(storyline.Id);
        measured.Intensity.Should().Be(storyline.Intensity);
        measured.ScenarioMinute.Should().Be(20);
    }

    [Fact]
    public void Tick_AmplificationDuringEscalation_IsAttributedAsTheMeasureCause()
    {
        var storyline = SeededStoryline(initialIntensity: 30);
        storyline.Tick(new FakeScenarioClock(20)); // open to Escalating first

        var signals = new StorylineTickSignals { Amplification = new AmplificationSignal(1.0, 5) };
        var result = storyline.Tick(new FakeScenarioClock(24), signals);

        result.Events.OfType<StorylineMeasured>().Single().Cause.Should().Be(MeasureCause.Amplification);
    }

    [Fact]
    public void RecordMatchedResponse_AddressesTheStoryline_BendsIntensityDown_ResetsSilence()
    {
        var storyline = SeededStoryline(initialIntensity: 40);
        storyline.Tick(new FakeScenarioClock(20)); // Escalating at intensity 90
        var intensityAtPeakPressure = storyline.Intensity;

        var events = storyline.RecordMatchedResponse(scenarioMinute: 25);

        storyline.Phase.Should().Be(StorylinePhase.Addressed);
        storyline.Intensity.Should().BeLessThan(intensityAtPeakPressure);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0);
        events.OfType<StorylineStateChanged>().Should().ContainSingle(e => e.Cause == StorylineCause.MatchedResponse);
        events.OfType<StorylineMeasured>().Should().ContainSingle(e => e.Cause == MeasureCause.MatchedResponse);
    }

    [Fact]
    public void RecordMatchedResponse_OffPlatform_UsesTheOffPlatformCause()
    {
        var storyline = SeededStoryline();
        storyline.Tick(new FakeScenarioClock(20));

        var events = storyline.RecordMatchedResponse(25, offPlatform: true);

        events.OfType<StorylineStateChanged>().Single().Cause.Should().Be(StorylineCause.OffPlatformMarker);
    }

    [Fact]
    public void Tick_AfterAddressed_DecaysToTheFloorThenResolves()
    {
        var storyline = SeededStoryline(initialIntensity: 40);
        var clock = new FakeScenarioClock();
        storyline.Tick(clock.Set(20));           // Escalating, intensity 90
        storyline.RecordMatchedResponse(21);     // Addressed, intensity ~68

        storyline.Tick(clock.Set(25));           // Addressed -> Decaying, decays
        storyline.Phase.Should().Be(StorylinePhase.Decaying);

        // Keep ticking; intensity must reach the floor and the storyline resolves.
        for (var minute = 30; minute <= 120 && storyline.Phase != StorylinePhase.Resolved; minute += 5)
        {
            storyline.Tick(clock.Set(minute));
        }

        storyline.Phase.Should().Be(StorylinePhase.Resolved);
        storyline.Intensity.Should().Be(EscalationCurvesFloor);
    }

    private const int EscalationCurvesFloor = 5; // Standard curve floor

    [Fact]
    public void Seed_ClearsSilenceAccruedWhileDormant_SoTheWindowDoesNotOpenInstantly()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e", responseWindowMin: 20, initialIntensity: 40);

        // Idle while Dormant accrues silence...
        storyline.Tick(new FakeScenarioClock(50));
        storyline.MinutesSinceLastOfficialResponse.Should().Be(50);

        // ...but seeding clears it, so the window measures from the seed moment.
        storyline.Seed(50);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0);

        // A tick 5 minutes later is well under the window — the storyline is still armed, not escalating.
        storyline.Tick(new FakeScenarioClock(55));
        storyline.Phase.Should().Be(StorylinePhase.Seeded);
    }

    [Fact]
    public void RecordMatchedResponse_ReAnchorsTheTickBaseline_SoSilenceIsMeasuredFromTheResponse()
    {
        var storyline = SeededStoryline(initialIntensity: 40);
        storyline.Tick(new FakeScenarioClock(20)); // last tick at t=20

        storyline.RecordMatchedResponse(scenarioMinute: 21); // response between ticks

        storyline.Tick(new FakeScenarioClock(25)); // t=25

        // Silence is 4 (25 - 21), not 5 (25 - 20): measured from the response, not the previous tick.
        storyline.MinutesSinceLastOfficialResponse.Should().Be(4);
    }

    [Fact]
    public void Tick_ClockBehindLastTick_TreatsElapsedAsZero_NeverNegative()
    {
        var storyline = SeededStoryline();
        storyline.Tick(new FakeScenarioClock(30));
        var silence = storyline.MinutesSinceLastOfficialResponse;

        // A clock reading behind the last tick (e.g. a replay seek) must not rewind silence.
        var result = storyline.Tick(new FakeScenarioClock(10));

        result.ElapsedScenarioMinutes.Should().Be(0);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(silence);
    }
}
