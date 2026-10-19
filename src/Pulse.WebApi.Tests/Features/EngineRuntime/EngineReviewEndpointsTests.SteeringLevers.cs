namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using System.Threading;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Issue #618 — the three in-memory autonomy steering levers (swamped mode on/off, the kill switch, the restore) record
/// each REAL change as one XC-004 event + one org-audit row, attributed to the verified SESSION person, with the scenario
/// minute and the previous + new state; a refused (400 / 403) or no-op call records nothing. Over real HTTP against the
/// shared migrated SQL Server, so every test is <see cref="RequiresDockerFactAttribute"/> (skipped on a Docker-less
/// machine). The payload/posture vocabulary itself is pinned without Docker by <c>EngineSteeringLeverRecordsTests</c>.
/// </summary>
public sealed partial class EngineReviewEndpointsTests
{
    private const int LeverScenarioMinute = 37;
    private static readonly DateTimeOffset LeverScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    private static readonly string[] LeverEventTypes =
    [
        EngineSteeringLeverRecords.SwampedModeOnEventType,
        EngineSteeringLeverRecords.SwampedModeOffEventType,
        EngineSteeringLeverRecords.KillSwitchEngagedEventType,
        EngineSteeringLeverRecords.AutonomyRestoredEventType,
    ];

    private static readonly string[] LeverAuditKinds =
    [
        EngineSteeringLeverRecords.SwampedModeOnAuditKind,
        EngineSteeringLeverRecords.SwampedModeOffAuditKind,
        EngineSteeringLeverRecords.KillSwitchEngagedAuditKind,
        EngineSteeringLeverRecords.AutonomyRestoredAuditKind,
    ];

