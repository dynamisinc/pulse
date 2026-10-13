namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// The <c>GET /api/injects</c> response — the frozen <c>InjectQueueDto</c>: the exercise's live items in queue order
/// plus the pause tier, so the console can show a suspended/frozen state without a second call.
/// </summary>
/// <remarks>
/// <b>STAFF-ONLY (XC-002).</b> Every DTO in this file is served only behind the staff cockpit gate. They carry
/// staff provenance (who authored, who fired, wall-clock instants) by design; none is ever projected onto a
/// participant surface — participants see only the posts the queue publishes, through the funnel's own projection.
/// </remarks>
public sealed class InjectQueueDto
{
    /// <summary>The live (non-deleted) items, in queue order.</summary>
    [JsonPropertyName("items")]
    public required IReadOnlyList<InjectItemDto> Items { get; init; }

    /// <summary>The exercise's pause tier wire literal — <c>running</c>/<c>injects</c>/<c>engine</c>/<c>freeze</c>.</summary>
    [JsonPropertyName("pauseTier")]
    public required string PauseTier { get; init; }

    /// <summary>Builds the queue projection.</summary>
    /// <param name="items">The projected items, already in order.</param>
    /// <param name="tier">The exercise's current pause tier.</param>
    /// <returns>The queue DTO.</returns>
    public static InjectQueueDto From(IReadOnlyList<InjectItemDto> items, PauseTier tier)
    {
        ArgumentNullException.ThrowIfNull(items);
        return new InjectQueueDto { Items = items, PauseTier = PauseTierWire.ToWire(tier) };
    }
}

