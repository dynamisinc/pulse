namespace Pulse.WebApi.Features.Channels.Content.Staff;

using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Channels.Contracts;

// Staff-only request and response bodies for /api/content-items* (channels-foundation story 07, FC-4). None carries an
// exercise id, an origin or an acting human: scope and identity come from the staff session (COR-001, COR-018).

/// <summary><c>POST /api/content-items/{id}/schedule</c>.</summary>
public sealed record ContentScheduleRequest
{
    /// <summary>The scenario-time publish instant (ISO-8601 with an offset or <c>Z</c>); must not be in the past.</summary>
    [JsonPropertyName("scenarioTime")]
    public string? ScenarioTime { get; init; }

    /// <summary>The side effects to persist for the runner's replay (FC-7a); null keeps what is persisted.</summary>
    [JsonPropertyName("options")]
    public PublishOptions? Options { get; init; }
}

/// <summary><c>POST /api/content-items/{id}/revise</c>.</summary>
public sealed record ContentReviseRequest
{
    /// <summary><c>update</c>, <c>correction</c> or <c>silent_rewrite</c>.</summary>
    [JsonPropertyName("kind")]
    public string? Kind { get; init; }

    /// <summary>The participant-visible note (required for update / correction).</summary>
    [JsonPropertyName("note")]
    public string? Note { get; init; }

    /// <summary>The revised fields; <c>fields.version</c> is the version being revised.</summary>
    [JsonPropertyName("fields")]
    public ContentWriteRequest? Fields { get; init; }

    /// <summary>Whether the Updated stamp moves (news FU-2); absent means <c>true</c>.</summary>
    [JsonPropertyName("touchUpdatedStamp")]
    public bool? TouchUpdatedStamp { get; init; }
}

/// <summary><c>POST /api/content-items/{id}/feature</c>.</summary>
public sealed record ContentFeatureRequest
{
    /// <summary>The featured rank (1 or more), or null to unfeature.</summary>
    [JsonPropertyName("rank")]
    public int? Rank { get; init; }
}

/// <summary><c>POST /api/content-items/feature/reorder</c> (portal FU-8).</summary>
public sealed record ContentFeatureReorderRequest
{
    /// <summary>The channel's whole featured order; every other featured item of the channel is unfeatured.</summary>
    [JsonPropertyName("ids")]
    public IReadOnlyList<Guid>? Ids { get; init; }

    /// <summary>The channel; required only to clear the slot with an empty <see cref="Ids"/>.</summary>
    [JsonPropertyName("channel")]
    public string? Channel { get; init; }
}

/// <summary>The <c>publish</c> response: the item and any side effect that failed without blocking the publish.</summary>
public sealed record ContentPublishResponse
{
    /// <summary>The published item.</summary>
    [JsonPropertyName("item")]
    public required ChannelContentStaffDto Item { get; init; }

    /// <summary>Side effects (alert, paired post) that could not be made; empty when all succeeded.</summary>
    [JsonPropertyName("sideEffectWarnings")]
    public IReadOnlyList<string> SideEffectWarnings { get; init; } = [];
}
