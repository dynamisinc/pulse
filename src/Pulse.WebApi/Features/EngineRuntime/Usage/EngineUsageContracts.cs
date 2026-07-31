namespace Pulse.WebApi.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

/// <summary>
/// The staff-only AI-generation usage rollup returned by <c>GET /api/engine/usage</c>
/// (engine-telemetry-tuning story 03a) — a READ over the existing XC-004 <c>engine.generated</c> event log
/// (AC8: no parallel event taxonomy, no second store). Two clearly separated halves: VOLUME (call counts over
/// time, per provider/model, with the four token categories kept distinct, latency, and the guard-result mix)
/// and <see cref="Cost"/>, priced from the config-sourced <see cref="EngineUsagePricingOptions"/> table.
/// </summary>
/// <remarks>
/// <para>
/// STAFF world (COBRA cockpit; XC-002 / SOC-003) — no participant surface projects any of this. Every property
/// carries an explicit <see cref="JsonPropertyNameAttribute"/> so the wire shape is fixed independent of
/// serializer configuration; this is the frozen seam the frontend panel (story 03c) renders, and there is no
/// codegen step between them.
/// </para>
/// <para>
/// <b>This DTO deliberately carries NO "current/live provider" field (AC1).</b>
/// <c>GET /api/engine/settings</c> (<c>EngineSettingsDto.Provider</c> / <c>EffectiveProvider</c>) is the single
/// authoritative answer to "which provider is live right now", and the panel reads it from there. This shape
/// answers the DIFFERENT question — "which provider/model produced THESE historical calls" — from the event
/// data alone (<see cref="ByModel"/>), so a provider flip since the calls were made still rolls historical rows
/// up under the provider that actually produced them. Two staff surfaces disagreeing about what is live would
/// be worse than one surface stating it once, so neither question is allowed to stand in for the other.
/// </para>
/// <para>
/// <b>Time is WALL-CLOCK throughout, and says so.</b> COR-053 reserves scenario time for participant-visible
/// timestamps; this is a staff live-ops view ("what did the engine spend in the last 10 real minutes"), so
/// every instant here is real time, labelled as such on <see cref="EngineUsageWindowDto.Clock"/> and by every
/// <c>…WallClock</c> field name, so a reader is never left guessing which clock they are looking at.
/// </para>
/// </remarks>
public sealed class EngineUsageDto
{
    /// <summary>The wall-clock window and bucket granularity this rollup covers.</summary>
    [JsonPropertyName("window")]
    public required EngineUsageWindowDto Window { get; init; }

    /// <summary>Totals across every provider/model in the window.</summary>
    [JsonPropertyName("totals")]
    public required EngineUsageTotalsDto Totals { get; init; }

    /// <summary>
    /// The aggregate call-count series — one entry per bucket, ALWAYS dense (zero-call buckets included) and
    /// ordered by <see cref="EngineUsageBucketDto.StartWallClock"/> ascending, so the panel can draw a
    /// continuous axis without inventing gaps. Served alongside the per-model series rather than leaving the
    /// client to sum them.
    /// </summary>
    [JsonPropertyName("buckets")]
    public required IReadOnlyList<EngineUsageBucketDto> Buckets { get; init; }

    /// <summary>
    /// The per-provider/model breakdown, ordered by call count descending then provider then model, so the
    /// busiest model is first and the ordering is deterministic.
    /// </summary>
    [JsonPropertyName("byModel")]
    public required IReadOnlyList<EngineUsageModelDto> ByModel { get; init; }

    /// <summary>
    /// The guard-result mix across the whole window (<c>pass</c> / <c>drop</c> / <c>re-roll</c> / whatever the
    /// log holds — an OPEN vocabulary, never an enum here). A re-roll is a call that cost money and produced
    /// nothing, so it is counted, never dropped.
    /// </summary>
    [JsonPropertyName("guardResults")]
    public required IReadOnlyList<EngineUsageGuardResultDto> GuardResults { get; init; }

    /// <summary>The separately-labelled COST view, priced from the config table (AC3).</summary>
    [JsonPropertyName("cost")]
    public required EngineUsageCostDto Cost { get; init; }

