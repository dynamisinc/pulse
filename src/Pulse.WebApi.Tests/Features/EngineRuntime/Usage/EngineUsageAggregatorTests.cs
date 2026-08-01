namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Xunit;

/// <summary>
/// Unit tests for the PURE volume + cost rollup (<see cref="EngineUsageAggregator"/>) behind
/// <c>GET /api/engine/usage</c> — engine-telemetry-tuning story 03a (#401), story 03 AC1/AC2/AC3/AC6.
/// Plain <see cref="FactAttribute"/>s: the function under test takes payloads, a window and a price table and
/// returns the rollup, so there is no database, no clock and no DI anywhere in its signature — which is
/// precisely why the numeric correctness lives here rather than behind a Docker gate.
/// </summary>
public sealed class EngineUsageAggregatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 7, 31, 12, 00, 00, TimeSpan.Zero);

    private static EngineEventPayloads.Generated Payload(
        string provider = "AzureOpenAI",
        string model = "gpt-5.4",
        int inputTokens = 0,
        int outputTokens = 0,
        int cacheReadTokens = 0,
        int cacheCreationTokens = 0,
        double latencyMs = 0,
        string guardResult = "pass") => new()
        {
            Storyline = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            Provider = provider,
            Model = model,
            TokenUsage = new EngineEventPayloads.TokenUsage
            {
                InputTokens = inputTokens,
                OutputTokens = outputTokens,
                CacheReadInputTokens = cacheReadTokens,
                CacheCreationInputTokens = cacheCreationTokens,
            },
            LatencyMs = latencyMs,
            GuardResult = guardResult,
        };

    private static EngineUsagePriceTable PriceTable(
        string provider,
        string model,
        decimal input,
        decimal output,
        decimal cacheRead = 0,
        decimal cacheCreation = 0)
    {
        var options = new EngineUsagePricingOptions();
        options.Providers[provider] = new Dictionary<string, EngineModelPriceOptions>
        {
            [model] = new()
            {
                InputPer1MTokens = input,
                OutputPer1MTokens = output,
                CacheReadPer1MTokens = cacheRead,
                CacheCreationPer1MTokens = cacheCreation,
            },
        };

        return EngineUsagePriceTable.FromOptions(options);
    }

    // ---- AC2: call counts over time ---------------------------------------------------------------

    [Fact]
    public void BuildWindow_DefaultsToOneMinuteBuckets_AndNeverExceedsTheBucketCeiling()
    {
        var hour = EngineUsageAggregator.BuildWindow(Now, EngineUsageAggregator.DefaultWindowMinutes);
        hour.From.Should().Be(Now.AddMinutes(-60));
        hour.To.Should().Be(Now);
        hour.BucketMinutes.Should().Be(1, "a one-hour live-ops window reads naturally at per-minute resolution");
        hour.BucketCount.Should().Be(60);

        var day = EngineUsageAggregator.BuildWindow(Now, EngineUsageAggregator.MaxWindowMinutes);
        day.BucketMinutes.Should().Be(24);
        day.BucketCount.Should().Be(
            EngineUsageAggregator.MaxBuckets,
            "bucket width is derived from the window against the ceiling, so the widest allowed window costs "
            + "the same payload size as the default one");

        var minute = EngineUsageAggregator.BuildWindow(Now, EngineUsageAggregator.MinWindowMinutes);
        minute.BucketCount.Should().Be(1, "the narrowest window is still a valid single-bucket series");
    }

    [Fact]
    public void Aggregate_PlacesEachCallInItsWallClockBucket_AndKeepsTheSeriesDense()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        // 3 calls in the bucket starting 50 minutes ago, 1 call in the bucket starting 10 minutes ago.
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-50), Payload()),
            new(Now.AddMinutes(-50).AddSeconds(20), Payload()),
            new(Now.AddMinutes(-50).AddSeconds(59), Payload()),
            new(Now.AddMinutes(-10), Payload()),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.Buckets.Should().HaveCount(60, "the series is dense — a zero-call minute is present, not omitted");
        usage.Buckets.Single(b => b.StartWallClock == Now.AddMinutes(-50).ToString("O")).Calls.Should().Be(3);
        usage.Buckets.Single(b => b.StartWallClock == Now.AddMinutes(-10).ToString("O")).Calls.Should().Be(1);
        usage.Buckets.Count(b => b.Calls == 0).Should().Be(58);
        usage.Buckets.Select(b => b.StartWallClock).Should().BeInAscendingOrder();
    }

    [Fact]
    public void Aggregate_AttributesEveryCallExactlyOnce_SoTheSeriesSumsToTheTotal()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        // Includes two deliberately out-of-window instants (the caller filters in SQL, but a stray must never
        // vanish): one before the window start, one after its end.
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-90), Payload()),
            new(Now.AddMinutes(-30), Payload()),
            new(Now.AddMinutes(5), Payload()),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.Calls.Should().Be(3);
        usage.Buckets.Sum(b => b.Calls).Should().Be(
            3,
            "sum(buckets) == totals.calls must always hold — a series that silently disagreed with its own "
            + "total is the plausible-but-wrong reading a spend view must never produce");
        usage.ByModel.Single().Buckets.Sum(b => b.Calls).Should().Be(3, "and the same holds per model");
    }

    [Fact]
    public void Aggregate_BreaksVolumeDownByProviderAndModel_BusiestFirst()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "Fake", model: "fake-deterministic")),
            new(Now.AddMinutes(-4), Payload(provider: "AzureOpenAI", model: "gpt-5.4")),
            new(Now.AddMinutes(-3), Payload(provider: "AzureOpenAI", model: "gpt-5.4")),
            new(Now.AddMinutes(-2), Payload(provider: "AzureOpenAI", model: "gpt-5.4-mini")),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.ByModel.Should().HaveCount(3);
        usage.ByModel[0].Provider.Should().Be("AzureOpenAI");
        usage.ByModel[0].Model.Should().Be("gpt-5.4");
        usage.ByModel[0].Totals.Calls.Should().Be(2, "the busiest provider+model pair leads the breakdown");
        usage.ByModel.Select(m => (m.Provider, m.Model)).Should().BeEquivalentTo(
            new[] { ("AzureOpenAI", "gpt-5.4"), ("AzureOpenAI", "gpt-5.4-mini"), ("Fake", "fake-deterministic") });
        usage.ByModel.Sum(m => m.Totals.Calls).Should().Be(usage.Totals.Calls);
    }

    [Fact]
    public void Aggregate_KeepsTheFourTokenCategoriesDistinct_AndNeverSumsThemIntoOneNumber()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(
                inputTokens: 1000, outputTokens: 200, cacheReadTokens: 30, cacheCreationTokens: 4)),
            new(Now.AddMinutes(-4), Payload(
                inputTokens: 1000, outputTokens: 200, cacheReadTokens: 30, cacheCreationTokens: 4)),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.InputTokens.Should().Be(2000);
        usage.Totals.OutputTokens.Should().Be(400);
        usage.Totals.CacheReadInputTokens.Should().Be(
            60, "cache-read tokens price differently from input tokens, so they are reported separately");
        usage.Totals.CacheCreationInputTokens.Should().Be(
            8, "and cache-creation differently again — nothing here blends them");

        var model = usage.ByModel.Single();
        model.Totals.InputTokens.Should().Be(2000);
        model.Totals.OutputTokens.Should().Be(400);
        model.Totals.CacheReadInputTokens.Should().Be(60);
        model.Totals.CacheCreationInputTokens.Should().Be(8);
    }

    [Fact]
    public void Aggregate_CountsTheGuardResultMix_IncludingReRollsThatCostMoneyAndProducedNothing()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(guardResult: "pass", inputTokens: 100)),
            new(Now.AddMinutes(-4), Payload(guardResult: "pass", inputTokens: 100)),
            new(Now.AddMinutes(-3), Payload(guardResult: "re-roll", inputTokens: 100)),
            new(Now.AddMinutes(-2), Payload(guardResult: "drop", inputTokens: 100)),
            new(Now.AddMinutes(-1), Payload(guardResult: string.Empty, inputTokens: 100)),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.GuardResults.Select(g => (g.Result, g.Calls)).Should().BeEquivalentTo(
            new[] { ("pass", 2), ("drop", 1), ("re-roll", 1), (EngineUsageAggregator.UnknownGuardResult, 1) });
        usage.GuardResults[0].Result.Should().Be("pass", "the mix is ordered by call count descending");

        usage.GuardResults.Single(g => g.Result == "re-roll").Calls.Should().Be(
            1,
            "a re-roll is a call that cost money and produced nothing — it is COUNTED, never dropped from the "
            + "mix (story 03 AC2)");
        usage.Totals.InputTokens.Should().Be(
            500, "and its tokens are in the totals too: the spend happened regardless of the guard verdict");
        usage.ByModel.Single().GuardResults.Sum(g => g.Calls).Should().Be(5);
    }

    [Fact]
    public void Aggregate_SummarisesLatency_TotalAverageAndMax()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(latencyMs: 1000)),
            new(Now.AddMinutes(-4), Payload(latencyMs: 3000)),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.Latency.TotalMs.Should().Be(4000);
        usage.Totals.Latency.AverageMs.Should().Be(2000);
        usage.Totals.Latency.MaxMs.Should().Be(3000);
    }

    [Fact]
    public void Aggregate_WithNoCalls_ReturnsADenseZeroSeriesAndNoModels_NeverAnEmptyBody()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        var usage = EngineUsageAggregator.Aggregate([], 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.Calls.Should().Be(0);
        usage.Totals.Latency.AverageMs.Should().Be(0, "no calls means no average, reported as 0 not NaN");
        usage.Buckets.Should().HaveCount(60).And.OnlyContain(b => b.Calls == 0);
        usage.ByModel.Should().BeEmpty();
        usage.GuardResults.Should().BeEmpty();
        usage.Cost.ByModel.Should().BeEmpty();
        usage.Cost.AnyUnpriced.Should().BeFalse("nothing was observed, so nothing is unpriced");
        usage.Cost.PricedTotalCost.Should().Be(0);
    }

    // ---- AC3: the cost view ------------------------------------------------------------------------

    [Fact]
    public void Aggregate_PricesAModelWithAPriceTableEntry_PerTokenCategory()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(
                provider: "AzureOpenAI",
                model: "gpt-5.4",
                inputTokens: 1_000_000,
                outputTokens: 500_000,
                cacheReadTokens: 200_000,
                cacheCreationTokens: 100_000)),
        };

        var table = PriceTable("AzureOpenAI", "gpt-5.4", input: 2.50m, output: 10m, cacheRead: 0.25m, cacheCreation: 3.125m);

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, table);
        var cost = usage.Cost.ByModel.Single();

        cost.Priced.Should().BeTrue();
        cost.InputCost.Should().Be(2.50m);
        cost.OutputCost.Should().Be(5m, "500k output tokens at $10/1M");
        cost.CacheReadCost.Should().Be(0.05m);
        cost.CacheCreationCost.Should().Be(0.3125m);
        cost.TotalCost.Should().Be(7.8625m, "the four categories are costed at their OWN rates then summed");
        usage.Cost.PricedTotalCost.Should().Be(7.8625m);
        usage.Cost.AnyUnpriced.Should().BeFalse();
        usage.Cost.Currency.Should().Be("USD");

        cost.Rates!.InputPer1MTokens.Should().Be(2.50m);
        cost.Rates.CacheReadPer1MTokens.Should().Be(
            0.25m,
            "the applied rates are echoed back so a small or zero category cost is visibly a RATE, not an "
            + "unexplained zero");
    }

    [Fact]
    public void Aggregate_ReportsAModelWithNoPriceTableEntryAsUnpriced_WithNullCostsNeverZero()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(
                provider: "ClaudeFoundry", model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 400_000)),
        };

        // The table prices a DIFFERENT model, so the observed one has no entry.
        var table = PriceTable("AzureOpenAI", "gpt-5.4", input: 2.50m, output: 10m);

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, table);
        var cost = usage.Cost.ByModel.Single();

        cost.Priced.Should().BeFalse();
        cost.TotalCost.Should().BeNull(
            "an unpriced model must never render a $0 total — a silently-wrong zero reads as 'this was free' "
            + "(story 03 AC3)");
        cost.InputCost.Should().BeNull();
        cost.OutputCost.Should().BeNull();
        cost.CacheReadCost.Should().BeNull();
        cost.CacheCreationCost.Should().BeNull();
        cost.Rates.Should().BeNull();
        usage.Cost.AnyUnpriced.Should().BeTrue();

        usage.ByModel.Single().Totals.InputTokens.Should().Be(
            1_000_000, "the token counts are still shown — only the COST is withheld");
    }

    [Fact]
    public void Aggregate_PricedTotalCoversOnlyPricedModels_AndSaysSoWithAnyUnpriced()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-4), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-3), Payload(provider: "ClaudeFoundry", model: "claude-sonnet-5", inputTokens: 9_000_000)),
        };

        var table = PriceTable("AzureOpenAI", "gpt-5.4", input: 2.50m, output: 10m);

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, table);

        usage.Cost.PricedTotalCost.Should().Be(
            5.00m,
            "pricedTotalCost is exactly what its name says — the priced models' spend, a FLOOR while "
            + "anyUnpriced is true, not an assertion about total spend");
        usage.Cost.AnyUnpriced.Should().BeTrue();
        usage.Cost.ByModel.Should().HaveCount(2);
        usage.Cost.ByModel.Select(c => (c.Provider, c.Model)).Should().Equal(
            usage.ByModel.Select(m => (m.Provider, m.Model)),
            "the cost rows are in the SAME order as the volume rows, so the panel can render them side by side");
    }

    [Fact]
    public void Aggregate_PricesTheFakeProviderAtZero_WhichIsAFactNotAPlaceholder()
    {
        // The committed default's honest case: Fake performs no egress and reports 0 tokens by construction,
        // so $0 is the CORRECT reading pre-flip — distinct from the unpriced state above.
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "Fake", model: "fake-deterministic", latencyMs: 0.02)),
        };

        var usage = EngineUsageAggregator.Aggregate(
            calls, 0, window, PriceTable("Fake", "fake-deterministic", input: 0m, output: 0m));
        var cost = usage.Cost.ByModel.Single();

        cost.Priced.Should().BeTrue("Fake HAS an entry — its zero rates are known, not missing");
        cost.TotalCost.Should().Be(0m);
        usage.Cost.AnyUnpriced.Should().BeFalse();
        usage.Totals.Calls.Should().Be(1, "and the volume view still reports the call that produced no spend");
    }

    // ---- honest handling of unreadable rows --------------------------------------------------------

    [Fact]
    public void Aggregate_ReportsTheUnparseableRowCountVerbatim_WithoutScoringThemAsZeros()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall> { new(Now.AddMinutes(-5), Payload(inputTokens: 100)) };

        var usage = EngineUsageAggregator.Aggregate(calls, 4, window, EngineUsagePriceTable.Empty);

        usage.UnparseableEvents.Should().Be(
            4, "the count is surfaced on the wire — honest over silent for a spend view");
        usage.Totals.Calls.Should().Be(
            1, "and the unreadable rows are NOT counted as calls, which would dilute the averages");
    }

    // ---- AC6 / AC1: the two structural guarantees --------------------------------------------------

    [Fact]
    public void Aggregate_LabelsItsTimeAxisAsWallClock_SoNoReaderHasToGuessTheClock()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        var usage = EngineUsageAggregator.Aggregate([], 0, window, EngineUsagePriceTable.Empty);

        usage.Window.Clock.Should().Be(
            "wall-clock",
            "COR-053 reserves scenario time for participant-visible timestamps; this staff live-ops view is "
            + "real time and states which clock it is, rather than leaving it to be inferred");
        usage.Window.FromWallClock.Should().Be(Now.AddMinutes(-60).ToString("O"));
        usage.Window.ToWallClock.Should().Be(Now.ToString("O"));
        usage.Window.WindowMinutes.Should().Be(60);
    }

    /// <summary>
    /// <b>AC1, made structural.</b> The usage DTO must NOT carry a "which provider is live now" field:
    /// <c>GET /api/engine/settings</c> is the single authoritative answer and the panel reads it there. A
    /// second, independently-computed provider readout is exactly the two-surfaces-disagreeing failure AC1
    /// forbids — so the absence is pinned by reflection rather than left to reviewer memory. The per-call
    /// provider (a DIFFERENT question: which provider produced these historical calls) lives one level down,
    /// on the per-model rows, and is asserted present here so this test cannot pass by the shape being empty.
    /// </summary>
    /// <remarks>
    /// The rejection is by SUBSTRING, not by an enumerated blocklist: an earlier version named
    /// <c>Provider</c>/<c>EffectiveProvider</c>/<c>ProviderCutToFake</c> explicitly, which a future
    /// <c>LiveProvider</c> or <c>CurrentProvider</c> would have walked straight past. What it still cannot catch,
    /// stated so nobody over-trusts it: a provider readout smuggled INSIDE a new nested object whose own name says
    /// nothing about providers (a top-level <c>Current { Provider }</c>), because the legitimate nested
    /// <c>ByModel</c> and <c>Cost</c> rows must be allowed to carry exactly that member. That residue is a review
    /// question, not a reflection one.
    /// </remarks>
    [Fact]
    public void UsageDto_CarriesNoLiveProviderField_ButPerModelRowsDoNameTheirProvider()
    {
        var offending = typeof(EngineUsageDto).GetProperties()
            .Select(property => property.Name)
            .Where(name => name.Contains("Provider", StringComparison.OrdinalIgnoreCase))
            .ToList();

        offending.Should().BeEmpty(
            "no TOP-LEVEL member of this DTO may name a provider under any spelling — 'which provider is live "
            + "now' is GET /api/engine/settings' single authoritative answer, and a second independently-computed "
            + "readout is the two-surfaces-disagreeing failure AC1 forbids");

        typeof(EngineUsageModelDto).GetProperties().Select(p => p.Name).Should().Contain(
            "Provider",
            "the historical 'which provider produced THESE calls' question is answered from the event data, "
            + "per model — that one is this endpoint's job, so this test cannot pass by the shape being empty");
    }
}

