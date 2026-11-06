namespace Pulse.WebApi.Features.Press.Contracts;

using System.Globalization;
using System.Text.Json.Nodes;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// PC-5, the ONE emitter for every E5 server telemetry event (press-room story 01, #738; XC-004). The <c>eventType</c>
/// strings are registered once by channels-foundation story 02 (<see cref="ChannelTelemetryEventTypes"/>, FC-6b); this
/// class declares each event's payload shape and builds the v0 envelope: <c>channel: 'press'</c>, wall + scenario time,
/// target <c>{ content_item, id }</c>, and the HUMAN as actor (<c>actingHumanId</c>) with the shared org handle in
/// <c>actor.personaId</c> (and <c>payload.orgPersonaId</c> where PC-5 lists it).
/// </summary>
/// <remarks>
/// <para>
/// <b>Declared types only.</b> <see cref="Build"/> refuses an event type that is not in <see cref="All"/>, and a payload
/// key that its shape does not declare, so an undeclared event can never be emitted through here.
/// </para>
/// <para>
/// <b><c>press_release</c> is the funnel's.</b> F04 emits it (instead of <c>content_published</c>, never both) for a
/// participant-origin release publish; its shape is declared here so the vocabulary is complete, but
/// <see cref="Build"/> refuses it so it is never emitted twice. Mirrored by <c>PRESS_TELEMETRY_SHAPES</c> in
/// <c>telemetry.ts</c>; both are pinned to <c>pressWireContract.json</c>.
/// </para>
/// </remarks>
public static class PressTelemetry
{
    /// <summary>Emitted by an E5 server service through <see cref="Build"/>.</summary>
    public const string EmitterServer = "server";

    /// <summary>Emitted by the F04 publish funnel, not by E5.</summary>
    public const string EmitterFunnel = "funnel";

    /// <summary>The envelope channel of every E5 event.</summary>
    public const string Channel = ChannelVocabulary.Press;

    /// <summary>The target entity type of every E5 event.</summary>
    public const string EntityType = ContentTelemetry.EntityType;

    /// <summary><c>press_release</c>: F04, a participant release publish.</summary>
    public static PressTelemetryShape Release { get; } = new(
        ContentTelemetry.PressRelease,
        EmitterFunnel,
        [
            "kind", "inputPath", "crossPost", "embargoed", "approvalRequired", "draftStartedScenarioTime",
            "draftToPublishSec", "revisionCountAtPublish", "orgPersonaId",
        ]);

    /// <summary><c>press_draft_created</c>: story 04.</summary>
    public static PressTelemetryShape DraftCreated { get; } =
        new(ChannelTelemetryEventTypes.PressDraftCreated, EmitterServer, ["orgPersonaId", "inputPath"]);

    /// <summary><c>press_embargo_set</c>: story 05.</summary>
    public static PressTelemetryShape EmbargoSet { get; } =
        new(ChannelTelemetryEventTypes.PressEmbargoSet, EmitterServer, ["scheduledScenarioTime", "orgPersonaId"]);

    /// <summary><c>press_embargo_cancelled</c>: story 05.</summary>
    public static PressTelemetryShape EmbargoCancelled { get; } = new(
        ChannelTelemetryEventTypes.PressEmbargoCancelled,
        EmitterServer,
        ["scheduledScenarioTime", "orgPersonaId", "approversNotified"]);

    /// <summary><c>press_approval_requested</c>: story 06.</summary>
    public static PressTelemetryShape ApprovalRequested { get; } = ApprovalShape(ChannelTelemetryEventTypes.PressApprovalRequested);

    /// <summary><c>press_approval_approved</c>: story 06.</summary>
    public static PressTelemetryShape ApprovalApproved { get; } = ApprovalShape(ChannelTelemetryEventTypes.PressApprovalApproved);

    /// <summary><c>press_approval_returned</c>: story 06.</summary>
    public static PressTelemetryShape ApprovalReturned { get; } = ApprovalShape(ChannelTelemetryEventTypes.PressApprovalReturned);