    /// <summary>
    /// How many <c>engine.generated</c> rows in the window carried a NULL or unreadable <c>payload</c> and are
    /// therefore excluded from every number above.
    /// </summary>
    /// <remarks>
    /// Surfaced explicitly rather than swallowed: <c>TelemetryEvent.Payload</c> is an opaque nullable
    /// <c>nvarchar(max)</c>, so a shape mismatch is possible, and the two silent alternatives are both worse
    /// than an honest count — a 500 hides the usable rows, and counting an unreadable row as zeros
    /// under-reports spend with no error anywhere. Plausible-but-wrong numbers are the worst failure mode for
    /// a spend view.
    /// </remarks>
    [JsonPropertyName("unparseableEvents")]
    public required int UnparseableEvents { get; init; }
}

/// <summary>The wall-clock window a usage rollup covers, plus the bucket granularity of its series.</summary>
public sealed class EngineUsageWindowDto
{
    /// <summary>
    /// The clock every instant in the response is measured on. Always the literal <c>wall-clock</c> — an
    /// explicit field, not an assumption, because COR-053 makes the other clock the default everywhere a
    /// participant can see.
    /// </summary>
    [JsonPropertyName("clock")]
    public required string Clock { get; init; }

    /// <summary>Inclusive window start, round-trip (<c>"O"</c>) wall-clock.</summary>
    [JsonPropertyName("fromWallClock")]
    public required string FromWallClock { get; init; }

    /// <summary>Inclusive window end (the server clock read that produced this response), round-trip wall-clock.</summary>
    [JsonPropertyName("toWallClock")]
    public required string ToWallClock { get; init; }

    /// <summary>The window length in minutes, as requested (or the default).</summary>
    [JsonPropertyName("windowMinutes")]
    public required int WindowMinutes { get; init; }

    /// <summary>The bucket width in minutes, chosen server-side from the window so the series stays bounded.</summary>
    [JsonPropertyName("bucketMinutes")]
    public required int BucketMinutes { get; init; }

    /// <summary>How many buckets every series in this response carries.</summary>
    [JsonPropertyName("bucketCount")]
    public required int BucketCount { get; init; }
}

/// <summary>Call/token/latency totals for a window or for one provider+model within it.</summary>
public sealed class EngineUsageTotalsDto
{
    /// <summary>How many <c>engine.generated</c> calls were recorded.</summary>
    [JsonPropertyName("calls")]
    public required int Calls { get; init; }

    /// <summary>Input (prompt) tokens.</summary>
    [JsonPropertyName("inputTokens")]
    public required long InputTokens { get; init; }

    /// <summary>Output (completion) tokens.</summary>
    [JsonPropertyName("outputTokens")]
    public required long OutputTokens { get; init; }

    /// <summary>Cache-READ input tokens — kept distinct from <see cref="InputTokens"/>; it prices differently.</summary>
    [JsonPropertyName("cacheReadInputTokens")]
    public required long CacheReadInputTokens { get; init; }

    /// <summary>Cache-CREATION input tokens — kept distinct; it prices differently again.</summary>
    [JsonPropertyName("cacheCreationInputTokens")]
    public required long CacheCreationInputTokens { get; init; }

    /// <summary>Latency summary for the same set of calls.</summary>
    [JsonPropertyName("latency")]
    public required EngineUsageLatencyDto Latency { get; init; }
}

/// <summary>Latency summary in milliseconds (wall-clock duration of the generation calls), rounded to 3dp.</summary>
public sealed class EngineUsageLatencyDto
{
    /// <summary>Total latency of every call in the set.</summary>
    [JsonPropertyName("totalMs")]
    public required double TotalMs { get; init; }

    /// <summary>Mean latency per call; <c>0</c> when there were no calls.</summary>
    [JsonPropertyName("averageMs")]
    public required double AverageMs { get; init; }

    /// <summary>Slowest single call in the set; <c>0</c> when there were no calls.</summary>
    [JsonPropertyName("maxMs")]
    public required double MaxMs { get; init; }
}

/// <summary>One bucket of a call-count series.</summary>
public sealed class EngineUsageBucketDto
{
    /// <summary>Inclusive bucket start, round-trip (<c>"O"</c>) wall-clock. The bucket spans <c>bucketMinutes</c>.</summary>
    [JsonPropertyName("startWallClock")]
    public required string StartWallClock { get; init; }