/// <summary>One queue item — the frozen <c>InjectItemDto</c> (staff-only, XC-002). Null members are omitted.</summary>
public sealed class InjectItemDto
{
    /// <summary>The item id (the published posts' <c>injectId</c>).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary><c>post</c> or <c>burst</c>.</summary>
    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    /// <summary>The title.</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The notes, when present.</summary>
    [JsonPropertyName("notes")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Notes { get; init; }

    /// <summary>The planned scenario minute (T+N), when present.</summary>
    [JsonPropertyName("plannedMinute")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? PlannedMinute { get; init; }

    /// <summary>The assigned staff user's id, when assigned.</summary>
    [JsonPropertyName("assigneeId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AssigneeId { get; init; }

    /// <summary>The burst window in seconds (bursts only).</summary>
    [JsonPropertyName("burstWindowSeconds")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? BurstWindowSeconds { get; init; }

    /// <summary>The dense 1-based queue position.</summary>
    [JsonPropertyName("order")]
    public required int Order { get; init; }

    /// <summary>The item status literal.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The assignee's display name, when assigned and still on the exercise's roster.</summary>
    [JsonPropertyName("assigneeName")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AssigneeName { get; init; }

    /// <summary>The child posts in sequence order.</summary>
    [JsonPropertyName("posts")]
    public required IReadOnlyList<InjectPostDto> Posts { get; init; }

    /// <summary>How many children have fired (burst progress).</summary>
    [JsonPropertyName("firedCount")]
    public required int FiredCount { get; init; }

    /// <summary>How many children the item has.</summary>
    [JsonPropertyName("total")]
    public required int Total { get; init; }

    /// <summary>The concurrency version a PUT/DELETE must echo (IQ-9).</summary>
    [JsonPropertyName("version")]
    public required int Version { get; init; }

    /// <summary>The authoring staff user's id.</summary>
    [JsonPropertyName("createdByHumanId")]
    public required string CreatedByHumanId { get; init; }

    /// <summary>The server wall-clock instant of the last state change (staff-only), round-trip ISO-8601.</summary>
    [JsonPropertyName("updatedAt")]
    public required string UpdatedAt { get; init; }

    /// <summary>Who pressed Fire on the first release, when fired.</summary>
    [JsonPropertyName("firedByHumanId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredByHumanId { get; init; }

    /// <summary>The scenario instant of the first release (COR-053), when fired.</summary>
    [JsonPropertyName("firedScenarioTime")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredScenarioTime { get; init; }

    /// <summary>Why the item failed, when <c>failed</c>.</summary>
    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; init; }

    /// <summary>Projects an item (with its children loaded) onto the staff wire shape.</summary>
    /// <param name="item">The item; its live children are projected in sequence order.</param>
    /// <param name="order">The dense 1-based queue position.</param>
    /// <param name="assigneeNames">The exercise roster's display names by staff user id.</param>
    /// <returns>The item DTO.</returns>
    public static InjectItemDto From(InjectItem item, int order, IReadOnlyDictionary<Guid, string> assigneeNames)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(assigneeNames);

        var posts = item.Posts
            .Where(post => post.DeletedAt is null)
            .OrderBy(post => post.Sequence)
            .Select(InjectPostDto.From)
            .ToList();

        string? assigneeName = null;
        if (item.AssigneeId is { } assignee && assigneeNames.TryGetValue(assignee, out var name))
        {
            assigneeName = name;
        }

        return new InjectItemDto
        {
            Id = item.Id.ToString(),
            Kind = item.Kind,
            Title = item.Title,
            Notes = item.Notes,
            PlannedMinute = item.PlannedMinute,
            AssigneeId = item.AssigneeId?.ToString(),
            BurstWindowSeconds = item.BurstWindowSeconds,
            Order = order,
            Status = item.Status,
            AssigneeName = assigneeName,
            Posts = posts,
            FiredCount = posts.Count(post => post.Status == InjectPostStatuses.Fired),
            Total = posts.Count,
            Version = item.Version,
            CreatedByHumanId = item.CreatedByHumanId.ToString(),
            UpdatedAt = InjectWire.Instant(item.UpdatedAt),
            FiredByHumanId = item.FiredByHumanId?.ToString(),
            FiredScenarioTime = InjectWire.Instant(item.FiredScenarioTime),
            Error = item.Error,
        };
    }
}

/// <summary>One scripted post — the frozen <c>InjectPostDto</c> (staff-only, XC-002). Null members are omitted.</summary>
public sealed class InjectPostDto
{
    /// <summary>The scripted post id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The 1-based position within the item.</summary>
    [JsonPropertyName("sequence")]
    public required int Sequence { get; init; }

    /// <summary>The child status literal.</summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>The authoring persona id.</summary>
    [JsonPropertyName("personaId")]
    public required string PersonaId { get; init; }

    /// <summary>The (write-sanitized) text.</summary>
    [JsonPropertyName("text")]
    public required string Text { get; init; }

    /// <summary>The media references, when any.</summary>
    [JsonPropertyName("media")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<InjectMediaDto>? Media { get; init; }

    /// <summary>The reply target, when any.</summary>
    [JsonPropertyName("replyTo")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InjectReplyToDto? ReplyTo { get; init; }

    /// <summary>The seeded engagement counts, when any.</summary>
    [JsonPropertyName("engagementBaseline")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public InjectEngagementBaselineDto? EngagementBaseline { get; init; }

    /// <summary>Burst pacing: seconds after release this child is due.</summary>
    [JsonPropertyName("dueOffsetSeconds")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? DueOffsetSeconds { get; init; }

    /// <summary>The published post's id, when fired.</summary>
    [JsonPropertyName("firedPostId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredPostId { get; init; }

    /// <summary>The published post's scenario instant (COR-053), when fired.</summary>
    [JsonPropertyName("firedScenarioTime")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredScenarioTime { get; init; }

    /// <summary>The published post's wall-clock instant (staff-only), when fired.</summary>
    [JsonPropertyName("firedWallClock")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredWallClock { get; init; }

    /// <summary>The staff user the published post is attributed to, when fired.</summary>
    [JsonPropertyName("firedByHumanId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FiredByHumanId { get; init; }

    /// <summary>Why the child failed, when <c>failed</c>.</summary>
    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; init; }

    /// <summary>Projects a child onto the staff wire shape.</summary>
    /// <param name="post">The child.</param>
    /// <returns>The child DTO.</returns>
    public static InjectPostDto From(InjectItemPost post)
    {
        ArgumentNullException.ThrowIfNull(post);

        return new InjectPostDto
        {
            Id = post.Id.ToString(),
            Sequence = post.Sequence,
            Status = post.Status,
            PersonaId = post.PersonaId.ToString(),
            Text = post.Text,
            Media = post.Media.Count == 0
                ? null
                : post.Media.Select(media => new InjectMediaDto { MediaId = media.MediaId, Alt = media.Alt }).ToList(),
            ReplyTo = InjectReplyToDto.From(post),
            EngagementBaseline = InjectEngagementBaselineDto.From(post),
            DueOffsetSeconds = post.DueOffsetSeconds,
            FiredPostId = post.FiredPostId?.ToString(),
            FiredScenarioTime = InjectWire.Instant(post.FiredScenarioTime),
            FiredWallClock = InjectWire.Instant(post.FiredWallClock),
            FiredByHumanId = post.FiredByHumanId?.ToString(),
            Error = post.Error,
        };
    }
}

/// <summary>A media reference on a scripted post.</summary>
public sealed class InjectMediaDto
{
    /// <summary>The library asset id.</summary>
    [JsonPropertyName("mediaId")]
    public required string MediaId { get; init; }

    /// <summary>The alt text.</summary>
    [JsonPropertyName("alt")]
    public required string Alt { get; init; }
}

/// <summary>A reply target: exactly one member is present on the wire.</summary>
public sealed class InjectReplyToDto
{
    /// <summary>Another scripted post's id.</summary>
    [JsonPropertyName("injectPostId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? InjectPostId { get; init; }

    /// <summary>An existing post's id.</summary>
    [JsonPropertyName("postId")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PostId { get; init; }

    /// <summary>Projects the child's reply target, or <c>null</c> when it has none.</summary>
    /// <param name="post">The child.</param>
    /// <returns>The reply DTO or <c>null</c>.</returns>
    public static InjectReplyToDto? From(InjectItemPost post)
    {
        ArgumentNullException.ThrowIfNull(post);

        if (post.ReplyToInjectPostId is { } injectPostId)
        {
            return new InjectReplyToDto { InjectPostId = injectPostId.ToString() };
        }

        return post.ReplyToPostId is { } postId ? new InjectReplyToDto { PostId = postId.ToString() } : null;
    }
}

/// <summary>Seeded engagement counts; absent members are omitted.</summary>
public sealed class InjectEngagementBaselineDto
{
    /// <summary>Seeded likes.</summary>
    [JsonPropertyName("like")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Like { get; init; }

    /// <summary>Seeded reposts.</summary>
    [JsonPropertyName("repost")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Repost { get; init; }

    /// <summary>Seeded replies.</summary>
    [JsonPropertyName("reply")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? Reply { get; init; }

    /// <summary>Projects the child's baseline, or <c>null</c> when none is set.</summary>
    /// <param name="post">The child.</param>
    /// <returns>The baseline DTO or <c>null</c>.</returns>
    public static InjectEngagementBaselineDto? From(InjectItemPost post)
    {
        ArgumentNullException.ThrowIfNull(post);

        if (post.BaselineLike is null && post.BaselineRepost is null && post.BaselineReply is null)
        {
            return null;
        }

        return new InjectEngagementBaselineDto
        {
            Like = post.BaselineLike,
            Repost = post.BaselineRepost,
            Reply = post.BaselineReply,
        };
    }
}

/// <summary>The <c>GET /api/injects/assignees</c> response — the frozen <c>InjectAssigneesDto</c> (staff-only).</summary>
public sealed class InjectAssigneesDto
{
    /// <summary>The caller's own staff user id (the same id space as <c>assigneeId</c>).</summary>
    [JsonPropertyName("me")]
    public required string Me { get; init; }

    /// <summary>Every staff user assigned to the active exercise.</summary>
    [JsonPropertyName("assignees")]
    public required IReadOnlyList<InjectAssigneeDto> Assignees { get; init; }
}

/// <summary>One staff user on the active exercise's roster.</summary>
public sealed class InjectAssigneeDto
{
    /// <summary>The staff user id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The staff user's display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The staff user's role on this exercise.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }
}

/// <summary>Wire formatting helpers shared by the inject DTOs.</summary>
internal static class InjectWire
{
    /// <summary>Formats an instant round-trip (<c>"O"</c>), invariant culture.</summary>
    /// <param name="instant">The instant.</param>
    /// <returns>The ISO-8601 string.</returns>
    public static string Instant(DateTimeOffset instant) => instant.ToString("O", CultureInfo.InvariantCulture);

    /// <summary>Formats an optional instant round-trip, or <c>null</c>.</summary>
    /// <param name="instant">The instant, or <c>null</c>.</param>
    /// <returns>The ISO-8601 string or <c>null</c>.</returns>
    public static string? Instant(DateTimeOffset? instant) => instant is { } value ? Instant(value) : null;
}
