namespace Pulse.WebApi.Tests.Features.Press;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Press.Contracts;

/// <summary>
/// Press story 01 (#738), XC-004 / PC-5: <see cref="PressTelemetry"/> builds every E5 server event on the v0 envelope
/// (channel <c>press</c>, wall + scenario time, the human as actor with the org handle), with exactly its declared payload
/// keys, and refuses an undeclared event type, an undeclared payload key and the funnel's own <c>press_release</c>.
/// </summary>
public sealed class PressTelemetryTests
{
    private static readonly PressEventTarget Release = new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

    private static readonly ContentCaller Pio = new() { Origin = ChannelVocabulary.OriginParticipant, ActingHumanId = "human-pio" };

    private static readonly ContentCaller Controller = new() { Origin = ChannelVocabulary.OriginController, ActingHumanId = "human-ctl" };

    private static readonly ContentEventTime Time = new(
        new DateTimeOffset(2026, 11, 2, 15, 0, 0, TimeSpan.Zero), new DateTimeOffset(2033, 9, 4, 9, 30, 0, TimeSpan.FromHours(-4)), "America/New_York");

    public static TheoryData<string> ServerEventTypes()
    {
        var data = new TheoryData<string>();
        foreach (var shape in PressTelemetry.All.Where(s => s.Emitter == PressTelemetry.EmitterServer))
        {
            data.Add(shape.EventType);
        }

        return data;
    }

    [Fact]
    public void EveryPc5Event_IsDeclared_AndRegisteredOnceByTheFoundation()
    {
        PressTelemetry.All.Select(s => s.EventType).Should().Equal(
            "press_release", "press_draft_created", "press_embargo_set", "press_embargo_cancelled",
            "press_approval_requested", "press_approval_approved", "press_approval_returned");
        PressTelemetry.All.Where(s => s.Emitter == PressTelemetry.EmitterServer).Select(s => s.EventType)
            .Should().BeSubsetOf(ChannelTelemetryEventTypes.All, "FC-6b registers the strings; E5 adds none");
        PressTelemetry.Release.EventType.Should().Be(ContentTelemetry.PressRelease);
    }

    [Theory]
    [MemberData(nameof(ServerEventTypes))]
    public void EveryServerEvent_BuildsAValidV0Envelope_WithOnlyItsDeclaredKeys(string eventType)
    {
        var built = BuildEach().Single(e => e.EventType == eventType);
        var shape = PressTelemetry.All.Single(s => s.EventType == eventType);

        built.SchemaVersion.Should().Be("v0");
        built.Channel.Should().Be("press");
        built.ExerciseId.Should().Be(Release.ExerciseId);
        built.WallClockTime.Should().Be(Time.WallClock);
        built.ScenarioTime.Should().Be(Time.ScenarioTime);
        built.TimeZone.Should().Be(Time.TimeZone);
        built.Target!.EntityType.Should().Be("content_item");
        built.Target.EntityId.Should().Be(Release.ContentItemId.ToString());
        built.Actor.ActingHumanId.Should().Be("human-pio");
        built.Actor.PersonaId.Should().Be(Release.OrgPersonaId.ToString(), "the shared org handle rides on the actor");
        built.Actor.Kind.Should().Be("participant");
        built.Actor.ParticipantId.Should().Be("human-pio");
        built.Origin.Should().Be("participant");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(built)).Should().BeEmpty();
        JsonNode.Parse(built.Payload!)!.AsObject().Select(p => p.Key).Should().BeSubsetOf(shape.PayloadKeys);
    }

    [Fact]
    public void AControllerAction_IsASystemActor_StillCarryingTheHumanAndTheOrg()
    {
        var built = PressTelemetry.ForEmbargoSet(Release, Time.ScenarioTime.AddHours(2), Controller, Time);

        built.Actor.Kind.Should().Be("system");
        built.Actor.ActingHumanId.Should().Be("human-ctl");
        built.Actor.PersonaId.Should().Be(Release.OrgPersonaId.ToString());
        built.Origin.Should().BeNull();
        JsonNode.Parse(built.Payload!)!["scheduledScenarioTime"]!.GetValue<string>().Should().Be("2033-09-04T11:30:00.0000000-04:00");
    }

    [Fact]
    public void EmittingAnUndeclaredType_Fails()
    {
        var act = () => PressTelemetry.Build("press_wire_view", Release, Pio, Time, []);

        act.Should().Throw<ArgumentOutOfRangeException>().WithMessage("*Not a declared PC-5 press event*");
    }

    [Fact]
    public void ThePressReleaseEvent_IsTheFunnels_AndIsNeverEmittedTwice()
    {
        var act = () => PressTelemetry.Build("press_release", Release, Pio, Time, []);

        act.Should().Throw<ArgumentOutOfRangeException>().WithMessage("*publish funnel emits this event*");
    }

    [Fact]
    public void AnUndeclaredPayloadKey_Fails()
    {
        var act = () => PressTelemetry.Build(
            "press_draft_created", Release, Pio, Time, new JsonObject { ["orgPersonaId"] = "x", ["headline"] = "leak" });

        act.Should().Throw<ArgumentException>().WithMessage("*headline*");
    }

    [Fact]
    public void ApprovalEvents_OmitAbsentOptionalKeys_AndRefuseANonApprovalType()
    {
        var requested = PressTelemetry.ForApproval(
            "press_approval_requested", Release, new PressApprovalFacts(Guid.NewGuid(), 0), Pio, Time);
        var returned = PressTelemetry.ForApproval(
            "press_approval_returned", Release, new PressApprovalFacts(Guid.NewGuid(), 95.5, "human-approver", 42), Pio, Time);

        JsonNode.Parse(requested.Payload!)!.AsObject().Select(p => p.Key).Should().BeEquivalentTo(["approvalId", "latencySec"]);
        JsonNode.Parse(returned.Payload!)!["noteLength"]!.GetValue<int>().Should().Be(42);
        var act = () => PressTelemetry.ForApproval(
            "press_embargo_set", Release, new PressApprovalFacts(Guid.NewGuid(), 0), Pio, Time);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    private static List<TelemetryEvent> BuildEach() =>
    [
        PressTelemetry.ForDraftCreated(Release, PressVocabulary.InputPathRich, Pio, Time),
        PressTelemetry.ForEmbargoSet(Release, Time.ScenarioTime.AddHours(1), Pio, Time),
        PressTelemetry.ForEmbargoCancelled(Release, Time.ScenarioTime.AddHours(1), 2, Pio, Time),
        PressTelemetry.ForApproval("press_approval_requested", Release, new PressApprovalFacts(Guid.NewGuid(), 0), Pio, Time),
        PressTelemetry.ForApproval(
            "press_approval_approved", Release, new PressApprovalFacts(Guid.NewGuid(), 30, "human-approver"), Pio, Time),
        PressTelemetry.ForApproval(
            "press_approval_returned", Release, new PressApprovalFacts(Guid.NewGuid(), 60, "human-approver", 12), Pio, Time),
    ];
}
