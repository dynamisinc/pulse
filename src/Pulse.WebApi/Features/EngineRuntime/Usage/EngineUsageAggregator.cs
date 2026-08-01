namespace Pulse.WebApi.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The PURE volume + cost rollup over a set of <c>engine.generated</c> payloads (engine-telemetry-tuning story
/// 03a). Deliberately a static function whose entire signature is plain values — no <c>DbContext</c>, no
/// <c>TelemetryEvent</c>, no <c>IExerciseContext</c>, no ambient clock read — so it is deterministic and
/// unit-testable on its own, and so nothing in it can accidentally become a second place that decides exercise
/// scope. Isolation is decided ONCE, upstream, by <c>PulseDbContext</c>'s central query filter over the
/// <c>IExerciseScoped</c> <c>TelemetryEvent</c> entity (COR-001); by the time payloads reach this function they
/// are already the calling exercise's own.
/// </summary>
public static class EngineUsageAggregator
{
    /// <summary>The <see cref="EngineUsageWindowDto.Clock"/> literal — this whole view is real time (COR-053 staff carve-out).</summary>
    public const string WallClockAxis = "wall-clock";

    /// <summary>The <see cref="EngineUsageGuardResultDto.Result"/> stand-in for an event that recorded an empty guard result.</summary>
    public const string UnknownGuardResult = "unknown";

    /// <summary>The default window (minutes) when the caller asks for none — a live-ops "recent activity" span.</summary>
    public const int DefaultWindowMinutes = 60;

    /// <summary>The hard cap on the requested window (minutes) — 24 hours. A longer span is a 400, not a silent clamp.</summary>
    public const int MaxWindowMinutes = 1440;

    /// <summary>The minimum requested window (minutes).</summary>
    public const int MinWindowMinutes = 1;

    /// <summary>
    /// The most buckets any series in a response may carry. Bucket width is derived from the window against
    /// this ceiling, so a 24-hour window costs the same payload size as a 1-hour one.
    /// </summary>
    public const int MaxBuckets = 60;

    /// <summary>Tokens per rate unit — every configured rate is "per 1,000,000 tokens".</summary>
    private const decimal TokensPerRateUnit = 1_000_000m;

    /// <summary>Decimal places latency milliseconds are rounded to on the wire.</summary>
    private const int LatencyDecimals = 3;

    /// <summary>Decimal places costs are rounded to on the wire (sub-cent spend is real at these token rates).</summary>
    private const int CostDecimals = 6;

    /// <summary>
    /// Derives the wall-clock window and its bucket granularity from one server clock read. Pure: the caller
    /// reads the clock and passes the instant in, so a test pins an exact window rather than racing "now".
    /// </summary>
    /// <param name="now">The server wall-clock instant the window ends at (inclusive).</param>
    /// <param name="windowMinutes">The validated window length in minutes.</param>
    /// <returns>The window.</returns>
    public static EngineUsageWindow BuildWindow(DateTimeOffset now, int windowMinutes)
    {
        var minutes = Math.Clamp(windowMinutes, MinWindowMinutes, MaxWindowMinutes);

        // Bucket width is the smallest whole number of minutes that keeps the series at or under MaxBuckets.
        var bucketMinutes = (int)Math.Ceiling(minutes / (double)MaxBuckets);
        bucketMinutes = Math.Max(1, bucketMinutes);

        return new EngineUsageWindow(now.AddMinutes(-minutes), now, minutes, bucketMinutes);
    }

    /// <summary>
    /// Rolls a window's <c>engine.generated</c> payloads up into the volume + cost view.
    /// </summary>
    /// <param name="calls">The window's readable calls (payload + its wall-clock instant). May be empty.</param>
    /// <param name="unparseableEventCount">How many rows in the window had a null/unreadable payload; reported verbatim.</param>
    /// <param name="window">The wall-clock window and bucket granularity (see <see cref="BuildWindow"/>).</param>
    /// <param name="priceTable">The config-sourced price table; <see cref="EngineUsagePriceTable.Empty"/> prices nothing.</param>
    /// <returns>The rollup.</returns>
    /// <remarks>
    /// <para>
    /// <b>Every call with a non-null <see cref="EngineGenerationCall.Payload"/> is counted exactly once.</b> The
    /// caller filters to the window in SQL, but a stray instant outside it is attributed to the nearest EDGE
    /// bucket rather than dropped, so <c>sum(buckets.calls) == totals.calls</c> always holds — a series that
    /// silently disagreed with its own total is precisely the plausible-but-wrong reading this view must not
    /// produce.
    /// </para>
    /// <para>
    /// The one thing NOT counted: a call whose <see cref="EngineGenerationCall.Payload"/> is null is skipped
    /// entirely — it lands in neither the totals nor <paramref name="unparseableEventCount"/>. That is
    /// unreachable from <see cref="EngineUsageService"/>, which resolves each row's payload before calling here
    /// and counts every unreadable one into <paramref name="unparseableEventCount"/> itself; the branch exists
    /// only so a direct caller of this pure function cannot NRE. A future second caller must count its own
    /// unreadable rows the same way rather than passing them through as nulls.
    /// </para>
    /// <para>
    /// Provider/model grouping is ORDINAL (exact-match): the values are machine-written by one emitter, and
    /// merging two genuinely different strings would misattribute spend. The price-table LOOKUP is separately
    /// case-insensitive, because that side is hand-authored config.
    /// </para>
    /// </remarks>
    public static EngineUsageDto Aggregate(
        IReadOnlyList<EngineGenerationCall> calls,
        int unparseableEventCount,
        EngineUsageWindow window,
        EngineUsagePriceTable priceTable)
    {
        ArgumentNullException.ThrowIfNull(calls);
        ArgumentNullException.ThrowIfNull(priceTable);
        ArgumentOutOfRangeException.ThrowIfNegative(unparseableEventCount);

        var bucketStarts = BuildBucketStarts(window);

        var overallBuckets = new int[bucketStarts.Count];
        var overallGuards = new Dictionary<string, int>(StringComparer.Ordinal);
        var accumulators = new Dictionary<(string Provider, string Model), ModelAccumulator>();
        var overall = new TokenAndLatencyAccumulator();

        foreach (var call in calls)
        {
            var payload = call.Payload;
            if (payload is null)
            {
                continue;
            }

            var bucketIndex = BucketIndexOf(call.WallClockTime, window, bucketStarts.Count);
            var guard = string.IsNullOrWhiteSpace(payload.GuardResult) ? UnknownGuardResult : payload.GuardResult;
            var key = (payload.Provider ?? string.Empty, payload.Model ?? string.Empty);

            if (!accumulators.TryGetValue(key, out var accumulator))
            {
                accumulator = new ModelAccumulator(bucketStarts.Count);
                accumulators[key] = accumulator;
            }

            accumulator.Add(payload, bucketIndex, guard);
            overall.Add(payload);
            overallBuckets[bucketIndex]++;
            overallGuards[guard] = overallGuards.GetValueOrDefault(guard) + 1;
        }

        var orderedModels = accumulators
            .OrderByDescending(pair => pair.Value.Calls)
            .ThenBy(pair => pair.Key.Provider, StringComparer.Ordinal)
            .ThenBy(pair => pair.Key.Model, StringComparer.Ordinal)
            .ToList();

        var byModel = orderedModels
            .Select(pair => new EngineUsageModelDto
            {
                Provider = pair.Key.Provider,
                Model = pair.Key.Model,
                Totals = pair.Value.BuildTotals(),
                GuardResults = ProjectGuardResults(pair.Value.GuardResults),
                Buckets = ProjectBuckets(bucketStarts, pair.Value.Buckets),
            })
            .ToList();

        return new EngineUsageDto
        {
            Window = new EngineUsageWindowDto
            {
                Clock = WallClockAxis,
                FromWallClock = window.From.ToString("O", CultureInfo.InvariantCulture),
                ToWallClock = window.To.ToString("O", CultureInfo.InvariantCulture),
                WindowMinutes = window.WindowMinutes,
                BucketMinutes = window.BucketMinutes,
                BucketCount = bucketStarts.Count,
            },
            Totals = overall.BuildTotals(),
            Buckets = ProjectBuckets(bucketStarts, overallBuckets),
            ByModel = byModel,
            GuardResults = ProjectGuardResults(overallGuards),
            Cost = BuildCost(orderedModels, priceTable),
            UnparseableEvents = unparseableEventCount,
        };
    }

    /// <summary>Builds the cost view over the SAME ordered model set the volume view reports.</summary>
    private static EngineUsageCostDto BuildCost(
        List<KeyValuePair<(string Provider, string Model), ModelAccumulator>> orderedModels,
        EngineUsagePriceTable priceTable)
    {
        var rows = new List<EngineUsageModelCostDto>(orderedModels.Count);
        var pricedTotal = 0m;
        var anyUnpriced = false;

        foreach (var (key, accumulator) in orderedModels)
        {
            if (!priceTable.TryGetRates(key.Provider, key.Model, out var rates) || rates is null)
            {
                // The explicit AC3 state: token counts stand, no cost is asserted. NEVER a zero.
                anyUnpriced = true;
                rows.Add(new EngineUsageModelCostDto
                {
                    Provider = key.Provider,
                    Model = key.Model,
                    Priced = false,
                });
                continue;
            }

            var inputCost = Cost(accumulator.InputTokens, rates.InputPer1MTokens);
            var outputCost = Cost(accumulator.OutputTokens, rates.OutputPer1MTokens);
            var cacheReadCost = Cost(accumulator.CacheReadInputTokens, rates.CacheReadPer1MTokens);
            var cacheCreationCost = Cost(accumulator.CacheCreationInputTokens, rates.CacheCreationPer1MTokens);
            var total = Round(inputCost + outputCost + cacheReadCost + cacheCreationCost, CostDecimals);

            pricedTotal += total;
            rows.Add(new EngineUsageModelCostDto
            {
                Provider = key.Provider,
                Model = key.Model,
                Priced = true,
                InputCost = inputCost,
                OutputCost = outputCost,
                CacheReadCost = cacheReadCost,
                CacheCreationCost = cacheCreationCost,
                TotalCost = total,
                Rates = EngineUsageRatesDto.From(rates),
            });
        }

        return new EngineUsageCostDto
        {
            Currency = priceTable.Currency,
            PricedTotalCost = Round(pricedTotal, CostDecimals),
            AnyUnpriced = anyUnpriced,
            ByModel = rows,
        };
    }

    private static decimal Cost(long tokens, decimal ratePer1M) =>
        Round(tokens / TokensPerRateUnit * ratePer1M, CostDecimals);

    private static decimal Round(decimal value, int decimals) =>
        Math.Round(value, decimals, MidpointRounding.AwayFromZero);

    private static double Round(double value, int decimals) =>
        Math.Round(value, decimals, MidpointRounding.AwayFromZero);

    /// <summary>Every bucket start in the window, ascending — dense by construction.</summary>
    private static List<DateTimeOffset> BuildBucketStarts(EngineUsageWindow window)
    {
        var count = window.BucketCount;
        var starts = new List<DateTimeOffset>(count);
        for (var index = 0; index < count; index++)
        {
            starts.Add(window.From.AddMinutes((double)index * window.BucketMinutes));
        }

        return starts;
    }

    /// <summary>The bucket an instant belongs to, clamped to the window's edges so no call is ever dropped.</summary>
    private static int BucketIndexOf(DateTimeOffset instant, EngineUsageWindow window, int bucketCount)
    {
        var offsetMinutes = (instant - window.From).TotalMinutes;
        var index = (int)Math.Floor(offsetMinutes / window.BucketMinutes);
        return Math.Clamp(index, 0, bucketCount - 1);
    }

    private static List<EngineUsageBucketDto> ProjectBuckets(List<DateTimeOffset> starts, int[] counts)
    {
        var buckets = new List<EngineUsageBucketDto>(starts.Count);
        for (var index = 0; index < starts.Count; index++)
        {
            buckets.Add(new EngineUsageBucketDto
            {
                StartWallClock = starts[index].ToString("O", CultureInfo.InvariantCulture),
                Calls = counts[index],
            });
        }

        return buckets;
    }

    private static List<EngineUsageGuardResultDto> ProjectGuardResults(Dictionary<string, int> guards) =>
        guards
            .OrderByDescending(pair => pair.Value)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => new EngineUsageGuardResultDto { Result = pair.Key, Calls = pair.Value })
            .ToList();

    /// <summary>Running token + latency sums for a set of calls.</summary>
    private class TokenAndLatencyAccumulator
    {
        public int Calls { get; private set; }

        public long InputTokens { get; private set; }

        public long OutputTokens { get; private set; }

        public long CacheReadInputTokens { get; private set; }

        public long CacheCreationInputTokens { get; private set; }

        private double TotalLatencyMs { get; set; }

        private double MaxLatencyMs { get; set; }

        public void Add(EngineEventPayloads.Generated payload)
        {
            Calls++;

            var usage = payload.TokenUsage;
            if (usage is not null)
            {
                InputTokens += usage.InputTokens;
                OutputTokens += usage.OutputTokens;
                CacheReadInputTokens += usage.CacheReadInputTokens;
                CacheCreationInputTokens += usage.CacheCreationInputTokens;
            }

            TotalLatencyMs += payload.LatencyMs;
            MaxLatencyMs = Math.Max(MaxLatencyMs, payload.LatencyMs);
        }

        public EngineUsageTotalsDto BuildTotals() => new()
        {
            Calls = Calls,
            InputTokens = InputTokens,
            OutputTokens = OutputTokens,
            CacheReadInputTokens = CacheReadInputTokens,
            CacheCreationInputTokens = CacheCreationInputTokens,
            Latency = new EngineUsageLatencyDto
            {
                TotalMs = Round(TotalLatencyMs, LatencyDecimals),
                AverageMs = Calls == 0 ? 0 : Round(TotalLatencyMs / Calls, LatencyDecimals),
                MaxMs = Round(MaxLatencyMs, LatencyDecimals),
            },
        };
    }

    /// <summary>Running sums for ONE provider+model — its tokens/latency, its guard mix, and its own series.</summary>
    private sealed class ModelAccumulator : TokenAndLatencyAccumulator
    {
        public ModelAccumulator(int bucketCount) => Buckets = new int[bucketCount];

        public int[] Buckets { get; }

        public Dictionary<string, int> GuardResults { get; } = new(StringComparer.Ordinal);

        public void Add(EngineEventPayloads.Generated payload, int bucketIndex, string guardResult)
        {
            Add(payload);
            Buckets[bucketIndex]++;
            GuardResults[guardResult] = GuardResults.GetValueOrDefault(guardResult) + 1;
        }
    }
}

