namespace Pulse.WebApi.Tests.Features.Channels.Scheduling;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Content.Scheduling;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Xunit;

/// <summary>
/// The scheduled-publish runner's TICK (channels-foundation story 05, #701) over the real funnel on the EF in-memory
/// provider: due-ness in scenario time, FC-7a replay, exactly once, pause tiers, clock jumps, visible failures and the
/// per-exercise background scope. Each tick is driven directly; nothing sleeps.
/// </summary>
public sealed class ContentScheduleRunnerTests : IDisposable
{
    private static readonly ContentCaller Author = new() { Origin = "controller", ActingHumanId = "human-author" };

    private static readonly ContentCaller Scheduler = new() { Origin = "controller", ActingHumanId = "human-scheduler" };

    private readonly FunnelHarness _harness = FunnelHarness.Create();

    private readonly PauseTierRegistry _tiers;

    public ContentScheduleRunnerTests()
    {
        _harness.Clock.Start(_harness.ExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        _tiers = new PauseTierRegistry(_harness.Clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
        SetStatus(_harness.ExerciseId, "live");
        SetStatus(_harness.OtherExerciseId, "live");
    }

    public void Dispose() => _harness.Dispose();

    [Fact]
    public async Task ADueItem_PublishesThroughTheFunnel_AsTheHumanWhoScheduledIt_ReplayingItsPersistedOptions()
    {
        var alert = new PublishOptions { Alert = new PublishAlertOptions { Severity = "warning", Headline = "Bridge closed" } };
        var id = await ScheduleAsync("2033-09-04T08:30:00Z", alert);

        _harness.Clock.Jump(_harness.ExerciseId, 45);
        (await Runner().RunTickAsync()).Should().Be(1);

        var item = await _harness.ItemAsync(id);
        item.Status.Should().Be("published");
        item.Origin.Should().Be("controller", "origin is unchanged by the scheduled publish");
        item.ActingHumanId.Should().Be("human-author", "the item keeps its author");
        _harness.Broadcaster.Published.Should().ContainSingle(content => content.Id == id);
        _harness.Observer.Calls.Should().ContainSingle(call => call.Event == "published");

        var published = (await _harness.EventsAsync()).Single(e => e.EventType == ChannelTelemetryEventTypes.ContentPublished);
        published.Actor.ActingHumanId.Should().Be("human-scheduler", "actor = the human who scheduled it");
        _harness.AlertRaiser!.Raised.Should().ContainSingle("the alert chosen at schedule time fires at publish (FC-7a)");
        _harness.AlertRaiser.Raised[0].Raise.Headline.Should().Be("Bridge closed");
        _harness.AlertRaiser.Raised[0].Caller.ActingHumanId.Should().Be("human-scheduler");

        (await Runner().RunTickAsync()).Should().Be(0, "a retried tick (or a restarted runner) finds nothing left to publish");
        _harness.AlertRaiser.Raised.Should().ContainSingle("a retried tick never duplicates the side effects");
        _harness.Broadcaster.Published.Should().ContainSingle();
    }

    [Fact]
    public async Task ADueItem_WithNoPersistedOptions_FallsBackToTheKindsResolvedOptions()
    {
        _harness.Article.Derive = _ => new PublishOptions { Alert = new PublishAlertOptions { Headline = "Derived" } };
        await ScheduleAsync("2033-09-04T08:30:00Z", options: null);

        _harness.Clock.Jump(_harness.ExerciseId, 31);
        await Runner().RunTickAsync();

        _harness.AlertRaiser!.Raised.Should().ContainSingle(raised => raised.Raise.Headline == "Derived");
    }

    [Fact]
    public async Task ANotYetDueItem_StaysScheduled_IsNeverBroadcast_AndShowsItsTimeToStaff()
    {
        var id = await ScheduleAsync("2033-09-04T09:00:00Z");

        _harness.Clock.Jump(_harness.ExerciseId, 59);
        (await Runner().RunTickAsync()).Should().Be(0);

        _harness.Broadcaster.Published.Should().BeEmpty("a scheduled item never reaches the participant stream (PRS-003)");
        using var scope = _harness.InA();
        var staff = await scope.Services.GetRequiredService<ContentProjector>()
            .ToStaffAsync(await scope.Db.ContentItems.AsNoTracking().SingleAsync(item => item.Id == Guid.Parse(id)));
        staff.Status.Should().Be("scheduled");
        DateTimeOffset.Parse(staff.ScheduledScenarioTime!, System.Globalization.CultureInfo.InvariantCulture)
            .Should().Be(new DateTimeOffset(2033, 9, 4, 9, 0, 0, TimeSpan.Zero));

        _harness.Clock.Jump(_harness.ExerciseId, 1);
        (await Runner().RunTickAsync()).Should().Be(1, "due is at-or-before the scenario time");
    }

    [Fact]
    public async Task AForwardJump_PublishesEveryDueItemInScheduledOrder_EachAtItsOwnScheduledTime()
    {
        var late = await ScheduleAsync("2033-09-04T09:30:00Z", headline: "Third");
        var early = await ScheduleAsync("2033-09-04T08:10:00Z", headline: "First");
        var middle = await ScheduleAsync("2033-09-04T08:50:00Z", headline: "Second");
        var future = await ScheduleAsync("2033-09-04T11:00:00Z", headline: "Not yet");

        _harness.Clock.Jump(_harness.ExerciseId, 120); // 08:00 → 10:00
        (await Runner().RunTickAsync()).Should().Be(3);

        _harness.Broadcaster.Published.Select(content => content.Id).Should().Equal([early, middle, late]);
        (await _harness.ItemAsync(early)).PublishedScenarioTime.Should().Be(new DateTimeOffset(2033, 9, 4, 8, 10, 0, TimeSpan.Zero));
        (await _harness.ItemAsync(middle)).PublishedScenarioTime.Should().Be(new DateTimeOffset(2033, 9, 4, 8, 50, 0, TimeSpan.Zero));
        (await _harness.ItemAsync(late)).PublishedScenarioTime.Should().Be(
            new DateTimeOffset(2033, 9, 4, 9, 30, 0, TimeSpan.Zero), "its own scheduled time, never the 10:00 jump target");
        (await _harness.ItemAsync(future)).Status.Should().Be("scheduled");
    }

    [Fact]
    public async Task ABackwardJump_NeverUnpublishesAnything()
    {
        var published = await ScheduleAsync("2033-09-04T08:10:00Z");
        var pending = await ScheduleAsync("2033-09-04T09:00:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        await Runner().RunTickAsync();

        // A restart of the clock at an earlier scenario instant is the only way scenario time moves backwards.
        _harness.Clock.Start(_harness.ExerciseId, FunnelHarness.ScenarioStart.AddHours(-2), TimeZoneInfo.Utc);
        (await Runner().RunTickAsync()).Should().Be(0);

        (await _harness.ItemAsync(published)).Status.Should().Be("published");
        (await _harness.ItemAsync(pending)).Status.Should().Be("scheduled");
        _harness.Broadcaster.Retracted.Should().BeEmpty();
    }

    [Fact]
    public async Task WorldFrozen_PublishesNothing_AndTheItemStaysScheduled_UntilResumed()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        (await _tiers.SetTierAsync(_harness.ExerciseId, PauseTier.Freeze, "human-ctl")).Outcome.Should().Be(PauseTierOutcome.Applied);

        (await Runner().RunTickAsync()).Should().Be(0);
        (await _harness.ItemAsync(id)).Status.Should().Be("scheduled");
        _harness.Broadcaster.Published.Should().BeEmpty();

        await _tiers.SetTierAsync(_harness.ExerciseId, PauseTier.Running, "human-ctl");
        (await Runner().RunTickAsync()).Should().Be(1);
    }

    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task AnExerciseNotLive_PublishesNothing_EvenWithAPersistedScenarioTimePastTheSchedule(string status)
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        SetStatus(_harness.ExerciseId, status);

        (await Runner().RunTickAsync()).Should().Be(0, "only a live exercise fires scenario content (COR-032)");
        (await _harness.ItemAsync(id)).Status.Should().Be("scheduled");

        SetStatus(_harness.ExerciseId, "active");
        (await Runner().RunTickAsync()).Should().Be(1, "the legacy 'active' literal reads as live");
    }

    [Theory]
    [InlineData(PauseTier.Injects)]
    [InlineData(PauseTier.Engine)]
    public async Task PauseInjectsAndPauseEngine_DoNotBlockScheduledContent(PauseTier tier)
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        await _tiers.SetTierAsync(_harness.ExerciseId, tier, "human-ctl");

        (await Runner().RunTickAsync()).Should().Be(1, "scheduled content is authored world content, not an inject or engine output");
        (await _harness.ItemAsync(id)).Status.Should().Be("published");
    }

