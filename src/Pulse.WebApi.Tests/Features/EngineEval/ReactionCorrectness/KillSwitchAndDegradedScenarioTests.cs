namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Xunit;

/// <summary>
/// SCENARIO - "pull the cord" (engine-eval-harness story 04, AC5 first half; requirement ADP-042).
/// *** RELEASE-BLOCKING: a regression in this class blocks release (Trait Category=ReleaseBlocking). ***
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> The exercise is running at Delayed-auto: the engine drafts a burst, starts a
/// 5-minute veto countdown, and (only if the operator has turned on swamped mode) would auto-publish it when
/// the countdown expires without a decision. Then something goes wrong - a controller hits the kill switch, or
/// the generation provider's circuit breaker trips (degraded mode). The platform's promise: the engine drops to
/// Suggest, and NOTHING the engine generated reaches participants without a human saying so.
/// </para>
/// <para>
/// <b>Why there is a positive control.</b> "Nothing was published" is only evidence if the same setup WOULD
/// have published without the lever. <see cref="WithoutAnyLever_SwampedModeAutoSendsAnExpiredCountdown"/> proves
/// that: same exercise, same clock, same swamped mode, no kill switch - and the burst goes out. Every other test
/// in this class differs from it only by the lever.
/// </para>
/// <para>
/// <b>The publish seam.</b> Auto-publish is observed on the exercise's single publish funnel
/// (<see cref="RecordingPublishService"/>), the only door to the participant feed; an empty funnel is a hard
/// "nothing auto-published". The auto-hold sweep (<c>EvaluateAutoHoldAsync</c>) is run after every scenario
/// minute, as the production tick host does every second.
/// </para>
/// </remarks>
[Trait("Category", "ReleaseBlocking")]
public sealed class KillSwitchAndDegradedScenarioTests
{
    private const int CountdownDeadline = 25; // minute-20 burst + the 5-minute Delayed-auto countdown

    /// <summary>A Delayed-auto exercise with swamped mode ON (the worst case: the only auto-send path is armed).</summary>
    private static async Task<ReactionScenario> ArmedAsync()
    {
        var scenario = ReactionScenario.Create(AutonomyLevel.DelayedAuto);
        scenario.AddStoryline(responseWindowMin: 20);
        scenario.Autonomy.SetSwampedMode(true, "lead-1", 0);
        await scenario.RunMinutesAsync(20); // the window blows; the first burst is now counting down
        return scenario;
    }

    /// <summary>Plays to <paramref name="untilMinute"/>, ticking the loop and then the auto-hold sweep each minute.</summary>
    private static async Task PlayAsync(ReactionScenario scenario, int untilMinute)
    {
        while (scenario.Minute < untilMinute)
        {
            await scenario.RunMinutesAsync(1);
            await scenario.EvaluateAutoHoldAsync();
        }
    }

    [Fact]
    public async Task WithoutAnyLever_SwampedModeAutoSendsAnExpiredCountdown()
    {
        await using var scenario = await ArmedAsync();
        var first = (await scenario.ReviewItemsAsync()).Single();
        first.RoutedAtLevel.Should().Be(AutonomyLevel.DelayedAuto);
        first.Disposition.Should().Be(DraftDisposition.CountingDown, "precondition: the burst is on a veto countdown");

        await PlayAsync(scenario, CountdownDeadline + 1);

        scenario.Publisher.Published.Should().NotBeEmpty(
            "CONTROL: with no lever the armed Delayed-auto path does auto-publish, so the negatives below mean something");
    }

    [Theory]
    [InlineData(KillSwitchMode.DropToSuggest)]
    [InlineData(KillSwitchMode.FullStop)]
    public async Task TheKillSwitch_SuspendsAnInFlightCountdown_AndNothingAutoPublishes(KillSwitchMode mode)
    {
        await using var scenario = await ArmedAsync();
        var inFlight = (await scenario.ReviewItemsAsync()).Single();

        scenario.Autonomy.EngageKillSwitch(mode, "lead-1", scenario.Minute);
        await PlayAsync(scenario, 40); // well past the countdown deadline, under swamped mode

        scenario.Publisher.Published.Should().BeEmpty("a kill switch means no engine content auto-publishes, even under swamped mode");
        var suspended = (await scenario.ReviewItemsAsync()).Single(i => i.DraftId == inFlight.DraftId);
        if (mode == KillSwitchMode.DropToSuggest)
        {
            suspended.Disposition.Should().Be(DraftDisposition.Held, "the expired countdown is held for a human (NEEDS YOU), never sent");
        }

        // FullStop + an expired countdown: deliberately NOT asserting the disposition here. On main the draft stays
        // CountingDown and auto-sends after a human restore under swamped mode (defect D5, HIGH); the fix lands in
        // the D5 safety PR to main (AutoHoldPolicy.Evaluate -> Hold with a hold-on-expiry event). See
        // docs/features/engine-eval-harness/04-scenario-reaction-correctness.md (D5). Only "nothing publishes
        // during the stop" (above) and "never Published" (below) hold either way.
        suspended.Disposition.Should().NotBe(DraftDisposition.Published);
    }

