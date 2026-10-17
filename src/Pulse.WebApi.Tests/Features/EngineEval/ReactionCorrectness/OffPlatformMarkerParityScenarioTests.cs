namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Xunit;

/// <summary>
/// SCENARIO - "the answer happened off-platform" (engine-eval-harness story 04, AC4; requirement CTL-026).
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> Real exercises answer the public on channels Pulse does not simulate: a
/// press conference, a phone call to the mayor's office, a door-knock. The controller records that with an
/// off-platform response marker against the storyline. The rule is parity: the marker must satisfy the
/// concern EXACTLY as an on-platform matched post does, because otherwise the world would berate a PIO who
/// did answer, just not on Pulse.
/// </para>
/// <para>
/// <b>Method.</b> Two identical exercises play the same 30 silent minutes. In one, a matching official post is
/// published on-platform (auto-confirm opted in, the way an on-platform match becomes a confirmed match). In
/// the other, the controller sets the off-platform marker. We then compare everything the world can show:
/// phase, silence clock, intensity, sentiment, the reaction burst, and what the provider was asked for. The
/// only permitted difference is the recorded cause (matched-response vs off-platform-marker), which exists so
/// the AAR can tell the two sources apart.
/// </para>
/// </remarks>
public sealed class OffPlatformMarkerParityScenarioTests
{
    private static async Task<(ReactionScenario Scenario, Storyline Storyline)> SilentAsync()
    {
        var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);
        await scenario.RunMinutesAsync(30);
        return (scenario, storyline);
    }

    [Fact]
    public async Task AnOffPlatformMarker_AddressesTheConcern_IdenticallyToAnOnPlatformMatch()
    {
        var (onPlatform, onStoryline) = await SilentAsync();
        var (offPlatform, offStoryline) = await SilentAsync();
        await using var _a = onPlatform;
        await using var _b = offPlatform;
        onPlatform.Registration.ResponseMatching.EnableAutoConfirm(); // how an on-platform post becomes a confirmed match

        onPlatform.OfficialPost(ScenarioScripts.AnsweringPost);
        offPlatform.OffPlatformMarker(offStoryline);
        onPlatform.Advance(1);
        offPlatform.Advance(1);
        await onPlatform.TickAsync();
        await offPlatform.TickAsync();

        var on = onPlatform.Timeline[^1].Storylines[onStoryline.Id];
        var off = offPlatform.Timeline[^1].Storylines[offStoryline.Id];
        off.Phase.Should().Be(StorylinePhase.Addressed);
        off.Should().BeEquivalentTo(on, "the storyline ends in exactly the same state either way");

        var onReaction = (await onPlatform.DecidedAsync()).Last();
        var offReaction = (await offPlatform.DecidedAsync()).Last();
        offReaction.DominantTone.Should().Be(onReaction.DominantTone);
        offReaction.Count.Should().Be(onReaction.Count, "the marker draws the same reaction burst");

        var onMix = ScenarioScripts.PromptMix(onPlatform.Provider.Requests[^1]);
        var offMix = ScenarioScripts.PromptMix(offPlatform.Provider.Requests[^1]);
        offMix.Should().BeEquivalentTo(onMix, "the provider is asked for the same crowd");
        offPlatform.Provider.Requests[^1].SystemPrompt.Should().Contain("Officials have just responded");
    }

    [Fact]
    public async Task AnOffPlatformMarker_IsAConfirmedMatch_EvenWithoutAutoConfirm()
    {
        var (scenario, storyline) = await SilentAsync();
        await using var _ = scenario;
        scenario.Registration.ResponseMatching.AutoConfirmEnabled.Should().BeFalse("precondition: the engine has not been trusted to auto-confirm");

        scenario.OffPlatformMarker(storyline);
        scenario.Advance(1);
        await scenario.TickAsync();

        storyline.Phase.Should().Be(StorylinePhase.Addressed, "a controller-set marker IS the confirmation; no second Y/N is needed");
        storyline.MinutesSinceLastOfficialResponse.Should().Be(0);
    }

    [Fact]
    public async Task TheOnlyDifferenceBetweenTheTwoSources_IsTheRecordedCause()
    {
        var (onPlatform, onStoryline) = await SilentAsync();
        var (offPlatform, offStoryline) = await SilentAsync();
        await using var _a = onPlatform;
        await using var _b = offPlatform;
        onPlatform.Registration.ResponseMatching.EnableAutoConfirm();

        onPlatform.OfficialPost(ScenarioScripts.AnsweringPost);
        offPlatform.OffPlatformMarker(offStoryline);
        onPlatform.Advance(1);
        offPlatform.Advance(1);
        await onPlatform.TickAsync();
        await offPlatform.TickAsync();

        (await onPlatform.PhaseChangesAsync()).Single(c => c.ToPhase == nameof(StorylinePhase.Addressed))
            .Cause.Should().Be("matched-response");
        (await offPlatform.PhaseChangesAsync()).Single(c => c.ToPhase == nameof(StorylinePhase.Addressed))
            .Cause.Should().Be("off-platform-marker", "the AAR can still tell where the answer came from");
        onStoryline.Phase.Should().Be(offStoryline.Phase);
    }

    [Fact]
    public async Task AfterAMarker_TheConcernDecaysAndStopsEscalating_JustAsAfterAnOnPlatformAnswer()
    {
        var (scenario, storyline) = await SilentAsync();
        await using var _ = scenario;
        var itemsBefore = (await scenario.ReviewItemsAsync()).Count;

        scenario.OffPlatformMarker(storyline);
        scenario.Advance(1);
        await scenario.TickAsync();
        var itemsAtMarker = (await scenario.ReviewItemsAsync()).Count;
        await scenario.RunMinutesAsync(15);

        itemsAtMarker.Should().Be(itemsBefore + 1, "one reaction burst for the marker");
        (await scenario.ReviewItemsAsync()).Should().HaveCount(itemsAtMarker, "and no escalation bursts afterwards");
        scenario.Timeline.Skip(31).Select(t => t.Storylines[storyline.Id].Intensity).Should().BeInDescendingOrder();
    }
}