    [Fact]
    public async Task AnExerciseWhoseScenarioTimeIsUnknown_PublishesNothing_TheWallClockNeverDecides()
    {
        using (var b = _harness.In(_harness.OtherExerciseId))
        {
            var created = await b.Funnel.CreateDraftAsync(OtherRequest(), Author);
            await b.Funnel.ScheduleAsync(Guid.Parse(created.Item!.Id), "2000-01-01T00:00:00Z", null, Scheduler);
        }

        (await Runner().RunTickAsync()).Should().Be(0, "exercise B's clock never started and it has no persisted scenario time");
    }

    [Fact]
    public async Task EachExercise_IsPublishedInItsOwnScope()
    {
        _harness.Clock.Start(_harness.OtherExerciseId, FunnelHarness.ScenarioStart, TimeZoneInfo.Utc);
        var inA = await ScheduleAsync("2033-09-04T08:10:00Z");
        string inB;
        using (var b = _harness.In(_harness.OtherExerciseId))
        {
            var created = await b.Funnel.CreateDraftAsync(OtherRequest(), Author);
            inB = created.Item!.Id;
            await b.Funnel.ScheduleAsync(Guid.Parse(inB), "2033-09-04T08:20:00Z", null, Scheduler);
        }

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        _harness.Clock.Jump(_harness.OtherExerciseId, 30);
        (await Runner().RunTickAsync()).Should().Be(2);

        _harness.Broadcaster.Published.Select(content => content.Id).Should().BeEquivalentTo([inA, inB]);
        _harness.Broadcaster.Exercises.Should().BeEquivalentTo([_harness.ExerciseId, _harness.OtherExerciseId]);
        using var scopeB = _harness.In(_harness.OtherExerciseId);
        (await scopeB.Db.ContentItems.AsNoTracking().SingleAsync()).Status.Should().Be("published");
        (await scopeB.Db.TelemetryEvents.AsNoTracking().CountAsync(e => e.EventType == ChannelTelemetryEventTypes.ContentPublished))
            .Should().Be(1, "B's publish event was written in B's own scope");
    }

