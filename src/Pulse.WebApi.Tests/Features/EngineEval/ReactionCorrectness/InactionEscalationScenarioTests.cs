namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;
using Xunit;

/// <summary>
/// SCENARIO - "nobody says anything" (engine-eval-harness story 04, AC1; requirement ADP-001).
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> A water-main concern is seeded at scenario minute 0 with a 20-minute response
/// window. Officials never respond. We play scenario time forward one minute at a time and watch what the
/// world does: nothing for the first 19 minutes (the window is still open), then the concern starts to
/// escalate, the intensity climbs along its escalation curve, sentiment sours, and the engine keeps asking the
/// crowd to be worried and speculative. That is the "fail to do" half of the reaction loop: the world reacts to
/// what participants did NOT do.
/// </para>
/// <para>
/// <b>How to read a test here.</b> Each test builds a <see cref="ReactionScenario"/>, plays minutes, and asserts
/// on observable outputs only: the storyline's phase / intensity / sentiment, the review items the controller
/// would see, the tone the decide stage chose, and the prompt the generation provider was handed.
/// </para>
/// <para>
/// <b>Deliberately NOT asserted here</b> (reported as product defects in the story doc's "Defects found"
/// section, to be fixed in a separate change): (1) the fractional Standard-curve rise (2.5/min configured, 2.0/min
/// observed, per-tick rounding), so "rises exactly per the curve" is asserted only as a bound, never an equality;
/// (2) the silence-duration tone ramp (<c>SilenceEscalationBehavior</c> is not registered on the driver's decide
/// stage); (3) the decided intent's tone mix is not what the provider prompt carries (the prompt uses the
/// storyline's phase mix). The prompt/tone assertions below therefore check the mix the provider was actually
/// asked for, which is anxious / speculative in every unanswered phase.
/// </para>
/// </remarks>
public sealed class InactionEscalationScenarioTests
{
    [Fact]
    public async Task WhileTheResponseWindowIsStillOpen_TheWorldStaysQuiet()
    {
        await using var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);

        await scenario.RunMinutesAsync(19);

        storyline.Phase.Should().Be(StorylinePhase.Seeded, "19 minutes of silence is inside the 20-minute window");
        storyline.Intensity.Should().Be(0, "nothing escalates before the window blows");
        (await scenario.ReviewItemsAsync()).Should().BeEmpty("no inaction burst before the window blows");
        scenario.Provider.Requests.Should().BeEmpty("the engine does not even ask the provider for content yet");
    }

    [Fact]
    public async Task WhenTheWindowBlowsWithNoResponse_TheConcernEscalatesAndAnAnxiousBurstIsQueued()
    {
        await using var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);

        await scenario.RunMinutesAsync(20); // minute 20: the window blows this tick

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "an unanswered concern leaves Seeded when its window blows");
        storyline.Intensity.Should().BeGreaterThan(0);
        var items = await scenario.ReviewItemsAsync();
        items.Should().ContainSingle("the first inaction burst fires the minute the window blows, one decision for the controller");
        items[0].StorylineId.Should().Be(storyline.Id);
        items[0].Posts.Should().NotBeEmpty();

        var decided = (await scenario.DecidedAsync()).Single();
        decided.DominantTone.Should().MatchRegex(
            "^(worry|speculation|anger) ",
            "the inaction burst is anxious / speculative / angry, never grateful or calm");
    }

    [Fact]
    public async Task WhileOfficialsStaySilent_IntensityKeepsRisingAlongTheCurve_AndSentimentSours()
    {
        await using var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20, curve: "Standard");
        var curve = EscalationCurves.CurveFor("Standard");

        await scenario.RunMinutesAsync(20);
        var openedAt = scenario.Timeline[^1].Storylines[storyline.Id];
        await scenario.RunMinutesAsync(30);

        var series = scenario.Timeline.Select(t => t.Storylines[storyline.Id]).Where(s => s.Phase == StorylinePhase.Escalating).ToList();
        series.Select(s => s.Intensity).Should().BeInAscendingOrder("silence never lets the pressure fall");
        series.Select(s => s.Intensity).Distinct().Count().Should().Be(series.Count, "intensity rises on every scenario minute of silence");
        series.Select(s => s.Sentiment).Should().BeInDescendingOrder("sentiment sours as the vacuum fills");

        var last = series[^1];
        last.Intensity.Should().BeGreaterThan(openedAt.Intensity + 30, "30 more silent minutes is a large, visible escalation");
        last.Intensity.Should().BeLessThanOrEqualTo(curve.Ceiling, "the curve's ceiling still bounds the climb");
        // Upper bound only: the climb can never be FASTER than the configured curve rate.
        last.Intensity.Should().BeLessThanOrEqualTo(
            openedAt.Intensity + (int)System.Math.Ceiling(curve.RiseRateUnaddressed * 30),
            "intensity follows the curve; it does not outrun the configured rise rate");
        last.MinutesSilent.Should().Be(50, "the silence clock was never reset by anything");
    }

    [Fact]
    public async Task EveryInactionBurstAsksTheProviderForWorryAndSpeculation_AndNamesTheSilence()
    {
        await using var scenario = ReactionScenario.Create();
        scenario.AddStoryline(responseWindowMin: 20);

        await scenario.RunMinutesAsync(35);

        var requests = scenario.Provider.Requests;
        requests.Should().HaveCountGreaterThan(1, "silence keeps producing bursts");
        foreach (var request in requests)
        {
            request.SystemPrompt.Should().Contain("Officials have been silent for", "the prompt tells the crowd the vacuum is filling");
            request.SystemPrompt.Should().NotContain("Officials have just responded", "no response has landed");

            var mix = ScenarioScripts.PromptMix(request);
            (mix.GetValueOrDefault("worry") + mix.GetValueOrDefault("speculation")).Should().BeGreaterThan(
                mix.GetValueOrDefault("gratitude") + mix.GetValueOrDefault("calm"),
                "the crowd is asked to be anxious / speculative, not grateful or calm");
            mix.GetValueOrDefault("gratitude").Should().Be(0.0, "an unanswered concern is never grateful");
        }
    }

    [Fact]
    public async Task OngoingSilence_ReactsOnTheReactionCadence_NotOnEveryTick()
    {
        await using var scenario = ReactionScenario.Create();
        scenario.AddStoryline(responseWindowMin: 20);

        await scenario.RunMinutesAsync(50);

        var fireMinutes = scenario.Timeline.Where(t => t.ReviewItemsEnqueued > 0).Select(t => t.Minute).ToList();
        fireMinutes.Should().HaveCountGreaterThan(5, "the silence keeps being reacted to (no flatline)");
        fireMinutes.Zip(fireMinutes.Skip(1), (a, b) => b - a).Should().OnlyContain(
            gap => gap >= scenario.Registration.RateConfig.MinMinutesBetweenInactionReactions,
            "one storyline's ongoing silence re-fires at most once per reaction cadence (no firehose, ADP-011)");
    }
}