    /// <summary>Calls attributed to this bucket.</summary>
    [JsonPropertyName("calls")]
    public required int Calls { get; init; }
}

/// <summary>One provider+model's volume within the window, including its own call-count series over time.</summary>
public sealed class EngineUsageModelDto
{
    /// <summary>The provider that produced these calls, verbatim from the event log (NOT what is configured now).</summary>
    [JsonPropertyName("provider")]
    public required string Provider { get; init; }

    /// <summary>The model/deployment that produced these calls, verbatim from the event log.</summary>
    [JsonPropertyName("model")]
    public required string Model { get; init; }

    /// <summary>This model's call/token/latency totals.</summary>
    [JsonPropertyName("totals")]
    public required EngineUsageTotalsDto Totals { get; init; }

    /// <summary>This model's guard-result mix (re-rolls included — they cost money and produced nothing).</summary>
    [JsonPropertyName("guardResults")]
    public required IReadOnlyList<EngineUsageGuardResultDto> GuardResults { get; init; }

    /// <summary>This model's dense call-count series, same buckets/order as the aggregate series.</summary>
    [JsonPropertyName("buckets")]
    public required IReadOnlyList<EngineUsageBucketDto> Buckets { get; init; }
}

/// <summary>One guard-result value and how many calls ended in it.</summary>
public sealed class EngineUsageGuardResultDto
{
    /// <summary>
    /// The <c>guardResult</c> literal as recorded (<c>pass</c> / <c>drop</c> / <c>re-roll</c> / …), or
    /// <c>unknown</c> when the event recorded an empty one. An OPEN string, matching the payload contract.
    /// </summary>
    [JsonPropertyName("result")]
    public required string Result { get; init; }

    /// <summary>How many calls ended with this guard result.</summary>
    [JsonPropertyName("calls")]
    public required int Calls { get; init; }
}

/// <summary>
/// The COST half of the rollup — a separately labelled section (AC3), priced from the config-sourced table and
/// never mixed into the volume numbers above.
/// </summary>
public sealed class EngineUsageCostDto
{
    /// <summary>The currency label the configured rates are expressed in (nothing here converts currencies).</summary>
    [JsonPropertyName("currency")]
    public required string Currency { get; init; }

    /// <summary>
    /// The summed cost of the PRICED models only. Named for exactly that: when
    /// <see cref="AnyUnpriced"/> is <c>true</c> this is a floor, not the total spend, and the panel must say so
    /// rather than presenting it as complete.
    /// </summary>
    [JsonPropertyName("pricedTotalCost")]
    public required decimal PricedTotalCost { get; init; }

    /// <summary>
    /// Whether at least one observed model had NO price-table entry. Reported as its own field so no consumer
    /// re-derives it by scanning <see cref="ByModel"/> — and so the "$0 shown next to real token counts"
    /// reading is impossible to reach by accident.
    /// </summary>
    [JsonPropertyName("anyUnpriced")]
    public required bool AnyUnpriced { get; init; }

    /// <summary>Per-provider/model cost rows, in the same order as <see cref="EngineUsageDto.ByModel"/>.</summary>
    [JsonPropertyName("byModel")]
    public required IReadOnlyList<EngineUsageModelCostDto> ByModel { get; init; }
}

/// <summary>
/// One provider+model's cost row. <see cref="Priced"/> is the explicit AC3 state: when it is <c>false</c>
/// every cost field is <c>null</c> — deliberately NOT <c>0</c>, which would read as "this was free".
/// </summary>
public sealed class EngineUsageModelCostDto
{
    /// <summary>The provider, matching the volume row.</summary>
    [JsonPropertyName("provider")]
    public required string Provider { get; init; }

    /// <summary>The model, matching the volume row.</summary>
    [JsonPropertyName("model")]
    public required string Model { get; init; }

    /// <summary>
    /// <c>true</c> when the price table has an entry for this provider+model. <c>false</c> is the explicit
    /// UNPRICED state: the token counts are still shown (on the volume row), but no cost is asserted.
    /// </summary>
    [JsonPropertyName("priced")]
    public required bool Priced { get; init; }

    /// <summary>Cost of this model's input tokens; <c>null</c> when unpriced.</summary>
    [JsonPropertyName("inputCost")]
    public decimal? InputCost { get; init; }

