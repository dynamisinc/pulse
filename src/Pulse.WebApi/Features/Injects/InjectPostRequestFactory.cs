namespace Pulse.WebApi.Features.Injects;

using System.Linq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The ONE place a scripted post is turned into the ingest funnel's input (IQ-2): a <see cref="CreatePostRequest"/>
/// plus the trusted, server-stated <see cref="PostAttribution"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Attribution (COR-018):</b> <c>origin: inject</c> — reachable only in-process, never over HTTP — with the item id
/// as <c>injectId</c>, the persona as author, and the controller who set the post in motion as the acting human.
/// <b>Scenario time (COR-053)</b> and the time zone come from the exercise clock and row, never a client.
/// </para>
/// <para>
/// <b>Media, reply and baseline (IQ-10, onto demo-polish BP's typed members).</b> The child's library media become
/// <see cref="CreatePostRequest.Media"/> (<c>{ mediaId, alt }</c> — the queue stores no poster, so
/// <c>posterMediaId</c> is never sent); the already-resolved reply parent (a scripted parent's <c>FiredPostId</c>, or
/// <c>replyTo.postId</c>) becomes <see cref="CreatePostRequest.ParentPostId"/>; the <c>Baseline*</c> columns become
/// <see cref="CreatePostRequest.EngagementBaseline"/>, which the funnel honours for origin <c>inject</c>. Every rule
/// on them — media ownership and kinds, the parent resolving in scope, the baseline range — is the FUNNEL's, so an
/// in-process scripted post gets exactly the validation an HTTP post does.
/// </para>
/// <para>
/// <b>Tripwire (M3):</b> <c>InjectPostRequestFactoryTripwireTests</c> fails if any of BP's typed members exists on
/// <see cref="CreatePostRequest"/> and this method leaves it null — so a refactor cannot silently drop a scripted
/// post's media, reply or baseline.
/// </para>
/// </remarks>
public static class InjectPostRequestFactory
{
    /// <summary>The <c>PostOrigin</c> this caller states — reserved for exactly this in-process caller.</summary>
    public const string InjectOrigin = "inject";

    /// <summary>Builds the funnel input for one scripted post.</summary>
    /// <param name="item">The owning item (its id becomes the post's <c>injectId</c>).</param>
    /// <param name="child">The scripted post being published.</param>
    /// <param name="parentPostId">The resolved reply parent post id, or <c>null</c> for a top-level post.</param>
    /// <param name="actingHumanId">The staff user the post is attributed to (server-derived).</param>
    /// <param name="time">The exercise scenario instant and time zone for the post.</param>
    /// <returns>The request and the attribution to pass to <see cref="PostIngestService.IngestAsync"/>.</returns>
    public static (CreatePostRequest Request, PostAttribution Attribution) Build(
        InjectItem item,
        InjectItemPost child,
        Guid? parentPostId,
        Guid actingHumanId,
        InjectEventTime time)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(child);
        ArgumentNullException.ThrowIfNull(time);

        var hasBaseline = child.BaselineLike is not null || child.BaselineRepost is not null || child.BaselineReply is not null;

        var request = new CreatePostRequest
        {
            Text = child.Text,
            ScenarioTime = InjectWire.Instant(time.ScenarioTime),
            TimeZone = time.TimeZone,
            InjectId = item.Id.ToString(),
            Media = child.Media.Count == 0
                ? null
                : child.Media.Select(media => new CreatePostMediaRequest(media.MediaId, media.Alt, PosterMediaId: null)).ToList(),
            ParentPostId = parentPostId?.ToString(),
            EngagementBaseline = hasBaseline
                ? new EngagementBaselineRequest(child.BaselineLike, child.BaselineRepost, child.BaselineReply)
                : null,
        };

        var attribution = new PostAttribution
        {
            AuthorPersonaId = child.PersonaId,
            Origin = InjectOrigin,
            ActingHumanId = actingHumanId.ToString(),
        };

        return (request, attribution);
    }
}
