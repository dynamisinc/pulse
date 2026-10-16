namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Exports;
using Xunit;

/// <summary>
/// The exercise report's pure rules (demo-feedback story 29): source mapping, 5-minute bins (noise always counted,
/// DF-41), the DF-42 inject response rule, lookalike pairing, the median and the busiest window.
/// </summary>
public sealed class ExerciseReportBuilderTests
{
    private static readonly DateTimeOffset T0 = new(2033, 9, 4, 13, 0, 0, TimeSpan.Zero);

    private static ReportPostFact Post(
        double minute,
        string origin = "participant",
        Guid? parent = null,
        string? body = "text",
        Guid? author = null,
        Guid? id = null) =>
        new(id ?? Guid.NewGuid(), author ?? Guid.NewGuid(), origin, T0.AddMinutes(minute), T0.AddMinutes(minute), parent, body);

    // ---- Source mapping ----------------------------------------------------------------------------------------

    [Theory]
    [InlineData("participant", "participant", ReportSeries.Participant)]
    [InlineData("controller-as-persona", "controller-as-persona", ReportSeries.Participant)]
    [InlineData("inject", "scripted", ReportSeries.Scripted)]
    [InlineData("engine", "engine", ReportSeries.Engine)]
    [InlineData("noise", "noise", ReportSeries.Noise)]
    public void Source_MapsOrigin_InjectBecomesScripted(string origin, string source, ReportSeries series)
    {
        ExerciseReportBuilder.Source(origin).Should().Be(source);
        ExerciseReportBuilder.Series(origin).Should().Be(series, "controller-as-persona charts with participants");
    }

    // ---- Bins (AC activity) --------------------------------------------------------------------------------------

    [Fact]
    public void BuildBins_FiveMinuteBins_FromFirstToLastPost_SplitBySource_EmptyBinsIncluded()
    {
        var posts = new[]
        {
            Post(1, "participant"),
            Post(2, "controller-as-persona"),
            Post(4.9, "inject"),
            Post(5, "engine"),
            Post(17, "noise"),
            Post(18, "noise"),
        };

        var bins = ExerciseReportBuilder.BuildBins(posts);

        bins.Select(bin => bin.Start).Should().Equal(
            [T0, T0.AddMinutes(5), T0.AddMinutes(10), T0.AddMinutes(15)],
            "bins run on 5-minute boundaries from the first post's bin to the last post's, the empty one included");
        bins[0].Should().BeEquivalentTo(new { Participant = 2, Scripted = 1, Engine = 0, Noise = 0 });
        bins[1].Should().BeEquivalentTo(new { Participant = 0, Scripted = 0, Engine = 1, Noise = 0 });
        bins[2].Total.Should().Be(0);
        bins[3].Noise.Should().Be(2, "noise is always counted in the chart, even when it is left out of the list (DF-41)");
    }

    [Fact]
    public void BuildBins_NoPosts_IsEmpty_AndBusiestIsNull()
    {
        var bins = ExerciseReportBuilder.BuildBins([]);
        bins.Should().BeEmpty();
        ExerciseReportBuilder.BusiestWindow(bins).Should().BeNull();
    }

    [Fact]
    public void BuildBins_FirstBinStartsOnTheBoundaryBeforeTheFirstPost()
    {
        var bins = ExerciseReportBuilder.BuildBins([Post(7.5), Post(8)]);
        bins.Should().ContainSingle().Which.Start.Should().Be(T0.AddMinutes(5));
    }

    [Fact]
    public void BuildBins_AWildScenarioInstant_WidensTheBins_AndDropsNoPost()
    {
        var far = new ReportPostFact(Guid.NewGuid(), Guid.NewGuid(), "engine", T0.AddYears(5), T0, null, null);
        var posts = new[] { Post(0), far };

        var minutes = ExerciseReportBuilder.ChartBinMinutes(posts);
        var bins = ExerciseReportBuilder.BuildBins(posts);

        minutes.Should().BeGreaterThan(1440).And.Subject.Should().Be((minutes / 1440) * 1440, "whole days past one day");
        bins.Count.Should().BeLessThanOrEqualTo(ExerciseReportBuilder.MaxChartBins);
        bins.Sum(bin => bin.Total).Should().Be(2);
    }