    /// <summary>Cost of this model's output tokens; <c>null</c> when unpriced.</summary>
    [JsonPropertyName("outputCost")]
    public decimal? OutputCost { get; init; }

    /// <summary>Cost of this model's cache-read input tokens; <c>null</c> when unpriced.</summary>
    [JsonPropertyName("cacheReadCost")]
    public decimal? CacheReadCost { get; init; }

    /// <summary>Cost of this model's cache-creation input tokens; <c>null</c> when unpriced.</summary>
    [JsonPropertyName("cacheCreationCost")]
    public decimal? CacheCreationCost { get; init; }

    /// <summary>The four category costs summed; <c>null</c> when unpriced.</summary>
    [JsonPropertyName("totalCost")]
    public decimal? TotalCost { get; init; }

    /// <summary>
    /// The rates actually applied, echoed back; <c>null</c> when unpriced. Present so a zero category cost is
    /// visibly a zero RATE rather than an unexplained zero — the same "never a silently-wrong $0" concern AC3
    /// raises about a missing entry, one level down inside an entry that exists.
    /// </summary>
    [JsonPropertyName("rates")]
    public EngineUsageRatesDto? Rates { get; init; }
}

/// <summary>The four rates applied to a priced model, in currency units per 1,000,000 tokens.</summary>
public sealed class EngineUsageRatesDto
{
    /// <summary>Configured input rate per 1,000,000 tokens.</summary>
    [JsonPropertyName("inputPer1MTokens")]
    public required decimal InputPer1MTokens { get; init; }

    /// <summary>Configured output rate per 1,000,000 tokens.</summary>
    [JsonPropertyName("outputPer1MTokens")]
    public required decimal OutputPer1MTokens { get; init; }

    /// <summary>Configured cache-read rate per 1,000,000 tokens.</summary>
    [JsonPropertyName("cacheReadPer1MTokens")]
    public required decimal CacheReadPer1MTokens { get; init; }

    /// <summary>Configured cache-creation rate per 1,000,000 tokens.</summary>
    [JsonPropertyName("cacheCreationPer1MTokens")]
    public required decimal CacheCreationPer1MTokens { get; init; }

    /// <summary>Projects the pure rates value to its wire shape.</summary>
    /// <param name="rates">The configured rates.</param>
    /// <returns>The wire shape.</returns>
    public static EngineUsageRatesDto From(EngineModelRates rates)
    {
        ArgumentNullException.ThrowIfNull(rates);

        return new EngineUsageRatesDto
        {
            InputPer1MTokens = rates.InputPer1MTokens,
            OutputPer1MTokens = rates.OutputPer1MTokens,
            CacheReadPer1MTokens = rates.CacheReadPer1MTokens,
            CacheCreationPer1MTokens = rates.CacheCreationPer1MTokens,
        };
    }
}

/// <summary>
/// The result of a usage read, mapped to an HTTP status at the endpoint (fail closed) — the same shape as
/// <see cref="EngineSettingsResult"/>, reusing the slice's <see cref="EngineReviewOutcome"/> vocabulary.
/// </summary>
public sealed class EngineUsageResult
{
    private EngineUsageResult(EngineReviewOutcome outcome, EngineUsageDto? usage, string? validationError)
    {
        Outcome = outcome;
        Usage = usage;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The usage rollup — non-null only on <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public EngineUsageDto? Usage { get; }

    /// <summary>The validation message — non-null only on <see cref="EngineReviewOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read carrying the rollup.</summary>
    /// <param name="usage">The rollup.</param>
    /// <returns>The result.</returns>
    public static EngineUsageResult Ok(EngineUsageDto usage) => new(EngineReviewOutcome.Ok, usage, null);

    /// <summary>The fail-closed result for an unresolved scope (COR-001) — 401, never a default/unscoped rollup.</summary>
    /// <returns>The result.</returns>
    public static EngineUsageResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request (400) — a window outside the supported bounds.</summary>
    /// <param name="validationError">The validation message.</param>
    /// <returns>The result.</returns>
    public static EngineUsageResult Invalid(string validationError) =>
        new(EngineReviewOutcome.Invalid, null, validationError);
}
