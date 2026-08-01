namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Xunit;

/// <summary>
/// <b>The adversarial arithmetic pass over <see cref="EngineUsageAggregator"/> (story 03a QA review).</b> Added
/// beside <c>EngineUsageAggregatorTests</c>, which covers the happy path; this file attacks the boundary and
/// rounding defects a happy-path test cannot see. The premise: on a SPEND view a plausible-but-wrong number is a
/// worse failure than an error, and every defect below would have produced one — a call timed into the wrong
/// bucket, a call dropped at a window edge, spend under-reported by rounding, two providers' costs merged, or a
/// guard result silently missing from a mix that is supposed to account for every call that cost money.
/// </summary>
/// <remarks>
/// Where a test pins a behaviour that is a JUDGEMENT rather than an obvious right answer (edge clamping, ordinal
/// grouping, six-decimal rounding, three-decimal latency), the doc comment says so and names the concrete wrong
/// number the alternative would have produced, so a future reader can re-litigate the choice instead of
/// discovering it by surprise.
/// </remarks>
public sealed class EngineUsageAggregatorArithmeticTests
{
    private static readonly DateTimeOffset Now = new(2026, 7, 31, 12, 00, 00, TimeSpan.Zero);

    // ---- window / bucket geometry ------------------------------------------------------------------

    /// <summary>
    /// The bucket-ceiling claim, checked at EVERY window the endpoint accepts rather than at the three points
    /// <c>BuildWindow_DefaultsToOneMinuteBuckets_AndNeverExceedsTheBucketCeiling</c> samples. Bucket width widens
    /// with the window, and the arithmetic that derives it (<c>ceil</c> twice, on two different denominators) is
    /// exactly where a payload-size bound quietly stops holding.
    /// </summary>
    [Fact]
    public void BuildWindow_StaysWithinTheBucketCeilingAndCoversTheWindow_AtEveryWindowTheApiAccepts()
    {
        for (var minutes = EngineUsageAggregator.MinWindowMinutes;
             minutes <= EngineUsageAggregator.MaxWindowMinutes;
             minutes++)
        {
            var window = EngineUsageAggregator.BuildWindow(Now, minutes);

            window.From.Should().Be(Now.AddMinutes(-minutes), "window {0}", minutes);
            window.To.Should().Be(Now, "window {0}", minutes);
            window.BucketMinutes.Should().BeGreaterThanOrEqualTo(1, "window {0}", minutes);
            window.BucketCount.Should().BeInRange(
                1,
                EngineUsageAggregator.MaxBuckets,
                $"a {minutes}-minute window must not exceed the {EngineUsageAggregator.MaxBuckets}-bucket "
                + "ceiling — the whole point of widening the bucket is that a 24-hour read costs the same "
                + "payload as a 1-hour one");

            // The buckets must span the window: the last bucket STARTS inside it (never at/after `to`, which
            // would be a bucket no call can reach) and the buckets together reach at least as far as `to`.
            var lastStart = window.From.AddMinutes((double)(window.BucketCount - 1) * window.BucketMinutes);
            lastStart.Should().BeBefore(window.To, $"window {minutes}: no bucket may start at or after the end");
            lastStart.AddMinutes(window.BucketMinutes).Should().BeOnOrAfter(
                window.To, $"window {minutes}: the buckets must reach the end of the window");
        }
    }

    /// <summary>
    /// <b>Edge placement, tick by tick.</b> Six instants around the two window edges and one interior bucket
    /// boundary, each asserted into an exact bucket. An off-by-one at either edge silently mis-times spend, and
    /// the "one tick outside" cases pin the DOCUMENTED clamp: a stray instant is attributed to the nearest edge
    /// bucket rather than dropped, because <c>sum(buckets) == totals.calls</c> is the invariant the panel draws
    /// against. (The alternative — dropping it — is a defensible design, but it must then be chosen deliberately;
    /// today it is not what the code does, and this test is what makes a change to that visible.)
    /// </summary>
    [Fact]
    public void Aggregate_PlacesTheEdgeAndBoundaryInstantsInExactlyTheRightBuckets()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var from = window.From;

