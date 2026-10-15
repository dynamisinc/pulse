namespace Pulse.WebApi.Features.Social.Pins;

using System.Text.Json.Serialization;

/// <summary>
/// The wire payload of the SignalR <c>PostPinChanged</c> event (demo-feedback DF-7, frozen in
/// <c>implementation.md</c>): <c>{ "postId": "&lt;guid&gt;", "pinnedForAll": true|false }</c>. Sent to the exercise-wide
/// group after a controller's exercise pin commits, so every Pinned tab and console updates live.
/// </summary>
/// <remarks>
/// Two members, on purpose (XC-002): no post text, no author, no pin instant and never who pinned it
/// (<c>Post.PinnedForAllByHumanId</c> is staff-only).
/// </remarks>
/// <param name="PostId">The post's id, as a GUID string (the same form <see cref="ParticipantPostDto.Id"/> uses).</param>
/// <param name="PinnedForAll">Whether the post is now pinned for everyone.</param>
public sealed record PostPinChangedDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("pinnedForAll")] bool PinnedForAll)
{
    /// <summary>Builds the payload for one exercise pin change.</summary>
    /// <param name="postId">The post id.</param>
    /// <param name="pinnedForAll">The new state.</param>
    /// <returns>The <c>PostPinChanged</c> payload.</returns>
    public static PostPinChangedDto For(Guid postId, bool pinnedForAll) => new(postId.ToString(), pinnedForAll);
}

/// <summary>
/// Why a post is on the caller's Pinned tab (demo-feedback DF-5): the frozen <c>'exercise' | 'pin' | 'like'</c> union.
/// When a post qualifies for more than one, precedence is <see cref="Exercise"/> &gt; <see cref="Pin"/> &gt;
/// <see cref="Like"/>.
/// </summary>
public static class PinnedFeedReasons
{
    /// <summary>A controller pinned the post for everyone (DF-7).</summary>
    public const string Exercise = "exercise";

    /// <summary>The caller pinned the post for itself (DF-6).</summary>
    public const string Pin = "pin";

    /// <summary>The caller liked the post.</summary>
    public const string Like = "like";
}

/// <summary>One entry on the Pinned tab — the server-side mirror of the frozen frontend <c>PinnedFeedItem</c>.</summary>
/// <param name="Reason">One of <see cref="PinnedFeedReasons"/>.</param>
/// <param name="Post">The participant-safe post (XC-002), projected exactly as the feed projects it.</param>
public sealed record PinnedFeedItemDto(
    [property: JsonPropertyName("reason")] string Reason,
    [property: JsonPropertyName("post")] ParticipantPostDto Post);

/// <summary>
/// The <c>GET /api/feed/pinned</c> response — the server-side mirror of the frozen frontend
/// <c>PinnedFeedResponse</c>: the items in DF-5 order, each post at most once.
/// </summary>
/// <param name="Items">The Pinned tab entries, in display order (at most <see cref="PinnedFeedService.MaxItems"/>).</param>
public sealed record PinnedFeedResponse(
    [property: JsonPropertyName("items")] IReadOnlyList<PinnedFeedItemDto> Items);
