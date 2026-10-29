namespace Pulse.WebApi.Features.Channels.Contracts;

using System.Text.RegularExpressions;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// FC-1, the frozen channels vocabulary (channels-foundation story 02, #698). Every value is a lowercase
/// STRING wire literal, never a C# enum on the wire (the <c>ParticipantShellDtos.cs</c> convention), and
/// every list here is mirrored verbatim by <c>src/frontend/src/features/channels/contract/vocabulary.ts</c>.
/// <c>ChannelContractParityTests</c> asserts the two sides through the shared golden file
/// <c>contract/wireContract.json</c>, so a one-sided edit fails a build rather than a review.
/// </summary>
/// <remarks>
/// Additive-only after Wave 1 (orchestrator approval): a channel adds a <see cref="ContentKinds"/> value
/// by registering an <c>IContentKindDescriptor</c>, never by editing an entity.
/// </remarks>
public static partial class ChannelVocabulary
{
    /// <summary>The <c>social</c> channel id.</summary>
    public const string Social = ChannelCatalog.SocialChannelId;

    /// <summary>The <c>portal</c> channel id. Aggregates; owns no content items (Q7).</summary>
    public const string Portal = "portal";

    /// <summary>The <c>news</c> channel id. A content channel.</summary>
    public const string News = "news";

    /// <summary>The <c>press</c> channel id. A content channel.</summary>
    public const string Press = "press";

    /// <summary>The <c>weather</c> channel id. A content channel.</summary>
    public const string Weather = "weather";

    /// <summary>
    /// Every channel id, in <see cref="ChannelCatalog.All"/> order. Equal to the catalog's ids (a test
    /// pins this): FC-1 adds no channel, it names the existing ones.
    /// </summary>
    public static IReadOnlyList<string> ChannelIds { get; } = [Social, Portal, News, Press, Weather];

    /// <summary>The channels that own <c>ContentItem</c>s. Portal aggregates and owns none.</summary>
    public static IReadOnlyList<string> ContentChannelIds { get; } = [News, Press, Weather];

    /// <summary>The <c>article</c> kind (news).</summary>
    public const string KindArticle = "article";

    /// <summary>The <c>release</c> kind (press).</summary>
    public const string KindRelease = "release";

    /// <summary>The <c>weather_product</c> kind (weather).</summary>
    public const string KindWeatherProduct = "weather_product";

    /// <summary>The <c>forecast</c> kind (weather).</summary>
    public const string KindForecast = "forecast";

    /// <summary>The December content kinds. A registry, additive only.</summary>
    public static IReadOnlyList<string> ContentKinds { get; } = [KindArticle, KindRelease, KindWeatherProduct, KindForecast];

    /// <summary>Content status <c>draft</c>. Staff-only; never on a participant DTO.</summary>
    public const string StatusDraft = "draft";

    /// <summary>Content status <c>scheduled</c>. Staff-only; never on a participant DTO.</summary>
    public const string StatusScheduled = "scheduled";

    /// <summary>Content status <c>published</c>.</summary>
    public const string StatusPublished = "published";

    /// <summary>Content status <c>retracted</c>.</summary>
    public const string StatusRetracted = "retracted";

    /// <summary>
    /// Every content status. Allowed transitions: draft→scheduled, draft→published, scheduled→draft,
    /// scheduled→published, published→retracted, retracted→published; anything else is a 409.
    /// </summary>
    public static IReadOnlyList<string> ContentStatuses { get; } = [StatusDraft, StatusScheduled, StatusPublished, StatusRetracted];

    /// <summary>
    /// The only two statuses a participant DTO may carry, as its <c>state</c> field (XC-002). Draft and
    /// scheduled items are never projected to a participant at all.
    /// </summary>
    public static IReadOnlyList<string> ParticipantContentStates { get; } = [StatusPublished, StatusRetracted];

    /// <summary>Origin <c>controller</c>.</summary>
    public const string OriginController = "controller";

    /// <summary>Origin <c>participant</c>.</summary>
    public const string OriginParticipant = "participant";

    /// <summary>Origin <c>engine</c>. Engine items always land as <c>draft</c> (NWS-022).</summary>
    public const string OriginEngine = "engine";

    /// <summary>Origin <c>inject</c>.</summary>
    public const string OriginInject = "inject";

    /// <summary>Every content origin. Staff-only provenance (XC-002).</summary>
    public static IReadOnlyList<string> ContentOrigins { get; } = [OriginController, OriginParticipant, OriginEngine, OriginInject];

    /// <summary>Revision kind <c>edit</c>: pre-publish draft history (PRS-004). Never moves the Updated stamp.</summary>
    public const string RevisionEdit = "edit";

    /// <summary>Revision kind <c>update</c>: visible "Updated 14:32" (PRS-005). Moves the stamp; adds a <c>revisions[]</c> entry.</summary>
    public const string RevisionUpdate = "update";

    /// <summary>Revision kind <c>correction</c>: visible editor's note (NWS-013). Moves the stamp; adds a <c>revisions[]</c> entry.</summary>
    public const string RevisionCorrection = "correction";

