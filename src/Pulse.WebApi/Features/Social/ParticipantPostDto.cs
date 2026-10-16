namespace Pulse.WebApi.Features.Social;

using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Editing;

/// <summary>
/// The FROZEN participant-safe post shape — the server-side mirror of the frontend
/// <c>ParticipantPostView</c> (<c>features/social/types/post.ts</c>). It is the ONLY post shape a
/// participant surface may ever receive: it structurally has NO provenance fields
/// (<c>origin</c>/<c>actingHumanId</c>/<c>createdWallClock</c>/<c>injectId</c>), so a participant
/// response cannot even carry them (XC-002).
/// </summary>
/// <remarks>
/// Story 01 produces this from reads; story 02's participant-caller branch and story 03's broadcast
/// payload reuse it rather than re-deriving. Serialized as camelCase JSON so the wire shape satisfies the
/// frozen <c>feedService.ts</c> <c>isPost</c> guard (<c>id</c>, <c>authorPersonaId</c>, <c>text</c>,
/// <c>scenarioTime</c>, <c>counts.{reply,repost,like}</c>); every property carries an explicit
/// <see cref="JsonPropertyNameAttribute"/> so the shape is self-evident and independent of host serializer
/// config. <c>linkPreview</c> is never sent by the server (optional in the frozen contract).
/// <para>
/// <b>demo-polish B1 skeleton (implementation.md §1.4).</b> The class is deliberately UNSEALED with a
/// protected copy constructor so the thread read can derive its reply shape from it, and it carries the
/// optional <see cref="Media"/> / <see cref="InReplyTo"/> / <see cref="Viewer"/> members — each OMITTED from the
/// wire when null. <see cref="FromPost"/> never sets them, so its output is byte-identical to before; populating
/// them is the participant projector's job, not this type's.
/// </para>
/// <para>
/// <b>demo-polish BP.</b> <see cref="ParticipantPostProjector"/> is the read-side producer: counts = baseline +
/// real, signed media URLs, <c>inReplyTo</c>, and <c>viewer</c> only for a persona-bound participant read. Every
/// read surface (feed, thread, the ingest broadcast of a post with media or a parent) goes through it; the
/// projector is always registered (<c>TryAddPostSeamFallbacks</c>). <see cref="FromPost"/> is the participant-safe
/// narrowing the ingest path builds its baseline view on (a new post with no media and no parent, or a projection
/// that failed after the commit), and the post-write endpoint's last-resort participant shape. A derived
/// shape (DP-17) adds only participant-safe members and must be serialized through its derived declared type.
/// </para>
/// </remarks>
public class ParticipantPostDto
{
    /// <summary>Creates an empty instance; the <c>required</c> members are set by an object initializer.</summary>
    public ParticipantPostDto()
    {
    }

    /// <summary>
    /// Copy constructor for derived participant shapes (e.g. a thread reply): copies every member of
    /// <paramref name="source"/>, so a derived type adds fields without re-deriving the participant-safe base.
    /// </summary>
    /// <param name="source">The participant post to copy.</param>
    [SetsRequiredMembers]
    protected ParticipantPostDto(ParticipantPostDto source)
    {
        ArgumentNullException.ThrowIfNull(source);

        Id = source.Id;
        AuthorPersonaId = source.AuthorPersonaId;
        Text = source.Text;
        Counts = source.Counts;
        ScenarioTime = source.ScenarioTime;
        Media = source.Media;
        InReplyTo = source.InReplyTo;
        Viewer = source.Viewer;
        PinnedForAll = source.PinnedForAll;
        Edited = source.Edited;
    }

    /// <summary>The post id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The authoring <c>Persona</c> instance id — never the acting human (COR-018 is staff-only).</summary>
    [JsonPropertyName("authorPersonaId")]
    public required string AuthorPersonaId { get; init; }

    /// <summary>The post body text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>Engagement counts, in the product-wide order reply · repost · like (R-002).</summary>
    [JsonPropertyName("counts")]
    public required ParticipantPostCounts Counts { get; init; }

