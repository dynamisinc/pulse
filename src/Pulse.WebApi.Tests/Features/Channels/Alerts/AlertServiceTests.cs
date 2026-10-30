namespace Pulse.WebApi.Tests.Features.Channels.Alerts;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Contracts;
using Xunit;

/// <summary>
/// Channels-foundation story 10 on the in-memory harness (no Docker): the active set, raise, clear, scenario-time
/// expiry and the sweep, telemetry in the same unit of work, the <c>AlertsChanged</c> full-set push, the SOC-072
/// bridge, history paging, and exercise isolation.
/// </summary>
public sealed class AlertServiceTests : IDisposable
{
    private readonly AlertServiceHarness _host = new();

    public void Dispose() => _host.Dispose();

    // ---- active set -------------------------------------------------------------------------------------

    [Fact]
    public async Task Active_NoAlerts_IsAnEmptySet_NotNull()
    {
        var exercise = _host.StartExercise();

        var active = await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync());

        active!.Alerts.Should().BeEmpty("an empty set is a zero-height bar (D7)");
    }

    [Fact]
    public async Task Active_UnresolvedScope_FailsClosed()
    {
        (await _host.InAsync(null, (_, reader) => reader.GetActiveAsync())).Should().BeNull();
        (await _host.InAsync(Guid.Empty, (_, reader) => reader.GetActiveAsync())).Should().BeNull();
    }

    [Fact]
    public async Task Active_IsHighestSeverityFirst_ThenNewest()
    {
        var exercise = _host.StartExercise();
        var oldInfo = await RaiseAsync(exercise, AlertServiceHarness.Raise(ChannelVocabulary.SeverityInfo, "old info"));
        _host.Time.Advance(TimeSpan.FromMinutes(1));
        var advisory = await RaiseAsync(exercise, AlertServiceHarness.Raise(ChannelVocabulary.SeverityAdvisory, "advisory"));
        _host.Time.Advance(TimeSpan.FromMinutes(1));
        var oldEmergency = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "old emergency"));
        _host.Time.Advance(TimeSpan.FromMinutes(1));
        var newInfo = await RaiseAsync(exercise, AlertServiceHarness.Raise(ChannelVocabulary.SeverityInfo, "new info"));
        _host.Time.Advance(TimeSpan.FromMinutes(1));
        var newEmergency = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "new emergency"));

        var active = await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync());

        active!.Alerts.Select(a => a.Id).Should().Equal(newEmergency.Id, oldEmergency.Id, advisory.Id, newInfo.Id, oldInfo.Id);
    }

    // ---- raise ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Raise_StampsServerScenarioTime_AndKeepsTheHeadlineVerbatimAsMessage()
    {
        var exercise = _host.StartExercise();
        _host.Time.Advance(TimeSpan.FromMinutes(42));
        var contentId = Guid.NewGuid();

        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise(
            headline: "Tornado Warning — Fairhaven County until 3:45 PM",
            href: "/weather/weather-desk/tornado-warning-1",
            contentId: contentId,
            expires: "2026-12-03T21:45:00Z"));

        alert.Message.Should().Be("Tornado Warning — Fairhaven County until 3:45 PM");
        alert.ScenarioTime.Should().Be("2026-12-03T20:42:00.0000000Z", "14:00 CST + 42 scenario minutes, server-stamped (COR-053)");
        alert.Href.Should().Be("/weather/weather-desk/tornado-warning-1");
        alert.SourceChannel.Should().Be("weather");
        alert.ContentId.Should().Be(contentId.ToString());
        alert.ExpiresScenarioTime.Should().Be("2026-12-03T21:45:00.0000000Z");

        await using var db = _host.Db(exercise);
        var row = await db.ChannelAlerts.SingleAsync();
        row.Headline.Should().Be(alert.Message);
        row.IssuedScenarioTime.Should().Be(AlertServiceHarness.ScenarioStart.AddMinutes(42));
        row.Origin.Should().Be("controller");
        row.ActingHumanId.Should().Be("staff-1");
    }

    [Fact]
    public async Task Raise_ConsoleAlert_SourceSystem_ReachesTheWireAsNull()
    {
        var exercise = _host.StartExercise();

        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise(source: ChannelVocabulary.AlertSourceSystem));

        alert.SourceChannel.Should().BeNull("'system' never goes on the wire; the client guard rejects it");
    }

    [Fact]
    public async Task Raise_Invalid_Throws_AndWritesNothing()
    {
        var exercise = _host.StartExercise();

        var act = () => RaiseAsync(exercise, AlertServiceHarness.Raise(href: "https://evil.example/"));

        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*href*");
        await using var db = _host.Db(exercise);
        (await db.ChannelAlerts.CountAsync()).Should().Be(0);
        (await db.TelemetryEvents.CountAsync()).Should().Be(0);
        _host.Broadcaster.Frames.Should().BeEmpty();
    }

    [Fact]
    public async Task Raise_WithoutAScope_Throws()
    {
        var act = () => _host.InAsync(null, (alerts, _) => alerts.RaiseAsync(
            AlertServiceHarness.Raise(), AlertServiceHarness.Controller()));

        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    [Fact]
    public async Task Raise_BroadcastsAlertsChanged_WithTheFullActiveSet()
    {
        var exercise = _host.StartExercise();
        var first = await RaiseAsync(exercise, AlertServiceHarness.Raise(ChannelVocabulary.SeverityInfo, "first"));
        var second = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "second"));

        _host.Broadcaster.Frames.Should().HaveCount(2);
        var last = _host.Broadcaster.Frames[^1];
        last.ExerciseId.Should().Be(exercise);
        last.Frame.Alerts.Select(a => a.Id).Should().Equal(second.Id, first.Id);
    }

    [Fact]
    public async Task Raise_EmitsAlertIssued_InTheSameUnitOfWork_WithTheActingHuman()
    {
        var exercise = _host.StartExercise();

        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise(contentId: Guid.NewGuid()), human: "casey");

        await using var db = _host.Db(exercise);
        var evt = await db.TelemetryEvents.SingleAsync();
        evt.EventType.Should().Be("alert_issued");
        evt.ExerciseId.Should().Be(exercise);
        evt.Channel.Should().Be("weather");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ActingHumanId.Should().Be("casey");
        evt.Origin.Should().BeNull("the telemetry origin union has no plain 'controller'");
        evt.Target!.EntityType.Should().Be("alert");
        evt.Target.EntityId.Should().Be(alert.Id);
        evt.ScenarioTime.Should().Be(AlertServiceHarness.ScenarioStart);
        using var payload = JsonDocument.Parse(evt.Payload!);
        payload.RootElement.GetProperty("severity").GetString().Should().Be("emergency");
        payload.RootElement.TryGetProperty("headline", out _).Should().BeFalse("telemetry carries no alert text");
    }

    [Fact]
    public async Task Raise_ByAnInject_CarriesTheInjectIdAndOrigin()
    {
        var exercise = _host.StartExercise();
        var injectId = Guid.NewGuid();
        var caller = new ContentCaller { Origin = ChannelVocabulary.OriginInject, ActingHumanId = "casey", InjectId = injectId };

        await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsync(AlertServiceHarness.Raise(), caller));

        await using var db = _host.Db(exercise);
        var evt = await db.TelemetryEvents.SingleAsync();
        evt.Origin.Should().Be("inject");
        evt.InjectId.Should().Be(injectId.ToString());
    }

    [Fact]
    public async Task Raise_ByAParticipantCaller_CarriesTheParticipantIdTheV0SchemaRequires()
    {
        var exercise = _host.StartExercise();
        var caller = new ContentCaller { Origin = ChannelVocabulary.OriginParticipant, ActingHumanId = "p-7" };

        await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsync(AlertServiceHarness.Raise(), caller));

        await using var db = _host.Db(exercise);
        var evt = await db.TelemetryEvents.SingleAsync();
        evt.Actor.Kind.Should().Be("participant");
        evt.Actor.ParticipantId.Should().Be("p-7");
        evt.Origin.Should().Be("participant");
    }

    [Fact]
    public async Task AlertDto_NeverCarriesWhoRaisedIt()
    {
        var names = typeof(AlertDto).GetProperties().Select(p => p.Name).ToList();

        names.Should().NotContain(new[] { "Origin", "ActingHumanId", "InjectId" }, "participants never see who raised it (XC-002)");
        var json = JsonSerializer.Serialize(await RaiseAsync(_host.StartExercise(), AlertServiceHarness.Raise(), human: "casey"));
        json.Should().NotContain("casey").And.NotContain("controller");
    }

    // ---- SOC-072 bridge ---------------------------------------------------------------------------------

    [Fact]
    public async Task Bridge_Enabled_TheSameAlertAlsoGoesToThePlatformNotification()
    {
        var exercise = _host.StartExercise();

        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise());

        _host.Notifier.Raised.Should().ContainSingle()
            .Which.Should().Be((exercise, alert), "one logical alert, two renderings: same id, same verbatim message");
    }

    [Fact]
    public async Task Bridge_Disabled_NoPlatformNotification()
    {
        using var host = new AlertServiceHarness(bridgeEnabled: false);
        var exercise = host.StartExercise();

        var alert = await host.InAsync(exercise, (alerts, _) => alerts.RaiseAsync(
            AlertServiceHarness.Raise(), AlertServiceHarness.Controller()));
        await host.InAsync(exercise, (alerts, _) => alerts.ClearAsync(Guid.Parse(alert.Id), AlertServiceHarness.Controller()));

        host.Notifier.Raised.Should().BeEmpty();
        host.Notifier.Cleared.Should().BeEmpty();
        host.Broadcaster.Frames.Should().HaveCount(2, "the bar is unaffected by the bridge switch");
    }

    [Fact]
    public async Task Bridge_OrBroadcastFault_NeverUndoesACommittedRaise()
    {
        var exercise = _host.StartExercise();
        _host.Notifier.Throw = true;
        _host.Broadcaster.Throw = true;

        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise());

        var active = await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync());
        active!.Alerts.Should().ContainSingle().Which.Id.Should().Be(alert.Id);
    }

    [Fact]
    public async Task AStalledBroadcast_IsBounded_SoLaterChangesAndTheBridgeStillProceed()
    {
        using var host = new AlertServiceHarness(broadcastTimeout: TimeSpan.FromMilliseconds(200));
        var exercise = host.StartExercise();
        host.Broadcaster.Hang = true;

        var raise = Task.Run(async () =>
        {
            foreach (var headline in new[] { "one", "two" })
            {
                await host.InAsync(exercise, (alerts, _) =>
                    alerts.RaiseAsync(AlertServiceHarness.Raise(headline: headline), AlertServiceHarness.Controller()));
            }
        });

        (await Task.WhenAny(raise, Task.Delay(TimeSpan.FromSeconds(10)))).Should().BeSameAs(
            raise, "a stalled send is cancelled at the bound, so it never blocks the next change behind the gate");
        host.Notifier.Raised.Should().HaveCount(2, "the bridge still runs after a timed-out broadcast");
        (await host.InAsync(exercise, (_, reader) => reader.GetActiveAsync()))!.Alerts.Should().HaveCount(2);
    }

    // ---- clear ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Clear_DropsTheAlert_BroadcastsTheNewSet_AndEmitsAlertCleared()
    {
        var exercise = _host.StartExercise();
        var keep = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "keep"));
        var drop = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "drop"));
        _host.Time.Advance(TimeSpan.FromMinutes(5));

        var cleared = await _host.InAsync(exercise, (alerts, _) =>
            alerts.ClearAsync(Guid.Parse(drop.Id), AlertServiceHarness.Controller("lee")));

        cleared.Should().BeTrue();
        (await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync()))!.Alerts.Select(a => a.Id)
            .Should().Equal(keep.Id);
        _host.Broadcaster.Frames[^1].Frame.Alerts.Select(a => a.Id).Should().Equal(keep.Id);
        _host.Notifier.Cleared.Should().ContainSingle().Which.Should().Be((exercise, drop.Id));

        await using var db = _host.Db(exercise);
        var row = await db.ChannelAlerts.SingleAsync(a => a.Id == Guid.Parse(drop.Id));
        row.ClearedScenarioTime.Should().Be(AlertServiceHarness.ScenarioStart.AddMinutes(5));
        var evt = await db.TelemetryEvents.SingleAsync(e => e.EventType == "alert_cleared");
        evt.Actor.ActingHumanId.Should().Be("lee");
        evt.Target!.EntityId.Should().Be(drop.Id);
        evt.Payload.Should().Contain("\"reason\":\"cleared\"");
    }

    [Fact]
    public async Task Clear_UnknownOrAlreadyCleared_IsANoOpReturningFalse()
    {
        var exercise = _host.StartExercise();
        var alert = await RaiseAsync(exercise, AlertServiceHarness.Raise());
        var id = Guid.Parse(alert.Id);
        await _host.InAsync(exercise, (alerts, _) => alerts.ClearAsync(id, AlertServiceHarness.Controller()));
        var frames = _host.Broadcaster.Frames.Count;

        (await _host.InAsync(exercise, (alerts, _) => alerts.ClearAsync(id, AlertServiceHarness.Controller())))
            .Should().BeFalse();
        (await _host.InAsync(exercise, (alerts, _) => alerts.ClearAsync(Guid.NewGuid(), AlertServiceHarness.Controller())))
            .Should().BeFalse();
        _host.Broadcaster.Frames.Should().HaveCount(frames, "a no-op announces nothing");
    }

    // ---- expiry -----------------------------------------------------------------------------------------

    [Fact]
    public async Task Expiry_IsAgainstScenarioTime_NotWallClock()
    {
        var exercise = _host.StartExercise();
        await RaiseAsync(exercise, AlertServiceHarness.Raise(expires: "2026-12-03T20:30:00Z")); // 14:30 CST
        _host.Clock.Freeze(exercise);
        _host.Time.Advance(TimeSpan.FromHours(3));

        (await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync()))!.Alerts
            .Should().ContainSingle("a frozen clock holds scenario time, however much wall time passes");

        _host.Clock.Jump(exercise, 30);

        (await _host.InAsync(exercise, (_, reader) => reader.GetActiveAsync()))!.Alerts
            .Should().BeEmpty("the read drops an expired alert itself, before any sweep");
    }

    [Fact]
    public async Task Sweep_ExpiresDueAlertsAcrossExercises_StampsAtTheExpiryInstant_AndAnnounces()
    {
        var a = _host.StartExercise();
        var b = _host.StartExercise();
        var aDue = await RaiseAsync(a, AlertServiceHarness.Raise(headline: "a due", expires: "2026-12-03T20:10:00Z"));
        var aLater = await RaiseAsync(a, AlertServiceHarness.Raise(headline: "a later", expires: "2026-12-03T23:00:00Z"));
        var bDue = await RaiseAsync(b, AlertServiceHarness.Raise(headline: "b due", expires: "2026-12-03T20:10:00Z"));
        _host.Broadcaster.Frames.Clear();
        _host.Time.Advance(TimeSpan.FromMinutes(20));

        var expired = await _host.Sweeper.SweepAsync();

        expired.Should().Be(2);
        _host.Broadcaster.Frames.Should().HaveCount(2);
        _host.Broadcaster.Frames.Single(f => f.ExerciseId == a).Frame.Alerts.Select(x => x.Id).Should().Equal(aLater.Id);
        _host.Broadcaster.Frames.Single(f => f.ExerciseId == b).Frame.Alerts.Should().BeEmpty();
        _host.Notifier.Cleared.Select(c => c.AlertId).Should().BeEquivalentTo(new[] { aDue.Id, bDue.Id });

        await using (var db = _host.Db(a))
        {
            var row = await db.ChannelAlerts.SingleAsync(x => x.Id == Guid.Parse(aDue.Id));
            row.ClearedScenarioTime.Should().Be(new DateTimeOffset(2026, 12, 3, 20, 10, 0, TimeSpan.Zero));
            var evt = await db.TelemetryEvents.SingleAsync(e => e.EventType == "alert_cleared");
            evt.Actor.Kind.Should().Be("system");
            evt.Actor.ActingHumanId.Should().BeNull("no human expired it");
            evt.Payload.Should().Contain("\"reason\":\"expired\"");
        }

        (await _host.Sweeper.SweepAsync()).Should().Be(0, "an expired alert is stamped once");
        _host.Broadcaster.Frames.Should().HaveCount(2);
    }

    [Fact]
    public async Task Sweep_NeverExpiresAgainstTheWallClock_WhenNoScenarioTimeIsKnown()
    {
        var exercise = Guid.NewGuid(); // clock never started and no exercise row: scenario time is unknown
        var expires = _host.Time.GetUtcNow().AddMinutes(5).ToString("O", System.Globalization.CultureInfo.InvariantCulture);
        await RaiseAsync(exercise, AlertServiceHarness.Raise(expires: expires));
        _host.Time.Advance(TimeSpan.FromHours(1));

        (await _host.Sweeper.SweepAsync()).Should().Be(0, "an expiry is never decided against the wall clock (COR-053)");

        await using var db = _host.Db(exercise);
        (await db.ChannelAlerts.SingleAsync()).ClearedScenarioTime.Should().BeNull();
    }

    [Fact]
    public async Task Raise_ByACallerWithAnOverlongActingHuman_IsAnArgumentError_NotASaveFailure()
    {
        var exercise = _host.StartExercise();

        var act = () => RaiseAsync(exercise, AlertServiceHarness.Raise(), human: new string('h', 257));

        await act.Should().ThrowAsync<ArgumentException>().WithMessage("*ActingHumanId*");
    }

    [Fact]
    public void Sweep_BacksOff_DoublingToTheCap()
    {
        var options = new ChannelAlertOptions { SweepInterval = TimeSpan.FromSeconds(5), MaxFailureBackoff = TimeSpan.FromSeconds(30) };

        AlertExpirySweeper.NextDelay(0, options).Should().Be(TimeSpan.FromSeconds(5));
        AlertExpirySweeper.NextDelay(1, options).Should().Be(TimeSpan.FromSeconds(5));
        AlertExpirySweeper.NextDelay(2, options).Should().Be(TimeSpan.FromSeconds(10));
        AlertExpirySweeper.NextDelay(3, options).Should().Be(TimeSpan.FromSeconds(20));
        AlertExpirySweeper.NextDelay(9, options).Should().Be(TimeSpan.FromSeconds(30));
    }

    // ---- history ----------------------------------------------------------------------------------------

    [Fact]
    public async Task History_IncludesClearedAndExpired_NewestFirst()
    {
        var exercise = _host.StartExercise();
        var expiring = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "expiring", expires: "2026-12-03T20:05:00Z"));
        _host.Time.Advance(TimeSpan.FromMinutes(1));
        var cleared = await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: "cleared"));
        await _host.InAsync(exercise, (alerts, _) => alerts.ClearAsync(Guid.Parse(cleared.Id), AlertServiceHarness.Controller()));
        _host.Time.Advance(TimeSpan.FromMinutes(10));
        var active = await RaiseAsync(exercise, AlertServiceHarness.Raise(ChannelVocabulary.SeverityInfo, "active"));

        var page = await _host.InAsync(exercise, (_, reader) => reader.GetHistoryAsync(null, null));

        page.Page!.Alerts.Select(a => a.Id).Should().Equal(active.Id, cleared.Id, expiring.Id);
        page.Page.NextCursor.Should().BeNull();
    }

    [Fact]
    public async Task History_PagesWithACursor_IncludingAlertsThatShareAFrozenInstant()
    {
        var exercise = _host.StartExercise();
        var ids = new System.Collections.Generic.List<string>();
        for (var i = 0; i < 3; i++)
        {
            ids.Add((await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: $"early {i}"))).Id);
            _host.Time.Advance(TimeSpan.FromMinutes(1));
        }

        _host.Clock.Freeze(exercise);
        for (var i = 0; i < 4; i++)
        {
            ids.Add((await RaiseAsync(exercise, AlertServiceHarness.Raise(headline: $"frozen {i}"))).Id);
        }

        var seen = new System.Collections.Generic.List<string>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var read = await _host.InAsync(exercise, (_, reader) => reader.GetHistoryAsync(cursor, 2));
            read.Page!.Alerts.Count.Should().BeLessThanOrEqualTo(2);
            seen.AddRange(read.Page.Alerts.Select(a => a.Id));
            cursor = read.Page.NextCursor;
            pages++;
        }
        while (cursor is not null && pages < 10);

        seen.Should().OnlyHaveUniqueItems().And.BeEquivalentTo(ids, "a late joiner catches up on every alert exactly once (PRT-012)");
        seen.Skip(4).Should().Equal(ids[2], ids[1], ids[0]);
        pages.Should().Be(4);
    }

    [Theory]
    [InlineData("not-a-cursor", null)]
    [InlineData("MTow", null)] // base64url "1:0": well formed, but an issued cursor always records >= 1 served row
    [InlineData(null, 0)]
    [InlineData(null, 101)]
    public async Task History_BadCursorOrLimit_IsInvalid(string? cursor, int? limit)
    {
        var exercise = _host.StartExercise();

        var read = await _host.InAsync(exercise, (_, reader) => reader.GetHistoryAsync(cursor, limit));

        read.Error.Should().NotBeNull();
        read.Page.Should().BeNull();
    }

    // ---- isolation (always Critical) ----------------------------------------------------------------------

    [Fact]
    public async Task Isolation_AnotherExercisesAlert_IsInvisible_AndUnclearable_LikeAnUnknownId()
    {
        var a = _host.StartExercise();
        var b = _host.StartExercise();
        var aAlert = await RaiseAsync(a, AlertServiceHarness.Raise(headline: "A only"));
        _host.Broadcaster.Frames.Clear();

        (await _host.InAsync(b, (_, reader) => reader.GetActiveAsync()))!.Alerts.Should().BeEmpty();
        (await _host.InAsync(b, (_, reader) => reader.GetHistoryAsync(null, null))).Page!.Alerts.Should().BeEmpty();
        (await _host.InAsync(b, (alerts, _) => alerts.ClearAsync(Guid.Parse(aAlert.Id), AlertServiceHarness.Controller())))
            .Should().BeFalse("another exercise's id is indistinguishable from an unknown one");

        _host.Broadcaster.Frames.Should().BeEmpty();
        (await _host.InAsync(a, (_, reader) => reader.GetActiveAsync()))!.Alerts.Should().ContainSingle()
            .Which.Id.Should().Be(aAlert.Id, "exercise B's attempt touched nothing");
    }

    [Fact]
    public async Task Isolation_ARaiseBroadcastsOnlyToItsOwnExercise_WithOnlyItsOwnAlerts()
    {
        var a = _host.StartExercise();
        var b = _host.StartExercise();
        await RaiseAsync(a, AlertServiceHarness.Raise(headline: "A"));
        var bAlert = await RaiseAsync(b, AlertServiceHarness.Raise(headline: "B"));

        var frame = _host.Broadcaster.Frames[^1];
        frame.ExerciseId.Should().Be(b);
        frame.Frame.Alerts.Select(x => x.Id).Should().Equal(bAlert.Id);
    }

    // ---- staff path -------------------------------------------------------------------------------------

    [Fact]
    public async Task Staff_RaiseTakesTheActingHumanFromTheSession_AndIsAConsoleAlert()
    {
        var exercise = _host.StartExercise();
        var staff = Guid.NewGuid();
        _host.StaffUserId = staff;

        var outcome = await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsStaffAsync(new StaffAlertRaiseRequest
        {
            Severity = "advisory",
            Headline = "Shelter open at Fairhaven High",
            Href = "/alerts",
        }));

        outcome.Alert!.SourceChannel.Should().BeNull();
        await using var db = _host.Db(exercise);
        var row = await db.ChannelAlerts.SingleAsync();
        row.SourceChannel.Should().Be("system");
        row.Origin.Should().Be("controller");
        row.ActingHumanId.Should().Be(staff.ToString());
    }

    [Fact]
    public async Task Staff_NoSession_FailsClosed_AndInvalidIsReadable()
    {
        var exercise = _host.StartExercise();

        (await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsStaffAsync(new StaffAlertRaiseRequest())))
            .Unresolved.Should().BeTrue();
        (await _host.InAsync(exercise, (alerts, _) => alerts.ClearAsStaffAsync(Guid.NewGuid()))).Should().BeNull();

        _host.StaffUserId = Guid.NewGuid();
        (await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsStaffAsync(null))).Error.Should().NotBeNull();
        (await _host.InAsync(exercise, (alerts, _) => alerts.RaiseAsStaffAsync(new StaffAlertRaiseRequest { Severity = "info" })))
            .Error.Should().Contain("headline");
    }

    private Task<AlertDto> RaiseAsync(Guid exerciseId, AlertRaise raise, string human = "staff-1") =>
        _host.InAsync(exerciseId, (alerts, _) => alerts.RaiseAsync(raise, AlertServiceHarness.Controller(human)));
}
