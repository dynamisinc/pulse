namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Xunit.Abstractions;

/// <summary>
/// End-to-end scenario walkthroughs for the storyline model — a living spec that reads as the arc a
/// controller/evaluator would watch, and mirrors the interactive <c>Pulse.Playground</c> harness. Prints
/// the timeline via <see cref="ITestOutputHelper"/> (run with <c>-l "console;verbosity=detailed"</c> to
/// see it) and asserts the load-bearing beats so the behavior can't silently regress.
/// </summary>
public class StorylineScenarioWalkthroughTests(ITestOutputHelper output)
{
    private readonly Guid _exercise = Guid.NewGuid();

    [Fact]
    public void Silence_Escalates_Amplifies_ThenAMatchedResponseResolvesIt()
    {
        var clock = new FakeScenarioClock();
        var storyline = Storyline.Create(
            _exercise,
            "Water main contamination fears",
            "County issues a boil-water advisory",
            curveName: "Standard",
            responseWindowMin: 15,
            initialIntensity: 30,
            hashtags: ["#WaterCrisis"]);

        storyline.Seed(0);
        Log(storyline, "seeded");

        // Silence past the window opens escalation.
        Tick(storyline, clock.Set(15), "window elapses");
        storyline.Phase.Should().Be(StorylinePhase.Escalating);

        // Amplification bends it up to the ceiling → PEAK.
        var amplified = new StorylineTickSignals { Amplification = new AmplificationSignal(0.9, 7) };
        Tick(storyline, clock.Set(20), "climbing");
        Tick(storyline, clock.Set(24), "amplified", amplified);
        storyline.Phase.Should().Be(StorylinePhase.Peak);
        storyline.Intensity.Should().Be(EscalationCurves.Standard.Ceiling);

        // The generation-facing brief reflects the hot, unaddressed state.
        var brief = storyline.ToBrief();
        brief.Phase.Should().Be("PEAK");
        brief.MinutesSinceLastOfficialResponse.Should().Be(24);
        brief.ToneMix.Anger.Should().BeGreaterThan(brief.ToneMix.Gratitude);
        output.WriteLine($"  brief → phase={brief.Phase} intensity={brief.Intensity} anger={brief.ToneMix.Anger:0.00}");

        // A matched official response addresses it and bends intensity down.
        var intensityAtPeak = storyline.Intensity;
        storyline.RecordMatchedResponse(32);
        Log(storyline, "matched response");
        storyline.Phase.Should().Be(StorylinePhase.Addressed);
        storyline.Intensity.Should().BeLessThan(intensityAtPeak);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0);

        // It decays to the floor and resolves.
        foreach (var minute in new[] { 40, 55, 80, 120 })
        {
            Tick(storyline, clock.Set(minute), "decaying");
        }

        storyline.Phase.Should().Be(StorylinePhase.Resolved);
        storyline.Intensity.Should().Be(EscalationCurves.Standard.Floor);
    }

    [Fact]
    public void ControllerDial_DrivesActualDownThenBackUp_TowardTheTarget()
    {
        var clock = new FakeScenarioClock();
        var storyline = Storyline.Create(
            _exercise, "Protest forming downtown", "EOC confirms road closures",
            curveName: "Standard", responseWindowMin: 0, initialIntensity: 74);
        storyline.Seed(0);
        storyline.DetectActivity(0); // seat it in Escalating at intensity 74
        Log(storyline, "escalating, hot");

        // Controller dials the target DOWN — the engine tapers and holds, never overshooting.
        storyline.SetTargetIntensity(40, 0);
        TargetFollow.Modulate(storyline).Direction.Should().Be(TargetFollowDirection.Lower);
        foreach (var minute in new[] { 5, 10, 20, 30 })
        {
            Tick(storyline, clock.Set(minute), "→ target 40");
        }

        storyline.Intensity.Should().Be(40);

        // Controller dials the target UP — the engine drives back up, the burst suggestion bounded by the cap.
        storyline.SetTargetIntensity(85, 30);
        var raise = TargetFollow.Modulate(storyline, RateGovernanceConfig.Default);
        raise.Direction.Should().Be(TargetFollowDirection.Raise);
        raise.SuggestedPostCount.Should().BeInRange(1, RateGovernanceConfig.Default.MaxEnginePostsPerMinute);
        output.WriteLine($"  dial up → intent={raise.Direction} gap={raise.Gap} suggestPosts={raise.SuggestedPostCount}");

        foreach (var minute in new[] { 35, 45, 55, 70 })
        {
            Tick(storyline, clock.Set(minute), "→ target 85");
        }

        storyline.Intensity.Should().Be(85);
    }

    private void Tick(Storyline s, FakeScenarioClock clock, string note, StorylineTickSignals? signals = null)
    {
        var result = s.Tick(clock, signals);
        var transitions = result.StateChanges.Any()
            ? " " + string.Join(",", result.StateChanges.Select(c => $"{c.From}->{c.To}"))
            : string.Empty;
        Log(s, note + transitions);
    }

    private void Log(Storyline s, string note) => output.WriteLine(
        $"  t={s.LastTickScenarioMinute,3}  {s.Phase,-11} I={s.Intensity,3} S={s.Sentiment,+5:0.0} " +
        $"silence={s.MinutesSinceLastOfficialResponse,3}m  {note}");
}
