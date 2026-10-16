namespace Pulse.WebApi.Features.Social.Editing;

using System.Text.Json.Serialization;

// demo-feedback/17 — the FROZEN Wave 4 edit contract (WAVE-4.md, "Types"), landed as stubs so story 19 (server) and
// story 20 (client) build in parallel against fixed shapes. Nothing references these yet. Every member carries an
// explicit JsonPropertyName so the camelCase wire shape is independent of host serializer config. None of them carries
// provenance or a wall-clock time (XC-002, COR-053): every time here is SCENARIO time, emitted round-trip ("O").

/// <summary>
/// The body of <c>PATCH /api/posts/{postId}</c> (story 19): the new text of a participant's own post or reply (DF-29).
/// Nullable so a missing field is a validation <c>400</c>, never a deserialization failure.
/// </summary>
public sealed class EditPostRequest
{
    /// <summary>The replacement post text (sanitized and length-checked by the server, story 19).</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}

/// <summary>
/// The "Edited" summary a post carries once edited (DF-31): <c>{ count, scenarioTime }</c>. The post DTOs' <c>edited</c>
/// member is this or <c>null</c> when never edited (story 19 wires it).
/// </summary>
public sealed class PostEditedSummaryDto
{
    /// <summary>How many times the post has been edited (<c>Post.EditCount</c>, 1..5).</summary>
    [JsonPropertyName("count")]
    public required int Count { get; init; }

    /// <summary>The last edit's scenario time (COR-053), round-trip ISO 8601 — never wall clock.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }
}

/// <summary>
/// The response of <c>GET /api/posts/{postId}/edits</c> (story 19): every version of a post, newest first. The current
/// text is <c>editNumber = EditCount</c>; the original is <c>editNumber = 0</c>.
/// </summary>
public sealed class PostEditHistoryDto
{
    /// <summary>The post id.</summary>
    [JsonPropertyName("postId")]
    public required string PostId { get; init; }

    /// <summary>Every version of the post, newest first.</summary>
    [JsonPropertyName("versions")]
    public required IReadOnlyList<PostEditVersionDto> Versions { get; init; }
}

/// <summary>One version in a <see cref="PostEditHistoryDto"/>: <c>{ editNumber, text, scenarioTime }</c>.</summary>
public sealed class PostEditVersionDto
{
    /// <summary>The version number: 0 for the original, n for the text after edit n.</summary>
    [JsonPropertyName("editNumber")]
    public required int EditNumber { get; init; }

    /// <summary>The post's text at this version.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>When this version was written, in scenario time (COR-053), round-trip ISO 8601.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }
}

/// <summary>
/// The <c>PostEdited</c> exercise-group push (DF-33, story 19), published after commit: the new text, the edit summary
/// and a monotonic <c>version</c> (= <c>edited.count</c>) so a client drops a stale frame.
/// </summary>
public sealed class PostEditedDto
{
    /// <summary>The edited post's id.</summary>
    [JsonPropertyName("postId")]
    public required string PostId { get; init; }

    /// <summary>The post's new text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>The edit summary after this edit.</summary>
    [JsonPropertyName("edited")]
    public required PostEditedSummaryDto Edited { get; init; }

    /// <summary>The frame version, equal to <see cref="PostEditedSummaryDto.Count"/> (monotonic per post).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }
}

/// <summary>
/// The body of a <c>409</c> from <c>PATCH /api/posts/{postId}</c> (story 19): <c>{ reason }</c>, one of
/// <c>window-closed</c>, <c>edit-limit</c> or <c>frozen</c> (<see cref="PostEditRefusalReasons"/>).
/// </summary>
public sealed class PostEditRefusalDto
{
    /// <summary>Why the edit was refused.</summary>
    [JsonPropertyName("reason")]
    public required string Reason { get; init; }
}