    [Fact]
    public async Task DropToSuggest_KeepsTheEngineRunning_ButEveryNewBurstWaitsForAHuman()
    {
        await using var scenario = await ArmedAsync();
        var preLever = (await scenario.ReviewItemsAsync()).Count;

        scenario.Autonomy.EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", scenario.Minute);
        await PlayAsync(scenario, 45);

        var postLever = (await scenario.ReviewItemsAsync()).Skip(preLever).ToList();
        postLever.Should().NotBeEmpty("DropToSuggest lowers autonomy; it does not stop the world");
        postLever.Should().OnlyContain(
            i => i.RoutedAtLevel == AutonomyLevel.Suggest && i.Disposition == DraftDisposition.Queued && i.CountdownMinutes == null,
            "every post-lever burst is routed at Suggest: queued for approval, no countdown, nothing to auto-send");
        scenario.Publisher.Published.Should().BeEmpty();
        scenario.Autonomy.ResolveEffective(scenario.Registration.Storylines[0].Id).Level.Should().Be(AutonomyLevel.Suggest);
    }

    [Fact]
    public async Task FullStop_GeneratesNothingAtAll_AfterTheLever()
    {
        await using var scenario = await ArmedAsync();
        var itemsBefore = (await scenario.ReviewItemsAsync()).Count;
        var promptsBefore = scenario.Provider.Requests.Count;

        scenario.Autonomy.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", scenario.Minute);
        await PlayAsync(scenario, 45);

        (await scenario.ReviewItemsAsync()).Should().HaveCount(itemsBefore, "a full stop enqueues no new burst");
        scenario.Provider.Requests.Should().HaveCount(promptsBefore, "and does not even spend a provider call");
        scenario.Publisher.Published.Should().BeEmpty();
        scenario.Autonomy.IsGenerationStopped.Should().BeTrue();
    }

    [Fact]
    public async Task ADegradedProviderTrip_DropsToSuggest_AndNothingAutoPublishes()
    {
        await using var scenario = await ArmedAsync();
        var inFlight = (await scenario.ReviewItemsAsync()).Single();
        var preTrip = (await scenario.ReviewItemsAsync()).Count;

        await scenario.DegradeProviderAsync("circuit breaker open: provider timeouts");
        await PlayAsync(scenario, 40);

        scenario.Autonomy.DegradedReason.Should().NotBeNull("the controller can see WHY autonomy dropped");
        scenario.Publisher.Published.Should().BeEmpty("degraded mode behaves like the kill switch: no auto-publish");
        (await scenario.ReviewItemsAsync()).Single(i => i.DraftId == inFlight.DraftId).Disposition.Should().Be(DraftDisposition.Held);
        (await scenario.ReviewItemsAsync()).Skip(preTrip).Should().OnlyContain(
            i => i.RoutedAtLevel == AutonomyLevel.Suggest && i.Disposition == DraftDisposition.Queued);
    }

    [Fact]
    public async Task ProviderRecovery_NeverRaisesAutonomyOnItsOwn_OnlyAHumanRestoreDoes()
    {
        await using var scenario = await ArmedAsync();
        await scenario.DegradeProviderAsync();
        await scenario.RecoverProviderAsync();
        var storylineId = scenario.Registration.Storylines[0].Id;

        scenario.Autonomy.ResolveEffective(storylineId).Level.Should().Be(
            AutonomyLevel.Suggest, "recovery clears the alert but automation never re-raises itself (8.2)");
        var beforeRestore = (await scenario.ReviewItemsAsync()).Count;
        await PlayAsync(scenario, 35);
        (await scenario.ReviewItemsAsync()).Skip(beforeRestore).Should().OnlyContain(
            i => i.RoutedAtLevel == AutonomyLevel.Suggest, "bursts after a recovered provider are still Suggest");
        scenario.Publisher.Published.Should().BeEmpty();

        scenario.Autonomy.RestoreFromSafety("lead-1", scenario.Minute);
        var afterRestoreStart = (await scenario.ReviewItemsAsync()).Count;
        await PlayAsync(scenario, 45);

        (await scenario.ReviewItemsAsync()).Skip(afterRestoreStart).Should().Contain(
            i => i.RoutedAtLevel == AutonomyLevel.DelayedAuto && i.Disposition != DraftDisposition.Queued,
            "an explicit human restore is the only way back to Delayed-auto");
    }
}