    /// <summary>Every PC-5 shape, in PC-5 order. <c>press_wire_view</c> is not an event: it reuses <c>article_view</c>.</summary>
    public static IReadOnlyList<PressTelemetryShape> All { get; } =
        [Release, DraftCreated, EmbargoSet, EmbargoCancelled, ApprovalRequested, ApprovalApproved, ApprovalReturned];

    /// <summary>Builds the <c>press_draft_created</c> event.</summary>
    /// <param name="release">The release and its org.</param>
    /// <param name="inputPath">The draft's input path (<see cref="PressVocabulary.InputPaths"/>).</param>
    /// <param name="caller">The human behind the action.</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row to add to the same unit of work.</returns>
    public static TelemetryEvent ForDraftCreated(
        PressEventTarget release, string inputPath, ContentCaller caller, ContentEventTime time) =>
        Build(DraftCreated.EventType, release, caller, time, new JsonObject
        {
            ["orgPersonaId"] = release.OrgPersonaId.ToString(),
            ["inputPath"] = inputPath,
        });

    /// <summary>Builds the <c>press_embargo_set</c> event.</summary>
    /// <param name="release">The release and its org.</param>
    /// <param name="scheduledScenarioTime">The embargo time.</param>
    /// <param name="caller">The human behind the action.</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row.</returns>
    public static TelemetryEvent ForEmbargoSet(
        PressEventTarget release, DateTimeOffset scheduledScenarioTime, ContentCaller caller, ContentEventTime time) =>
        Build(EmbargoSet.EventType, release, caller, time, new JsonObject
        {
            ["scheduledScenarioTime"] = Iso(scheduledScenarioTime),
            ["orgPersonaId"] = release.OrgPersonaId.ToString(),
        });

    /// <summary>Builds the <c>press_embargo_cancelled</c> event.</summary>
    /// <param name="release">The release and its org.</param>
    /// <param name="scheduledScenarioTime">The embargo time that was cancelled.</param>
    /// <param name="approversNotified">How many approvers were told.</param>
    /// <param name="caller">The human behind the action.</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row.</returns>
    public static TelemetryEvent ForEmbargoCancelled(
        PressEventTarget release,
        DateTimeOffset scheduledScenarioTime,
        int approversNotified,
        ContentCaller caller,
        ContentEventTime time) =>
        Build(EmbargoCancelled.EventType, release, caller, time, new JsonObject
        {
            ["scheduledScenarioTime"] = Iso(scheduledScenarioTime),
            ["orgPersonaId"] = release.OrgPersonaId.ToString(),
            ["approversNotified"] = approversNotified,
        });

    /// <summary>Builds one of the three <c>press_approval_*</c> events.</summary>
    /// <param name="eventType">One of the three approval event types.</param>
    /// <param name="release">The release and its org.</param>
    /// <param name="approval">The approval facts.</param>
    /// <param name="caller">The human behind the action (the approver, for approve/return).</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <returns>The telemetry row.</returns>
    public static TelemetryEvent ForApproval(
        string eventType, PressEventTarget release, PressApprovalFacts approval, ContentCaller caller, ContentEventTime time)
    {
        ArgumentNullException.ThrowIfNull(approval);
        if (eventType is not (ChannelTelemetryEventTypes.PressApprovalRequested
            or ChannelTelemetryEventTypes.PressApprovalApproved
            or ChannelTelemetryEventTypes.PressApprovalReturned))
        {
            throw new ArgumentOutOfRangeException(nameof(eventType), eventType, "Not a press approval event.");
        }

        var payload = new JsonObject
        {
            ["approvalId"] = approval.ApprovalId.ToString(),
            ["latencySec"] = approval.LatencySec,
        };
        if (approval.ApproverHumanId is { } approver)
        {
            payload["approverHumanId"] = approver;
        }

        if (approval.NoteLength is { } noteLength)
        {
            payload["noteLength"] = noteLength;
        }

        return Build(eventType, release, caller, time, payload);
    }

