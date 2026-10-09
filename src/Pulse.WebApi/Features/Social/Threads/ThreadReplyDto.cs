namespace Pulse.WebApi.Features.Social.Threads;

using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// One direct reply in a thread: the server-side mirror of the frontend <c>ThreadReplyView</c> /
/// <c>ThreadReply = ParticipantPostView &amp; { replyToPersonaId; status }</c> (implementation.md §1.5.3). It is a
/// <see cref="ParticipantPostDto"/> plus two participant-safe members and nothing else (DP-17, XC-002).
/// </summary>
/// <remarks>
/// <para>
/// <b>Serialize through this declared type (DP-17).</b> <see cref="ThreadResponseDto.Replies"/> is typed
/// <c>IReadOnlyList&lt;ThreadReplyDto&gt;</c> for this reason. A list typed by the base class would serialize by
/// the base contract and silently drop <see cref="ReplyToPersonaId"/> and <see cref="Status"/>.
/// </para>
/// <para>
/// <b>Two ways to build one.</b> <see cref="Visible"/> wraps the projector's output and copies every base member
/// through the protected copy constructor, so this type never re-derives the participant projection.
/// <see cref="TakenDown"/> builds the D1-009 tombstone straight from the entity and reads ONLY the reply's id,
/// author and scenario time, never its body, media or engagement. A taken-down reply's content therefore never
/// reaches a serializer.
/// </para>
/// </remarks>
public sealed class ThreadReplyDto : ParticipantPostDto
{
    /// <summary>The <see cref="Status"/> of a reply that is shown normally.</summary>
    public const string VisibleStatus = "visible";

    /// <summary>The <see cref="Status"/> of a soft-deleted reply, rendered as an in-thread tombstone (D1-009).</summary>
    public const string TakenDownStatus = "taken-down";

    /// <summary>Copies <paramref name="source"/> and adds the two reply members.</summary>
    /// <param name="source">The participant-safe post to copy.</param>
    /// <param name="replyToPersonaId">The persona id of the post being replied to.</param>
    /// <param name="status"><see cref="VisibleStatus"/> or <see cref="TakenDownStatus"/>.</param>
    [SetsRequiredMembers]
    private ThreadReplyDto(ParticipantPostDto source, string replyToPersonaId, string status)
        : base(source)
    {
        ReplyToPersonaId = replyToPersonaId;
        Status = status;
    }

    /// <summary>
    /// The persona id of the post this reply answers: the focused post's author, because a thread lists only the
    /// focused post's direct replies.
    /// </summary>
    [JsonPropertyName("replyToPersonaId")]
    public required string ReplyToPersonaId { get; init; }

    /// <summary><c>visible</c> or <c>taken-down</c> (SOC-005, D1-009).</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>Wraps a projected, non-deleted reply.</summary>
    /// <param name="projected">The projector's participant-safe output for the reply.</param>
    /// <param name="replyToPersonaId">The persona id of the post being replied to.</param>
    /// <returns>The reply with <see cref="Status"/> = <see cref="VisibleStatus"/> and every base member copied.</returns>
    public static ThreadReplyDto Visible(ParticipantPostDto projected, Guid replyToPersonaId)
    {
        ArgumentNullException.ThrowIfNull(projected);

        return new ThreadReplyDto(projected, replyToPersonaId.ToString(), VisibleStatus);
    }

    /// <summary>
    /// Builds the tombstone for a soft-deleted reply: <c>text</c> is empty, <c>counts</c> are zero, and
    /// <c>media</c>, <c>inReplyTo</c> and <c>viewer</c> are absent. Only the id, the author and the persisted
    /// scenario time (COR-053) are read from <paramref name="reply"/>. The frozen client guard needs those three.
    /// </summary>
    /// <param name="reply">The soft-deleted reply entity.</param>
    /// <param name="replyToPersonaId">The persona id of the post being replied to.</param>
    /// <returns>The tombstone, with <see cref="Status"/> = <see cref="TakenDownStatus"/>.</returns>
    public static ThreadReplyDto TakenDown(Post reply, Guid replyToPersonaId)
    {
        ArgumentNullException.ThrowIfNull(reply);

        var tombstone = new ParticipantPostDto
        {
            Id = reply.Id.ToString(),
            AuthorPersonaId = reply.AuthorPersonaId.ToString(),
            Text = string.Empty,
            ScenarioTime = reply.CreatedScenarioTime.ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
        };

        return new ThreadReplyDto(tombstone, replyToPersonaId.ToString(), TakenDownStatus);
    }
}