    [Fact]
    public async Task TwoInstancesSeeingTheSameDueItem_PublishExactlyOnce_AndTheLoserSkipsSilently()
    {
        var alert = new PublishOptions { Alert = new PublishAlertOptions { Headline = "Once" } };
        var id = await ScheduleAsync("2033-09-04T08:10:00Z", alert);
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        var parkFirst = new ParkFirstGate();
        _harness.Gates.Add(parkFirst);

        var first = Runner().RunTickAsync();
        if (await Task.WhenAny(parkFirst.Entered.Task, first, Task.Delay(TimeSpan.FromSeconds(30))) != parkFirst.Entered.Task)
        {
            parkFirst.Release.TrySetResult();
            throw new Xunit.Sdk.XunitException(
                $"The first tick never reached the parking gate (completed: {first.IsCompleted}).");
        }
        int second;
        try
        {
            second = await Runner().RunTickAsync();
        }
        finally
        {
            parkFirst.Release.TrySetResult(); // never strand the parked tick, even if the second one throws
        }

        second.Should().Be(1, "the second instance publishes while the first is mid-tick");
        (await first).Should().Be(0, "the first instance loses the Version claim");

        _harness.Broadcaster.Published.Should().ContainSingle();
        _harness.AlertRaiser!.Raised.Should().ContainSingle();
        // The single content_published event is proven on real SQL (ContentScheduleRunnerSqlTests): the in-memory
        // provider has no transactions, so the loser's event row is not rolled back here.
        (await _harness.EventsAsync()).Should().NotContain(e => e.EventType == ChannelTelemetryEventTypes.ContentScheduleFailed);
        var item = await _harness.ItemAsync(id);
        item.Status.Should().Be("published");
        item.LastError.Should().BeNull();
    }