    /// <summary>
    /// Builds an E5 server event against its declared shape. Throws for an undeclared type, for the funnel-emitted
    /// <c>press_release</c>, and for a payload key the shape does not declare.
    /// </summary>
    /// <param name="eventType">A declared, server-emitted PC-5 type.</param>
    /// <param name="release">The release and its org.</param>
    /// <param name="caller">The human behind the action.</param>
    /// <param name="time">The one clock read shared with the change.</param>
    /// <param name="payload">The payload; its keys must be declared by the shape.</param>
    /// <returns>The telemetry row.</returns>
    public static TelemetryEvent Build(
        string eventType, PressEventTarget release, ContentCaller caller, ContentEventTime time, JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(release);
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(time);
        ArgumentNullException.ThrowIfNull(payload);

        var shape = All.FirstOrDefault(s => string.Equals(s.EventType, eventType, StringComparison.Ordinal))
            ?? throw new ArgumentOutOfRangeException(nameof(eventType), eventType, "Not a declared PC-5 press event.");
        if (shape.Emitter != EmitterServer)
        {
            throw new ArgumentOutOfRangeException(
                nameof(eventType), eventType, "The publish funnel emits this event; E5 never emits it too.");
        }

        var undeclared = payload.Select(p => p.Key).Where(k => !shape.PayloadKeys.Contains(k, StringComparer.Ordinal)).ToList();
        if (undeclared.Count > 0)
        {
            throw new ArgumentException(
                $"{eventType} does not declare payload key(s): {string.Join(", ", undeclared)}.", nameof(payload));
        }

        var actingHumanId = string.IsNullOrEmpty(caller.ActingHumanId) ? null : caller.ActingHumanId;
        var orgPersonaId = release.OrgPersonaId.ToString();
        var actor = caller.Origin == ChannelVocabulary.OriginParticipant
            ? new TelemetryActor
            {
                Kind = "participant", ParticipantId = actingHumanId, ActingHumanId = actingHumanId, PersonaId = orgPersonaId,
            }
            : new TelemetryActor { Kind = "system", ActingHumanId = actingHumanId, PersonaId = orgPersonaId };

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = release.ExerciseId,
            EventType = eventType,
            Channel = Channel,
            Actor = actor,
            Origin = ContentTelemetry.TelemetryOriginOf(caller.Origin),
            InjectId = caller.InjectId?.ToString(),
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget { EntityType = EntityType, EntityId = release.ContentItemId.ToString() },
            Payload = payload.ToJsonString(),
            EmittedAt = time.WallClock,
        };
    }

    private static PressTelemetryShape ApprovalShape(string eventType) =>
        new(eventType, EmitterServer, ["approvalId", "approverHumanId", "noteLength", "latencySec"]);

    private static string Iso(DateTimeOffset value) => value.ToString("o", CultureInfo.InvariantCulture);
}

/// <summary>One PC-5 event's declared shape.</summary>
/// <param name="EventType">The FC-6b event type.</param>
/// <param name="Emitter"><see cref="PressTelemetry.EmitterServer"/> or <see cref="PressTelemetry.EmitterFunnel"/>.</param>
/// <param name="PayloadKeys">The keys the payload may carry.</param>
public sealed record PressTelemetryShape(string EventType, string Emitter, IReadOnlyList<string> PayloadKeys);

/// <summary>The release an E5 event is about: its exercise, its content item and the org it is issued as.</summary>
/// <param name="ExerciseId">The resolved exercise (from the item, never the client).</param>
/// <param name="ContentItemId">The release.</param>
/// <param name="OrgPersonaId">The organization persona (the shared org handle).</param>
public sealed record PressEventTarget(Guid ExerciseId, Guid ContentItemId, Guid OrgPersonaId);

/// <summary>The facts of one approval event (story 06).</summary>
/// <param name="ApprovalId">The approval record.</param>
/// <param name="LatencySec">Seconds since the approval was requested (0 for the request itself).</param>
/// <param name="ApproverHumanId">The approver, or null for a request.</param>
/// <param name="NoteLength">The return note's length, or null (never the note itself).</param>
public sealed record PressApprovalFacts(Guid ApprovalId, double LatencySec, string? ApproverHumanId = null, int? NoteLength = null);
