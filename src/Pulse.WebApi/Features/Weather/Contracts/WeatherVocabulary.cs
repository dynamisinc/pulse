namespace Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The weather payload vocabulary (weather-source story 01, #752; WX-010, WX-001/003). Every value is a lowercase STRING wire
/// literal, never a C# enum on the wire (the <c>ChannelVocabulary</c> convention), and every list here is mirrored verbatim by
/// <c>src/frontend/src/features/weather/contract/vocabulary.ts</c>. <c>WeatherContractParityTests</c> asserts both sides
/// through the shared golden file <c>features/weather/contract/weatherContract.json</c>.
/// </summary>
/// <remarks>
/// There is deliberately no severity here: the alert severity is derived from <see cref="ProductTypes"/> in ONE place,
/// weather story 04's <c>WeatherAlertSeverityMap</c>. No VTEC, UGC or SAME codes (out of scope).
/// </remarks>
public static class WeatherVocabulary
{
    /// <summary>Product type <c>watch</c>.</summary>
    public const string ProductWatch = "watch";

    /// <summary>Product type <c>warning</c>. Its IBW block is required and its alert cannot be switched off.</summary>
    public const string ProductWarning = "warning";

    /// <summary>Product type <c>advisory</c>.</summary>
    public const string ProductAdvisory = "advisory";

    /// <summary>Every product type.</summary>
    public static IReadOnlyList<string> ProductTypes { get; } = [ProductWatch, ProductWarning, ProductAdvisory];

    /// <summary>The closed hazard list (WX-010). <c>other</c> is the escape hatch.</summary>
    public static IReadOnlyList<string> Hazards { get; } =
    [
        "tornado", "severe_thunderstorm", "flash_flood", "flood", "hurricane", "tropical_storm", "storm_surge",
        "winter_storm", "blizzard", "ice_storm", "extreme_heat", "extreme_cold", "high_wind", "wildfire_smoke",
        "dense_fog", "other",
    ];

    /// <summary>Product action <c>new</c>: a first issuance; supersedes nothing.</summary>
    public const string ActionNew = "new";

    /// <summary>Product action <c>update</c>: replaces a published product of the same type.</summary>
    public const string ActionUpdate = "update";

    /// <summary>Product action <c>upgrade</c>: replaces a published product with a more severe one (watch → warning).</summary>
    public const string ActionUpgrade = "upgrade";

    /// <summary>Product action <c>cancel</c>: ends a published product early.</summary>
    public const string ActionCancel = "cancel";

    /// <summary>Every product action.</summary>
    public static IReadOnlyList<string> ProductActions { get; } = [ActionNew, ActionUpdate, ActionUpgrade, ActionCancel];

    /// <summary>The actions that must name the product they supersede.</summary>
    public static IReadOnlyList<string> SupersedingActions { get; } = [ActionUpdate, ActionUpgrade, ActionCancel];

    /// <summary>The closed condition-icon vocabulary for current conditions and forecast periods.</summary>
    public static IReadOnlyList<string> ConditionCodes { get; } =
    [
        "clear", "partly_cloudy", "cloudy", "rain", "showers", "thunderstorms", "snow", "sleet", "fog", "wind", "hot", "cold",
    ];

    /// <summary>Product state <c>pending</c>: scenario now is before <c>effectiveScenarioTime</c>.</summary>
    public const string StatePending = "pending";

    /// <summary>Product state <c>active</c>: effective ≤ now &lt; expires, and not cancelled.</summary>
    public const string StateActive = "active";

    /// <summary>Product state <c>expired</c>: now ≥ <c>expiresScenarioTime</c>.</summary>
    public const string StateExpired = "expired";

    /// <summary>Product state <c>cancelled</c>: a published <c>cancel</c> product supersedes it.</summary>
    public const string StateCancelled = "cancelled";

    /// <summary>Every product state, as the TS <c>productState</c> returns them.</summary>
    public static IReadOnlyList<string> ProductStates { get; } = [StatePending, StateActive, StateExpired, StateCancelled];
}

/// <summary>
/// The weather payload bounds (story 01, NFR-004). A string is measured AFTER plain-text cleaning; an over-long value is a
/// field error, never silently truncated (the product text is verbatim data, D4-010). Mirrored by <c>WEATHER_LIMITS</c>.
/// </summary>
public static class WeatherLimits
{
    /// <summary>
    /// The product narrative (<c>BodyHtml</c>) cap. NOT enforced by the weather descriptors (FC-7 gives a descriptor the
    /// payload only); it needs a funnel-side per-kind body limit (follow-up raised with F04).
    /// </summary>
    public const int NarrativeMaxLength = 4000;

    /// <summary>
    /// The longest headline the weather kinds guarantee to keep untruncated (D4-010). The headline is the funnel's field
    /// (sanitized, trimmed, capped at <c>ContentItem.MaxHeadlineLength</c>); weather adds no transformation of its own.
    /// </summary>
    public const int HeadlineMaxLength = 200;

    /// <summary>Each IBW field (<c>what</c>, <c>where</c>, <c>when</c>, <c>impacts</c>).</summary>
    public const int IbwFieldMaxLength = 1000;

    /// <summary>Each protective action.</summary>
    public const int ActionMaxLength = 300;

    /// <summary>At most this many protective actions.</summary>
    public const int MaxActions = 8;

    /// <summary>A product names 1..this many zones.</summary>
    public const int MaxZones = 12;

    /// <summary>A forecast carries 1..this many periods.</summary>
    public const int MaxPeriods = 14;

    /// <summary>The forecast discussion cap.</summary>
    public const int DiscussionMaxLength = 4000;

    /// <summary>The forecast uncertainty note cap.</summary>
    public const int UncertaintyNoteMaxLength = 1000;

    /// <summary>A forecast period's detailed text.</summary>
    public const int PeriodDetailMaxLength = 1000;

    /// <summary>A period label ("Tonight"), a condition ("Mostly Cloudy") or a wind text ("SW 10 to 15 mph").</summary>
    public const int ShortTextMaxLength = 100;

    /// <summary>A wind direction ("SW", "Variable").</summary>
    public const int WindDirMaxLength = 16;

    /// <summary>The <c>@WeatherDesk</c> post text, in Unicode code points (story 04).</summary>
    public const int PostTextMaxCodePoints = 280;

    /// <summary>The plausible temperature range in °F (US customary only, Q8).</summary>
    public const int MinTempF = -80;

    /// <summary>The plausible temperature range in °F.</summary>
    public const int MaxTempF = 140;

    /// <summary>The plausible wind speed ceiling in mph.</summary>
    public const int MaxWindMph = 250;
}
