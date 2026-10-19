namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;
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

    // Post-restore minutes the D5 scenario plays: fewer than a new burst's 5-minute countdown, so a new post-restore
    // burst cannot expire (and legitimately auto-send) inside the window being asserted on.
    private const int DelayedAutoCountdownGuard = ReactionLoopDriver.DefaultDelayedAutoCountdownMinutes - 2;

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

        // Either lever holds the expired countdown for a human. For FullStop this is the D5 fix (#620): an expiry
        // during a full stop used to be left CountingDown (see FullStop_ExpiryThenRestore_UnderSwampedMode_...).
        suspended.Disposition.Should().Be(DraftDisposition.Held, "the expired countdown is held for a human (NEEDS YOU), never sent");
    }

    /// <summary>
    /// D5 (HIGH, fixed on main by #620): a pre-stop countdown that expires DURING a FullStop must be held at expiry,
    /// so a later human restore - with swamped mode still on and the auto-send path re-armed (the harness authorises
    /// <c>TimeoutAutoSendAuthorized</c>) - cannot send the stale burst on the first sweep after the restore.
    /// </summary>
    [Fact]
    public async Task FullStop_ExpiryThenRestore_UnderSwampedMode_NothingAutoPublishes_AndTheItemStaysHeld()
    {
        await using var scenario = await ArmedAsync();
        var inFlight = (await scenario.ReviewItemsAsync()).Single();
        inFlight.Disposition.Should().Be(DraftDisposition.CountingDown, "precondition: the burst is on a veto countdown");

        scenario.Autonomy.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", scenario.Minute);
        await PlayAsync(scenario, CountdownDeadline + 2); // the countdown expires while the engine is fully stopped

        (await scenario.ReviewItemsAsync()).Single(i => i.DraftId == inFlight.DraftId).Disposition.Should().Be(
            DraftDisposition.Held, "an expiry during a full stop is held at expiry, not left counting down");

        scenario.Autonomy.RestoreFromSafety("lead-1", scenario.Minute);
        scenario.Autonomy.IsGenerationStopped.Should().BeFalse("precondition: the restore actually lifted the full stop");
        scenario.Autonomy.SwampedModeEnabled.Should().BeTrue("precondition: swamped mode survives the restore, so auto-send is re-armed");

        // A few post-restore minutes with the sweep running every minute - short of a NEW burst's own 5-minute countdown,
        // so any publish here could only be the stale pre-stop burst.
        await PlayAsync(scenario, scenario.Minute + DelayedAutoCountdownGuard);

        scenario.Publisher.Published.Should().BeEmpty(
            "a draft held during the full stop must never auto-send after the restore, even under swamped mode");
        (await scenario.ReviewItemsAsync()).Single(i => i.DraftId == inFlight.DraftId).Disposition.Should().Be(
            DraftDisposition.Held, "the held item stays held for a human after the restore");
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