    [Fact]
    public async Task ARefusedPublish_DeletedOutlet_ReturnsTheItemToDraftWithItsError_AndEmitsOneFailureEvent()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        using (var scope = _harness.InA())
        {
            var outlet = await scope.Db.Outlets.SingleAsync(candidate => candidate.Id == _harness.OutletId);
            outlet.DeletedAt = FunnelHarness.WallStart;
            await scope.Db.SaveChangesAsync();
        }

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        (await Runner().RunTickAsync()).Should().Be(0);
        (await Runner().RunTickAsync()).Should().Be(0, "a draft is never found again: no retry loop");

        var item = await _harness.ItemAsync(id);
        item.Status.Should().Be("draft");
        item.ScheduledScenarioTime.Should().BeNull();
        item.LastError.Should().Contain("outlet");
        _harness.Broadcaster.Published.Should().BeEmpty();

        var failed = (await _harness.EventsAsync()).Where(e => e.EventType == ChannelTelemetryEventTypes.ContentScheduleFailed).ToList();
        failed.Should().ContainSingle();
        failed[0].Actor.ActingHumanId.Should().Be("human-scheduler");
        failed[0].Target!.EntityId.Should().Be(id);
        using var payload = JsonDocument.Parse(failed[0].Payload!);
        payload.RootElement.GetProperty("action").GetString().Should().Be("schedule_failed");
        payload.RootElement.GetProperty("error").GetString().Should().Contain("outlet");