/// <summary>
/// Unit tests for <see cref="EngineUsagePayloadReader"/> — the reader that turns the OPAQUE
/// <c>TelemetryEvent.Payload</c> string into the emitter's own <c>EngineEventPayloads.Generated</c> record.
/// The round-trip test is the contract check that matters: it serializes with the REAL emitter and reads back,
/// so a rename on either side fails here rather than silently under-reporting spend.
/// </summary>
public sealed class EngineUsagePayloadReaderTests
{
    private static EngineEventPayloads.Generated BuildPayload() => new()
    {
        Storyline = "storyline-1",
        DraftId = "draft-1",
        Provider = "AzureOpenAI",
        Model = "gpt-5.4",
        TokenUsage = new EngineEventPayloads.TokenUsage
        {
            InputTokens = 1234,
            OutputTokens = 567,
            CacheReadInputTokens = 89,
            CacheCreationInputTokens = 10,
        },
        LatencyMs = 2655.5,
        GuardResult = "pass",
    };

    [Fact]
    public void TryRead_ReadsBackWhatTheRealEmitterWrote_FieldForField()
    {
        // Serialized by the ACTUAL emitter the reaction loop uses, so writer and reader share one definition.
        var stored = new EngineTelemetryEmitter()
            .BuildEvent(
                EngineEventTypes.Generated,
                new EngineTelemetryContext
                {
                    ExerciseId = Guid.NewGuid(),
                    Channel = "social",
                    TimeZone = "UTC",
                    Actor = new EngineTelemetryActor { Kind = "engine" },
                    WallClockTime = DateTimeOffset.UtcNow,
                    ScenarioTime = DateTimeOffset.UtcNow,
                },
                BuildPayload())
            .Payload;

        EngineUsagePayloadReader.TryRead(stored, out var read).Should().BeTrue();

        read!.Provider.Should().Be("AzureOpenAI");
        read.Model.Should().Be("gpt-5.4");
        read.TokenUsage.InputTokens.Should().Be(1234);
        read.TokenUsage.OutputTokens.Should().Be(567);
        read.TokenUsage.CacheReadInputTokens.Should().Be(89);
        read.TokenUsage.CacheCreationInputTokens.Should().Be(10);
        read.LatencyMs.Should().Be(2655.5);
        read.GuardResult.Should().Be("pass");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"provider\":\"AzureOpenAI\"")]
    public void TryRead_RejectsNullBlankAndMalformedPayloads_WithoutThrowing(string? payload)
    {
        var act = () => EngineUsagePayloadReader.TryRead(payload, out _);

        act.Should().NotThrow("an unreadable row must be COUNTABLE, never a 500 that hides every usable row");
        EngineUsagePayloadReader.TryRead(payload, out var read).Should().BeFalse();
        read.Should().BeNull();
    }

    [Fact]
    public void TryRead_RejectsAShapeMismatch_RatherThanSilentlyScoringItAsZeros()
    {
        // A payload missing the required tokenUsage block — the shape a renamed/dropped field would produce.
        // This is the whole reason the read deserializes into the emitter's own `required` record instead of
        // pulling JSON_VALUE paths: that route yields NULL, coalesces to 0, and under-reports spend silently.
        const string Renamed =
            "{\"storyline\":\"s\",\"draftId\":\"d\",\"provider\":\"AzureOpenAI\",\"model\":\"gpt-5.4\","
            + "\"latencyMs\":12.0,\"guardResult\":\"pass\"}";

        EngineUsagePayloadReader.TryRead(Renamed, out var read).Should().BeFalse(
            "a missing required member is a LOUD (locally caught) failure that lands in unparseableEvents, not "
            + "a plausible-looking zero");
        read.Should().BeNull();
    }
}