/// <summary>
/// The wall-clock window a usage rollup covers, plus its bucket granularity. A plain value so the aggregation
/// never reads a clock itself.
/// </summary>
/// <param name="From">Inclusive window start.</param>
/// <param name="To">Inclusive window end (the server clock read).</param>
/// <param name="WindowMinutes">The window length in minutes.</param>
/// <param name="BucketMinutes">The bucket width in minutes.</param>
public readonly record struct EngineUsageWindow(
    DateTimeOffset From,
    DateTimeOffset To,
    int WindowMinutes,
    int BucketMinutes)
{
    /// <summary>How many buckets span the window (at least one).</summary>
    public int BucketCount => Math.Max(1, (int)Math.Ceiling(WindowMinutes / (double)BucketMinutes));
}

/// <summary>
/// One readable <c>engine.generated</c> call: the deserialized emitter payload plus the wall-clock instant its
/// telemetry row recorded. Carries no envelope columns and no entity type — the pure aggregation's whole input.
/// </summary>
/// <param name="WallClockTime">The row's <c>wallClockTime</c> (real time, COR-053 staff carve-out).</param>
/// <param name="Payload">The deserialized <c>engine.generated</c> payload.</param>
public readonly record struct EngineGenerationCall(
    DateTimeOffset WallClockTime,
    EngineEventPayloads.Generated Payload);

