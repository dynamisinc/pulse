namespace Pulse.WebApi.Features.Channels.Contracts;

using Pulse.WebApi.Data.Entities;

/// <summary>
/// FC-7, posts a Social link card for a published item as its outlet's paired persona (implemented by
/// channels-foundation story 18 through <c>PostIngestService</c>). The post's origin mirrors the item's, and the
/// acting human is the PUBLISH CALL's (<see cref="ContentCaller.ActingHumanId"/>), never the persona's owner
/// (press FU-8). A failure never blocks the publish; the funnel reports it as a side-effect warning.
/// </summary>
public interface IPairedSocialPoster
{
    /// <summary>Posts the link card.</summary>
    /// <param name="item">The just-published item (its permalink is the card's target).</param>
    /// <param name="text">The post text above the card, or null for the default composition.</param>
    /// <param name="caller">The publish call's caller.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The new post id, or null when the outlet has no paired persona.</returns>
    Task<Guid?> PostLinkCardAsync(
        ContentItem item, string? text, ContentCaller caller, CancellationToken cancellationToken = default);
}
