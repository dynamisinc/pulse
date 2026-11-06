namespace Pulse.WebApi.Features.Channels.Content.Staff;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Preview-as-participant (COR-041): maps an item in ANY status onto the participant wire shape, so the console renders
/// exactly what a participant would see. Pure; the input is the funnel's own staff projection, so the participant fields
/// are the same values the participant read serves, the payload goes through the kind's own participant projection, and
/// the output types carry no staff field (XC-002, sealed DTOs).
/// </summary>
/// <remarks>
/// A retracted item previews as the tombstone participants read. Every other status previews as the published article;
/// an item not yet published shows the instant it would carry: its scheduled time, else "now" in scenario time.
/// </remarks>
public static class ContentPreviewMapper
{
    /// <summary>The participant DTO (<see cref="ChannelContentDto"/> or <see cref="ChannelContentTombstoneDto"/>).</summary>
    /// <param name="item">The stored item (for the retraction instant).</param>
    /// <param name="staff">The funnel's staff projection of <paramref name="item"/>.</param>
    /// <param name="scenarioNow">The exercise's current scenario time (COR-053).</param>
    /// <param name="descriptor">The item's kind; its <c>ProjectPayload</c> drops staff-only payload keys (XC-002). An
    /// unregistered kind previews an EMPTY payload (fail closed), never the raw stored one.</param>
    /// <returns>The participant view.</returns>
    public static object ToParticipant(
        ContentItem item, ChannelContentStaffDto staff, DateTimeOffset scenarioNow, IContentKindDescriptor? descriptor)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(staff);

        if (item.Status == ChannelVocabulary.StatusRetracted)
        {
            return new ChannelContentTombstoneDto
            {
                Id = staff.Id,
                ChannelId = staff.ChannelId,
                Kind = staff.Kind,
                Outlet = staff.Outlet,
                Slug = staff.Slug,
                Permalink = staff.Permalink,
                RetractedScenarioTime = ContentProjector.Iso(item.RetractedScenarioTime ?? scenarioNow),
            };
        }

        return new ChannelContentDto
        {
            Id = staff.Id,
            ChannelId = staff.ChannelId,
            Kind = staff.Kind,
            Outlet = staff.Outlet,
            Slug = staff.Slug,
            Permalink = staff.Permalink,
            Headline = staff.Headline,
            Dek = staff.Dek,
            Kicker = staff.Kicker,
            Category = staff.Category,
            Hero = staff.Hero,
            PublishedScenarioTime = staff.PublishedScenarioTime
                ?? staff.ScheduledScenarioTime
                ?? ContentProjector.Iso(scenarioNow),
            UpdatedScenarioTime = staff.UpdatedScenarioTime,
            Featured = staff.Featured,
            Byline = staff.Byline,
            BodyHtml = staff.BodyHtml,
            Media = staff.Media,
            Revisions = staff.Revisions, // already the participant-visible subset (update / correction)
            PairedPostId = staff.PairedPostId,
            AlertId = staff.AlertId,
            // A private copy: a projection may hand back (part of) its input, and the staff DTO keeps its own.
            Payload = descriptor?.ProjectPayload(staff.Payload.DeepClone().AsObject()) ?? [],
        };
    }
}