    /// <summary>
    /// Revision kind <c>silent_rewrite</c>: new content with no note and no participant <c>revisions[]</c>
    /// entry; it still moves the Updated stamp (news FU-1). Staff-visible only.
    /// </summary>
    public const string RevisionSilentRewrite = "silent_rewrite";

    /// <summary>Every revision kind.</summary>
    public static IReadOnlyList<string> RevisionKinds { get; } = [RevisionEdit, RevisionUpdate, RevisionCorrection, RevisionSilentRewrite];

    /// <summary>The revision kinds a participant may see in <c>revisions[]</c>.</summary>
    public static IReadOnlyList<string> ParticipantRevisionKinds { get; } = [RevisionUpdate, RevisionCorrection];

    /// <summary>The revision kinds that move <c>updatedScenarioTime</c> (the Updated stamp rule).</summary>
    public static IReadOnlyList<string> StampMovingRevisionKinds { get; } = [RevisionUpdate, RevisionCorrection, RevisionSilentRewrite];

    /// <summary>Alert severity <c>info</c>.</summary>
    public const string SeverityInfo = "info";

    /// <summary>Alert severity <c>advisory</c>.</summary>
    public const string SeverityAdvisory = "advisory";

    /// <summary>Alert severity <c>emergency</c>.</summary>
    public const string SeverityEmergency = "emergency";

    /// <summary>Every alert severity, frozen by the shell (<c>alertTypes.ts</c>).</summary>
    public static IReadOnlyList<string> AlertSeverities { get; } = [SeverityInfo, SeverityAdvisory, SeverityEmergency];

    /// <summary>
    /// The <c>sourceChannel</c> value for an alert raised by no channel (the console flag, CTL-021). FC-2's
    /// <c>ChannelAlert.SourceChannel</c> is a channel id or this.
    /// </summary>
    public const string AlertSourceSystem = "system";

    /// <summary>Media role <c>hero</c>.</summary>
    public const string MediaRoleHero = "hero";

    /// <summary>Media role <c>inline</c>.</summary>
    public const string MediaRoleInline = "inline";

    /// <summary>Media role <c>attachment</c>.</summary>
    public const string MediaRoleAttachment = "attachment";

    /// <summary>Every media role.</summary>
    public static IReadOnlyList<string> MediaRoles { get; } = [MediaRoleHero, MediaRoleInline, MediaRoleAttachment];

    /// <summary>Media kind <c>image</c>.</summary>
    public const string MediaKindImage = "image";

    /// <summary>Media kind <c>video</c>.</summary>
    public const string MediaKindVideo = "video";

    /// <summary>Media kind <c>document</c>: E5's download-only PDF attachment (press story 02 owns the pipeline).</summary>
    public const string MediaKindDocument = "document";

    /// <summary>Every content media kind.</summary>
    public static IReadOnlyList<string> ContentMediaKinds { get; } = [MediaKindImage, MediaKindVideo, MediaKindDocument];

    /// <summary>The longest slug FC-1 allows.</summary>
    public const int SlugMaxLength = 80;

    /// <summary>
    /// Whether <paramref name="value"/> is a valid FC-1 slug: <c>[a-z0-9-]{1,80}</c>. Outlet and content
    /// slugs share the rule; a slug is immutable once first published (NWS-011).
    /// </summary>
    /// <param name="value">The candidate slug.</param>
    /// <returns><c>true</c> when the value is a well-formed slug.</returns>
    public static bool IsSlug(string? value) => value is not null && SlugPattern().IsMatch(value);

    /// <summary>Whether <paramref name="value"/> is one of <see cref="ChannelIds"/> (ordinal, case-sensitive).</summary>
    /// <param name="value">The candidate id.</param>
    /// <returns><c>true</c> when the value is a channel id.</returns>
    public static bool IsChannelId(string? value) => value is not null && ChannelIds.Contains(value, StringComparer.Ordinal);

    [GeneratedRegex("^[a-z0-9-]{1,80}$", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();
}

/// <summary>
/// FC-5 client event names on the existing exercise hub. Payloads: <c>ContentPublished</c> →
/// <see cref="ChannelContentSummaryDto"/>, <c>ContentRevised</c> → <see cref="ContentRevisedDto"/>,
/// <c>ContentRetracted</c> → <see cref="ContentRetractedDto"/>, <c>AlertsChanged</c> → <see cref="AlertsChangedDto"/>.
/// Mirrored by <c>CHANNEL_REALTIME_EVENTS</c> in <c>vocabulary.ts</c>.
/// </summary>
public static class ChannelRealtimeEvents
{
    /// <summary>An item became <c>published</c> (publish-now, the scheduled runner, or restore).</summary>
    public const string ContentPublished = "ContentPublished";

    /// <summary>An <c>update</c> / <c>correction</c> / <c>silent_rewrite</c> revise committed.</summary>
    public const string ContentRevised = "ContentRevised";

    /// <summary>An item was retracted (or a published item soft-deleted).</summary>
    public const string ContentRetracted = "ContentRetracted";

    /// <summary>The active alert set changed (raised, cleared, expired).</summary>
    public const string AlertsChanged = "AlertsChanged";

    /// <summary>All four, in FC-5 order.</summary>
    public static IReadOnlyList<string> All { get; } = [ContentPublished, ContentRevised, ContentRetracted, AlertsChanged];
}