/// <summary>
/// Reads the OPAQUE <c>TelemetryEvent.Payload</c> JSON string into the emitter's OWN
/// <see cref="EngineEventPayloads.Generated"/> record — one shared definition for writer and reader, rather
/// than re-encoding payload field names as SQL string literals in a <c>JSON_VALUE</c> path where a renamed
/// field would yield <c>NULL</c>, coalesce to 0, and under-report spend with no error anywhere.
/// </summary>
/// <remarks>
/// Fails LOUDLY-but-locally: a null, blank or shape-mismatched payload returns <c>false</c> so the caller can
/// COUNT it and put that count on the wire, rather than 500ing the whole read or silently scoring it as zeros.
/// <see cref="EngineEventPayloads.Generated"/>'s <c>required</c> members are what make a shape mismatch
/// detectable at all — <c>System.Text.Json</c> throws when one is absent.
/// </remarks>
public static class EngineUsagePayloadReader
{
    /// <summary>Mirrors <c>EngineTelemetryEmitter.PayloadOptions</c>: camelCase in, camelCase out.</summary>
    private static readonly JsonSerializerOptions PayloadOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Attempts to read one <c>engine.generated</c> payload.</summary>
    /// <param name="payload">The stored opaque JSON string (nullable — the column is).</param>
    /// <param name="generated">The deserialized payload on success; otherwise <c>null</c>.</param>
    /// <returns><c>true</c> when the payload was readable; <c>false</c> counts as an unparseable row.</returns>
    public static bool TryRead(string? payload, out EngineEventPayloads.Generated? generated)
    {
        generated = null;

        if (string.IsNullOrWhiteSpace(payload))
        {
            return false;
        }

        try
        {
            generated = JsonSerializer.Deserialize<EngineEventPayloads.Generated>(payload, PayloadOptions);
        }
        catch (JsonException)
        {
            return false;
        }
        catch (NotSupportedException)
        {
            return false;
        }

        return generated is not null;
    }
}
