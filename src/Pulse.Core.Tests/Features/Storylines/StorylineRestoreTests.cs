namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Engine-runtime story 07 (engine state survives a restart), slice S1: <see cref="Storyline.ToSnapshot"/> /
/// <see cref="Storyline.Restore"/> — the storyline arc (inventory row 9) round-trips exactly onto a storyline rebuilt
/// with <see cref="Storyline.Create"/> and the persisted id, and an out-of-range or foreign snapshot is rejected with
/// nothing applied (the rehydrator then fails closed, Q7). Docker-free.
/// </summary>
public sealed class StorylineRestoreTests
{
    private static Storyline Fresh(Guid exerciseId, Guid id) =>
        Storyline.Create(exerciseId, "Water main fears", "County issues an advisory", responseWindowMin: 10, id: id);

    private static Storyline Advanced()
    {
        var storyline = Storyline.Create(
            Guid.NewGuid(), "Water main fears", "County issues an advisory", responseWindowMin: 10, initialIntensity: 30);
        storyline.Seed(2);
        storyline.Tick(new FakeScenarioClock(15));
        storyline.SetTargetIntensity(70, 15);
        storyline.RecordEngineReaction(16);
        storyline.AssignCurve("Flash panic", 17);
        storyline.Tick(new FakeScenarioClock(21));
        return storyline;
    }

    [Fact]
    public void ToSnapshot_ThenRestoreOntoAFreshStoryline_RoundTripsToAnEqualSnapshot()
    {
        var live = Advanced();
        var snapshot = live.ToSnapshot();
        snapshot.Phase.Should().NotBe(StorylinePhase.Dormant, "the fixture must have advanced the arc");

        var restored = Fresh(live.ExerciseId, live.Id);
        restored.Restore(snapshot);

        restored.ToSnapshot().Should().Be(snapshot, "the arc resumes where it was, not from Dormant at minute 0");
        restored.Phase.Should().Be(live.Phase);
        restored.Intensity.Should().Be(live.Intensity);
        restored.Sentiment.Should().Be(live.Sentiment);
        restored.TargetIntensity.Should().Be(70);
        restored.LastEngineReactionScenarioMinute.Should().Be(16);
        restored.CurveName.Should().Be("Flash panic");
    }

    [Fact]
    public void Restore_ThenTick_ContinuesFromTheRestoredBaseline()
    {
        var live = Advanced();
        var restored = Fresh(live.ExerciseId, live.Id);
        restored.Restore(live.ToSnapshot());

        var clock = new FakeScenarioClock(25);
        var fromLive = live.Tick(clock);
        var fromRestored = restored.Tick(clock);

        fromRestored.ElapsedScenarioMinutes.Should().Be(fromLive.ElapsedScenarioMinutes);
        restored.ToSnapshot().Should().Be(live.ToSnapshot(), "a restored storyline ticks identically to the original");
    }

    [Fact]
    public void Restore_AcceptsANegativeLastTick_AndNullOptionals()
    {
        var exercise = Guid.NewGuid();
        var id = Guid.NewGuid();
        var snapshot = new StorylineRuntimeSnapshot(
            exercise, id, StorylinePhase.Dormant, 0, 0.0, null, 0, 0, -5, null, "Standard");

        var restored = Fresh(exercise, id);
        restored.Restore(snapshot);

        restored.ToSnapshot().Should().Be(snapshot, "Tick stores a pre-StartEx negative minute, so it must restore");
    }

    private static IEnumerable<(string Reason, StorylineRuntimeSnapshot Snapshot)> InvalidSnapshots(Guid exercise, Guid id)
    {
        var valid = new StorylineRuntimeSnapshot(
            exercise, id, StorylinePhase.Escalating, 50, 0.1, 60, 5, 3, 8, 7, "Standard");

        yield return ("intensity below 0", valid with { Intensity = -1 });
        yield return ("intensity above 100", valid with { Intensity = 101 });
        yield return ("target above 100", valid with { TargetIntensity = 101 });
        yield return ("target below 0", valid with { TargetIntensity = -1 });
        yield return ("sentiment below -1", valid with { Sentiment = -1.01 });
        yield return ("sentiment above +1", valid with { Sentiment = 1.01 });
        yield return ("sentiment NaN", valid with { Sentiment = double.NaN });
        yield return ("negative silence", valid with { MinutesSinceLastOfficialResponse = -1 });
        yield return ("negative phase-entered", valid with { PhaseEnteredScenarioMinute = -1 });
        yield return ("negative last reaction", valid with { LastEngineReactionScenarioMinute = -1 });
        yield return ("undefined phase", valid with { Phase = (StorylinePhase)99 });
        yield return ("blank curve", valid with { CurveName = " " });
        yield return ("foreign exercise", valid with { ExerciseId = Guid.NewGuid() });
        yield return ("foreign storyline", valid with { StorylineId = Guid.NewGuid() });
    }

    [Fact]
    public void Restore_RejectsEveryInvalidSnapshot_WithAnArgumentException_AndAppliesNothing()
    {
        var exercise = Guid.NewGuid();
        var id = Guid.NewGuid();

        foreach (var (reason, snapshot) in InvalidSnapshots(exercise, id))
        {
            var storyline = Fresh(exercise, id);
            var before = storyline.ToSnapshot();

            var act = () => storyline.Restore(snapshot);

            act.Should().Throw<ArgumentException>($"a {reason} row must fail loudly so the rehydrator fails closed (Q7)");
            storyline.ToSnapshot().Should().Be(before, $"a rejected {reason} snapshot applies nothing");
        }
    }

    [Fact]
    public void Restore_RejectsNull()
    {
        var act = () => Fresh(Guid.NewGuid(), Guid.NewGuid()).Restore(null!);
        act.Should().Throw<ArgumentNullException>();
    }
}
