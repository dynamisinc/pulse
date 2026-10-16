namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Exports;
using Xunit;

/// <summary>
/// <see cref="ExerciseReportFilter"/> (demo-feedback story 30, DF-44): query parsing, the 400 reasons, the noise alias,
/// the canonical source order and the inclusive exercise-zone window. Pure, no database.
/// </summary>
public sealed class ExerciseReportFilterTests
{
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    [Fact]
    public void Absent_IsTheDefault_EverySourceButNoise_NoWindow()
    {
        Parse(null, null, null, null).Should().BeTrue();
        var filter = Parsed(null, null, null, null);
        filter.Sources.Should().Equal("participant", "scripted", "engine");
        filter.IncludesNoise.Should().BeFalse();
        filter.From.Should().BeNull();
        filter.To.Should().BeNull();
    }

    [Theory]
    [InlineData(null, true, new[] { "participant", "scripted", "engine", "noise" })]
    [InlineData(null, false, new[] { "participant", "scripted", "engine" })]
    [InlineData("engine", true, new[] { "engine", "noise" })]
    [InlineData("noise", false, new[] { "noise" })]
    [InlineData("noise, Participant,participant,,", null, new[] { "participant", "noise" })]
    public void Sources_AreCanonical_AndIncludeNoiseOnlyAdds(string? sources, bool? includeNoise, string[] expected) =>
        Parsed(sources, includeNoise, null, null).Sources.Should().Equal(expected);

    [Theory]
    [InlineData("participant,press", null, null, "\"press\" is not a report source")]
    [InlineData("", null, null, "Choose at least one source")]
    [InlineData(" , ", null, null, "Choose at least one source")]
    [InlineData(null, "2033-09-04", null, "\"2033-09-04\" is not a valid from time")]
    [InlineData(null, null, "2033-09-04 8:00", "is not a valid to time")]
    [InlineData(null, null, "2033-13-04 08:00", "is not a valid to time")]
    [InlineData(null, "2033-09-04 08:01", "2033-09-04 08:00", "The window starts at 2033-09-04 08:01, after it ends at 2033-09-04 08:00")]
    public void Invalid_GivesAReadableReason(string? sources, string? from, string? to, string reason)
    {
        ExerciseReportFilter.TryParse(sources, null, from, to, out _, out var error).Should().BeFalse();
        error.Should().Contain(reason);
    }

    [Fact]
    public void EmptyTimes_AreAnOpenWindow_AndEqualBoundsAreValid()
    {
        Parsed(null, null, string.Empty, string.Empty).From.Should().BeNull();
        var single = Parsed(null, null, "2033-09-04 08:00", "2033-09-04 08:00");
        ExerciseReportFilter.Format(single.From).Should().Be("2033-09-04 08:00");
        ExerciseReportFilter.Format(single.To).Should().Be("2033-09-04 08:00");
    }

    [Fact]
    public void Matches_IsInclusiveToThePrintedMinute_InTheExerciseZone()
    {
        var filter = Parsed("participant", null, "2033-09-04 08:05", "2033-09-04 08:10");

        // 08:05 CDT = 13:05 UTC.
        var at = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.Zero);
        filter.Matches("participant", at, Chicago).Should().BeTrue("from is inclusive");
        filter.Matches("controller-as-persona", at, Chicago).Should().BeTrue("participant covers controller-as-persona");
        filter.Matches("participant", at.AddSeconds(-1), Chicago).Should().BeFalse("08:04:59 is before from");
        filter.Matches("participant", at.AddMinutes(5).AddSeconds(59), Chicago).Should().BeTrue("08:10:59 prints as 08:10");
        filter.Matches("participant", at.AddMinutes(6), Chicago).Should().BeFalse("08:11 is after to");
        filter.Matches("engine", at, Chicago).Should().BeFalse("engine is not a selected source");
        filter.Matches("participant", new DateTimeOffset(2033, 9, 4, 8, 5, 0, TimeSpan.Zero), Chicago)
            .Should().BeFalse("08:05 UTC is 03:05 in the exercise zone");
    }

    [Theory]
    [InlineData("inject", "scripted")]
    [InlineData("engine", "engine")]
    [InlineData("noise", "noise")]
    [InlineData("participant", "participant")]
    [InlineData("controller-as-persona", "participant")]
    public void EachOrigin_MatchesItsSource(string origin, string source)
    {
        var filter = Parsed(source, null, null, null);
        filter.Matches(origin, DateTimeOffset.UnixEpoch, TimeZoneInfo.Utc).Should().BeTrue();
    }

    private static bool Parse(string? sources, bool? includeNoise, string? from, string? to) =>
        ExerciseReportFilter.TryParse(sources, includeNoise, from, to, out _, out _);

    private static ExerciseReportFilter Parsed(string? sources, bool? includeNoise, string? from, string? to)
    {
        ExerciseReportFilter.TryParse(sources, includeNoise, from, to, out var filter, out var error).Should().BeTrue(error);
        return filter;
    }
}
