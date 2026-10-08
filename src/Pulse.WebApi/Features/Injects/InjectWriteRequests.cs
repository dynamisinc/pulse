namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The <c>POST /api/injects</c> and <c>PUT /api/injects/{id}</c> body — the frozen <c>InjectItemWrite</c> (plus
/// <c>version</c> on a PUT). Every scalar is nullable so a missing field is a readable validation <c>400</c>, never
/// a deserialization failure. It carries NO <c>exerciseId</c> and no acting human: the scope comes only from
/// <see cref="Data.IExerciseContext"/> (COR-001) and the human only from the staff session (COR-018).
/// </summary>
public sealed class InjectItemWriteRequest
{
    /// <summary><c>post</c> or <c>burst</c>; required.</summary>
    [JsonPropertyName("kind")]
    public string? Kind { get; init; }

    /// <summary>The controller-facing title (1..120 code points); required.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; init; }

    /// <summary>Optional notes (at most 500 code points).</summary>
    [JsonPropertyName("notes")]
    public string? Notes { get; init; }

    /// <summary>Optional planned scenario minute (integer, at least 0) — display and sort only, never auto-fire.</summary>
    [JsonPropertyName("plannedMinute")]
    public int? PlannedMinute { get; init; }

    /// <summary>A staff user assigned to this exercise, or <c>null</c>/absent for none.</summary>
    [JsonPropertyName("assigneeId")]
    public string? AssigneeId { get; init; }

    /// <summary>Burst only: the release window in seconds (30..600, default 90). Ignored for a <c>post</c>.</summary>
    [JsonPropertyName("burstWindowSeconds")]
    public int? BurstWindowSeconds { get; init; }

    /// <summary>The child posts: exactly one for a <c>post</c>, 2..20 for a <c>burst</c>; required.</summary>
    [JsonPropertyName("posts")]
    public IReadOnlyList<InjectPostWriteRequest?>? Posts { get; init; }

    /// <summary>PUT only: the version the editor last read. A stale version is a <c>409</c> (IQ-9).</summary>
    [JsonPropertyName("version")]
    public int? Version { get; init; }
}

/// <summary>One child post in an <see cref="InjectItemWriteRequest"/> — the frozen <c>InjectPostWrite</c>.</summary>
public sealed class InjectPostWriteRequest
{
    /// <summary>The authoring persona instance id; must name a persona in this exercise.</summary>
    [JsonPropertyName("personaId")]
    public string? PersonaId { get; init; }

    /// <summary>The post text (1..280 code points).</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }

    /// <summary>Optional library media (at most 4; <c>alt</c> 1..1000; no duplicate <c>mediaId</c>).</summary>
    [JsonPropertyName("media")]
    public IReadOnlyList<InjectMediaWriteRequest?>? Media { get; init; }

    /// <summary>Optional reply target — exactly one of <c>injectPostId</c> or <c>postId</c>.</summary>
    [JsonPropertyName("replyTo")]
    public InjectReplyToWriteRequest? ReplyTo { get; init; }

    /// <summary>Optional seeded engagement counts (each 0..1,000,000).</summary>
    [JsonPropertyName("engagementBaseline")]
    public InjectEngagementBaselineWriteRequest? EngagementBaseline { get; init; }
}

/// <summary>A media reference on a scripted post.</summary>
public sealed class InjectMediaWriteRequest
{
    /// <summary>The library asset id.</summary>
    [JsonPropertyName("mediaId")]
    public string? MediaId { get; init; }

    /// <summary>The alt text (1..1000).</summary>
    [JsonPropertyName("alt")]
    public string? Alt { get; init; }
}

/// <summary>A reply target: <c>{ injectPostId }</c> (another scripted post) or <c>{ postId }</c> (an existing post).</summary>
public sealed class InjectReplyToWriteRequest
{
    /// <summary>Another scripted post in this exercise (an earlier one if it is in the same item).</summary>
    [JsonPropertyName("injectPostId")]
    public string? InjectPostId { get; init; }

    /// <summary>An existing post id.</summary>
    [JsonPropertyName("postId")]
    public string? PostId { get; init; }
}

/// <summary>Seeded engagement counts for a scripted post.</summary>
public sealed class InjectEngagementBaselineWriteRequest
{
    /// <summary>Seeded likes (0..1,000,000).</summary>
    [JsonPropertyName("like")]
    public int? Like { get; init; }

    /// <summary>Seeded reposts (0..1,000,000).</summary>
    [JsonPropertyName("repost")]
    public int? Repost { get; init; }

    /// <summary>Seeded replies (0..1,000,000).</summary>
    [JsonPropertyName("reply")]
    public int? Reply { get; init; }
}

/// <summary>The <c>POST /api/injects/reorder</c> body: the full new order of the live items.</summary>
public sealed class InjectReorderRequest
{
    /// <summary>Every live item id, exactly once, in the new order.</summary>
    [JsonPropertyName("ids")]
    public IReadOnlyList<string?>? Ids { get; init; }
}
