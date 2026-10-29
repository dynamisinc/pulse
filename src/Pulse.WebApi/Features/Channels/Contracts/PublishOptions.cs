namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.Json.Serialization;

/// <summary>
/// What a publish does BESIDES changing state: an optional paired Social post and an optional alert (FC-7).
/// Persisted as <c>ContentItem.PublishOptionsJson</c> by <c>ScheduleAsync</c> and inject attach, and
/// replayed by the scheduled runner and inject fire, so the camelCase keys are a stored contract too.
/// </summary>
/// <remarks>
/// FC-7a resolution in the funnel: <b>first non-null wins, no merging</b> — (1) the options on the call,
/// (2) the persisted <c>PublishOptionsJson</c>, (3) <see cref="IContentKindDescriptor.ResolvePublishOptions"/>,
/// (4) none.
/// </remarks>
public sealed record PublishOptions
{
    /// <summary>Post a link card as the outlet's paired persona (<see cref="IPairedSocialPoster"/>), or null.</summary>
    [JsonPropertyName("pairedPost")]
    public PairedPostOptions? PairedPost { get; init; }

    /// <summary>Raise an alert pointing at the item (<see cref="IAlertRaiser"/>), or null.</summary>
    [JsonPropertyName("alert")]
    public PublishAlertOptions? Alert { get; init; }
}

/// <summary>The paired-post half of <see cref="PublishOptions"/>.</summary>
public sealed record PairedPostOptions
{
    /// <summary>The post text above the link card, or null for the poster's default composition.</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}

/// <summary>
/// The alert half of <see cref="PublishOptions"/>, and the shape of a descriptor's
/// <see cref="IContentKindDescriptor.DefaultAlertMapping"/> suggestion. The funnel fills the rest of the
/// <see cref="AlertRaise"/> (href = the permalink, source channel and content id = the item's).
/// </summary>
public sealed record PublishAlertOptions
{
    /// <summary>The severity (<see cref="ChannelVocabulary.AlertSeverities"/>).</summary>
    [JsonPropertyName("severity")]
    public string Severity { get; init; } = ChannelVocabulary.SeverityAdvisory;

    /// <summary>The alert headline, or null to use the item's headline.</summary>
    [JsonPropertyName("headline")]
    public string? Headline { get; init; }

    /// <summary>The scenario-time expiry, or null for no expiry.</summary>
    [JsonPropertyName("expiresScenarioTime")]
    public string? ExpiresScenarioTime { get; init; }
}

/// <summary>
/// The options on <see cref="IContentPublishService.ReviseAsync"/>: what kind of revision, the editor's note,
/// the new field values, and whether the participant-visible Updated stamp moves.
/// </summary>
public sealed record ReviseOptions
{
    /// <summary>
    /// The revision kind (<see cref="ChannelVocabulary.RevisionKinds"/>). On a published item it is
    /// <c>update</c>, <c>correction</c> or <c>silent_rewrite</c>; <c>edit</c> is the draft-history kind.
    /// </summary>
    public required string Kind { get; init; }

    /// <summary>The editor's note (rendered for <c>correction</c> / <c>update</c>), or null.</summary>
    public string? Note { get; init; }

    /// <summary>The item's new field values. <c>version</c> is the concurrency token.</summary>
    public required ContentWriteRequest Fields { get; init; }

    /// <summary>
    /// Whether the revise moves <c>updatedScenarioTime</c> (news FU-2). <c>false</c> is a payload-only change
    /// (e.g. setting or clearing a breaking banner): nothing participant-visible moves and no
    /// <c>revisions[]</c> entry is added. Defaults to <c>true</c>; there is no fully-invisible option beyond this.
    /// </summary>
    public bool TouchUpdatedStamp { get; init; } = true;
}

/// <summary>
/// Who is calling the funnel, taken from the caller's AUTHENTICATED session (never a request body, FC-7).
/// Staff and participant callers are both valid; authorization is the calling endpoint's.
/// </summary>
public sealed record ContentCaller
{
    /// <summary>The provenance (<see cref="ChannelVocabulary.ContentOrigins"/>).</summary>
    public required string Origin { get; init; }

    /// <summary>The acting human (COR-018).</summary>
    public required string ActingHumanId { get; init; }

    /// <summary>The firing inject when <see cref="Origin"/> is <c>inject</c>, else null.</summary>
    public Guid? InjectId { get; init; }
}
