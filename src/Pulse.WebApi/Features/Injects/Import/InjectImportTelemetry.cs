namespace Pulse.WebApi.Features.Injects.Import;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Builds the ONE XC-004 <c>injects.imported</c> event per MSEL import (demo-feedback story 03), against the locked v0
/// envelope. Counts only: no text, no names, no file name. A dry run emits it too (with <c>dryRun: true</c>) and nothing
/// else; a real import adds it to the same <c>SaveChanges</c> as the items it writes.
/// </summary>
/// <remarks>
/// Shape, mirroring <see cref="InjectTelemetry"/>: <c>channel: system</c>, <c>actor { kind: system, actingHumanId }</c>
/// (the staff user from the server-side session, COR-018), <c>target { entityType: inject-queue, entityId: exerciseId }</c>
/// (an import touches the queue, not one item, so there is no <c>injectId</c>), server wall clock + exercise scenario
/// time + time zone, and the opaque camelCase payload <c>{ created, updated, unchanged, skipped, failed, dryRun }</c>.
/// </remarks>
public static class InjectImportTelemetry
{
    /// <summary>The XC-004 event type.</summary>
    public const string EventType = "injects.imported";

    private static readonly JsonSerializerOptions PayloadOptions = new();

    /// <summary>Builds the event.</summary>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="actingHumanId">The staff user who imported (server-derived).</param>
    /// <param name="result">The import report (its counts go into the payload).</param>
    /// <param name="time">The one clock read for the import.</param>
    /// <returns>The telemetry row to add to the import's unit of work.</returns>
    public static TelemetryEvent Imported(Guid exerciseId, Guid actingHumanId, InjectImportResultDto result, InjectEventTime time)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(time);

        var payload = new ImportedPayload(
            result.CreatedCount,
            result.UpdatedCount,
            result.UnchangedCount,
            result.SkippedCount,
            result.FailedCount,
            result.DryRun);

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = EventType,
            Channel = InjectTelemetry.Channel,
            Actor = new TelemetryActor
            {
                Kind = InjectTelemetry.ActorKind,
                ActingHumanId = actingHumanId.ToString(),
            },
            WallClockTime = time.WallClock,
            ScenarioTime = time.ScenarioTime,
            TimeZone = time.TimeZone,
            Target = new TelemetryTarget { EntityType = InjectTelemetry.QueueEntityType, EntityId = exerciseId.ToString() },
            Payload = JsonSerializer.Serialize(payload, PayloadOptions),
            EmittedAt = time.WallClock,
        };
    }

    /// <summary>The opaque payload — camelCase by explicit property names, never parsed server-side.</summary>
    private sealed record ImportedPayload(
        [property: JsonPropertyName("created")] int Created,
        [property: JsonPropertyName("updated")] int Updated,
        [property: JsonPropertyName("unchanged")] int Unchanged,
        [property: JsonPropertyName("skipped")] int Skipped,
        [property: JsonPropertyName("failed")] int Failed,
        [property: JsonPropertyName("dryRun")] bool DryRun);
}