    [RequiresDockerFact]
    public async Task SwampedModeOn_RecordsTurnedOn_ForTheSessionPerson_WithStateAndScenarioMinute_AndOrgAudit()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: true);
        var scenarioNow = StartLeverClock(host, exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, enabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var (events, audits) = await LeverRecordsAsync(exerciseId);

        var recorded = events.Should().ContainSingle("one real change, one event").Subject;
        AssertSessionLeverEvent(host, recorded, EngineSteeringLeverRecords.SwampedModeOnEventType, exerciseId, scenarioNow);
        using (var payload = JsonDocument.Parse(recorded.Payload!))
        {
            payload.RootElement.GetProperty("reason").GetString().Should().Be("controller");
            payload.RootElement.GetProperty("wasOn").GetBoolean().Should().BeFalse("the previous state");
            payload.RootElement.GetProperty("isOn").GetBoolean().Should().BeTrue("the new state");
            payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(LeverScenarioMinute);
        }

        AssertSessionLeverAudit(host, audits.Should().ContainSingle().Subject, EngineSteeringLeverRecords.SwampedModeOnAuditKind, recorded.Payload!);
    }

    [RequiresDockerFact]
    public async Task SwampedModeOff_AfterOn_ReusesTheTurnedOffType_ForTheSessionPerson_AndOrgAudit()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        var scenarioNow = StartLeverClock(host, exerciseId);
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId).SetSwampedMode(true, "arrange", 0);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, enabled = false });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "turning swamped mode OFF is never refused");
        var (events, audits) = await LeverRecordsAsync(exerciseId);

        var recorded = events.Should().ContainSingle().Subject;
        AssertSessionLeverEvent(host, recorded, EnrollmentService.SwampedModeOffEventType, exerciseId, scenarioNow);
        using (var payload = JsonDocument.Parse(recorded.Payload!))
        {
            payload.RootElement.GetProperty("reason").GetString().Should().Be("controller", "a controller turned it off, not a lead release");
            payload.RootElement.GetProperty("wasOn").GetBoolean().Should().BeTrue();
            payload.RootElement.GetProperty("isOn").GetBoolean().Should().BeFalse();
            payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(LeverScenarioMinute);
        }

        AssertSessionLeverAudit(host, audits.Should().ContainSingle().Subject, EnrollmentService.SwampedModeOffAuditKind, recorded.Payload!);
    }

    [RequiresDockerFact]
    public async Task SwampedModeOn_WhileTimeoutAutoSendIsNotAuthorized_Is400_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, timeoutAutoSendAuthorized: false);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, enabled = true });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNoLeverRecordAsync(exerciseId, "a refused swamped ON changed nothing, so nothing is recorded");
    }

    [RequiresDockerFact]
    public async Task SwampedModeOff_WhileAlreadyOff_IsAnIdempotentNoOp_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, enabled = false });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        await AssertNoLeverRecordAsync(exerciseId, "OFF while off is no change, and only a real change is recorded");
    }

    [RequiresDockerFact]
    public async Task KillSwitch_FullStop_RecordsEngaged_WithModeAndPostures_ForTheSessionPerson_AndOrgAudit()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        var scenarioNow = StartLeverClock(host, exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var (events, audits) = await LeverRecordsAsync(exerciseId);

        var recorded = events.Should().ContainSingle().Subject;
        AssertSessionLeverEvent(host, recorded, EngineSteeringLeverRecords.KillSwitchEngagedEventType, exerciseId, scenarioNow);
        using (var payload = JsonDocument.Parse(recorded.Payload!))
        {
            payload.RootElement.GetProperty("mode").GetString().Should().Be("full-stop");
            payload.RootElement.GetProperty("fromPosture").GetString().Should().Be("running", "the previous state");
            payload.RootElement.GetProperty("toPosture").GetString().Should().Be("stopped", "the new state");
            payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(LeverScenarioMinute);
        }

        AssertSessionLeverAudit(host, audits.Should().ContainSingle().Subject, EngineSteeringLeverRecords.KillSwitchEngagedAuditKind, recorded.Payload!);
    }

    [RequiresDockerFact]
    public async Task KillSwitch_PulledAgainInTheSameMode_ChangesNothing_AndRecordsOnlyTheFirst()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        var uri = new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative);

        using (var first = await host.Client.PostAsJsonAsync(uri, new { actingHumanId = SpoofedActingHumanId, mode = "drop-to-suggest" }))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using (var second = await host.Client.PostAsJsonAsync(uri, new { actingHumanId = SpoofedActingHumanId, mode = "drop-to-suggest" }))
        {
            second.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var (events, audits) = await LeverRecordsAsync(exerciseId);
        events.Should().ContainSingle("the second pull left the posture clamped as it was")
            .Which.EventType.Should().Be(EngineSteeringLeverRecords.KillSwitchEngagedEventType);
        audits.Should().ContainSingle();
    }

    [RequiresDockerFact]
    public async Task KillSwitch_WithAnUnknownMode_Is400_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, mode = "self-destruct" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await AssertNoLeverRecordAsync(exerciseId, "a refused kill switch changed nothing");
    }

    [RequiresDockerFact]
    public async Task Restore_AfterAFullStop_RecordsRestored_WithPostures_ForTheSessionPerson_AndOrgAudit()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        var scenarioNow = StartLeverClock(host, exerciseId);
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId)
            .EngageKillSwitch(KillSwitchMode.FullStop, "arrange", 0);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var (events, audits) = await LeverRecordsAsync(exerciseId);

        var recorded = events.Should().ContainSingle().Subject;
        AssertSessionLeverEvent(host, recorded, EngineSteeringLeverRecords.AutonomyRestoredEventType, exerciseId, scenarioNow);
        using (var payload = JsonDocument.Parse(recorded.Payload!))
        {
            payload.RootElement.GetProperty("fromPosture").GetString().Should().Be("stopped", "the previous state");
            payload.RootElement.GetProperty("toPosture").GetString().Should().Be("running", "the new state");
            payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(LeverScenarioMinute);
        }

        AssertSessionLeverAudit(host, audits.Should().ContainSingle().Subject, EngineSteeringLeverRecords.AutonomyRestoredAuditKind, recorded.Payload!);
    }

    [RequiresDockerFact]
    public async Task Restore_WithNothingClamped_IsAnIdempotentNoOp_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId });

        response.StatusCode.Should().Be(HttpStatusCode.OK, "restoring a running engine still succeeds");
        await AssertNoLeverRecordAsync(exerciseId, "nothing was clamped, so nothing changed");
    }

    [RequiresDockerFact]
    public async Task Restore_ByANonLeadController_Is403_AndRecordsNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);
        autonomy.EngageKillSwitch(KillSwitchMode.DropToSuggest, "arrange", 0);
        await using (var demote = _fixture.CreateContext())
        {
            await demote.Enrollments.IgnoreQueryFilters()
                .Where(e => e.ExerciseId == exerciseId && e.PersonId == host.StaffUserId)
                .ExecuteUpdateAsync(set => set.SetProperty(e => e.IsLead, false));
        }

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "a restore is a raise, which is lead-only");
        autonomy.SafetyClampActive.Should().BeTrue("the refused restore lifted nothing");
        await AssertNoLeverRecordAsync(exerciseId, "a refused restore records nothing");
    }

    [RequiresDockerFact]
    public async Task SpoofTheoryHost_WithAnUnstartedClock_OmitsTheScenarioMinute_NeverAFabricatedZero()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);

        using var response = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, mode = "drop-to-suggest" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var (events, _) = await LeverRecordsAsync(exerciseId);
        using var payload = JsonDocument.Parse(events.Should().ContainSingle().Subject.Payload!);
        payload.RootElement.TryGetProperty("scenarioMinute", out _).Should().BeFalse("the clock has not started");
    }

    // ---- #618 review C2: a record failure never costs a safety effect, nor fails the lever ------------

    [RequiresDockerFact]
    public async Task KillSwitch_WhenTheRecorderThrows_StillDemotesAutonomousAmbient_AndReturns200()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId, configureServices: UseRecorder(new ThrowingSteeringLeverRecorder()));
        var (path, body, _) = ArrangeAutonomousAmbient(host, exerciseId, "/api/engine/autonomy/kill-switch", new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" });

        using var response = await host.Client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the kill switch applied; a failed record must not turn it into a 500");
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>().Get(exerciseId).Mode
            .Should().Be(Pulse.Core.Features.Ambient.Models.AmbientPolicyMode.Off, "AC6: the kill switch lowers autonomous ambient whatever happens to the record");
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId).IsGenerationStopped.Should().BeTrue();
        await AssertNoLeverRecordAsync(exerciseId, "the recorder failed");
    }

    [RequiresDockerFact]
    public async Task SwampedModeAndRestore_WhenTheRecorderThrows_StillApply_AndReturn200()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(
            exerciseId, timeoutAutoSendAuthorized: true, configureServices: UseRecorder(new ThrowingSteeringLeverRecorder()));
        var autonomy = host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId);

        using (var on = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/swamped-mode", UriKind.Relative), new { actingHumanId = SpoofedActingHumanId, enabled = true }))
        {
            on.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        autonomy.SwampedModeEnabled.Should().BeTrue();

        autonomy.EngageKillSwitch(KillSwitchMode.FullStop, "arrange", 0);
        using (var restore = await host.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/restore", UriKind.Relative), new { actingHumanId = SpoofedActingHumanId }))
        {
            restore.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        autonomy.SafetyClampActive.Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task KillSwitch_WhenTheRecordSaveFails_StillDemotesAmbient_Returns200_AndWritesNothing()
    {
        var exerciseId = Guid.NewGuid();
        await using var failingDb = new ServiceCollection()
            .AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString!).AddInterceptors(new FailingSaveInterceptor()))
            .BuildServiceProvider();
        await using var host = await StartHostAsync(
            exerciseId,
            configureServices: UseRecorder(new EngineSteeringLeverRecorder(failingDb.GetRequiredService<IServiceScopeFactory>())));
        var (path, body, _) = ArrangeAutonomousAmbient(host, exerciseId, "/api/engine/autonomy/kill-switch", new { actingHumanId = SpoofedActingHumanId, mode = "drop-to-suggest" });

        using var response = await host.Client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "a record that cannot be saved is logged, never fatal");
        host.Services.GetRequiredService<EngineAmbientPolicyRegistry>().Get(exerciseId).Mode
            .Should().Be(Pulse.Core.Features.Ambient.Models.AmbientPolicyMode.Off);
        await AssertNoLeverRecordAsync(exerciseId, "the record's own save failed (and it never shared the request's unit of work)");
    }

    // ---- #618 review W4 -----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task KillSwitch_DropToSuggest_UnderTheDegradedClamp_IsANoOp_AndRecordsNothing_ButFullStopIsAChange()
    {
        var exerciseId = Guid.NewGuid();
        await using var host = await StartHostAsync(exerciseId);
        host.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId).DegradeToSuggest("provider down", 0);
        var uri = new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative);

        using (var drop = await host.Client.PostAsJsonAsync(uri, new { actingHumanId = SpoofedActingHumanId, mode = "drop-to-suggest" }))
        {
            drop.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        await AssertNoLeverRecordAsync(exerciseId, "already clamped to Suggest — the posture did not move");

        using (var stop = await host.Client.PostAsJsonAsync(uri, new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" }))
        {
            stop.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var (events, _) = await LeverRecordsAsync(exerciseId);
        using var payload = JsonDocument.Parse(events.Should().ContainSingle().Subject.Payload!);
        payload.RootElement.GetProperty("fromPosture").GetString().Should().Be("clamped");
        payload.RootElement.GetProperty("toPosture").GetString().Should().Be("stopped");
    }

    [RequiresDockerFact]
    public async Task ALeverOnExerciseA_NeverWritesARecordScopedToExerciseB()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await using var hostA = await StartHostAsync(exerciseA);
        await using var hostB = await StartHostAsync(exerciseB);

        using var response = await hostA.Client.PostAsJsonAsync(
            new Uri("/api/engine/autonomy/kill-switch", UriKind.Relative),
            new { actingHumanId = SpoofedActingHumanId, mode = "full-stop" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await LeverRecordsAsync(exerciseA)).Events.Should().ContainSingle("A's lever is recorded on A");
        await AssertNoLeverRecordAsync(exerciseB, "COR-001: nothing A did is ever scoped to B");

        // And through B's own scope, the central filter shows B nothing of A's record.
        await using var asB = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseB });
        (await asB.TelemetryEvents.CountAsync(e => LeverEventTypes.Contains(e.EventType))).Should().Be(0);
        hostB.Services.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseB).SafetyClampActive.Should().BeFalse();
    }

    // ---- #618 helpers ---------------------------------------------------------------------------

    private static Action<IServiceCollection> UseRecorder(IEngineSteeringLeverRecorder recorder) => services =>
    {
        services.RemoveAll<IEngineSteeringLeverRecorder>();
        services.AddSingleton(recorder);
    };

    /// <summary>A recorder that breaks its never-throws contract — proves the service's own guard.</summary>
    private sealed class ThrowingSteeringLeverRecorder : IEngineSteeringLeverRecorder
    {
        public Task RecordAsync(EngineSteeringLeverRecord record) =>
            throw new InvalidOperationException("record store down");
    }

    /// <summary>Fails every save on the context it is attached to.</summary>
    private sealed class FailingSaveInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("audit store down");
    }

    /// <summary>Starts (and freezes) the exercise's scenario clock at <see cref="LeverScenarioMinute"/>; returns that instant.</summary>
    private static DateTimeOffset StartLeverClock(EngineReviewTestHost host, Guid exerciseId)
    {
        var clock = host.Services.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, LeverScenarioStart, TimeZoneInfo.Utc);
        clock.Freeze(exerciseId);
        clock.Jump(exerciseId, LeverScenarioMinute);
        return clock.CurrentScenarioTime(exerciseId)!.Value;
    }

    private static void AssertSessionLeverEvent(
        EngineReviewTestHost host, TelemetryEvent recorded, string eventType, Guid exerciseId, DateTimeOffset scenarioNow)
    {
        recorded.EventType.Should().Be(eventType);
        recorded.ExerciseId.Should().Be(exerciseId);
        recorded.Channel.Should().Be("system", "a staff-change record rides the system channel, like the lead-release flip");
        recorded.Actor.Kind.Should().Be("system");
        recorded.Actor.ActingHumanId.Should().Be(host.StaffUserId.ToString(), "the SESSION person, never the body id (WR-2)")
            .And.NotBe(SpoofedActingHumanId);
        recorded.Actor.SessionId.Should().Be(host.SessionId.ToString());
        recorded.Actor.Role.Should().Be("controller", "the caller's live enrollment role");
        recorded.ScenarioTime.Should().Be(scenarioNow, "COR-053: the live scenario clock's instant");
        recorded.Target!.EntityType.Should().Be("exercise");
        recorded.Target.EntityId.Should().Be(exerciseId.ToString());
        recorded.Payload.Should().NotContain(SpoofedActingHumanId);
    }

    private static void AssertSessionLeverAudit(EngineReviewTestHost host, OrgAuditEvent audit, string auditKind, string eventPayload)
    {
        audit.Kind.Should().Be(auditKind);
        audit.Outcome.Should().Be("success");
        audit.ActorPersonId.Should().Be(host.StaffUserId, "the org audit names the session person");
        audit.OrganizationId.Should().Be(Organization.DefaultOrganizationId, "the exercise's own organization");
        audit.Payload.Should().Be(eventPayload, "the event and the audit share one payload");
    }

    private async Task<(List<TelemetryEvent> Events, List<OrgAuditEvent> Audits)> LeverRecordsAsync(Guid exerciseId)
    {
        await using var verify = _fixture.CreateContext();
        var events = await verify.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == exerciseId && LeverEventTypes.Contains(e.EventType))
            .ToListAsync();
        var audits = await verify.OrgAuditEvents.IgnoreQueryFilters()
            .Where(a => a.ExerciseId == exerciseId && LeverAuditKinds.Contains(a.Kind))
            .ToListAsync();
        return (events, audits);
    }

    private async Task AssertNoLeverRecordAsync(Guid exerciseId, string because)
    {
        var (events, audits) = await LeverRecordsAsync(exerciseId);
        events.Should().BeEmpty(because);
        audits.Should().BeEmpty(because);
    }
}
