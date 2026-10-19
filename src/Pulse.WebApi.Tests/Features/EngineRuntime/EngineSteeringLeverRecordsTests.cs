namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.Identity.Enrollments;
using Xunit;

/// <summary>
/// Issue #618 — the record vocabulary of the three autonomy steering levers (<see cref="EngineSteeringLeverRecords"/>):
/// the event types and audit kinds, the previous/new-state postures, and the payload shapes. Model-only (no DB, no
/// host), so <c>[Fact]</c>: this half runs on every machine; the emission itself is proven over HTTP by the
/// Docker-gated <c>EngineReviewEndpointsTests</c> lever tests.
/// </summary>
public class EngineSteeringLeverRecordsTests
{
    [Fact]
    public void TheOffLever_ReusesTheExistingSwampedModeOffTypeAndAuditKind()
    {
        EngineSteeringLeverRecords.SwampedModeOffEventType.Should().Be(
            EnrollmentService.SwampedModeOffEventType, "one change, one name, whichever path turned swamped mode off");
        EngineSteeringLeverRecords.SwampedModeOffAuditKind.Should().Be(EnrollmentService.SwampedModeOffAuditKind);
        EngineSteeringLeverRecords.SwampedModeOffEventType.Should().Be("engine.swamped-mode.turned-off");
    }

    [Fact]
    public void TheLeverVocabulary_IsExactlyTheStaffChangeNames_AndOutsideTheEngineLoopTaxonomy()
    {
        EngineSteeringLeverRecords.SwampedModeOnEventType.Should().Be("engine.swamped-mode.turned-on");
        EngineSteeringLeverRecords.KillSwitchEngagedEventType.Should().Be("engine.kill-switch.engaged");
        EngineSteeringLeverRecords.AutonomyRestoredEventType.Should().Be("engine.autonomy.restored");
        EngineSteeringLeverRecords.SwampedModeOnAuditKind.Should().Be("org.engine.swamped-mode-on");
        EngineSteeringLeverRecords.KillSwitchEngagedAuditKind.Should().Be("org.engine.kill-switch-engaged");
        EngineSteeringLeverRecords.AutonomyRestoredAuditKind.Should().Be("org.engine.autonomy-restored");

        var loopTaxonomy = typeof(EngineEventTypes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();
        loopTaxonomy.Should().NotContain(
            [
                EngineSteeringLeverRecords.SwampedModeOnEventType,
                EngineSteeringLeverRecords.SwampedModeOffEventType,
                EngineSteeringLeverRecords.KillSwitchEngagedEventType,
                EngineSteeringLeverRecords.AutonomyRestoredEventType,
            ],
            "the levers are staff-change records (system channel + org audit), not engine-loop events");
    }

    [Theory]
    [InlineData(false, false, "running")]
    [InlineData(false, true, "clamped")]
    [InlineData(true, true, "stopped")]
    public void PostureOf_Flags_NamesTheSafetyPosture(bool stopped, bool clamped, string expected) =>
        EngineSteeringLeverRecords.PostureOf(stopped, clamped).Should().Be(expected);

    [Fact]
    public void PostureOf_State_FollowsTheKillSwitchAndRestore()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid());
        EngineSteeringLeverRecords.PostureOf(state).Should().Be("running");

        state.EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 3);
        EngineSteeringLeverRecords.PostureOf(state).Should().Be("clamped");

        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 4);
        EngineSteeringLeverRecords.PostureOf(state).Should().Be("stopped");

        state.RestoreFromSafety("lead-1", 5);
        EngineSteeringLeverRecords.PostureOf(state).Should().Be("running");

        state.DegradeToSuggest("provider down", 6);
        EngineSteeringLeverRecords.PostureOf(state).Should().Be("clamped", "the degraded clamp is a clamp too");
    }

    [Fact]
    public void SwampedModePayload_CarriesReasonPreviousNewStateAndScenarioMinute()
    {
        using var payload = JsonDocument.Parse(EngineSteeringLeverRecords.SwampedModePayload(wasOn: false, isOn: true, scenarioMinute: 42));

        payload.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("reason", "wasOn", "isOn", "scenarioMinute");
        payload.RootElement.GetProperty("reason").GetString().Should().Be("controller");
        payload.RootElement.GetProperty("wasOn").GetBoolean().Should().BeFalse();
        payload.RootElement.GetProperty("isOn").GetBoolean().Should().BeTrue();
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(42);
    }

    [Theory]
    [InlineData(KillSwitchMode.DropToSuggest, "drop-to-suggest")]
    [InlineData(KillSwitchMode.FullStop, "full-stop")]
    public void KillSwitchPayload_CarriesTheRouteModeLiteralPosturesAndScenarioMinute(KillSwitchMode mode, string literal)
    {
        using var payload = JsonDocument.Parse(EngineSteeringLeverRecords.KillSwitchPayload(mode, "running", "clamped", 7));

        payload.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("mode", "fromPosture", "toPosture", "scenarioMinute");
        payload.RootElement.GetProperty("mode").GetString().Should().Be(literal, "the same literal the kill-switch route accepts");
        payload.RootElement.GetProperty("fromPosture").GetString().Should().Be("running");
        payload.RootElement.GetProperty("toPosture").GetString().Should().Be("clamped");
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(7);
    }

    [Fact]
    public void RestorePayload_CarriesPosturesAndScenarioMinute_AndNoIdentity()
    {
        var raw = EngineSteeringLeverRecords.RestorePayload("stopped", "running", 0);
        using var payload = JsonDocument.Parse(raw);

        payload.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal(["fromPosture", "toPosture", "scenarioMinute"], "the actor is on the envelope, never in the payload");
        payload.RootElement.GetProperty("fromPosture").GetString().Should().Be("stopped");
        payload.RootElement.GetProperty("toPosture").GetString().Should().Be("running");
        payload.RootElement.GetProperty("scenarioMinute").GetInt32().Should().Be(0);
    }

    [Fact]
    public void ActionInput_CarriesNoSessionUnlessTheEndpointSetsOne()
    {
        var bodyOnly = new EngineReviewActionInput("spoofed-lead", "UTC");
        bodyOnly.Session.Should().BeNull("only the endpoint, from the verified session, sets the recorded actor (WR-2)");

        var person = Guid.NewGuid();
        var session = Guid.NewGuid();
        var attributed = bodyOnly with { Session = new StaffChangeActor(person, "controller", session) };
        attributed.Session!.PersonId.Should().Be(person);
        attributed.Session.SessionId.Should().Be(session);
    }
}
