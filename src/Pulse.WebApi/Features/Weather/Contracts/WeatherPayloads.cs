namespace Pulse.WebApi.Features.Weather.Contracts;

using System.Text.Json.Serialization;

/// <summary>
/// The STORED <c>weather_product</c> payload (<c>ContentItem.PayloadJson</c>, WX-010), in the normalized form the descriptor
/// writes back after validation. Staff-only as a whole: participants see <see cref="WeatherProductProjection"/>.
/// Headline, dek, narrative (<c>BodyHtml</c>), media and permalink are the foundation's (FC-2/FC-3), never repeated here.
/// </summary>
public sealed record WeatherProductPayload
{
    /// <summary><see cref="WeatherVocabulary.ProductTypes"/>.</summary>
    [JsonPropertyName("productType")]
    public required string ProductType { get; init; }

    /// <summary><see cref="WeatherVocabulary.Hazards"/>.</summary>
    [JsonPropertyName("hazard")]
    public required string Hazard { get; init; }

    /// <summary><see cref="WeatherVocabulary.ProductActions"/>.</summary>
    [JsonPropertyName("action")]
    public required string Action { get; init; }

    /// <summary>The published weather product this one supersedes (update / upgrade / cancel), else null. Staff-only.</summary>
    [JsonPropertyName("supersedesContentId")]
    public Guid? SupersedesContentId { get; init; }

    /// <summary>
    /// The superseded product's permalink, SERVER-derived during validation from <see cref="SupersedesContentId"/> (never
    /// client-supplied); the only supersession detail a participant sees.
    /// </summary>
    [JsonPropertyName("supersedesPermalink")]
    public string? SupersedesPermalink { get; init; }

    /// <summary>1..12 zone slugs in the exercise.</summary>
    [JsonPropertyName("zoneSlugs")]
    public required IReadOnlyList<string> ZoneSlugs { get; init; }

    /// <summary>When the product takes effect, a scenario-time ISO instant with an offset (COR-053).</summary>
    [JsonPropertyName("effectiveScenarioTime")]
    public required string EffectiveScenarioTime { get; init; }

    /// <summary>When it expires; strictly after <see cref="EffectiveScenarioTime"/>.</summary>
    [JsonPropertyName("expiresScenarioTime")]
    public required string ExpiresScenarioTime { get; init; }

    /// <summary>The impact-based warning block; required for a <c>warning</c>, optional otherwise.</summary>
    [JsonPropertyName("ibw")]
    public WeatherIbw? Ibw { get; init; }

    /// <summary>0..8 protective actions.</summary>
    [JsonPropertyName("actions")]
    public required IReadOnlyList<string> Actions { get; init; }

    /// <summary>The staff-only delivery block (consumed by story 04). Never projected (XC-002).</summary>
    [JsonPropertyName("delivery")]
    public required WeatherDelivery Delivery { get; init; }
}

/// <summary>The impact-based warning block: what, where, when, impacts (plain text, each ≤ 1,000).</summary>
public sealed record WeatherIbw
{
    /// <summary>The hazard and its magnitude.</summary>
    [JsonPropertyName("what")]
    public required string What { get; init; }

    /// <summary>The affected places.</summary>
    [JsonPropertyName("where")]
    public required string Where { get; init; }

    /// <summary>The time window, as authored text.</summary>
    [JsonPropertyName("when")]
    public required string When { get; init; }

    /// <summary>The expected impacts.</summary>
    [JsonPropertyName("impacts")]
    public required string Impacts { get; init; }
}

/// <summary>
/// The staff-only delivery block of a product: whether publishing raises the alert and posts as <c>@WeatherDesk</c>. Read by
/// <c>ResolvePublishOptions</c> (FC-7a) through story 04's <see cref="IWeatherDeliveryPlanner"/>.
/// </summary>
public sealed record WeatherDelivery
{
    /// <summary>Raise the alert-bar entry. Defaults to true; a non-cancel <c>warning</c> cannot set false.</summary>
    [JsonPropertyName("raiseAlert")]
    public bool RaiseAlert { get; init; } = true;

    /// <summary>The paired <c>@WeatherDesk</c> post.</summary>
    [JsonPropertyName("post")]
    public WeatherDeliveryPost Post { get; init; } = new();
}

/// <summary>The post half of <see cref="WeatherDelivery"/>.</summary>
public sealed record WeatherDeliveryPost
{
    /// <summary>Whether to post. Defaults to false (the editor pre-fills its own default, Q2).</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; }

    /// <summary>The post text (≤ 280 code points), or null for the headline verbatim (story 04).</summary>
    [JsonPropertyName("text")]
    public string? Text { get; init; }
}

/// <summary>
/// The participant-safe <c>weather_product</c> projection (XC-002): the <c>payload</c> of a <c>ChannelContentDto</c>. No
/// <c>delivery</c>, no content ids; the superseded product appears only as its permalink. Every key is always written (null
/// when absent) so the TS guard can treat a missing key as out of shape.
/// </summary>
public sealed record WeatherProductProjection
{
    /// <summary><see cref="WeatherProductPayload.ProductType"/>.</summary>
    [JsonPropertyName("productType")]
    public required string ProductType { get; init; }

