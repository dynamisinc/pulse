namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Globalization;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Xunit;
using static Pulse.WebApi.Tests.Features.Injects.InjectTestData;

/// <summary>
/// The XC-004 <c>inject_action</c> event shape (IQ-8) — including that it passes the SAME envelope rules the
/// <c>PulseDbContext</c> write guard enforces — and the funnel input the queue builds for a fire (IQ-2, COR-018,
/// COR-053).
/// </summary>
public sealed class InjectTelemetryAndRequestFactoryTests
{
    private static readonly InjectEventTime Time = new(
        T0, new DateTimeOffset(2033, 5, 1, 9, 30, 0, TimeSpan.FromHours(-5)), "America/Chicago");

    [Fact]
    public void AnItemAction_HasTheLockedShape()
    {
        var item = Item(InjectKinds.Burst, InjectStatuses.Held);
        var actor = Guid.NewGuid();

        var evt = InjectTelemetry.ForItem(item, InjectActions.Hold, actor, Time);

        evt.SchemaVersion.Should().Be("v0");
        evt.ExerciseId.Should().Be(item.ExerciseId);
        evt.EventType.Should().Be("inject_action");
        evt.Channel.Should().Be("system");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ActingHumanId.Should().Be(actor.ToString(), "the controller from the server session (COR-018)");
        evt.Actor.PersonaId.Should().BeNull();
        evt.InjectId.Should().Be(item.Id.ToString());
        evt.Origin.Should().BeNull("a queue action is not content; the published post carries origin: inject");
        evt.Target!.EntityType.Should().Be("inject");
        evt.Target.EntityId.Should().Be(item.Id.ToString());
        evt.WallClockTime.Should().Be(T0);
        evt.EmittedAt.Should().Be(T0);
        evt.ScenarioTime.Should().Be(Time.ScenarioTime);
        evt.TimeZone.Should().Be("America/Chicago");

        using var payload = JsonDocument.Parse(evt.Payload!);
        payload.RootElement.GetProperty("action").GetString().Should().Be("hold");
        payload.RootElement.GetProperty("kind").GetString().Should().Be("burst");
        payload.RootElement.GetProperty("status").GetString().Should().Be("held");
    }

    [Theory]
    [InlineData(InjectActions.Create)]
    [InlineData(InjectActions.Edit)]
    [InlineData(InjectActions.Delete)]
    [InlineData(InjectActions.Hold)]
    [InlineData(InjectActions.Release)]
    [InlineData(InjectActions.Skip)]
    [InlineData(InjectActions.Unskip)]
    [InlineData(InjectActions.Fire)]
    [InlineData(InjectActions.Retry)]
    public void EveryItemAction_PassesTheEnvelopeRulesTheWriteGuardEnforces(string action)
    {
        var evt = InjectTelemetry.ForItem(Item(), action, Guid.NewGuid(), Time);

        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty(
            "PulseDbContext.GuardTelemetryEnvelope runs these rules on every save — a violating event would abort "
            + "the action it was meant to record");
    }

    [Fact]
    public void Reorder_TargetsTheQueue_AndPassesTheEnvelopeRules()
    {
        var exercise = Guid.NewGuid();

        var evt = InjectTelemetry.ForReorder(exercise, Guid.NewGuid(), Time);

        evt.InjectId.Should().BeNull("a reorder touches the whole queue, not one item");
        evt.Target!.EntityType.Should().Be("inject-queue");
        evt.Target.EntityId.Should().Be(exercise.ToString());
        evt.Payload.Should().Be("{\"action\":\"reorder\"}");
        TelemetryEnvelopeRules.Validate(TelemetryAttributionFacts.FromEntity(evt)).Should().BeEmpty();
    }

    [Fact]
    public void TheFunnelInput_IsAnInjectOriginPost_AttributedToTheControllerWhoFired()
    {
        var item = Item(InjectKinds.Post, childCount: 1);
        var child = Children(item)[0];
        var controller = Guid.NewGuid();

        var (request, attribution) = InjectPostRequestFactory.Build(item, child, parentPostId: null, controller, Time);

        attribution.Origin.Should().Be("inject");
        attribution.AuthorPersonaId.Should().Be(child.PersonaId, "the persona is the author");
        attribution.ActingHumanId.Should().Be(controller.ToString(), "the controller who pressed Fire (COR-018)");
        request.InjectId.Should().Be(item.Id.ToString(), "ingest requires injectId for origin inject");
        request.Text.Should().Be(child.Text);
        request.TimeZone.Should().Be("America/Chicago");
        DateTimeOffset.Parse(request.ScenarioTime!, CultureInfo.InvariantCulture).Should().Be(
            Time.ScenarioTime, "scenario time comes from the exercise clock, round-tripped (COR-053)");
        request.ScenarioTime.Should().Be(Time.ScenarioTime.ToString("O", CultureInfo.InvariantCulture));
        request.Origin.Should().BeNull("the request body's origin is inert; attribution is stated separately");
        request.ActingHumanId.Should().BeNull();
        request.AuthorPersonaId.Should().BeNull();
    }
}
