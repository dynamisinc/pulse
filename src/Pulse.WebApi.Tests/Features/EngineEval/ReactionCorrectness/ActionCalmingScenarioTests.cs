namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;
using Xunit;

/// <summary>
/// SCENARIO - "the PIO answers" (engine-eval-harness story 04, AC2; requirement ADP-002).
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> The same unanswered water-main concern escalates for 30 scenario minutes. Then
/// an official post lands that genuinely addresses it (it carries the storyline's #WaterIssues tag). The
/// operator has opted in to auto-confirm of response matches (the engine never turns this on by itself), so the
/// match is confirmed immediately. We assert the world calms: the concern is marked addressed, its silence clock
/// resets, intensity bends DOWN, sentiment bends UP, and the crowd answers with a gratitude-led reaction burst
/// instead of yet another round of worry. After that, the concern decays and the engine stops escalating it.
/// </para>
/// <para>
/// This is the mirror image of <see cref="InactionEscalationScenarioTests"/>: same storyline, same clock, same
/// provider. The only thing that changes is that officials acted.
/// </para>
/// </remarks>
public sealed class ActionCalmingScenarioTests
{
    private static async Task<(ReactionScenario Scenario, Storyline Storyline, StorylineSnapshot Before)> EscalatedAsync(int minutes = 30)
    {
        var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);
        scenario.Registration.ResponseMatching.EnableAutoConfirm(); // the operator's explicit opt-in
        await scenario.RunMinutesAsync(minutes);
        return (scenario, storyline, scenario.Timeline[^1].Storylines[storyline.Id]);
    }

    [Fact]
    public async Task AMatchedOfficialResponse_BendsIntensityDown_AndSentimentUp_AndMarksTheConcernAddressed()
    {
        var (scenario, storyline, before) = await EscalatedAsync();
        await using var _ = scenario;
        before.Phase.Should().Be(StorylinePhase.Escalating, "precondition: the concern was escalating");
        before.Intensity.Should().BeGreaterThan(10, "precondition: there is pressure to relieve");

        scenario.OfficialPost(ScenarioScripts.AnsweringPost);
        scenario.Advance(1);
        await scenario.TickAsync();

        var after = scenario.Timeline[^1].Storylines[storyline.Id];
        after.Phase.Should().Be(StorylinePhase.Addressed, "a confirmed match addresses the concern");
        after.MinutesSilent.Should().Be(0, "the response resets the silence clock");
        after.Intensity.Should().BeLessThan(before.Intensity, "an answer bends intensity DOWN (not merely holds it)");
        after.Sentiment.Should().BeGreaterThan(before.Sentiment, "an answer bends sentiment UP (less negative)");

        (await scenario.PhaseChangesAsync()).Should().Contain(
            c => c.StorylineId == storyline.Id && c.ToPhase == nameof(StorylinePhase.Addressed) && c.Cause == "matched-response");
    }

    [Fact]
    public async Task AMatchedOfficialResponse_DrawsAGratitudeLedReactionBurst_NotAnotherRoundOfWorry()
    {
        var (scenario, _, _) = await EscalatedAsync();
        await using var _ = scenario;
        var itemsBefore = (await scenario.ReviewItemsAsync()).Count;
        var decidedBefore = (await scenario.DecidedAsync()).Count;

        scenario.OfficialPost(ScenarioScripts.AnsweringPost);
        scenario.Advance(1);
        var tick = await scenario.TickAsync();

        tick.ReviewItemsEnqueued.Should().Be(1, "exactly one burst for the answer: the reaction, NOT an escalation burst on top of it");
        (await scenario.ReviewItemsAsync()).Should().HaveCount(itemsBefore + 1);

        var reaction = (await scenario.DecidedAsync()).Skip(decidedBefore).Should().ContainSingle().Subject;
        reaction.DominantTone.Should().StartWith("gratitude", "the response reaction leans to gratitude + calm with one skeptic");
        reaction.Count.Should().Be(3, "a reaction is a burst of several voices so the mix has room to show");

        var prompt = scenario.Provider.Requests[^1].SystemPrompt;
        prompt.Should().Contain("Officials have just responded", "the provider is told the official answered");
        prompt.Should().NotContain("Officials have been silent for");
        var mix = ScenarioScripts.PromptMix(scenario.Provider.Requests[^1]);
        mix.OrderByDescending(kv => kv.Value).First().Key.Should().Be(
            "gratitude", "the provider is asked for a gratitude-led crowd, not a worried one");
        mix["gratitude"].Should().BeGreaterThan(mix.GetValueOrDefault("worry"));
        mix["gratitude"].Should().BeGreaterThan(mix.GetValueOrDefault("anger"));

        // D3: the provider is asked for the DECIDED response-reaction mix (ResponseReactionBehavior.DefaultMix:
        // gratitude 0.5 / calm 0.3 / skepticism 0.15 / worry 0.05), not the Addressed phase projection
        // (which rendered as gratitude 0.4 / calm 0.2 before the fix).
        mix.Should().BeEquivalentTo(
            ExpectedPromptMix(ResponseReactionBehavior.DefaultMix),
            "the decided intent's tone mix, not the storyline's phase mix, reaches the provider prompt");
    }

    /// <summary>The tone mix exactly as the prompt assembler renders it (one decimal, ~0 tones omitted).</summary>
    private static System.Collections.Generic.Dictionary<string, double> ExpectedPromptMix(ToneMix mix) =>
        new (string Name, double Value)[]
        {
            ("worry", mix.Worry), ("anger", mix.Anger), ("speculation", mix.Speculation),
            ("gratitude", mix.Gratitude), ("skepticism", mix.Skepticism), ("calm", mix.Calm),
        }
        .Where(t => t.Value > 0.001)
        .ToDictionary(t => t.Name, t => System.Math.Round(t.Value, 1, System.MidpointRounding.AwayFromZero));

    [Fact]
    public async Task AfterTheResponse_TheConcernDecaysAndTheEngineStopsEscalatingIt()
    {
        var (scenario, storyline, before) = await EscalatedAsync();
        await using var _ = scenario;

        scenario.OfficialPost(ScenarioScripts.AnsweringPost);
        scenario.Advance(1);
        await scenario.TickAsync();
        var answeredAt = scenario.Timeline[^1].Minute;
        var itemsAtAnswer = (await scenario.ReviewItemsAsync()).Count;

        await scenario.RunMinutesAsync(15);

        var afterwards = scenario.Timeline.Where(t => t.Minute > answeredAt).Select(t => t.Storylines[storyline.Id]).ToList();
        afterwards.Should().OnlyContain(s => s.Phase != StorylinePhase.Escalating && s.Phase != StorylinePhase.Peak);
        afterwards.Select(s => s.Intensity).Should().BeInDescendingOrder("the answered concern keeps decaying");
        afterwards[^1].Intensity.Should().BeLessThan(before.Intensity / 2, "15 minutes after an answer the pressure is far below where it was");
        (await scenario.ReviewItemsAsync()).Should().HaveCount(
            itemsAtAnswer, "no further escalation bursts are demanded once the concern is answered");
    }

    [Fact]
    public async Task APlausibleButUnconfirmedAnswer_DoesNotCalmTheWorld()
    {
        // Auto-confirm stays OFF (the default): the engine only SUGGESTS a match; it never grades its own homework.
        await using var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);
        await scenario.RunMinutesAsync(30);
        var before = scenario.Timeline[^1].Storylines[storyline.Id];

        scenario.OfficialPost(ScenarioScripts.AnsweringPost);
        scenario.Advance(1);
        await scenario.TickAsync();

        var after = scenario.Timeline[^1].Storylines[storyline.Id];
        after.Phase.Should().Be(StorylinePhase.Escalating, "an unconfirmed suggestion never addresses a concern");
        after.MinutesSilent.Should().Be(before.MinutesSilent + 1, "and never resets its silence clock");
        after.Intensity.Should().BeGreaterThan(before.Intensity, "so the pressure keeps climbing until a human confirms");
    }
}