        var calls = new List<EngineGenerationCall>
        {
            new(from.AddTicks(-1), Payload()),                 // one tick BEFORE the window  -> clamped to 0
            new(from, Payload()),                              // exactly `from`               -> 0
            new(from.AddMinutes(1).AddTicks(-1), Payload()),    // last tick of bucket 0       -> 0
            new(from.AddMinutes(1), Payload()),                // exactly a bucket start      -> 1
            new(window.To.AddTicks(-1), Payload()),            // last tick of the window     -> 59
            new(window.To, Payload()),                         // exactly `to`                -> 59
            new(window.To.AddTicks(1), Payload()),             // one tick AFTER the window   -> clamped to 59
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);
        var buckets = usage.Buckets.ToList();

        buckets[0].Calls.Should().Be(
            3,
            "the tick before `from`, `from` itself and the last tick of the first minute all belong to the first "
            + "bucket — an inclusive-start edge, and a stray earlier instant clamped onto it rather than lost");
        buckets[1].Calls.Should().Be(
            1, "an instant exactly ON a bucket start opens that bucket; it does not close the previous one");
        buckets[59].Calls.Should().Be(
            3, "the last tick of the window, `to` itself, and a stray later instant all land in the last bucket");
        buckets.Where((_, index) => index is not (0 or 1 or 59)).Should().OnlyContain(
            b => b.Calls == 0, "and nothing smeared into any bucket between them");

