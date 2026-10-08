// FROZEN — demo-polish implementation.md §1.4. Change via the orchestrator only.
namespace Pulse.WebApi.Features.Social;

using System.Text.Json.Serialization;

/// <summary>
/// One media attachment on a participant post — the server-side mirror of the frontend <c>PostMedia</c>. Null
/// optional members are OMITTED from the wire, never emitted as <c>null</c>. Carries no storage detail
/// (blob name, content type, size, uploader) — participant-safe by construction (XC-002).
/// </summary>
/// <param name="Id">The <c>MediaAsset</c> id (the stable list key).</param>
/// <param name="Kind"><c>image</c> or <c>video</c>.</param>
/// <param name="Url">The signed read URL.</param>
/// <param name="Alt">The alt text — always present (NFR-001).</param>
/// <param name="PosterUrl">The signed poster URL (videos), when there is one.</param>
/// <param name="Width">Pixel width, when known.</param>
/// <param name="Height">Pixel height, when known.</param>
/// <param name="DurationSec">Video duration in seconds, when known.</param>
public sealed record PostMediaDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("alt")] string Alt,
    [property: JsonPropertyName("posterUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PosterUrl = null,
    [property: JsonPropertyName("width"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Width = null,
    [property: JsonPropertyName("height"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Height = null,
    [property: JsonPropertyName("durationSec"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? DurationSec = null);

/// <summary>The post a reply answers — the server-side mirror of the frontend <c>PostInReplyTo</c>.</summary>
/// <param name="PostId">The parent post id.</param>
/// <param name="AuthorHandle">The parent author's handle, with no leading <c>@</c>.</param>
public sealed record PostInReplyToDto(
    [property: JsonPropertyName("postId")] string PostId,
    [property: JsonPropertyName("authorHandle")] string AuthorHandle);

/// <summary>The caller's own reaction state on a post — the server-side mirror of the frontend <c>PostViewerState</c>.</summary>
/// <param name="Liked">Whether the caller's persona has liked the post.</param>
/// <param name="Reposted">Whether the caller's persona has reposted the post.</param>
public sealed record PostViewerStateDto(
    [property: JsonPropertyName("liked")] bool Liked,
    [property: JsonPropertyName("reposted")] bool Reposted);

/// <summary>
/// One requested media attachment on <c>POST /api/posts</c> — the server-side mirror of the frontend
/// <c>CreatePostMedia</c>. Nullable scalars so a missing field is a validation 400, never a deserialization failure.
/// </summary>
/// <param name="MediaId">The <c>MediaAsset</c> id to attach.</param>
/// <param name="Alt">The alt text (required after sanitization).</param>
/// <param name="PosterMediaId">An optional poster override (videos).</param>
public sealed record CreatePostMediaRequest(
    [property: JsonPropertyName("mediaId")] string? MediaId,
    [property: JsonPropertyName("alt")] string? Alt,
    [property: JsonPropertyName("posterMediaId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PosterMediaId);

/// <summary>
/// The seeded engagement baseline on <c>POST /api/posts</c> (STAFF controller-as-persona only) — the server-side
/// mirror of the frontend <c>EngagementBaseline</c>.
/// </summary>
/// <param name="Like">The like baseline.</param>
/// <param name="Repost">The repost baseline.</param>
/// <param name="Reply">The reply baseline.</param>
public sealed record EngagementBaselineRequest(
    [property: JsonPropertyName("like"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Like,
    [property: JsonPropertyName("repost"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Repost,
    [property: JsonPropertyName("reply"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Reply);
