namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;
using Xunit;

/// <summary>
/// SCENARIO - "anti-berate-the-PIO" (engine-eval-harness story 04, AC3; requirements ADP-002 / ADP-002a).
/// *** RELEASE-BLOCKING: a regression in this class blocks release (Trait Category=ReleaseBlocking). ***
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this is the most important scenario.</b> The failure mode that destroys evaluator trust is a world
/// that berates a PIO who has ALREADY answered (adversarial review D4 / A6). The engine can only SUGGEST which
/// concern an official post addresses; when it cannot be sure, it has to fail in the safe direction. The
/// "miss-safe" contract has four clauses, each asserted below against the live loop:
/// </para>
/// <list type="number">
///   <item>An official post the engine cannot match SLOWS escalation - fewer voices in the next burst - but
///   NEVER PAUSES it: the burst still happens, on its normal cadence, and intensity keeps climbing. (An
///   irrelevant post must not be able to game the engine into calming down.)</item>
///   <item>The controller is PROMPTED to say which concern, if any, the post addressed. At the resolver
///   level this is the Unmatched / NeedsConfirmation resolution, which is the signal the cockpit prompt
///   renders from; each such post costs one unit of controller demand
///   (<see cref="DemandAccounting.MatchPromptDemand"/>).</item>
///   <item>The concern is NEVER marked addressed by an unmatched post: no Addressed phase, no silence-clock
///   reset, no matched-response telemetry.</item>
///   <item>Auto-confirm being ON does not change any of that for a post that matches nothing.</item>
/// </list>
/// <para>
/// <b>Method.</b> Two identical fixture exercises are played side by side, minute for minute. The "control"
/// exercise hears nothing from officials; the "subject" exercise gets the official post at minute 30. Any
/// difference in the next burst is therefore caused by the post and nothing else.
/// </para>
/// <para>
/// <b>Known scope limit.</b> The live loop does not yet raise a controller-prompt artifact of its own (the
/// cockpit match prompt is a separate, unbuilt surface), so the "controller is prompted" clause is asserted at
/// the resolver seam the prompt is driven from, not on a queue item.
/// </para>
/// </remarks>
[Trait("Category", "ReleaseBlocking")]
public sealed class MissSafeAntiBeratePioScenarioTests
{
    private const int PostMinute = 30;

    /// <summary>Plays the shared prefix: a storyline silent and escalating until the PIO posts at <see cref="PostMinute"/>.</summary>
    private static async Task<(ReactionScenario Scenario, Storyline Storyline)> EscalatingAsync(bool autoConfirm)
    {
        var scenario = ReactionScenario.Create();
        var storyline = scenario.AddStoryline(responseWindowMin: 20);
        if (autoConfirm)
        {
            scenario.Registration.ResponseMatching.EnableAutoConfirm();
        }

        await scenario.RunMinutesAsync(PostMinute);
        return (scenario, storyline);
    }

    private static MatchResolution Resolve(ReactionScenario scenario, string text, bool autoConfirm) =>
        MissSafeResolver.Resolve(
            new AddressingCandidate(AddressingSource.OfficialPost, "post-1", text, null, scenario.Minute),
            scenario.Registration.Storylines,
            autoConfirm);