        buckets.Sum(b => b.Calls).Should().Be(7);
        usage.Totals.Calls.Should().Be(7);
        usage.ByModel.Single().Buckets.Sum(b => b.Calls).Should().Be(7, "per model too");
    }

    /// <summary>
    /// <b>The window sizes where minutes do NOT divide evenly by the bucket count</b> — where a call gets dropped
    /// or double-counted if the bucket index and the bucket-start list are derived from even slightly different
    /// arithmetic. A call is placed on every whole minute across the window, so the test also proves no bucket is
    /// UNREACHABLE: an off-by-one in the start list would leave an empty bucket in a fully-populated window.
    /// </summary>
    /// <param name="windowMinutes">A window length whose bucket width does not divide it evenly.</param>
    [Theory]
    [InlineData(7)]
    [InlineData(59)]
    [InlineData(61)]
    [InlineData(121)]
    [InlineData(181)]
    [InlineData(1439)]
    public void Aggregate_AtAWindowThatDoesNotDivideEvenly_StillAttributesEveryCallExactlyOnce(int windowMinutes)
    {
        var window = EngineUsageAggregator.BuildWindow(Now, windowMinutes);
        var expectedCalls = windowMinutes + 1;

        var calls = Enumerable.Range(0, expectedCalls)
            .Select(minute => new EngineGenerationCall(window.From.AddMinutes(minute), Payload()))
            .ToList();

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.Calls.Should().Be(expectedCalls);
        usage.Buckets.Should().HaveCount(window.BucketCount);
        usage.Buckets.Sum(b => b.Calls).Should().Be(
            expectedCalls,
            $"a {windowMinutes}-minute window bucketed at {window.BucketMinutes} minutes into "
            + $"{window.BucketCount} buckets spans {window.BucketCount * window.BucketMinutes} minutes — the "
            + "uneven remainder is exactly where a call gets dropped from the series or counted twice");
        usage.ByModel.Single().Buckets.Sum(b => b.Calls).Should().Be(expectedCalls, "and per model");
        usage.Buckets.Should().OnlyContain(
            b => b.Calls > 0,
            "with a call on every minute, every bucket must be reachable — an empty one would mean a bucket "
            + "start no instant can map to");
        usage.Buckets.Select(b => b.StartWallClock).Should().BeInAscendingOrder().And.OnlyHaveUniqueItems();
    }

    /// <summary>
    /// Buckets are placed by INSTANT, not by a local clock reading. A telemetry row's <c>WallClockTime</c> is a
    /// <see cref="DateTimeOffset"/> and nothing guarantees its offset is UTC, so an implementation that reached
    /// for <c>.DateTime</c> / <c>.LocalDateTime</c> would mis-time spend by the offset — here, the call would be
    /// clamped into the last bucket (index 59) instead of landing in bucket 30, reading as "spend happening right
    /// now" when it happened half an hour ago.
    /// </summary>
    [Fact]
    public void Aggregate_BucketsByInstant_SoANonUtcOffsetOnTheRowIsNotHoursOut()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var sameInstantInAnotherOffset = Now.AddMinutes(-30).ToOffset(TimeSpan.FromHours(2));

        sameInstantInAnotherOffset.Offset.Should().Be(
            TimeSpan.FromHours(2), "the fixture is only meaningful if the offset really is non-UTC");

        var usage = EngineUsageAggregator.Aggregate(
            [new EngineGenerationCall(sameInstantInAnotherOffset, Payload())],
            0,
            window,
            EngineUsagePriceTable.Empty);

        usage.Buckets[30].Calls.Should().Be(
            1, "30 minutes before the window end, by instant — the offset it happens to be expressed in is not a "
            + "time difference");
        usage.Buckets[59].Calls.Should().Be(0, "which is where a local-clock reading would have clamped it");
    }

    // ---- deterministic ordering (the frontend renders this in order) ------------------------------

    /// <summary>
    /// <b>The tie-break, pinned.</b> The DTO documents "busiest first", and the existing coverage checks the
    /// busiest row and then compares the rest as an order-INSENSITIVE set — so the ordering of equal-volume rows
    /// is unpinned, and <c>Dictionary</c> enumeration order is not a contract. Two reads returning the same
    /// numbers in a different row order would make the panel's rendering jump between polls.
    /// </summary>
    [Fact]
    public void Aggregate_TieBreaksTheModelBreakdownByProviderThenModel_SoTwoReadsRenderIdentically()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        var tied = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "Zeta", model: "alpha")),
            new(Now.AddMinutes(-4), Payload(provider: "Alpha", model: "zeta")),
            new(Now.AddMinutes(-3), Payload(provider: "Alpha", model: "alpha")),
            new(Now.AddMinutes(-2), Payload(provider: "Beta", model: "m")),
        };

        var usage = EngineUsageAggregator.Aggregate(tied, 0, window, EngineUsagePriceTable.Empty);

        usage.ByModel.Select(m => (m.Provider, m.Model)).Should().Equal(
            new[] { ("Alpha", "alpha"), ("Alpha", "zeta"), ("Beta", "m"), ("Zeta", "alpha") },
            "all four rows have one call, so the order is fully determined by the provider-then-model ordinal "
            + "tie-break — not by hash order");
        usage.Cost.ByModel.Select(c => (c.Provider, c.Model)).Should().Equal(
            usage.ByModel.Select(m => (m.Provider, m.Model)),
            "and the cost rows track it, so the panel can render the two halves side by side");

        // Volume still dominates the tie-break: one extra call moves a row to the front.
        var withAWinner = tied.Append(new EngineGenerationCall(Now.AddMinutes(-1), Payload("Zeta", "alpha"))).ToList();
        var reordered = EngineUsageAggregator.Aggregate(withAWinner, 0, window, EngineUsagePriceTable.Empty);

        reordered.ByModel.Select(m => (m.Provider, m.Model)).Should().Equal(
            new[] { ("Zeta", "alpha"), ("Alpha", "alpha"), ("Alpha", "zeta"), ("Beta", "m") },
            "count descending FIRST — the tie-break only decides between equals");
    }

    /// <summary>
    /// The same determinism for the guard-result mix, whose existing coverage also compares as an
    /// order-insensitive set once past the leading entry.
    /// </summary>
    [Fact]
    public void Aggregate_TieBreaksTheGuardMixByTheResultLiteral()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(guardResult: "zeta-result")),
            new(Now.AddMinutes(-4), Payload(guardResult: "alpha-result")),
            new(Now.AddMinutes(-3), Payload(guardResult: "Mid")),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.GuardResults.Select(g => g.Result).Should().Equal(
            new[] { "Mid", "alpha-result", "zeta-result" },
            "one call each, so the ordinal tie-break on the literal is the whole ordering");
    }

    /// <summary>
    /// <b>The guard vocabulary is OPEN, and an unrecognised value must be counted — never dropped.</b> A dropped
    /// guard result under-reports calls that cost money, so the invariant asserted here is the strong form:
    /// <c>sum(guardResults.calls) == totals.calls</c>, with a literal no one has ever seen before, two literals
    /// differing only in case, and two flavours of "empty" in the same window. Casing is preserved VERBATIM
    /// (ordinal grouping) rather than normalised: these strings are machine-written by one emitter, and folding
    /// two genuinely different values together would misattribute calls.
    /// </summary>
    [Fact]
    public void Aggregate_CountsAnUnrecognisedGuardResultVerbatim_AndTheMixAlwaysSumsToTheCallCount()
    {
        const string NeverSeenBefore = "quarantined-by-a-guard-that-did-not-exist-when-this-panel-shipped";

        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(guardResult: "pass")),
            new(Now.AddMinutes(-4), Payload(guardResult: "Pass")),
            new(Now.AddMinutes(-3), Payload(guardResult: NeverSeenBefore)),
            new(Now.AddMinutes(-2), Payload(guardResult: "   ")),
            new(Now.AddMinutes(-1), Payload(guardResult: string.Empty)),
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty);

        usage.GuardResults.Select(g => (g.Result, g.Calls)).Should().Equal(
            new[]
            {
                (EngineUsageAggregator.UnknownGuardResult, 2),
                ("Pass", 1),
                ("pass", 1),
                (NeverSeenBefore, 1),
            },
            "an unrecognised literal is surfaced as itself; blank and whitespace both fold into the documented "
            + "'unknown' stand-in; and 'Pass' stays distinct from 'pass' because these are verbatim machine "
            + "values, not display text");

        usage.GuardResults.Sum(g => g.Calls).Should().Be(
            usage.Totals.Calls,
            "the mix accounts for EVERY call — a guard result quietly missing from the mix is a call that cost "
            + "money and vanished from the only place the panel shows why");
        usage.ByModel.Single().GuardResults.Sum(g => g.Calls).Should().Be(usage.Totals.Calls);
    }

    // ---- cost arithmetic --------------------------------------------------------------------------

    /// <summary>
    /// <b>The same model id under two providers must NOT merge.</b> The rollup key is provider+model precisely
    /// because a model name can price differently per provider. Merged, this window would report one row of 2M
    /// input tokens priced at whichever provider's rate won the collision — <c>$5.00</c> or <c>$20.00</c> instead
    /// of the correct <c>$12.50</c>.
    /// </summary>
    [Fact]
    public void Aggregate_DoesNotMergeTheSameModelNameAcrossTwoProviders_TheKeyIsProviderPlusModel()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-4), Payload(provider: "ClaudeFoundry", model: "gpt-5.4", inputTokens: 1_000_000)),
        };

        var options = new EngineUsagePricingOptions();
        options.Providers["AzureOpenAI"] = new Dictionary<string, EngineModelPriceOptions>
        {
            ["gpt-5.4"] = new() { InputPer1MTokens = 2.50m },
        };
        options.Providers["ClaudeFoundry"] = new Dictionary<string, EngineModelPriceOptions>
        {
            ["gpt-5.4"] = new() { InputPer1MTokens = 10.00m },
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.FromOptions(options));

        usage.ByModel.Should().HaveCount(2, "same model NAME, different provider — two rows, never one");
        usage.ByModel.Should().OnlyContain(m => m.Totals.InputTokens == 1_000_000);

        var costs = usage.Cost.ByModel.ToDictionary(c => c.Provider, c => c);
        costs["AzureOpenAI"].TotalCost.Should().Be(2.50m);
        costs["ClaudeFoundry"].TotalCost.Should().Be(10.00m, "priced from ITS provider's rate, not the other's");
        usage.Cost.PricedTotalCost.Should().Be(
            12.50m, "merged, this window would have read $5.00 or $20.00 depending on which rate won");
    }

    /// <summary>
    /// <b>Rounding cannot accumulate over a window, because tokens are summed as integers and priced ONCE.</b>
    /// 999 calls of a single input token at $0.50/1M cost $0.0004995, which is $0.000500 at the documented six
    /// decimal places. A refactor that priced per CALL and then summed would report <c>0.000999</c> (rounding
    /// each $0.0000005 up — double the real spend) or <c>0.000000</c> (rounding each down — all of it lost).
    /// Both are the plausible-but-wrong reading this view exists to avoid, and both red this test.
    /// </summary>
    [Fact]
    public void Aggregate_PricesFromSummedTokens_NotPerCall_SoRoundingCannotAccumulateOverAWindow()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = Enumerable.Range(0, 999)
            .Select(index => new EngineGenerationCall(
                window.From.AddMinutes(index % 60),
                Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1)))
            .ToList();

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, PriceTable("AzureOpenAI", "gpt-5.4", input: 0.50m));

        usage.Totals.Calls.Should().Be(999);
        usage.Totals.InputTokens.Should().Be(999, "tokens accumulate as exact integers, so nothing is lost here");
        usage.Cost.ByModel.Single().InputCost.Should().Be(
            0.0005m,
            "999 tokens x $0.50/1M = $0.0004995 -> $0.000500 at six decimals; per-call rounding would have said "
            + "$0.000999 (2x over) or $0 (all of it lost)");
        usage.Cost.PricedTotalCost.Should().Be(0.0005m);
    }

    /// <summary>
    /// The rounding MODE and precision, pinned so they cannot drift. Six decimals with
    /// <see cref="MidpointRounding.AwayFromZero"/>: an exact half-microdollar rounds UP (banker's rounding, the
    /// .NET default, would report <c>$0</c> for the first case), and anything below the half genuinely rounds to
    /// zero — which stays an honest <c>priced: true</c> zero rather than becoming "unpriced", because the rate IS
    /// known and is echoed on the row.
    /// </summary>
    [Fact]
    public void Aggregate_RoundsCostToSixDecimalsAwayFromZero_AndASubMicrodollarZeroStaysAPricedZero()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var oneToken = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1)),
        };

        var atTheHalf = EngineUsageAggregator.Aggregate(
            oneToken, 0, window, PriceTable("AzureOpenAI", "gpt-5.4", input: 0.50m));

        atTheHalf.Cost.ByModel.Single().InputCost.Should().Be(
            0.000001m,
            "$0.0000005 is exactly half a microdollar and rounds AWAY from zero; MidpointRounding.ToEven — the "
            + ".NET default — would have reported $0 for a token that did cost something");

        var belowTheHalf = EngineUsageAggregator.Aggregate(
            oneToken, 0, window, PriceTable("AzureOpenAI", "gpt-5.4", input: 0.40m));
        var row = belowTheHalf.Cost.ByModel.Single();

        row.InputCost.Should().Be(0m, "$0.0000004 is below the last reported decimal place");
        row.Priced.Should().BeTrue(
            "and this zero is a PRICED zero, not the unpriced state — the rate is known, so it is echoed rather "
            + "than withheld, which is what tells a reader the zero is precision and not a missing price");
        row.Rates!.InputPer1MTokens.Should().Be(0.40m);
    }

    /// <summary>
    /// <b><c>pricedTotalCost</c> is a floor, and this quantifies how far a floor can be from the truth.</b>
    /// Volume stays COMPLETE (all 23,000,000 tokens are reported); cost covers only the two priced models
    /// ($5.50). The unpriced model carries 20,000,000 of those tokens — 87% of the window — so a panel that
    /// presented $5.50 as "spend" would be understating the priced fraction of the window by a factor no reader
    /// could infer from the number itself. That is exactly why <c>anyUnpriced</c> is its own field.
    /// </summary>
    [Fact]
    public void Aggregate_KeepsVolumeCompleteWhileTheCostTotalIsOnlyAFloorOverThePricedModels()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-9), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-8), Payload(provider: "AzureOpenAI", model: "gpt-5.4", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-7), Payload(provider: "AzureOpenAI", model: "gpt-5.4-mini", inputTokens: 1_000_000)),
            new(Now.AddMinutes(-6), Payload(provider: "ClaudeFoundry", model: "claude-sonnet-5", inputTokens: 20_000_000)),
        };

        var options = new EngineUsagePricingOptions();
        options.Providers["AzureOpenAI"] = new Dictionary<string, EngineModelPriceOptions>
        {
            ["gpt-5.4"] = new() { InputPer1MTokens = 2.50m },
            ["gpt-5.4-mini"] = new() { InputPer1MTokens = 0.50m },
        };

        var usage = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.FromOptions(options));

        usage.Totals.InputTokens.Should().Be(
            23_000_000, "VOLUME is complete — withholding a price never withholds a token count");
        usage.Cost.PricedTotalCost.Should().Be(
            5.50m, "$2.50 x 2M + $0.50 x 1M — the two priced models and nothing else");
        usage.Cost.AnyUnpriced.Should().BeTrue();

        var unpriced = usage.Cost.ByModel.Single(c => c.Model == "claude-sonnet-5");
        unpriced.Priced.Should().BeFalse();
        unpriced.TotalCost.Should().BeNull("no cost is asserted for it — not even implicitly, as a zero");
        usage.ByModel.Single(m => m.Model == "claude-sonnet-5").Totals.InputTokens.Should().Be(
            20_000_000,
            "yet its 20M tokens — 87% of the window — are fully visible, which is the only reason a reader can "
            + "judge how incomplete the $5.50 floor is");

        usage.Cost.ByModel.Where(c => c.Priced).Sum(c => c.TotalCost!.Value).Should().Be(
            usage.Cost.PricedTotalCost, "and the floor is exactly the sum of the priced rows, nothing extra");
    }

    /// <summary>
    /// The four token categories are priced at their OWN rates and never blended, checked with four DIFFERENT
    /// rates and four different token counts so that a swapped pair of rates cannot cancel out. A blended
    /// implementation using the input rate for all four would have reported <c>$1.50</c> instead of <c>$3.30</c>.
    /// </summary>
    [Fact]
    public void Aggregate_AppliesEachTokenCategorysOwnRate_SoASwappedPairCannotCancelOut()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = new List<EngineGenerationCall>
        {
            new(Now.AddMinutes(-5), Payload(
                provider: "AzureOpenAI",
                model: "gpt-5.4",
                inputTokens: 100_000,
                outputTokens: 200_000,
                cacheReadTokens: 400_000,
                cacheCreationTokens: 800_000)),
        };

        var table = PriceTable(
            "AzureOpenAI", "gpt-5.4", input: 1m, output: 2m, cacheRead: 4m, cacheCreation: 1.5m);

        var cost = EngineUsageAggregator.Aggregate(calls, 0, window, table).Cost;
        var row = cost.ByModel.Single();

        row.InputCost.Should().Be(0.10m, "100k @ $1");
        row.OutputCost.Should().Be(0.40m, "200k @ $2");
        row.CacheReadCost.Should().Be(1.60m, "400k @ $4 — the cache-read rate is not a discount here on purpose");
        row.CacheCreationCost.Should().Be(1.20m, "800k @ $1.50");
        row.TotalCost.Should().Be(
            3.30m,
            "each category at its own rate; a blended input-rate implementation would have said $1.50 and one "
            + "with the two cache rates transposed $4.30 — both plausible, both wrong");
        cost.PricedTotalCost.Should().Be(3.30m);
    }

    // ---- defensive: what the emitter never writes, but a stored row can still hold -----------------

    /// <summary>
    /// <b>A reachable shape the payload reader ACCEPTS.</b> <c>System.Text.Json</c>'s <c>required</c> enforces a
    /// member's PRESENCE, not its non-nullness — so a stored row whose payload has explicit <c>null</c>s
    /// deserializes successfully and is NOT counted as unparseable. The real emitter never writes that shape, but
    /// any other writer against this opaque <c>nvarchar(max)</c> column can, and the aggregation must not throw
    /// on it. Two things are pinned: the call is still COUNTED (a call that cost money is never dropped), and its
    /// attribution degrades to empty provider/model plus the <c>unknown</c> guard result — which the panel will
    /// render as a nameless row, and which is the honest reading rather than a fabricated one.
    /// </summary>
    [Fact]
    public void Aggregate_WithAPayloadCarryingExplicitNulls_CountsTheCallWithoutThrowing()
    {
        const string ExplicitNulls =
            "{\"storyline\":\"s\",\"draftId\":\"d\",\"provider\":null,\"model\":null,\"tokenUsage\":null,"
            + "\"latencyMs\":12.5,\"guardResult\":null}";

        EngineUsagePayloadReader.TryRead(ExplicitNulls, out var payload).Should().BeTrue(
            "required means PRESENT, not non-null — this is why the shape below is reachable at all");
        payload!.TokenUsage.Should().BeNull();

        var window = EngineUsageAggregator.BuildWindow(Now, 60);

        var usage = EngineUsageAggregator.Aggregate(
            [new EngineGenerationCall(Now.AddMinutes(-5), payload!)], 0, window, EngineUsagePriceTable.Empty);

        usage.Totals.Calls.Should().Be(1, "the call happened; it is counted");
        usage.Totals.InputTokens.Should().Be(0, "with no token block there is nothing to add — not an invention");
        usage.Totals.Latency.MaxMs.Should().Be(12.5, "the fields that ARE present are still used");
        usage.UnparseableEvents.Should().Be(0, "the payload parsed; it is thin, not unreadable");

        var model = usage.ByModel.Single();
        model.Provider.Should().BeEmpty("attribution degrades to empty rather than to a guessed provider");
        model.Model.Should().BeEmpty();
        model.GuardResults.Single().Result.Should().Be(EngineUsageAggregator.UnknownGuardResult);
        usage.Cost.ByModel.Single().Priced.Should().BeFalse("an empty provider/model can never match a rate");
    }

    /// <summary>
    /// Latency is rounded to three decimal places, which is pinned here at the value where it BITES: four calls
    /// totalling 0.0008ms report a 0.001ms total and a 0.000ms average, so a reader can see a non-zero total
    /// beside a zero average. Recorded rather than fixed — latency is not spend, the live providers this panel
    /// exists for report milliseconds not nanoseconds, and changing the precision is a production decision this
    /// story does not own. If it is ever changed, this test is the note explaining what was known.
    /// </summary>
    [Fact]
    public void Aggregate_RoundsLatencyToThreeDecimals_WhichCanShowANonZeroTotalBesideAZeroAverage()
    {
        var window = EngineUsageAggregator.BuildWindow(Now, 60);
        var calls = Enumerable.Range(1, 4)
            .Select(minute => new EngineGenerationCall(Now.AddMinutes(-minute), Payload(latencyMs: 0.0002)))
            .ToList();

        var latency = EngineUsageAggregator.Aggregate(calls, 0, window, EngineUsagePriceTable.Empty).Totals.Latency;

        latency.TotalMs.Should().Be(0.001, "4 x 0.0002ms = 0.0008ms, rounded away from zero at three decimals");
        latency.AverageMs.Should().Be(0, "while the per-call average falls below the reported precision");
        latency.MaxMs.Should().Be(0, "as does the slowest single call");
    }

    // ---- helpers ----------------------------------------------------------------------------------

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
            Storyline = "storyline",
            DraftId = "draft",
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
        decimal input = 0,
        decimal output = 0,
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
}
