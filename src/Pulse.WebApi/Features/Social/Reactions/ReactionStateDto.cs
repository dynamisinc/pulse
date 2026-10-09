namespace Pulse.WebApi.Features.Social.Reactions;

using System.Text.Json.Serialization;

/// <summary>
/// The reaction write response (demo-polish implementation.md §1.5.4): the caller's state on ONE post after a
/// <c>PUT</c>/<c>DELETE /api/posts/{postId}/reactions/{kind}</c> — the server-side mirror of the frontend
/// <c>ReactionState</c>. Participant-safe by construction (XC-002): it carries no provenance, no acting human, no
/// wall-clock instant and no baseline split, only the displayed counts (baseline + real) and the caller's own flags.
/// </summary>
/// <param name="PostId">The reacted-to post id.</param>
/// <param name="Kind">The reaction kind — <c>like</c> or <c>repost</c>.</param>
/// <param name="Active">Whether the caller's persona holds an active reaction of <paramref name="Kind"/> after the call.</param>
/// <param name="Counts">The displayed counts after the change: baseline + real, reply · repost · like (R-002).</param>
/// <param name="Viewer">The caller's own like/repost state on the post after the change.</param>
public sealed record ReactionStateDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("active")] bool Active,
    [property: JsonPropertyName("counts")] ParticipantPostCounts Counts,
    [property: JsonPropertyName("viewer")] PostViewerStateDto Viewer);
