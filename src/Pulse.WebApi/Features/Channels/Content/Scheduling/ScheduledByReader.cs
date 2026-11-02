namespace Pulse.WebApi.Features.Channels.Content.Scheduling;

using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Who a scheduled publish acts as (story 05): the human who SCHEDULED the item, with the origin of that schedule call,
/// read back from the item's latest <c>content_scheduled</c> (<c>action: schedule</c>) event — the funnel's durable record
/// of the schedule call, written in the same unit of work as the state change. No column holds it, and the item's own
/// <c>ActingHumanId</c> is whoever drafted it.
/// </summary>
/// <remarks>
/// The read runs in the item's exercise scope (the central filter confines it). When no schedule event can be read
/// (telemetry pruned, a row written before the funnel), the item's own attribution is used, with a staff
/// <c>controller</c> origin for an engine draft, since only staff schedule those (NWS-022).
/// </remarks>
public sealed class ScheduledByReader
{
    // A handful of recent events is plenty: the latest schedule is the current one (a failure or unschedule ends it).
    private const int RecentEvents = 10;

    private readonly PulseDbContext _db;

    /// <summary>Creates the reader.</summary>
    /// <param name="db">The item's exercise-scoped unit of work.</param>
    public ScheduledByReader(PulseDbContext db)
    {
        ArgumentNullException.ThrowIfNull(db);
        _db = db;
    }

    /// <summary>The caller to publish item <paramref name="itemId"/> as, or null when it is not visible in this scope.</summary>
    /// <param name="itemId">The scheduled item.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The scheduling human's caller.</returns>
    public async Task<ContentCaller?> ReadAsync(Guid itemId, CancellationToken cancellationToken = default)
    {
        var entityId = itemId.ToString();
        var events = await _db.TelemetryEvents
            .AsNoTracking()
            .Where(e => e.EventType == ContentTelemetry.ContentScheduled
                && e.Target != null
                && e.Target.EntityType == ContentTelemetry.EntityType
                && e.Target.EntityId == entityId)
            .OrderByDescending(e => e.EmittedAt)
            .Take(RecentEvents)
            .Select(e => new { e.Origin, e.InjectId, e.Actor.ActingHumanId, e.Payload })
            .ToListAsync(cancellationToken);

        var scheduledBy = events.FirstOrDefault(e => IsScheduleAction(e.Payload));
        if (scheduledBy is not null && !string.IsNullOrWhiteSpace(scheduledBy.ActingHumanId))
        {
            // The envelope origin is the v0 union (ContentTelemetry.TelemetryOriginOf): null is a controller action.
            var origin = scheduledBy.Origin ?? ChannelVocabulary.OriginController;
            return new ContentCaller
            {
                Origin = origin,
                ActingHumanId = scheduledBy.ActingHumanId,
                InjectId = origin == ChannelVocabulary.OriginInject && Guid.TryParse(scheduledBy.InjectId, out var injectId)
                    ? injectId
                    : null,
            };
        }

        var item = await _db.ContentItems
            .AsNoTracking()
            .Where(candidate => candidate.Id == itemId)
            .Select(candidate => new { candidate.Origin, candidate.ActingHumanId, candidate.InjectId })
            .FirstOrDefaultAsync(cancellationToken);
        if (item is null)
        {
            return null;
        }

        var fallbackOrigin = item.Origin is ChannelVocabulary.OriginEngine or ChannelVocabulary.OriginInject
            ? ChannelVocabulary.OriginController
            : item.Origin;
        return new ContentCaller { Origin = fallbackOrigin, ActingHumanId = item.ActingHumanId };
    }

    private static bool IsScheduleAction(string? payload)
    {
        if (string.IsNullOrEmpty(payload))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("action", out var action)
                && action.ValueKind == JsonValueKind.String
                && action.GetString() == ContentTransitions.Schedule;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
