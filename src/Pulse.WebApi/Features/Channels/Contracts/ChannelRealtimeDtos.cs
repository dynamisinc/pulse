namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.Json.Serialization;

// FROZEN FC-3 alert shape and FC-4/FC-5 frame payloads (channels-foundation story 02, #698). Same
// conventions as ChannelContentDtos.cs: explicit camelCase keys, string literals, scenario-time ISO strings,
// sealed and flat. Every type here is participant-safe (XC-002) and pinned in contract/wireContract.json.

/// <summary>
/// <c>GET /api/alerts</c> / <c>/api/alerts/history</c> entry and the <c>AlertsChanged</c> element. A
/// SUPERSET of the shell's frozen <c>Alert</c> (<c>alertTypes.ts</c>, and the server's
/// <c>ParticipantShell.AlertDto</c>): the first four keys are the shell's, the rest are additive and
/// tolerated by the shell guard.
/// </summary>
public sealed record AlertDto
{
    /// <summary>The alert id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The severity (<see cref="ChannelVocabulary.AlertSeverities"/>).</summary>
    [JsonPropertyName("severity")]
    public required string Severity { get; init; }

    /// <summary>The alert headline, verbatim.</summary>
    [JsonPropertyName("message")]
    public required string Message { get; init; }

    /// <summary>The scenario-time instant the alert was issued.</summary>
    [JsonPropertyName("scenarioTime")]
    public required string ScenarioTime { get; init; }

    /// <summary>
    /// The host-relative "Details" target (FC-9.3), or null. Must pass <see cref="ChannelVocabulary.IsHostRelativePath"/>;
    /// the client guard rejects anything else.
    /// </summary>
    [JsonPropertyName("href")]
    public string? Href { get; init; }

    /// <summary>
    /// The source channel id, or null. The stored value may be <see cref="ChannelVocabulary.AlertSourceSystem"/>, which
    /// never goes on the wire: map it with <see cref="WireSourceChannel"/> (the client guard rejects <c>"system"</c>, and
    /// one bad alert fails the whole active set).
    /// </summary>
    [JsonPropertyName("sourceChannel")]
    public string? SourceChannel { get; init; }

    /// <summary>The content item that raised the alert, or null.</summary>
    [JsonPropertyName("contentId")]
    public string? ContentId { get; init; }

    /// <summary>The scenario-time expiry, or null.</summary>
    [JsonPropertyName("expiresScenarioTime")]
    public string? ExpiresScenarioTime { get; init; }

    /// <summary>
    /// Maps a stored <c>ChannelAlert.SourceChannel</c> (a channel id or <c>system</c>) to the wire value: a channel id
    /// passes through; anything else, including <c>system</c>, becomes null.
    /// </summary>
    /// <param name="storedSourceChannel">The stored source.</param>
    /// <returns>The wire <c>sourceChannel</c>.</returns>
    public static string? WireSourceChannel(string? storedSourceChannel) =>
        ChannelVocabulary.IsChannelId(storedSourceChannel) ? storedSourceChannel : null;
}

/// <summary>
/// <c>ContentRevised</c> frame: enough to move the Updated stamp and the headline in place; no body (the
/// client refetches the item).
/// </summary>
public sealed record ContentRevisedDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The host-relative permalink.</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>The Updated stamp after the revise, or null.</summary>
    [JsonPropertyName("updatedScenarioTime")]
    public string? UpdatedScenarioTime { get; init; }

    /// <summary>The participant-visible revisions after the revise.</summary>
    [JsonPropertyName("revisions")]
    public IReadOnlyList<ContentRevisionDto> Revisions { get; init; } = [];

    /// <summary>The headline after the revise.</summary>
    [JsonPropertyName("headline")]
    public required string Headline { get; init; }

    /// <summary>The dek after the revise, or null.</summary>
    [JsonPropertyName("dek")]
    public string? Dek { get; init; }
}

/// <summary><c>ContentRetracted</c> frame: identity and the retraction instant only.</summary>
public sealed record ContentRetractedDto
{
    /// <summary>The content item id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The item's channel.</summary>
    [JsonPropertyName("channelId")]
    public required string ChannelId { get; init; }

    /// <summary>The host-relative permalink.</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }

    /// <summary>The scenario-time retraction instant.</summary>
    [JsonPropertyName("retractedScenarioTime")]
    public required string RetractedScenarioTime { get; init; }
}

/// <summary>
/// <c>AlertsChanged</c> frame: the FULL active set, so a late or reconnecting client converges without a
/// diff.
/// </summary>
public sealed record AlertsChangedDto
{
    /// <summary>Every active alert.</summary>
    [JsonPropertyName("alerts")]
    public IReadOnlyList<AlertDto> Alerts { get; init; } = [];
}

/// <summary>
/// <c>GET /api/link-previews?path=…</c> body (FC-4; SOC-004, NWS-015): in-sim link-card data for a content
/// permalink. Every URL is host-relative.
/// </summary>
public sealed record LinkPreviewDto
{
    /// <summary>The card title (the headline).</summary>
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    /// <summary>The card description (the dek), or null.</summary>
    [JsonPropertyName("description")]
    public string? Description { get; init; }

    /// <summary>The card image, or null.</summary>
    [JsonPropertyName("image")]
    public ContentMediaDto? Image { get; init; }

    /// <summary>The source outlet's display name.</summary>
    [JsonPropertyName("sourceName")]
    public required string SourceName { get; init; }

    /// <summary>The host-relative permalink.</summary>
    [JsonPropertyName("permalink")]
    public required string Permalink { get; init; }
}
