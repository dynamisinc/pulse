namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One piece of channel content (channels-foundation story 01, FC-2): a news article, a press release, a weather
/// product or forecast. Every content channel stores this one shape; kind-specific data rides in the opaque
/// <see cref="PayloadJson"/>, validated by the kind's descriptor (FC-7), so no channel adds its own content table.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (COR-001).</b> <see cref="IExerciseScoped"/>; the outlet reference is a SAME-EXERCISE composite foreign
/// key, so the database refuses content filed under another exercise's outlet. Only the publish funnel
/// (<c>IContentPublishService</c>, story 04) writes these rows.
/// </para>
/// <para>
/// <b>Two worlds (XC-002).</b> <see cref="Origin"/>, <see cref="ActingHumanId"/>, the <c>*WallClock</c> columns,
/// <see cref="Background"/>, <see cref="FeaturedRank"/>, <see cref="InjectId"/>, <see cref="ExternalSource"/> /
/// <see cref="ExternalRef"/>, <see cref="PublishOptionsJson"/>, <see cref="LastError"/> and <see cref="Version"/> are
/// staff-only and never projected to a participant DTO.
/// </para>
/// <para>
/// <b>Scenario time (COR-053).</b> Every <c>*ScenarioTime</c> column is stamped by the funnel from
/// <c>IExerciseClock</c>; none has a database default, so nothing can silently fall back to the wall clock.
/// </para>
/// </remarks>
public sealed class ContentItem : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 32;

    /// <summary>Bound of <see cref="Status"/> and <see cref="Origin"/>.</summary>
    public const int MaxStatusLength = 16;

    /// <summary>Bound of <see cref="Headline"/>.</summary>
    public const int MaxHeadlineLength = 300;

    /// <summary>Bound of <see cref="Dek"/>.</summary>
    public const int MaxDekLength = 600;

    /// <summary>Bound of <see cref="Kicker"/> and <see cref="Category"/>.</summary>
    public const int MaxLabelLength = 80;

    /// <summary>Bound of <see cref="BylineName"/>.</summary>
    public const int MaxBylineNameLength = 160;

    /// <summary>Bound of <see cref="ActingHumanId"/> (matches <see cref="MediaAsset.MaxUploadedByHumanIdLength"/>).</summary>
    public const int MaxActingHumanIdLength = 256;

    /// <summary>Bound of <see cref="ExternalSource"/>.</summary>
    public const int MaxExternalSourceLength = 32;

    /// <summary>Bound of <see cref="ExternalRef"/>.</summary>
    public const int MaxExternalRefLength = 128;

    /// <summary>Bound of <see cref="LastError"/> (matches <see cref="InjectItem.Error"/>).</summary>
    public const int MaxLastErrorLength = 1024;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The content channel (<c>news</c> / <c>press</c> / <c>weather</c>).</summary>
    public required string ChannelId { get; set; }

    /// <summary>The content kind (<c>article</c>, <c>release</c>, <c>weather_product</c>, <c>forecast</c>, ...).</summary>
    public required string Kind { get; set; }

    /// <summary>The publishing outlet in the same exercise.</summary>
    public Guid OutletId { get; set; }

    /// <summary>The permalink segment; unique per <c>(ExerciseId, OutletId)</c>, immutable once first published (FC-1).</summary>
    public required string Slug { get; set; }

    /// <summary>The lifecycle status: <c>draft</c> / <c>scheduled</c> / <c>published</c> / <c>retracted</c>.</summary>
    public required string Status { get; set; }

    /// <summary>The headline.</summary>
    public required string Headline { get; set; }

    /// <summary>The standfirst under the headline.</summary>
    public string? Dek { get; set; }

    /// <summary>The label over the headline ("BREAKING").</summary>
    public string? Kicker { get; set; }

    /// <summary>The outlet section the item files under.</summary>
    public string? Category { get; set; }

    /// <summary>The printed byline name.</summary>
    public string? BylineName { get; set; }

    /// <summary>The byline persona (a logical reference resolved in scope), else <c>null</c>.</summary>
    public Guid? BylinePersonaId { get; set; }

    /// <summary>The body HTML, sanitized at write by the kind's body policy (NFR-004).</summary>
    public string BodyHtml { get; set; } = string.Empty;

    /// <summary>The hero image/video (a media-library asset), else <c>null</c>.</summary>
    public Guid? HeroMediaId { get; set; }

    /// <summary>Kind-specific payload JSON, validated by the kind descriptor (FC-7).</summary>
    public string PayloadJson { get; set; } = "{}";

    /// <summary>Evergreen filler (PRT-031). Staff-only.</summary>
    public bool Background { get; set; }

    /// <summary>The portal featured rank (PRT-004), else <c>null</c>. Staff-only.</summary>
    public int? FeaturedRank { get; set; }

    /// <summary>The scenario instant a scheduled item is due.</summary>
    public DateTimeOffset? ScheduledScenarioTime { get; set; }

    /// <summary>The scenario instant the item was (first) published.</summary>
    public DateTimeOffset? PublishedScenarioTime { get; set; }

    /// <summary>Server wall-clock instant of the publish. Staff/telemetry only.</summary>
    public DateTimeOffset? PublishedWallClock { get; set; }

    /// <summary>The scenario instant of the last retraction.</summary>
    public DateTimeOffset? RetractedScenarioTime { get; set; }

    /// <summary>The scenario instant the item was created.</summary>
    public DateTimeOffset CreatedScenarioTime { get; set; }

    /// <summary>Server wall-clock instant the item was created. Staff/telemetry only.</summary>
    public DateTimeOffset CreatedWallClock { get; set; }

    /// <summary>Who caused the item: <c>controller</c> / <c>participant</c> / <c>engine</c> / <c>inject</c>. Staff-only.</summary>
    public required string Origin { get; set; }

    /// <summary>The human the item is attributed to (COR-018), from the caller's session. Staff-only.</summary>
    public required string ActingHumanId { get; set; }

    /// <summary>The inject that published the item (story 16), a logical reference. Staff-only.</summary>
    public Guid? InjectId { get; set; }

    /// <summary>The paired social post (story 18), a logical reference.</summary>
    public Guid? PairedPostId { get; set; }

    /// <summary>The alert the publish raised (story 10), a logical reference.</summary>
    public Guid? AlertId { get; set; }

    /// <summary>The external system that pushed the item (<c>cadence</c>, PDF-06). Staff-only.</summary>
    public string? ExternalSource { get; set; }

    /// <summary>The pushing system's id; <c>(ExerciseId, ExternalSource, ExternalRef)</c> is unique when both are set. Staff-only.</summary>
    public string? ExternalRef { get; set; }

    /// <summary>The "Updated 14:32" stamp: moved by <c>update</c>, <c>correction</c> and <c>silent_rewrite</c>, never by <c>edit</c>.</summary>
    public DateTimeOffset? UpdatedScenarioTime { get; set; }

    /// <summary>Persisted <c>PublishOptions</c> replayed by the scheduler and inject fire (FC-7a). Staff-only.</summary>
    public string? PublishOptionsJson { get; set; }

    /// <summary>Why the last scheduled publish was refused (story 05), else <c>null</c>. Staff-only.</summary>
    public string? LastError { get; set; }

    /// <summary>How many revisions the item has.</summary>
    public int RevisionCount { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps. Staff-only.</summary>
    public int Version { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
