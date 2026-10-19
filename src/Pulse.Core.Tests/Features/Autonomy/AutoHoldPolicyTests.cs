namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;

public class AutoHoldPolicyTests
{
    private static readonly EffectiveAutonomy Delayed = EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto);
    private static readonly EffectiveAutonomy Suggest = EffectiveAutonomy.Running(AutonomyLevel.Suggest);

    // Countdown started at scenario-minute 100, 5-minute window → deadline at 105.
    private static DelayedAutoCountdown Countdown(ControllerDecision decision = ControllerDecision.None) =>
        new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), startedScenarioMinute: 100, countdownMinutes: 5, decision);

    [Fact]
    public void BeforeExpiry_WithNoDecision_AwaitsDecision()
    {
        // Scenario time frozen at 103 (< deadline 105): the countdown holds; nothing is decided.
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 103, swampedMode: false)
            .Should().Be(TimeoutDisposition.AwaitDecision);
    }

    [Fact]
    public void OnExpiry_WithNoDecision_AutoHolds_SilenceIsNeverApproval()
    {
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 105, swampedMode: false)
            .Should().Be(TimeoutDisposition.Hold);
    }

    [Fact]
    public void OnExpiry_AfterATimeJump_StillHolds_NeverSilentlyAutoSends()
    {
        // A time-jump (CTL-015) carries the current minute far past the deadline — the miss must HOLD.
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 130, swampedMode: false)
            .Should().Be(TimeoutDisposition.Hold);
    }

    [Fact]
    public void OnExpiry_UnderSwampedMode_IsTheOnlyAutoSendPath()
    {
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 105, swampedMode: true)
            .Should().Be(TimeoutDisposition.Publish);
    }

    [Fact]
    public void OnExpiry_SwampedButEffectiveLevelSuspended_Holds()
    {
        // Kill switch / degraded mode dropped the effective level to Suggest: in-flight countdowns are
        // suspended, so even with swamped mode on the draft holds, never auto-sends.
        AutoHoldPolicy.Decide(Countdown(), Suggest, currentScenarioMinute: 105, swampedMode: true)
            .Should().Be(TimeoutDisposition.Hold);
    }

    [Fact]
    public void FullStop_HoldsEverything_EvenAStandingApproval()
    {
        AutoHoldPolicy.Decide(Countdown(ControllerDecision.Approved), EffectiveAutonomy.Stopped, 130, swampedMode: true)
            .Should().Be(TimeoutDisposition.Hold);
    }

    [Fact]
    public void Evaluate_FullStop_BeforeExpiry_KeepsCounting_LogsNoTransition()
    {
        var result = AutoHoldPolicy.Evaluate(Countdown(), EffectiveAutonomy.Stopped, currentScenarioMinute: 103, swampedMode: true);

        result.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.Event.Should().BeNull("a countdown still inside its window under a full stop is not resolved yet");
    }

    [Fact]
    public void Evaluate_FullStop_OnExpiry_LogsAHoldTransition_NotViaSwamped()
    {
        var countdown = Countdown();

        var result = AutoHoldPolicy.Evaluate(countdown, EffectiveAutonomy.Stopped, currentScenarioMinute: 108, swampedMode: true);

        result.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.ViaSwampedMode.Should().BeFalse();
        result.Event.Should().NotBeNull(
            "an expiry during a full stop is the ordinary hold-on-expiry — never left counting down to auto-send after a restore");
        result.Event!.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.Event.ViaSwampedMode.Should().BeFalse();
        result.Event.ScenarioMinute.Should().Be(108);
    }

    [Fact]
    public void Evaluate_FullStop_WithAStandingApproval_LogsNoTimeoutTransition()
    {
        AutoHoldPolicy.Evaluate(Countdown(ControllerDecision.Approved), EffectiveAutonomy.Stopped, 108, swampedMode: true)
            .Event.Should().BeNull("a human decision is never a timeout transition, even under a full stop");
    }

    [Theory]
    [InlineData(ControllerDecision.Approved, TimeoutDisposition.Publish)]
    [InlineData(ControllerDecision.Vetoed, TimeoutDisposition.Hold)]
    public void ExplicitControllerDecision_IsHonoured(ControllerDecision decision, TimeoutDisposition expected) =>
        AutoHoldPolicy.Decide(Countdown(decision), Delayed, currentScenarioMinute: 130, swampedMode: false)
            .Should().Be(expected);

    // ---- Evaluate: the on-expiry transition is the one logged here (XC-004) ----------------------

    [Fact]
    public void Evaluate_OnAutoHold_ReturnsTheHoldTransitionToLog()
    {
        var countdown = Countdown();

        var result = AutoHoldPolicy.Evaluate(countdown, Delayed, currentScenarioMinute: 108, swampedMode: false);

        result.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.ViaSwampedMode.Should().BeFalse();
        result.Event.Should().NotBeNull();
        result.Event!.Should().BeEquivalentTo(new
        {
            countdown.ExerciseId,
            countdown.StorylineId,
            countdown.DraftId,
            Disposition = TimeoutDisposition.Hold,
            ViaSwampedMode = false,
            ScenarioMinute = 108,
        });
    }

    [Fact]
    public void Evaluate_OnSwampedAutoSend_LogsAnAutoSendTransition()
    {
        var result = AutoHoldPolicy.Evaluate(Countdown(), Delayed, currentScenarioMinute: 108, swampedMode: true);

        result.Disposition.Should().Be(TimeoutDisposition.Publish);
        result.ViaSwampedMode.Should().BeTrue();
        result.Event!.Disposition.Should().Be(TimeoutDisposition.Publish);
        result.Event.ViaSwampedMode.Should().BeTrue();
    }

    [Fact]
    public void Evaluate_WhileAwaiting_OrOnAHumanDecision_LogsNoTimeoutTransition()
    {
        AutoHoldPolicy.Evaluate(Countdown(), Delayed, currentScenarioMinute: 103, swampedMode: false)
            .Event.Should().BeNull("the countdown is still running");

        AutoHoldPolicy.Evaluate(Countdown(ControllerDecision.Approved), Delayed, 108, false)
            .Event.Should().BeNull("a human approve/veto is logged on the review-action path, not the timeout path");
    }

    // ---- Hold-on-cut: an active provider cut to Fake clamps the auto path (ADP-042) ---------------

    [Fact]
    public void OnExpiry_UnderSwampedMode_WhileCutToFake_Holds()
    {
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 105, swampedMode: true, providerCutToFake: true)
            .Should().Be(TimeoutDisposition.Hold, "a pre-cut live draft must never auto-send after the exercise is cut to Fake");
    }

    [Fact]
    public void ApprovedDraft_WhileCutToFake_StillPublishes()
    {
        AutoHoldPolicy.Decide(
                Countdown(ControllerDecision.Approved), Delayed, currentScenarioMinute: 130, swampedMode: true, providerCutToFake: true)
            .Should().Be(TimeoutDisposition.Publish, "an explicit approval is a manual publish — the cut suspends only the auto path");
    }

    [Fact]
    public void BeforeExpiry_WhileCutToFake_StillAwaitsDecision()
    {
        AutoHoldPolicy.Decide(Countdown(), Delayed, currentScenarioMinute: 103, swampedMode: true, providerCutToFake: true)
            .Should().Be(TimeoutDisposition.AwaitDecision, "the cut does not resolve a still-running countdown early");
    }

    [Fact]
    public void Evaluate_OnExpiryWhileCutToFake_LogsAHoldTransition_NotViaSwamped()
    {
        var countdown = Countdown();

        var result = AutoHoldPolicy.Evaluate(countdown, Delayed, currentScenarioMinute: 108, swampedMode: true, providerCutToFake: true);

        result.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.ViaSwampedMode.Should().BeFalse();
        result.Event.Should().NotBeNull("a hold-on-cut is the ordinary hold-on-expiry transition to log");
        result.Event!.Disposition.Should().Be(TimeoutDisposition.Hold);
        result.Event.ViaSwampedMode.Should().BeFalse();
    }
}