    /// <summary>
    /// The scenario ISO-8601 instant (COR-053) — the ONLY participant-visible time. Emitted as the persisted
    /// instant exactly, never re-derived from the server clock.
    /// </summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>The post's media attachments in display order; OMITTED from the wire when null.</summary>
    [JsonPropertyName("media")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<PostMediaDto>? Media { get; init; }

    /// <summary>The post this one replies to; OMITTED from the wire when null (a top-level post).</summary>
    [JsonPropertyName("inReplyTo")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PostInReplyToDto? InReplyTo { get; init; }

    /// <summary>
    /// The caller's own reaction state; OMITTED from the wire when null (always absent on broadcasts and for staff).
    /// </summary>
    [JsonPropertyName("viewer")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public PostViewerStateDto? Viewer { get; init; }

    /// <summary>
    /// <c>true</c> while a controller has pinned the post for EVERY participant (an exercise pin, demo-feedback DF-7);
    /// OMITTED from the wire otherwise (frozen <c>pinnedForAll?: true</c>), so it is never <c>false</c> or <c>null</c>
    /// on the wire. Who pinned it (<see cref="Post.PinnedForAllByHumanId"/>) and when are staff-only and never carried
    /// here (XC-002).
    /// </summary>
    [JsonPropertyName("pinnedForAll")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? PinnedForAll { get; init; }

    /// <summary>
    /// The "Edited" summary (demo-feedback DF-31, story 19): <c>{ count, scenarioTime }</c> once the author has edited the
    /// post, else <c>null</c>. Frozen as <c>edited: {...} | null</c>, so it is ALWAYS on the wire (written as
    /// <c>null</c> when never edited, never omitted). The time is SCENARIO time (COR-053); the wall-clock
    /// <see cref="Post.LastEditedAt"/> is staff/export only and never carried here (XC-002).
    /// </summary>
    [JsonPropertyName("edited")]
    public PostEditedSummaryDto? Edited { get; init; }

    /// <summary>
    /// The single server-side XC-002 narrowing — the server-side mirror of the frontend
    /// <c>toParticipantView</c> (retiring finding S2-2). Maps only participant-safe fields; it MUST NOT read
    /// or include <see cref="Post.Origin"/>, <see cref="Post.ActingHumanId"/>,
    /// <see cref="Post.CreatedWallClock"/>, or <see cref="Post.InjectId"/>. <see cref="ScenarioTime"/> is the
    /// persisted <see cref="Post.CreatedScenarioTime"/> emitted round-trip ISO-8601 — never re-derived from
    /// the server clock (COR-053). Counts seed to zero for a freshly-read post. <see cref="PinnedForAll"/> is
    /// <c>true</c> only when <see cref="Post.PinnedForAllAt"/> is set; <see cref="Post.PinnedForAllByHumanId"/> is
    /// never read. <see cref="Edited"/> reads only <see cref="Post.EditCount"/> and
    /// <see cref="Post.LastEditedScenarioTime"/>, never the wall-clock <see cref="Post.LastEditedAt"/>.
    /// </summary>
    /// <param name="post">The full post entity to narrow to the participant-safe shape.</param>
    /// <returns>The participant-safe projection of <paramref name="post"/>.</returns>
    public static ParticipantPostDto FromPost(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);

        return new ParticipantPostDto
        {
            Id = post.Id.ToString(),
            AuthorPersonaId = post.AuthorPersonaId.ToString(),
            Text = post.Body,
            ScenarioTime = post.CreatedScenarioTime.ToString("O"),
            Counts = new ParticipantPostCounts(0, 0, 0),
            PinnedForAll = PinnedForAllFlag(post),
            Edited = PostEditRules.SummaryOf(post),
        };
    }

    /// <summary>
    /// A copy of this post with <paramref name="viewer"/> as its caller-specific viewer state (demo-feedback story 19:
    /// the creator's own <c>POST /api/posts</c> 201). The source is left untouched, so a payload already handed to the
    /// <c>PostReceived</c> broadcast stays viewer-free.
    /// </summary>
    /// <param name="viewer">The caller's viewer state.</param>
    /// <returns>A new instance carrying <paramref name="viewer"/>.</returns>
    public ParticipantPostDto WithViewer(PostViewerStateDto viewer)
    {
        ArgumentNullException.ThrowIfNull(viewer);
        return new ParticipantPostDto(this) { Viewer = viewer };
    }

    /// <summary>
    /// The wire value of <see cref="PinnedForAll"/> for <paramref name="post"/>: <c>true</c> while it is pinned for
    /// everyone, else <c>null</c> (omitted). Reads <see cref="Post.PinnedForAllAt"/> only, never who pinned it.
    /// </summary>
    /// <param name="post">The post.</param>
    /// <returns><c>true</c> or <c>null</c>.</returns>
    public static bool? PinnedForAllFlag(Post post)
    {
        ArgumentNullException.ThrowIfNull(post);
        return post.PinnedForAllAt is null ? null : true;
    }
}

/// <summary>
/// Engagement counts on a <see cref="ParticipantPostDto"/> — the frozen <c>PostCounts</c> subset the
/// <c>isPost</c> guard requires, in the product-wide order reply · repost · like (R-002).
/// </summary>
/// <param name="Reply">Reply count.</param>
/// <param name="Repost">Repost count.</param>
/// <param name="Like">Like count.</param>
public sealed record ParticipantPostCounts(
    [property: JsonPropertyName("reply")] int Reply,
    [property: JsonPropertyName("repost")] int Repost,
    [property: JsonPropertyName("like")] int Like);
