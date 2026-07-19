namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;

public class WorkloadDemandMeterTests
{
    private static WorkloadDemandMeter NewMeter() => new(Guid.NewGuid(), Guid.NewGuid());

    private static void RecordDemand(WorkloadDemandMeter meter, int count, int scenarioMinute)
    {
        for (var i = 0; i < count; i++)
        {
            meter.Record(DemandEventKind.ReviewAction, scenarioMinute);
        }
    }

    [Fact]
    public void DemandInWindow_CountsOnlyTheRollingWindow()
    {
        var meter = NewMeter();
        RecordDemand(meter, 3, scenarioMinute: 40); // outside a 1-min window ending at 42
        RecordDemand(meter, 2, scenarioMinute: 42); // inside

        meter.DemandInWindow(nowScenarioMinute: 42, windowMinutes: 1).Should().Be(2);
    }

    [Fact]
    public void AtOrBelowBudget_IsWithinBudget_StrictlyPast_IsAmber()
    {
        var meter = NewMeter();

        RecordDemand(meter, 6, scenarioMinute: 10);
        meter.DemandPerMinute(10).Should().Be(6);
        meter.IsOverBudget(10).Should().BeFalse("6/min is exactly the budget, not past it");

        meter.Record(DemandEventKind.QueueFire, 10); // 7th in the minute
        meter.IsOverBudget(10).Should().BeTrue("7/min is past the ~6 budget → amber");
    }

    [Fact]
    public void SustainedDemand_OverAMultiMinuteWindow_TripsTheBudget()
    {
        var meter = NewMeter();
        // 8 demands/min sustained across minutes 1..3 → 24 in a 3-min window = 8/min.
        for (var minute = 1; minute <= 3; minute++)
        {
            RecordDemand(meter, 8, minute);
        }

        meter.DemandPerMinute(nowScenarioMinute: 3, windowMinutes: 3).Should().Be(8);
        meter.IsOverBudget(nowScenarioMinute: 3, windowMinutes: 3).Should().BeTrue();
    }

    [Fact]
    public void ASingleSpike_IsSmoothedByASustainedWindow()
    {
        var meter = NewMeter();
        RecordDemand(meter, 12, scenarioMinute: 5); // one busy minute

        // Over a 4-min window that one spike averages to 3/min — not sustained, not flagged.
        meter.DemandPerMinute(nowScenarioMinute: 5, windowMinutes: 4).Should().Be(3);
        meter.IsOverBudget(nowScenarioMinute: 5, windowMinutes: 4).Should().BeFalse();
    }

    [Fact]
    public void FrozenScenarioTime_AccruesNoPhantomDemand()
    {
        var meter = NewMeter();
        RecordDemand(meter, 4, scenarioMinute: 20);

        // The scenario clock is frozen at 20 (CTL-023) — querying the same minute repeatedly reflects only
        // what actually happened; no time advances, so no rate inflation/deflation.
        meter.DemandInWindow(20, 1).Should().Be(4);
        meter.DemandInWindow(20, 1).Should().Be(4);
    }

    [Fact]
    public void Prune_DropsOldEvents_WithoutAffectingTheCurrentWindow()
    {
        var meter = NewMeter();
        RecordDemand(meter, 5, scenarioMinute: 1);
        RecordDemand(meter, 2, scenarioMinute: 60);

        meter.Prune(beforeScenarioMinute: 60);

        meter.RetainedCount.Should().Be(2);
        meter.DemandInWindow(60, 1).Should().Be(2);
    }

    [Fact]
    public void Meter_IsExerciseAndControllerScoped()
    {
        var exercise = Guid.NewGuid();
        var controller = Guid.NewGuid();
        var meter = new WorkloadDemandMeter(exercise, controller);

        meter.ExerciseId.Should().Be(exercise);
        meter.ControllerId.Should().Be(controller);
        ((Action)(() => _ = new WorkloadDemandMeter(Guid.Empty, controller))).Should().Throw<ArgumentException>();
    }
}