    [Fact]
    public void EarlyOutlier_ThenTheMainRun_KeepsEveryPostInTheChart_AndTheBusiestWindowIsExact()
    {
        // One January post, then three September posts in one 5-minute window (Copilot #551).
        var outlier = new ReportPostFact(Guid.NewGuid(), Guid.NewGuid(), "participant", T0.AddMonths(-8), T0, null, "early");
        var posts = new[] { outlier, Post(0), Post(1), Post(2, origin: "inject") };

        var bins = ExerciseReportBuilder.BuildBins(posts);
        var busiest = ExerciseReportBuilder.BusiestFiveMinutes(posts);

        bins.Sum(bin => bin.Total).Should().Be(4, "no post is dropped from the chart");
        bins.Count.Should().BeLessThanOrEqualTo(ExerciseReportBuilder.MaxChartBins);
        busiest!.Start.Should().Be(T0);
        busiest.Total.Should().Be(3);
        busiest.Scripted.Should().Be(1);
    }

    [Theory]
    [InlineData(0, 5)]
    [InlineData(24 * 60, 5)]
    [InlineData(25 * 60, 10)]
    [InlineData(7 * 24 * 60, 60)]
    public void ChartBinMinutes_StaysAtFiveForADay_ThenWidens(int spanMinutes, int expected)
    {
        ExerciseReportBuilder.ChartBinMinutes([Post(0), Post(spanMinutes)]).Should().Be(expected);
    }

    [Fact]
    public void BusiestWindow_IsTheMaxBin_EarliestOnATie_NoiseIncluded()
    {
        var bins = ExerciseReportBuilder.BuildBins(
        [
            Post(0), Post(1),
            Post(6, "noise"), Post(7, "noise"), Post(8, "noise"),
            Post(11), Post(12), Post(13),
        ]);

        var busiest = ExerciseReportBuilder.BusiestWindow(bins);

        busiest!.Start.Should().Be(T0.AddMinutes(5), "the noise bin ties with a later bin and the earlier one wins");
        busiest.Total.Should().Be(3);
    }

    [Fact]
    public void BinIndex_PlacesAnInstantInItsBin()
    {
        ExerciseReportBuilder.BinIndex(T0, T0).Should().Be(0);
        ExerciseReportBuilder.BinIndex(T0, T0.AddMinutes(4.99)).Should().Be(0);
        ExerciseReportBuilder.BinIndex(T0, T0.AddMinutes(5)).Should().Be(1);
        ExerciseReportBuilder.BinIndex(T0, T0.AddMinutes(-1)).Should().Be(-1);
    }

    // ---- DF-42 -------------------------------------------------------------------------------------------------

    [Fact]
    public void FirstResponse_ADirectReplyToAnInjectPost_Counts()
    {
        var injectPost = Post(0, "inject");
        var reply = Post(6, "participant", parent: injectPost.Id, body: "where do we go?");

        var response = ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid> { injectPost.Id }, ["cityfire"], [injectPost, reply]);

