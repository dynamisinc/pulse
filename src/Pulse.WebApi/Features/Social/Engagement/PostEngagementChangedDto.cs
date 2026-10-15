namespace Pulse.WebApi.Features.Social.Engagement;

using System.Text.Json.Serialization;

/// <summary>
/// The wire payload of the SignalR <c>PostEngagementChanged</c> event (demo-feedback DF-17):
/// <c>{ "postId": "&lt;guid&gt;", "counts": { "reply": n, "repost": n, "like": n }, "version": n }</c>, sent to the
/// exercise-wide group after a like or repost changed state, or a reply landed under the post, so every participant
/// card shows the new numbers without a reload.
/// </summary>
/// <remarks>
/// <para>
/// <b>Counts are the SHOWN counts</b>: the seeded baseline plus the real rows, the same numbers the feed projection
/// puts in <c>counts</c>, read through <see cref="IPostEngagementReader"/>. A personal pin never counts (DF-6).
/// </para>
/// <para>
/// <b>Nothing else rides along (XC-002).</b> No viewer state (<c>viewer</c> / <c>active</c> are per-person and this is
/// one payload for the whole group), no actor, no baseline / real split, no instant. A client applies the numbers only
/// and never changes its own liked / reposted state from a push (DF-18).
/// </para>
/// <para>
/// <b><see cref="Version"/> is monotonic per post and derived from the database (DF-18)</b>, never from a process
/// counter, so two app instances compute the same number and a stale or reordered frame can be dropped by the client:
/// <code>
/// version = R + Rd + P + Pd
///   R  = the post's like and repost reaction rows, active AND soft-deleted (a like, a repost, a re-like each add one)
///   Rd = those rows whose DeletedAt is set              (an unlike or an un-repost adds one)
///   P  = the post's direct replies, live AND taken down  (a reply adds one)
///   Pd = those replies whose DeletedAt is set            (a reply takedown adds one)
/// </code>
/// Reaction rows are only ever soft-deleted, never un-deleted or hard-deleted, and a takedown is never reversed, so
/// every like, unlike, repost, un-repost, reply and reply takedown raises the version by exactly one and nothing lowers
/// it. Pin rows are not counted (a pin never pushes). All four terms are read through the exercise-scoped sets, so a
/// stray row from another exercise can never move it (COR-001). See <see cref="PostEngagementVersion"/>.
/// </para>
/// </remarks>
/// <param name="PostId">The post's id, as a GUID string (the same form <c>ParticipantPostDto.Id</c> uses).</param>
/// <param name="Counts">The shown counts (baseline + real), exactly as the feed projection reports them.</param>
/// <param name="Version">The database-derived, per-post monotonic version (see the remarks for the formula).</param>
public sealed record PostEngagementChangedDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("counts")] ParticipantPostCounts Counts,
    [property: JsonPropertyName("version")] long Version)
{
    /// <summary>Builds the payload for one post.</summary>
    /// <param name="postId">The post whose engagement changed.</param>
    /// <param name="counts">The shown counts (baseline + real).</param>
    /// <param name="version">The database-derived version (see <see cref="PostEngagementVersion"/>).</param>
    /// <returns>The <c>PostEngagementChanged</c> payload.</returns>
    public static PostEngagementChangedDto For(Guid postId, ParticipantPostCounts counts, long version)
    {
        ArgumentNullException.ThrowIfNull(counts);
        return new(postId.ToString(), counts, version);
    }
}
