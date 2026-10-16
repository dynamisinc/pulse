namespace Pulse.LoadTest.Tests;

using FluentAssertions;

public class PercentilesTests
{
    [Fact]
    public void Of_NoValues_IsNull() => Percentiles.Of([], 95).Should().BeNull();

    [Fact]
    public void Of_OneValue_IsThatValueAtEveryPercentile()
    {
        Percentiles.Of([42.0], 0).Should().Be(42);
        Percentiles.Of([42.0], 50).Should().Be(42);
        Percentiles.Of([42.0], 100).Should().Be(42);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(50, 50.5)]
    [InlineData(95, 95.05)]
    [InlineData(99, 99.01)]
    [InlineData(100, 100)]
    public void Of_OneToHundred_InterpolatesLikePercentileInc(double percentile, double expected)
    {
        var values = Enumerable.Range(1, 100).Select(i => (double)i).ToArray();
        Percentiles.Of(values, percentile)!.Value.Should().BeApproximately(expected, 1e-9);
    }

    [Fact]
    public void Of_UnsortedInput_IsSortedFirstAndNotModified()
    {
        double[] values = [50, 10, 40, 20, 30];
        Percentiles.Of(values, 50).Should().Be(30);
        Percentiles.Of(values, 25).Should().Be(20);
        values.Should().Equal(50, 10, 40, 20, 30);
    }

    [Fact]
    public void Of_EvenCount_MedianIsTheMeanOfTheMiddlePair() => Percentiles.Of([1.0, 2, 3, 4], 50).Should().Be(2.5);

    [Theory]
    [InlineData(-1)]
    [InlineData(100.5)]
    [InlineData(double.NaN)]
    public void Of_PercentileOutOfRange_Throws(double percentile)
    {
        var act = () => Percentiles.Of([1.0], percentile);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void SeriesSummary_CountsErrorsAndRate()
    {
        var at = DateTimeOffset.UtcNow;
        var samples = Enumerable.Range(1, 20)
            .Select(i => new RequestSample(at, 0, Metrics.Post, i * 10, i <= 2 ? 503 : 201, i > 2))
            .ToArray();

        var summary = SeriesSummary.From(Metrics.Post, samples);

        summary.Count.Should().Be(20);
        summary.Errors.Should().Be(2);
        summary.ErrorRate.Should().Be(0.1);
        summary.P50Ms.Should().Be(105);
        summary.MaxMs.Should().Be(200);
    }

    [Fact]
    public void SeriesSummary_Empty_HasNoPercentiles()
    {
        var summary = SeriesSummary.From(Metrics.Feed, []);
        summary.Count.Should().Be(0);
        summary.ErrorRate.Should().Be(0);
        summary.P95Ms.Should().BeNull();
        summary.MaxMs.Should().BeNull();
    }
}