        response.Should().Be(reply);
    }

    [Fact]
    public void FirstResponse_AnAtMentionOfAnInjectAuthor_Counts_CaseInsensitive()
    {
        var mention = Post(3, "participant", body: "Is this real @CityFire?");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid>(), ["@cityfire"], [mention]).Should().Be(mention);
    }

    [Fact]
    public void FirstResponse_ASharedHashtag_IsNotAMatch()
    {
        var hashtag = Post(3, "participant", body: "#cityfire #KestrelFlood stay safe");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid>(), ["cityfire"], [hashtag])
            .Should().BeNull("a shared hashtag would match everything (DF-42)");
    }

    [Fact]
    public void FirstResponse_ALongerHandleStartingWithTheAuthor_IsNotAMention()
    {
        var lookalikeMention = Post(3, "participant", body: "@cityfire_official said so");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid>(), ["cityfire"], [lookalikeMention]).Should().BeNull();
    }

    [Fact]
    public void FirstResponse_ThirtyMinuteCutoff_IsInclusive_AndBeforeDeliveryNeverCounts()
    {
        var injectPost = Post(0, "inject");
        var atThirty = Post(30, "participant", parent: injectPost.Id);
        var afterThirty = Post(30.5, "participant", parent: injectPost.Id);
        var before = Post(-1, "participant", body: "@cityfire early");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid> { injectPost.Id }, ["cityfire"], [before, afterThirty])
            .Should().BeNull("only posts within 30 scenario minutes of the inject's first post count");
        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid> { injectPost.Id }, ["cityfire"], [afterThirty, atThirty])
            .Should().Be(atThirty, "exactly 30 minutes is within the window");
    }

    [Theory]
    [InlineData("controller-as-persona")]
    [InlineData("engine")]
    [InlineData("noise")]
    [InlineData("inject")]
    public void FirstResponse_NonParticipantPosts_AreIgnored(string origin)
    {
        var injectPost = Post(0, "inject");
        var reply = Post(2, origin, parent: injectPost.Id, body: "@cityfire");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid> { injectPost.Id }, ["cityfire"], [reply])
            .Should().BeNull("only a participant post is a response (DF-42)");
    }

    [Fact]
    public void FirstResponse_TheEarliestMatchWins()
    {
        var injectPost = Post(0, "inject");
        var later = Post(9, "participant", parent: injectPost.Id);
        var earlier = Post(4, "participant", body: "@cityfire help");

        ExerciseReportBuilder.FirstResponse(T0, new HashSet<Guid> { injectPost.Id }, ["cityfire"], [later, earlier])
            .Should().Be(earlier);
    }

    [Theory]
    [InlineData("hi @cityfire", true)]
    [InlineData("@cityfire.", true)]
    [InlineData("(@CITYFIRE)", true)]
    [InlineData("mail me@cityfire", false)]
    [InlineData("@cityfire2", false)]
    [InlineData("cityfire", false)]
    [InlineData(null, false)]
    public void MentionsHandle_MatchesWholeHandlesOnly(string? body, bool expected) =>
        ExerciseReportBuilder.MentionsHandle(body, "cityfire").Should().Be(expected);

    [Fact]
    public void ResponseMinutes_IsRoundedToOneDecimal() =>
        ExerciseReportBuilder.ResponseMinutes(T0, T0.AddSeconds(343)).Should().Be(5.7);

    // ---- Median ------------------------------------------------------------------------------------------------

    [Fact]
    public void Median_NoneResponded_IsNull() => ExerciseReportBuilder.Median([]).Should().BeNull();

    [Fact]
    public void Median_OddAndEvenCounts()
    {
        ExerciseReportBuilder.Median([9, 1, 4]).Should().Be(4);
        ExerciseReportBuilder.Median([1, 4, 9, 2]).Should().Be(3, "the mean of the middle two");
    }

    // ---- Lookalikes --------------------------------------------------------------------------------------------

    [Fact]
    public void PairLookalikes_UnverifiedHandleStartingWithAVerifiedOne_IsPaired_CaseInsensitive()
    {
        var verified = new ReportLookalikeCandidate(Guid.NewGuid(), "KestrelPD", Verified: true);
        var lookalike = new ReportLookalikeCandidate(Guid.NewGuid(), "@kestrelpd_alerts", Verified: false);
        var unrelated = new ReportLookalikeCandidate(Guid.NewGuid(), "resident_ann", Verified: false);

        var pairs = ExerciseReportBuilder.PairLookalikes([verified, lookalike, unrelated]);

        pairs.Should().ContainSingle();
        pairs[0].Verified.Should().Be(verified);
        pairs[0].Lookalike.Should().Be(lookalike);
    }

    [Fact]
    public void PairLookalikes_SameHandleLength_OrAnotherVerified_IsNotAPair()
    {
        var verified = new ReportLookalikeCandidate(Guid.NewGuid(), "cityfire", Verified: true);
        var sameHandle = new ReportLookalikeCandidate(Guid.NewGuid(), "CITYFIRE", Verified: false);
        var verifiedLonger = new ReportLookalikeCandidate(Guid.NewGuid(), "cityfire_chief", Verified: true);

        ExerciseReportBuilder.PairLookalikes([verified, sameHandle, verifiedLonger])
            .Should().BeEmpty("the lookalike must be unverified and strictly longer");
    }

    [Fact]
    public void PairLookalikes_TheMostSpecificVerifiedHandleWins()
    {
        var city = new ReportLookalikeCandidate(Guid.NewGuid(), "city", Verified: true);
        var cityFire = new ReportLookalikeCandidate(Guid.NewGuid(), "cityfire", Verified: true);
        var lookalike = new ReportLookalikeCandidate(Guid.NewGuid(), "cityfire_news", Verified: false);

        var pairs = ExerciseReportBuilder.PairLookalikes([city, cityFire, lookalike]);

        pairs.Should().ContainSingle().Which.Verified.Should().Be(cityFire);
    }

    [Fact]
    public void SumShown_PassesInt32Max_WithoutOverflow()
    {
        // 2,148 posts at the permitted 1,000,000-like baseline, below the 5,000-post limit (Copilot #551).
        var counts = Enumerable.Repeat((1_000_000, 0), 2_148).Append((0, 5));

        ExerciseReportBuilder.SumShown(counts).Should().Be(2_148_000_005L).And.BeGreaterThan(int.MaxValue);
    }
}
