namespace Pulse.WebApi.Features.Portal.Contracts;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// PC-1, the frozen portal vocabulary (exercise-portal story 02, #768). Every value is a lowercase or camelCase
/// STRING wire literal, never a C# enum on the wire (the <see cref="ChannelVocabulary"/> convention), and every
/// list here is mirrored verbatim by <c>src/frontend/src/features/portal/contract/vocabulary.ts</c>.
/// <c>PortalContractParityTests</c> asserts the two sides through the shared golden file
/// <c>features/portal/contract/portalWireContract.json</c>, so a one-sided edit fails a build rather than a review.
/// </summary>
/// <remarks>
/// <para>
/// Additive-only after E3 Wave 1 (orchestrator approval). The display vocabulary (<c>DisplayMode</c>,
/// <c>DisplayTargetKind</c>) is Deferred post-December (Q-35, Tom 10/29) and deliberately absent.
/// </para>
/// <para>
/// The limits are the single source for the <c>PortalLimits</c> guard (story 01), the config and resources
/// APIs (03, 04) and the console form (16). The entity column widths in <c>Data/Entities</c> are storage
/// ceilings, not these product limits.
/// </para>
/// </remarks>
public static class PortalVocabulary
{
    /// <summary>The <c>topStories</c> module (source channel <c>news</c>).</summary>
    public const string ModuleTopStories = "topStories";

    /// <summary>The <c>socialStream</c> module (source channel <c>social</c>).</summary>
    public const string ModuleSocialStream = "socialStream";

    /// <summary>The <c>trending</c> module (source channel <c>social</c>).</summary>
    public const string ModuleTrending = "trending";

    /// <summary>The <c>pressLatest</c> module (source channel <c>press</c>).</summary>
    public const string ModulePressLatest = "pressLatest";

    /// <summary>The <c>weather</c> module (source channel <c>weather</c>).</summary>
    public const string ModuleWeather = "weather";

    /// <summary>Every portal module id, in PC-1 order. An additive registry (<c>registerPortalModule</c>, PC-5).</summary>
    public static IReadOnlyList<string> ModuleIds { get; } =
        [ModuleTopStories, ModuleSocialStream, ModuleTrending, ModulePressLatest, ModuleWeather];

    /// <summary>
    /// Each module id's ONE source channel (FC-1 <see cref="ChannelVocabulary.ChannelIds"/>). A module is available
    /// only while its source channel is enabled (F08); a module for a disabled channel is absent, never flagged.
    /// </summary>
    public static IReadOnlyDictionary<string, string> ModuleChannelIds { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [ModuleTopStories] = ChannelVocabulary.News,
        [ModuleSocialStream] = ChannelVocabulary.Social,
        [ModuleTrending] = ChannelVocabulary.Social,
        [ModulePressLatest] = ChannelVocabulary.Press,
        [ModuleWeather] = ChannelVocabulary.Weather,
    };

    /// <summary>
    /// The module order an exercise without a <c>PortalConfig</c> row gets (story 03, "Defaults without a row").
    /// </summary>
    public static IReadOnlyList<string> DefaultModuleOrder { get; } =
        [ModuleTopStories, ModuleSocialStream, ModulePressLatest, ModuleWeather, ModuleTrending];

    /// <summary>The <c>anchor</c> layout: hero left + right rail. The only December layout.</summary>
    public const string LayoutAnchor = "anchor";

    /// <summary>Every layout key. <c>band</c> / <c>grid</c> are parked (D2-003) and are not values.</summary>
    public static IReadOnlyList<string> LayoutKeys { get; } = [LayoutAnchor];

    /// <summary>The layout an exercise without a <c>PortalConfig</c> row gets.</summary>
    public const string DefaultLayoutKey = LayoutAnchor;

    /// <summary>The most resources one exercise may hold (non-deleted rows).</summary>
    public const int MaxResources = 25;

    /// <summary>The longest masthead (portal) name, in characters.</summary>
    public const int MastheadNameMaxLength = 60;

    /// <summary>The largest stored <c>ModulesJson</c>, in UTF-8 bytes.</summary>
    public const int ModulesJsonMaxBytes = 4096;

    /// <summary>The largest stored <c>SkinOverridesJson</c>, in UTF-8 bytes (also F03's validator cap).</summary>
    public const int SkinOverridesJsonMaxBytes = 4096;

    /// <summary>The longest resource title, in characters (story 04, "Staff CRUD").</summary>
    public const int ResourceTitleMaxLength = 120;

    /// <summary>The longest resource summary, in characters (story 04, "Staff CRUD").</summary>
    public const int ResourceSummaryMaxLength = 300;

    /// <summary>Whether <paramref name="value"/> is one of <see cref="ModuleIds"/> (ordinal, case-sensitive).</summary>
    /// <param name="value">The candidate id.</param>
    /// <returns><c>true</c> when the value is a portal module id.</returns>
    public static bool IsModuleId(string? value) => value is not null && ModuleIds.Contains(value, StringComparer.Ordinal);

    /// <summary>Whether <paramref name="value"/> is one of <see cref="LayoutKeys"/> (ordinal, case-sensitive).</summary>
    /// <param name="value">The candidate key.</param>
    /// <returns><c>true</c> when the value is a layout key.</returns>
    public static bool IsLayoutKey(string? value) => value is not null && LayoutKeys.Contains(value, StringComparer.Ordinal);
}
