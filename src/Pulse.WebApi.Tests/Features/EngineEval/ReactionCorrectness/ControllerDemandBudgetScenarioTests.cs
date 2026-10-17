namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Xunit;

/// <summary>
/// SCENARIO - "one controller runs a believable world" (engine-eval-harness story 04, AC6; requirement CTL-034).
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> CTL-034 is the make-or-break workload contract between the controller console and
/// the engine: at burst load with the engine at Delayed-auto, a single controller must never be asked for more than
/// about six decisions a minute, sustained. If a design pushes past it, the design is wrong, because the failure
/// mode is public (the world berating a PIO who already answered). This class is the gate: it fails the suite if
/// the loop ever demands more than the budget.
/// </para>
/// <para>
/// <b>What "controller demand" means here</b> (defined once, in <see cref="ReactionScenario"/>): the decisions the
/// controller is asked for in one scenario minute - one per review-queue item (one burst = one decision, however
/// many posts it carries) plus one per response-match prompt. The production meter (<see cref="WorkloadDemandMeter"/>)
/// records and enforces both (queue fires; response-match prompts since D4). The burst-load tests assert the
/// queue-fire part; the match-prompt test asserts the total.
/// </para>
/// <para>
/// <b>The burst load.</b> 24 storylines whose response windows all blow in the same minute (the worst realistic
/// pile-up: far more concerns than one controller could ever attend to), the exercise at Delayed-auto, and the loop
/// ticked three times per scenario minute (the real host ticks every few seconds, so one minute holds many ticks and
/// the budget must hold across them, not per tick). Forty scenario minutes are played; the load is "real" only if
/// the budget is actually reached, which the first test asserts so a quiet fixture can never pass vacuously.
/// </para>
/// <para>
/// <b>Why the unit is the burst.</b> The last test shows the counterfactual: under the SAME load, a naive design
/// that demanded a decision per post (plus an autonomy decision per burst) would ask for several times the budget.
/// Counting the burst as one decision is what makes the budget reachable at all.
/// </para>
/// </remarks>
public sealed class ControllerDemandBudgetScenarioTests
{
    private const int Storylines = 24;
    private const int Minutes = 40;

    private static async Task<ReactionScenario> BurstLoadAsync(string? officialPostEachMinute = null)
    {
        var scenario = ReactionScenario.Create(AutonomyLevel.DelayedAuto);
        for (var i = 0; i < Storylines; i++)
        {
            scenario.AddStoryline(title: $"Concern {i}", responseWindowMin: 5);
        }

        for (var minute = 1; minute <= Minutes; minute++)
        {
            scenario.Advance(1);
            if (officialPostEachMinute is not null)
            {
                scenario.OfficialPost(officialPostEachMinute);
            }

            for (var tick = 0; tick < 3; tick++)
            {
                await scenario.TickAsync();
            }
        }

        return scenario;
    }

    [Fact]
    public async Task AtBurstLoadOnDelayedAuto_NoScenarioMinuteDemandsMoreThanTheBudget()
    {
        await using var scenario = await BurstLoadAsync();

        var demand = scenario.QueueFireDemandPerMinute();

        demand.Values.Max().Should().Be(
            WorkloadDemandMeter.BudgetPerMinute,
            "precondition: the load actually pushed the loop to the budget, so a pass is not vacuous");
        demand.Should().OnlyContain(
            kv => kv.Value <= WorkloadDemandMeter.BudgetPerMinute,
            "CTL-034: a single controller is never asked for more than 6 decisions in a scenario minute");
    }

    [Fact]
    public async Task TheSustainedRate_StaysWithinBudget_AsTheProductionMeterMeasuresIt()
    {
        await using var scenario = await BurstLoadAsync();

        // Replay the scenario's decisions into the production meter, one QueueFire per review item at its minute.
        var meter = new WorkloadDemandMeter(scenario.ExerciseId, scenario.Registration.ControllerDeskId);
        foreach (var (minute, fires) in scenario.QueueFireDemandPerMinute())
        {
            for (var i = 0; i < fires; i++)
            {
                meter.Record(DemandEventKind.QueueFire, minute);
            }
        }

        for (var minute = 1; minute <= Minutes; minute++)
        {
            meter.IsOverBudget(minute).Should().BeFalse($"minute {minute}: the per-minute window is within budget");
        }

        for (var minute = 10; minute <= Minutes; minute++)
        {
            meter.DemandPerMinute(minute, windowMinutes: 10).Should().BeLessThanOrEqualTo(
                WorkloadDemandMeter.BudgetPerMinute, $"minute {minute}: the sustained 10-minute rate is within budget");
        }
    }

    [Fact]
    public async Task APerPostDecisionDesign_WouldHaveBreachedTheBudgetUnderTheSameLoad()
    {
        await using var scenario = await BurstLoadAsync();

        var naivePerMinute = scenario.Timeline
            .GroupBy(t => t.Minute)
            .ToDictionary(
                g => g.Key,
                g => g.Sum(t => DemandAccounting.NaiveBurstDemand(t.PostsEnqueued, isResponseMatch: false)));

        naivePerMinute.Values.Max().Should().BeGreaterThan(
            WorkloadDemandMeter.BudgetPerMinute,
            "the same traffic costed one-decision-per-post would blow the budget: the burst-as-one-decision unit is load-bearing");
    }

    [Fact]
    public async Task AtBurstLoadWithAMatchPromptEveryMinute_TotalControllerDemandStaysWithinTheBudget()
    {
        // D4: the same burst load plus one official post per minute the engine cannot confirm on its own (a plausible
        // answer, auto-confirm off) - one response-match prompt per minute. CTL-034 counts review-queue actions +
        // response-match prompts + queue fires against ONE budget, so the loop must leave room for the prompt: before
        // the fix it budgeted queue fires only, and total demand ran at 7/min for 36 consecutive minutes.
        await using var scenario = await BurstLoadAsync(officialPostEachMinute: ScenarioScripts.PlausiblePost);

        scenario.Timeline.Sum(t => t.MatchPrompts).Should().Be(Minutes, "precondition: one match prompt was raised every minute");

        var demand = scenario.ControllerDemandPerMinute();
        demand.Values.Max().Should().Be(
            WorkloadDemandMeter.BudgetPerMinute,
            "precondition: the load still pushes the loop to the budget, so a pass is not vacuous");
        demand.Should().OnlyContain(
            kv => kv.Value <= WorkloadDemandMeter.BudgetPerMinute,
            "CTL-034: queue fires + match prompts together never exceed 6 decisions in a scenario minute");
        scenario.QueueFireDemandPerMinute().Values.Max().Should().BeLessThan(
            WorkloadDemandMeter.BudgetPerMinute, "the engine's own bursts yield the budget the prompt took");
    }
}

