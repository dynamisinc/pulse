namespace Pulse.WebApi.Features.Injects;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The ONE place a scripted post is turned into the ingest funnel's input (IQ-2): a <see cref="CreatePostRequest"/>
/// plus the trusted, server-stated <see cref="PostAttribution"/>. Keeping it in one small method is what lets the
/// BP merge (IQ-10) be a one-place change.
/// </summary>
/// <remarks>
/// <para>
/// <b>Attribution (COR-018):</b> <c>origin: inject</c> — reachable only in-process, never over HTTP — with the item id
/// as <c>injectId</c>, the persona as author, and the controller who set the post in motion as the acting human.
/// <b>Scenario time (COR-053)</b> and the time zone come from the exercise clock and row, never a client.
/// </para>
/// <para>
/// <b>Text only, until demo-polish BP merges (IQ-10).</b> <see cref="CreatePostRequest"/> has no typed media, parent
/// or baseline members yet, so today this maps the text alone. When BP lands, map them HERE onto BP's typed members
/// (docs/features/demo-polish/implementation.md §1.5.2): <c>child.Media</c> → <c>Media</c>
/// (<c>{ mediaId, alt }</c>), <paramref name="parentPostId"/> → <c>ParentPostId</c>, and the
/// <c>Baseline*</c> columns → <c>EngagementBaseline</c>. The reply parent is already resolved (a scripted parent's
/// <c>FiredPostId</c>, or <c>replyTo.postId</c>) and passed in, so nothing else changes.
/// <para>
/// <b>Tripwire (M3):</b> <c>InjectPostRequestFactoryTripwireTests</c> fails the build the moment BP's typed
/// <c>ParentPostId</c> / <c>Media</c> / <c>EngagementBaseline</c> members exist on <see cref="CreatePostRequest"/>
/// and this method still leaves them null — so the BP merge cannot silently ship scripted posts without their media,
/// reply or baseline.
/// </para>
/// </para>
/// </remarks>
public static class InjectPostRequestFactory
{
    /// <summary>The <c>PostOrigin</c> this caller states — reserved for exactly this in-process caller.</summary>
    public const string InjectOrigin = "inject";

    /// <summary>Builds the funnel input for one scripted post.</summary>
    /// <param name="item">The owning item (its id becomes the post's <c>injectId</c>).</param>
    /// <param name="child">The scripted post being published.</param>
    /// <param name="parentPostId">The resolved reply parent post id, or <c>null</c> (mapped once BP lands).</param>
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

        // parentPostId, child.Media and child.Baseline* are intentionally NOT mapped yet — see the remarks (IQ-10).
        _ = parentPostId;

        var request = new CreatePostRequest
        {
            Text = child.Text,
            ScenarioTime = InjectWire.Instant(time.ScenarioTime),
            TimeZone = time.TimeZone,
            InjectId = item.Id.ToString(),
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