    /// <summary>Plays the next 6 minutes and returns (minute, voices) for each burst the storyline drew.</summary>
    private static async Task<List<(int Minute, int Voices)>> BurstsAsync(ReactionScenario scenario, int minutes)
    {
        var decidedBefore = (await scenario.DecidedAsync()).Count;
        var itemsBefore = (await scenario.ReviewItemsAsync()).Count;
        var minutesBefore = scenario.Timeline.Count;
        await scenario.RunMinutesAsync(minutes);
        var decided = (await scenario.DecidedAsync()).Skip(decidedBefore).ToList();
        var fireMinutes = scenario.Timeline.Skip(minutesBefore).Where(t => t.ReviewItemsEnqueued > 0).Select(t => t.Minute).ToList();
        (await scenario.ReviewItemsAsync()).Count.Should().Be(itemsBefore + fireMinutes.Count);
        // One decided record per fire: pairing by position is only valid if the counts agree.
        decided.Should().HaveCount(fireMinutes.Count, "each burst emits exactly one engine.decided event");
        return fireMinutes.Zip(decided, (minute, d) => (minute, d.Count)).ToList();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AnUnmatchedOfficialPost_SlowsTheNextBurst_ButNeverPausesIt(bool autoConfirm)
    {
        var (subject, subjectStoryline) = await EscalatingAsync(autoConfirm);
        var (control, controlStoryline) = await EscalatingAsync(autoConfirm);
        await using var _s = subject;
        await using var _c = control;

        subject.OfficialPost(ScenarioScripts.UnrelatedPost); // the PIO posts something real, but not about the water

        var subjectBursts = await BurstsAsync(subject, 6);
        var controlBursts = await BurstsAsync(control, 6);

        controlBursts.Should().NotBeEmpty("precondition: the unanswered concern keeps drawing bursts");
        controlBursts[0].Voices.Should().BeGreaterThan(1, "precondition: an unslowed burst has several voices, so a slow is visible");

        subjectBursts.Should().NotBeEmpty("escalation is slowed, never paused: the burst still happens");
        subjectBursts.Select(b => b.Minute).Should().Equal(
            controlBursts.Select(b => b.Minute), "slowed bursts keep their normal cadence; the post did not pause the clock");
        subjectBursts[0].Voices.Should().BeLessThan(controlBursts[0].Voices, "the unmatched post SLOWS the next escalation burst");
        subjectBursts[0].Voices.Should().BeGreaterThanOrEqualTo(1, "but never to zero voices");
        subjectBursts.Skip(1).Select(b => b.Voices).Should().Equal(
            controlBursts.Skip(1).Select(b => b.Voices), "the slow is spent on one burst; escalation then resumes its normal rate");

        subjectStoryline.Intensity.Should().Be(controlStoryline.Intensity, "the intensity curve never paused or reversed either");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AnUnmatchedOfficialPost_IsNeverTreatedAsAnswerOrAsSilence_AndNeverMarksTheConcernAddressed(bool autoConfirm)
    {
        var (scenario, storyline) = await EscalatingAsync(autoConfirm);
        await using var _ = scenario;
        var before = scenario.Timeline[^1].Storylines[storyline.Id];

        scenario.OfficialPost(ScenarioScripts.UnrelatedPost);
        scenario.Advance(1);
        await scenario.TickAsync();
        await scenario.RunMinutesAsync(10);

        storyline.Phase.Should().Be(StorylinePhase.Escalating, "an unmatched post never addresses the concern");
        storyline.Phase.Should().NotBe(StorylinePhase.Addressed);
        storyline.MinutesSinceLastOfficialResponse.Should().Be(
            before.MinutesSilent + 11, "the silence clock keeps running: the post neither satisfied nor reset it");
        storyline.Intensity.Should().BeGreaterThan(before.Intensity, "escalation continues");

        var changes = await scenario.PhaseChangesAsync();
        changes.Should().NotContain(
            c => c.ToPhase == nameof(StorylinePhase.Addressed) || c.Cause == "matched-response" || c.Cause == "off-platform-marker",
            "no addressed transition is ever recorded for an unmatched post");
    }

    [Fact]
    public async Task AnUnmatchedOfficialPost_PromptsTheController_ToSayWhichConcernItAddressed()
    {
        var (scenario, _) = await EscalatingAsync(autoConfirm: false);
        await using var _s = scenario;

        // The seam the cockpit's "does this address #WaterIssues? Y/N" prompt is driven from.
        var unrelated = Resolve(scenario, ScenarioScripts.UnrelatedPost, autoConfirm: false);
        var plausible = Resolve(scenario, ScenarioScripts.PlausiblePost, autoConfirm: false);

        unrelated.Kind.Should().Be(MatchKind.Unmatched, "nothing plausibly addressed: miss-safe applies");
        unrelated.IsMatch.Should().BeFalse();
        plausible.Kind.Should().Be(MatchKind.NeedsConfirmation, "a plausible answer asks the controller Y/N rather than assuming");
        plausible.IsMatch.Should().BeFalse();

        DemandAccounting.MatchPromptDemand(autoConfirmEarned: false).Should().Be(
            1, "each prompt is one unit of controller demand (CTL-034), counted against the budget");
    }

    [Fact]
    public async Task APlausibleButUnconfirmedAnswer_AlsoSlowsWithoutPausing_AndLeavesTheConcernUnaddressed()
    {
        var (subject, storyline) = await EscalatingAsync(autoConfirm: false);
        var (control, _) = await EscalatingAsync(autoConfirm: false);
        await using var _s = subject;
        await using var _c = control;

        subject.OfficialPost(ScenarioScripts.AnsweringPost); // would match, but nobody has confirmed it

        var subjectBursts = await BurstsAsync(subject, 6);
        var controlBursts = await BurstsAsync(control, 6);

        subjectBursts.Should().NotBeEmpty("slowed, not paused");
        subjectBursts[0].Voices.Should().BeLessThan(controlBursts[0].Voices);
        storyline.Phase.Should().Be(StorylinePhase.Escalating, "unconfirmed means not addressed");
        (await subject.PhaseChangesAsync()).Should().NotContain(c => c.Cause == "matched-response");
    }

    [Fact]
    public async Task ARepeatedStreamOfIrrelevantPosts_CannotPauseOrCalmTheWorld()
    {
        var (subject, storyline) = await EscalatingAsync(autoConfirm: true);
        var (control, controlStoryline) = await EscalatingAsync(autoConfirm: true);
        await using var _s = subject;
        await using var _c = control;

        // The anti-gaming case: a flood of irrelevant official posts, one per minute for 15 minutes.
        for (var i = 0; i < 15; i++)
        {
            subject.OfficialPost(ScenarioScripts.UnrelatedPost);
            await subject.RunMinutesAsync(1);
            await control.RunMinutesAsync(1);
        }

        var subjectFires = subject.Timeline.Skip(PostMinute).Count(t => t.ReviewItemsEnqueued > 0);
        var controlFires = control.Timeline.Skip(PostMinute).Count(t => t.ReviewItemsEnqueued > 0);
        subjectFires.Should().Be(controlFires, "irrelevant posts cannot pause escalation: it fires as often as with no posts at all");
        subjectFires.Should().BeGreaterThan(0);
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
        storyline.Intensity.Should().Be(controlStoryline.Intensity, "nor can they calm it");
        (await subject.PhaseChangesAsync()).Should().NotContain(c => c.ToPhase == nameof(StorylinePhase.Addressed));
    }

    /// <summary>
    /// PR #634 CR-001: response-match prompts are metered against the CTL-034 budget (D4), but prompt demand alone must
    /// never starve escalation. At 6 (exactly the budget) and 10 (well past it) irrelevant official posts a minute, the
    /// prompts saturate the budget on their own; the miss-safe minimum service still lets the burst the cadence would
    /// have fired anyway go out - and ONLY that burst (it never creates one the cadence would not fire), so the subject
    /// fires exactly as often as the post-free control.
    /// </summary>
    [Theory]
    [InlineData(6)]
    [InlineData(10)]
    public async Task AFloodOfIrrelevantPostsThatSaturatesTheDemandBudget_StillCannotPauseEscalation(int postsPerMinute)
    {
        var (subject, storyline) = await EscalatingAsync(autoConfirm: false);
        var (control, _) = await EscalatingAsync(autoConfirm: false);
        await using var _s = subject;
        await using var _c = control;

        for (var i = 0; i < 15; i++)
        {
            for (var post = 0; post < postsPerMinute; post++)
            {
                subject.OfficialPost(ScenarioScripts.UnrelatedPost);
            }

            await subject.RunMinutesAsync(1);
            await control.RunMinutesAsync(1);
        }

        subject.Timeline.Skip(PostMinute).Should().OnlyContain(
            t => t.MatchPrompts == postsPerMinute, "precondition: every post raised a prompt, saturating the budget by itself");
        var subjectFires = subject.Timeline.Skip(PostMinute).Select(t => t.ReviewItemsEnqueued).ToList();
        var controlFires = control.Timeline.Skip(PostMinute).Select(t => t.ReviewItemsEnqueued).ToList();
        controlFires.Sum().Should().BeGreaterThan(0, "precondition: the control escalates in this window");
        subjectFires.Should().Equal(
            controlFires,
            "prompt demand from posts we cannot throttle must not pause escalation (ADP-002a), nor add bursts the cadence would not fire");
        storyline.Phase.Should().Be(StorylinePhase.Escalating);
    }

    /// <summary>
    /// PR #634 W-001: a response burst is voiced only on the tick its storyline is addressed, so it must never be gated by
    /// prompt demand - otherwise an answer landing in the same minute as a flood of unrelated posts would lose its
    /// gratitude reaction permanently.
    /// </summary>
    [Fact]
    public async Task AnAnswerLandingAmidAPromptSaturatingFlood_StillDrawsItsResponseBurst()
    {
        var (scenario, storyline) = await EscalatingAsync(autoConfirm: true);
        await using var _ = scenario;
        var itemsBefore = (await scenario.ReviewItemsAsync()).Count;

        scenario.OfficialPost(ScenarioScripts.AnsweringPost);
        for (var post = 0; post < WorkloadDemandMeter.BudgetPerMinute; post++)
        {
            scenario.OfficialPost(ScenarioScripts.UnrelatedPost);
        }

        scenario.Advance(1);
        var tick = await scenario.TickAsync();

        scenario.Timeline[^1].MatchPrompts.Should().Be(WorkloadDemandMeter.BudgetPerMinute, "precondition: the prompts alone fill the budget");
        storyline.Phase.Should().Be(StorylinePhase.Addressed, "the answering post was auto-confirmed");
        tick.ReviewItemsEnqueued.Should().Be(1, "the response reaction is not starved by prompt demand");
        (await scenario.ReviewItemsAsync()).Should().HaveCount(itemsBefore + 1);
        (await scenario.DecidedAsync()).Last().DominantTone.Should().StartWith("gratitude");
    }
}