        using var staffScope = _harness.InA();
        var staff = await staffScope.Services.GetRequiredService<ContentProjector>()
            .ToStaffAsync(await staffScope.Db.ContentItems.AsNoTracking().SingleAsync(candidate => candidate.Id == Guid.Parse(id)));
        staff.LastError.Should().Contain("outlet", "the refusal is staff-visible");
    }

    [Fact]
    public async Task ARefusedPublish_InvalidPayload_ReturnsTheItemToDraft_AndASuccessfulRescheduleClearsTheError()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        using (var scope = _harness.InA())
        {
            var row = await scope.Db.ContentItems.SingleAsync(candidate => candidate.Id == Guid.Parse(id));
            row.PayloadJson = """{"invalid":true}""";
            await scope.Db.SaveChangesAsync();
        }

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        await Runner().RunTickAsync();

        var failed = await _harness.ItemAsync(id);
        failed.Status.Should().Be("draft");
        failed.LastError.Should().Contain("payload.invalid");

        using (var scope = _harness.InA())
        {
            var row = await scope.Db.ContentItems.SingleAsync(candidate => candidate.Id == Guid.Parse(id));
            row.PayloadJson = "{}";
            await scope.Db.SaveChangesAsync();
            (await scope.Funnel.ScheduleAsync(Guid.Parse(id), "2033-09-04T08:20:00Z", null, Scheduler)).Outcome
                .Should().Be(ContentPublishOutcome.Ok);
        }

        (await _harness.ItemAsync(id)).LastError.Should().BeNull("the next schedule clears the last error");
        (await Runner().RunTickAsync()).Should().Be(1);
    }

    [Fact]
    public async Task APublishHeldByAGate_ReturnsTheItemToDraftWithTheHoldReason()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Gates.Add(new TestGate(ContentPublishGateDecision.Hold("Awaiting approval.")));

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        await Runner().RunTickAsync();

        var item = await _harness.ItemAsync(id);
        item.Status.Should().Be("draft");
        item.LastError.Should().Be("Scheduled publish for 2033-09-04T08:10:00Z was refused: Awaiting approval.",
            "the schedule is cleared, so the error keeps the time it was due for");
    }

    [Fact]
    public async Task APoisonedItem_IsSkipped_AndEveryOtherItemStillPublishes()
    {
        var poisoned = await ScheduleAsync("2033-09-04T08:05:00Z", headline: "Poisoned");
        var healthy = await ScheduleAsync("2033-09-04T08:10:00Z", headline: "Healthy");
        _harness.Gates.Add(new ThrowingGate(Guid.Parse(poisoned)));

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        (await Runner().RunTickAsync()).Should().Be(1);

        (await _harness.ItemAsync(healthy)).Status.Should().Be("published");
        (await _harness.ItemAsync(poisoned)).Status.Should().Be("scheduled", "a fault is not a refusal: the item is retried");
    }

    [Fact]
    public async Task ScheduledByReader_FallsBackToTheItemsAttribution_WhenNoScheduleEventExists()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        using (var scope = _harness.InA())
        {
            scope.Db.TelemetryEvents.RemoveRange(await scope.Db.TelemetryEvents.ToListAsync());
            await scope.Db.SaveChangesAsync();
        }

        using var read = _harness.InA();
        var scheduledBy = await read.Services.GetRequiredService<ScheduledByReader>().ReadAsync(Guid.Parse(id));

        scheduledBy!.Caller.Should().BeEquivalentTo(new ContentCaller { Origin = "controller", ActingHumanId = "human-author" });
        scheduledBy.ScheduledAt.Should().Be(FunnelHarness.ScenarioStart, "the floor falls back to the item's creation time");
    }

    [Fact]
    public async Task ARecordedFailure_WithAStaleVersion_ChangesNothing()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        var version = (await _harness.ItemAsync(id)).Version;

        using var scope = _harness.InA();
        var recorder = scope.Services.GetRequiredService<IScheduledContentPublisher>();
        (await recorder.RecordScheduleFailureAsync(Guid.Parse(id), version - 1, "stale", Scheduler)).Should().BeFalse();

        (await _harness.ItemAsync(id)).Status.Should().Be("scheduled");
    }

    [Fact]
    public async Task AStaffUnscheduleLandingAfterDiscovery_Wins_TheRunnerNeverPublishesTheDraft()
    {
        var first = await ScheduleAsync("2033-09-04T08:05:00Z", headline: "First");
        var second = await ScheduleAsync("2033-09-04T08:10:00Z", headline: "Second");
        _harness.Clock.Jump(_harness.ExerciseId, 30);

        // Both are discovered; while the runner publishes the first, a controller unschedules the second.
        _harness.Gates.Add(new ActionGate(Guid.Parse(first), async () =>
        {
            using var staff = _harness.InA();
            (await staff.Funnel.UnscheduleAsync(Guid.Parse(second), FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }));

        (await Runner().RunTickAsync()).Should().Be(1);

        (await _harness.ItemAsync(second)).Status.Should().Be("draft", "the controller's withdrawal wins");
        _harness.Broadcaster.Published.Select(content => content.Id).Should().Equal([first]);
        (await _harness.EventsAsync()).Should().NotContain(e => e.EventType == ChannelTelemetryEventTypes.ContentScheduleFailed);
    }

    [Fact]
    public async Task PublishDue_RefusesAStaleClaim_AnUnscheduledItem_AndANotYetDueItem()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        var discovered = (await _harness.ItemAsync(id)).Version;

        using (var scope = _harness.InA())
        {
            var publisher = scope.Services.GetRequiredService<IScheduledContentPublisher>();
            (await publisher.PublishDueAsync(Guid.Parse(id), discovered, null, Scheduler)).Outcome
                .Should().Be(ContentPublishOutcome.Conflict, "08:10 is not due at 08:00");
        }

        _harness.Clock.Jump(_harness.ExerciseId, 30);
        using (var scope = _harness.InA())
        {
            (await scope.Services.GetRequiredService<IScheduledContentPublisher>()
                .PublishDueAsync(Guid.Parse(id), discovered - 1, null, Scheduler)).Outcome
                .Should().Be(ContentPublishOutcome.Conflict, "the item changed since it was discovered");
        }

        using (var scope = _harness.InA())
        {
            await scope.Funnel.UnscheduleAsync(Guid.Parse(id), FunnelHarness.Controller);
        }

        using (var scope = _harness.InA())
        {
            var version = (await _harness.ItemAsync(id)).Version;
            (await scope.Services.GetRequiredService<IScheduledContentPublisher>()
                .PublishDueAsync(Guid.Parse(id), version, null, Scheduler)).Outcome
                .Should().Be(ContentPublishOutcome.Conflict, "a draft is never published by the scheduler");
        }

        (await _harness.ItemAsync(id)).Status.Should().Be("draft");
        _harness.Broadcaster.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task ASchedulePlacedInThePast_IsStampedWhenItWasScheduled_NeverBackDated()
    {
        _harness.Clock.Jump(_harness.ExerciseId, 60); // 09:00
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30); // 09:30

        (await Runner().RunTickAsync()).Should().Be(1);

        (await _harness.ItemAsync(id)).PublishedScenarioTime.Should().Be(
            FunnelHarness.ScenarioStart.AddMinutes(60), "the schedule was made at 09:00, so it cannot have run at 08:10");
    }

    [Fact]
    public async Task PublishNow_OfAnOverdueScheduledItem_StampsNow()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);

        using (var scope = _harness.InA())
        {
            (await scope.Funnel.PublishAsync(Guid.Parse(id), null, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }

        (await _harness.ItemAsync(id)).PublishedScenarioTime.Should().Be(
            FunnelHarness.ScenarioStart.AddMinutes(30), "a staff publish-now is a publish at the current scenario time");
    }

    [Fact]
    public async Task PublishNow_OfANotYetDueScheduledItem_StampsTheCurrentScenarioTime()
    {
        var id = await ScheduleAsync("2033-09-04T09:00:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 15);

        using (var scope = _harness.InA())
        {
            (await scope.Funnel.PublishAsync(Guid.Parse(id), null, FunnelHarness.Controller)).Outcome.Should().Be(ContentPublishOutcome.Ok);
        }

        (await _harness.ItemAsync(id)).PublishedScenarioTime.Should().Be(FunnelHarness.ScenarioStart.AddMinutes(15));
    }

    [Fact]
    public async Task ASchedule_WakesTheSleepingRunner_AfterItCommits()
    {
        using var root = _harness.InA();
        var signal = root.Services.GetRequiredService<ContentScheduleSignal>();
        await signal.WaitAsync(TimeSpan.Zero, TimeProvider.System, CancellationToken.None); // drain

        await ScheduleAsync("2033-09-04T09:00:00Z");

        (await signal.WaitAsync(TimeSpan.Zero, TimeProvider.System, CancellationToken.None)).Should().BeTrue(
            "the runner sleeps while idle (#673), so a new schedule must wake it");
    }

    [Fact]
    public async Task TheSweep_KeepsItsCadence_OnlyWhileAnItemWaitsInAnExerciseWhoseClockRuns()
    {
        (await Runner().SweepAsync()).Waiting.Should().Be(0, "nothing scheduled: the runner may sleep");

        var id = await ScheduleAsync("2033-09-04T09:00:00Z");
        (await Runner().SweepAsync()).Should().Be((0, 1), "the clock runs, so 09:00 comes due with no write");

        await _tiers.SetTierAsync(_harness.ExerciseId, PauseTier.Freeze, "human-ctl");
        (await Runner().SweepAsync()).Waiting.Should().Be(0, "frozen: nothing comes due until leaving Freeze wakes the runner");
        await _tiers.SetTierAsync(_harness.ExerciseId, PauseTier.Running, "human-ctl");

        _harness.Clock.Jump(_harness.ExerciseId, 60);
        (await Runner().SweepAsync()).Should().Be((1, 0), "published; nothing left waiting");
        (await _harness.ItemAsync(id)).Status.Should().Be("published");
    }

    [Fact]
    public async Task AStagedExerciseWithARunningClock_KeepsTheCadence_SoGoingLivePublishesWithoutAWake()
    {
        var id = await ScheduleAsync("2033-09-04T08:10:00Z");
        _harness.Clock.Jump(_harness.ExerciseId, 30);
        SetStatus(_harness.ExerciseId, "staged");

        (await Runner().SweepAsync()).Should().Be(
            (0, 1), "StartEx is not a clock change and wakes nothing, so the runner must not sleep through it");

        SetStatus(_harness.ExerciseId, "completed");
        (await Runner().SweepAsync()).Waiting.Should().Be(0, "a completed exercise never goes live again: the runner may sleep");

        SetStatus(_harness.ExerciseId, "live");
        (await Runner().SweepAsync()).Should().Be((1, 0), "the next cadence sweep publishes it");
        (await _harness.ItemAsync(id)).Status.Should().Be("published");
    }

    [Fact]
    public async Task AnItemInAnExerciseWithNoRunningClock_LeavesTheRunnerAsleep()
    {
        using (var b = _harness.In(_harness.OtherExerciseId))
        {
            var created = await b.Funnel.CreateDraftAsync(OtherRequest(), Author);
            await b.Funnel.ScheduleAsync(Guid.Parse(created.Item!.Id), "2033-09-04T09:00:00Z", null, Scheduler);
        }

        (await Runner().SweepAsync()).Waiting.Should().Be(0, "B's clock never started: only its start (a clock change) can make it due");
    }

    private void SetStatus(Guid exerciseId, string status)
    {
        using var scope = _harness.In(exerciseId);
        var exercise = scope.Db.Exercises.IgnoreQueryFilters().Single(candidate => candidate.Id == exerciseId);
        exercise.Status = status;
        scope.Db.SaveChanges();
    }

    private ContentScheduleRunner Runner() => new(
        _harness.ScopeFactory,
        _tiers,
        _harness.Clock,
        _harness.Time,
        new ContentScheduleSignal(),
        new ContentScheduleRunnerOptions(),
        NullLogger<ContentScheduleRunner>.Instance);

    private async Task<string> ScheduleAsync(string at, PublishOptions? options = null, string headline = "Bridge closed")
    {
        var draft = await _harness.CreateAsync(Author, _harness.Request(headline));
        using var scope = _harness.InA();
        var result = await scope.Funnel.ScheduleAsync(Guid.Parse(draft.Id), at, options, Scheduler);
        result.Outcome.Should().Be(ContentPublishOutcome.Ok, string.Join("; ", result.Errors));
        return draft.Id;
    }

    private ContentWriteRequest OtherRequest() => _harness.Request("Other exercise item") with
    {
        OutletId = _harness.OtherOutletId.ToString(),
    };

    /// <summary>Parks the FIRST publish evaluation until released (to stage two instances racing); passes the rest.</summary>
    private sealed class ParkFirstGate : IContentPublishGate
    {
        private int _calls;

        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<ContentPublishGateDecision> EvaluateAsync(
            ContentItem item, PublishContext context, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _calls) == 1)
            {
                Entered.TrySetResult();
                await Release.Task;
            }

            return ContentPublishGateDecision.Allow();
        }
    }

    /// <summary>Runs an action while one item's publish is mid-flight (to stage a staff change), then allows.</summary>
    private sealed class ActionGate(Guid itemId, Func<Task> action) : IContentPublishGate
    {
        public async Task<ContentPublishGateDecision> EvaluateAsync(
            ContentItem item, PublishContext context, CancellationToken cancellationToken = default)
        {
            if (item.Id == itemId)
            {
                await action();
            }

            return ContentPublishGateDecision.Allow();
        }
    }

    /// <summary>Throws for one item (a poisoned row), allows every other.</summary>
    private sealed class ThrowingGate(Guid poisoned) : IContentPublishGate
    {
        public Task<ContentPublishGateDecision> EvaluateAsync(
            ContentItem item, PublishContext context, CancellationToken cancellationToken = default) =>
            item.Id == poisoned
                ? throw new InvalidOperationException("poisoned row")
                : Task.FromResult(ContentPublishGateDecision.Allow());
    }
}