    /// <summary><see cref="WeatherProductPayload.Hazard"/>.</summary>
    [JsonPropertyName("hazard")]
    public required string Hazard { get; init; }

    /// <summary><see cref="WeatherProductPayload.Action"/>.</summary>
    [JsonPropertyName("action")]
    public required string Action { get; init; }

    /// <summary>The superseded product's host-relative permalink, else null.</summary>
    [JsonPropertyName("supersedesPermalink")]
    public string? SupersedesPermalink { get; init; }

    /// <summary><see cref="WeatherProductPayload.ZoneSlugs"/>.</summary>
    [JsonPropertyName("zoneSlugs")]
    public required IReadOnlyList<string> ZoneSlugs { get; init; }

    /// <summary><see cref="WeatherProductPayload.EffectiveScenarioTime"/>.</summary>
    [JsonPropertyName("effectiveScenarioTime")]
    public required string EffectiveScenarioTime { get; init; }

    /// <summary><see cref="WeatherProductPayload.ExpiresScenarioTime"/>.</summary>
    [JsonPropertyName("expiresScenarioTime")]
    public required string ExpiresScenarioTime { get; init; }

    /// <summary><see cref="WeatherProductPayload.Ibw"/>.</summary>
    [JsonPropertyName("ibw")]
    public WeatherIbw? Ibw { get; init; }

    /// <summary><see cref="WeatherProductPayload.Actions"/>.</summary>
    [JsonPropertyName("actions")]
    public required IReadOnlyList<string> Actions { get; init; }
}

/// <summary>
/// The <c>forecast</c> payload (WX-001/003): one zone's current conditions and 1..14 periods. It carries nothing staff-only,
/// so the stored and the projected shapes are the same record. A later forecast for the same zone may say something different
/// (WX-003): nothing here forbids it.
/// </summary>
public sealed record ForecastPayload
{
    /// <summary>The zone slug in the exercise.</summary>
    [JsonPropertyName("zoneSlug")]
    public required string ZoneSlug { get; init; }

    /// <summary>The current conditions.</summary>
    [JsonPropertyName("current")]
    public required ForecastCurrent Current { get; init; }

    /// <summary>1..14 periods, in authored order.</summary>
    [JsonPropertyName("periods")]
    public required IReadOnlyList<ForecastPeriod> Periods { get; init; }

    /// <summary>The forecaster's discussion (plain text), else null.</summary>
    [JsonPropertyName("discussion")]
    public string? Discussion { get; init; }

    /// <summary>The uncertainty note (plain text), else null.</summary>
    [JsonPropertyName("uncertaintyNote")]
    public string? UncertaintyNote { get; init; }
}

/// <summary>Current conditions in US customary units (Q8).</summary>
public sealed record ForecastCurrent
{
    /// <summary>Temperature, °F.</summary>
    [JsonPropertyName("tempF")]
    public required int TempF { get; init; }

    /// <summary>The authored condition text ("Partly Cloudy").</summary>
    [JsonPropertyName("condition")]
    public required string Condition { get; init; }

    /// <summary><see cref="WeatherVocabulary.ConditionCodes"/>.</summary>
    [JsonPropertyName("conditionCode")]
    public required string ConditionCode { get; init; }

    /// <summary>Wind speed, mph.</summary>
    [JsonPropertyName("windMph")]
    public required int WindMph { get; init; }

    /// <summary>Wind direction text ("SW").</summary>
    [JsonPropertyName("windDir")]
    public required string WindDir { get; init; }

    /// <summary>Relative humidity, 0..100.</summary>
    [JsonPropertyName("humidityPct")]
    public required int HumidityPct { get; init; }

    /// <summary>When observed, a scenario-time ISO instant (COR-053).</summary>
    [JsonPropertyName("observedScenarioTime")]
    public required string ObservedScenarioTime { get; init; }
}

/// <summary>One forecast period. Exactly one of <see cref="TempF"/> or the <see cref="HiF"/> + <see cref="LoF"/> pair is set.</summary>
public sealed record ForecastPeriod
{
    /// <summary>The period label ("Tonight", "Thursday").</summary>
    [JsonPropertyName("label")]
    public required string Label { get; init; }

    /// <summary>A single temperature, °F, else null.</summary>
    [JsonPropertyName("tempF")]
    public int? TempF { get; init; }

    /// <summary>The high, °F, else null.</summary>
    [JsonPropertyName("hiF")]
    public int? HiF { get; init; }

    /// <summary>The low, °F, else null.</summary>
    [JsonPropertyName("loF")]
    public int? LoF { get; init; }

    /// <summary>The authored condition text.</summary>
    [JsonPropertyName("condition")]
    public required string Condition { get; init; }

    /// <summary><see cref="WeatherVocabulary.ConditionCodes"/>.</summary>
    [JsonPropertyName("conditionCode")]
    public required string ConditionCode { get; init; }

    /// <summary>Chance of precipitation, 0..100.</summary>
    [JsonPropertyName("precipPct")]
    public required int PrecipPct { get; init; }

    /// <summary>The wind text ("SW 10 to 15 mph").</summary>
    [JsonPropertyName("windText")]
    public required string WindText { get; init; }

    /// <summary>The detailed period text.</summary>
    [JsonPropertyName("detail")]
    public required string Detail { get; init; }
}
