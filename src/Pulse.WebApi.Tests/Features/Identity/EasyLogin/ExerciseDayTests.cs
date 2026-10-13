namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (URLs and days AC, EL-9, EL-10) — the exercise day is the REAL local date in the exercise zone,
/// rolling over at local midnight plus the rollover hour. Covered: rollover 0 and 3; a spring-forward and a fall-back
/// change in <c>America/New_York</c> (23- and 25-hour days, a rollover inside the gap and inside the overlap); a
/// half-hour zone (<c>Asia/Kolkata</c>); a zone whose local midnight does not exist (<c>America/Havana</c>, where the
/// next valid instant is used); and the UTC fallback for a blank or unknown zone. A sweep proves <c>Today</c> and
/// <c>EndOfDayUtc</c> agree on every boundary. No clock is read: every instant is explicit.
/// </summary>
public sealed class ExerciseDayTests
{
    private const string NewYork = "America/New_York";
    private const string Kolkata = "Asia/Kolkata";
    private const string Havana = "America/Havana";

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);

    // ---------------------------------------------------------------- plain days, rollover 0 and 3

    [Fact]
    public void Utc_RolloverZero_DayTurnsAtMidnight()
    {
        ExerciseDay.Today("UTC", Utc(2026, 10, 13, 23, 59, 59), 0).Should().Be(new DateOnly(2026, 10, 13));
        ExerciseDay.Today("UTC", Utc(2026, 10, 14, 0, 0, 0), 0).Should().Be(new DateOnly(2026, 10, 14));
        ExerciseDay.EndOfDayUtc("UTC", new DateOnly(2026, 10, 13), 0).Should().Be(Utc(2026, 10, 14, 0));
    }

    [Fact]
    public void NewYork_RolloverThree_DayTurnsAtThreeLocal()
    {
        // October: EDT, UTC-4. Local 03:00 on the 14th is 07:00Z.
        ExerciseDay.Today(NewYork, Utc(2026, 10, 14, 6, 59, 59), 3).Should().Be(
            new DateOnly(2026, 10, 13), "02:59:59 local is still the 13th's exercise day with a 3 a.m. rollover");
        ExerciseDay.Today(NewYork, Utc(2026, 10, 14, 7, 0, 0), 3).Should().Be(new DateOnly(2026, 10, 14));
        ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 10, 13), 3).Should().Be(Utc(2026, 10, 14, 7));
        ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 10, 13), 0).Should().Be(Utc(2026, 10, 14, 4));
    }

    [Fact]
    public void EndOfDayUtc_ReturnsAZeroOffsetInstant()
    {
        ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 10, 13), 0).Offset.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void EndOfDayUtc_FromAnInstant_IsTheEndOfTheDayContainingIt()
    {
        var now = Utc(2026, 10, 20, 13, 45);

        ExerciseDay.EndOfDayUtc(NewYork, now, 0).Should().Be(Utc(2026, 10, 21, 4), "the 20th ends at local midnight, 04:00Z");
        ExerciseDay.EndOfDayUtc(NewYork, Utc(2026, 10, 21, 5, 0), 3).Should().Be(
            Utc(2026, 10, 21, 7), "01:00 local on the 21st is still the 20th's day with a 3 a.m. rollover");
    }

    // ---------------------------------------------------------------- daylight saving in America/New_York

    [Fact]
    public void NewYork_SpringForward_TheDayIs23Hours()
    {
        // 2026-03-08 02:00 EST -> 03:00 EDT.
        var startOfDay = ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 3, 7), 0);
        var endOfDay = ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 3, 8), 0);

        startOfDay.Should().Be(Utc(2026, 3, 8, 5), "midnight EST is 05:00Z");
        endOfDay.Should().Be(Utc(2026, 3, 9, 4), "the next midnight is EDT, 04:00Z");
        (endOfDay - startOfDay).Should().Be(TimeSpan.FromHours(23), "a spring-forward day is 23 hours, never 'add 24'");
    }

    [Fact]
    public void NewYork_SpringForward_ARolloverInsideTheGap_UsesTheNextValidInstant()
    {
        // Rollover 02:00 on 2026-03-08 does not exist; the next valid local time is 03:00 EDT = 07:00Z.
        ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 3, 7), 2).Should().Be(Utc(2026, 3, 8, 7));
        ExerciseDay.Today(NewYork, Utc(2026, 3, 8, 6, 59, 59), 2).Should().Be(
            new DateOnly(2026, 3, 7), "01:59:59 EST is the last second of the 7th's day");
        ExerciseDay.Today(NewYork, Utc(2026, 3, 8, 7, 0, 0), 2).Should().Be(
            new DateOnly(2026, 3, 8), "the instant the clocks jump to 03:00 EDT is the 8th's day");
    }

    [Fact]
    public void NewYork_FallBack_TheDayIs25Hours()
    {
        // 2026-11-01 02:00 EDT -> 01:00 EST.
        var startOfDay = ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 10, 31), 0);
        var endOfDay = ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 11, 1), 0);

        startOfDay.Should().Be(Utc(2026, 11, 1, 4), "midnight EDT is 04:00Z");
        endOfDay.Should().Be(Utc(2026, 11, 2, 5), "the next midnight is EST, 05:00Z");
        (endOfDay - startOfDay).Should().Be(TimeSpan.FromHours(25));
    }

    [Fact]
    public void NewYork_FallBack_ARolloverInsideTheOverlap_UsesTheEarlierOccurrence()
    {
        // Local 01:00 happens twice on 2026-11-01: 01:00 EDT (05:00Z), then 01:00 EST (06:00Z).
        ExerciseDay.EndOfDayUtc(NewYork, new DateOnly(2026, 10, 31), 1).Should().Be(Utc(2026, 11, 1, 5));
        ExerciseDay.Today(NewYork, Utc(2026, 11, 1, 4, 59, 59), 1).Should().Be(new DateOnly(2026, 10, 31));
        ExerciseDay.Today(NewYork, Utc(2026, 11, 1, 5, 0, 0), 1).Should().Be(new DateOnly(2026, 11, 1));
        ExerciseDay.Today(NewYork, Utc(2026, 11, 1, 6, 30, 0), 1).Should().Be(
            new DateOnly(2026, 11, 1), "the second 01:30 (EST) does not flip the day back");
    }

    // ---------------------------------------------------------------- a half-hour zone

    [Fact]
    public void Kolkata_HalfHourOffset_RolloverZeroAndThree()
    {
        // IST is UTC+05:30 all year.
        ExerciseDay.EndOfDayUtc(Kolkata, new DateOnly(2026, 10, 13), 0).Should().Be(Utc(2026, 10, 13, 18, 30));
        ExerciseDay.Today(Kolkata, Utc(2026, 10, 13, 18, 29, 59), 0).Should().Be(new DateOnly(2026, 10, 13));
        ExerciseDay.Today(Kolkata, Utc(2026, 10, 13, 18, 30, 0), 0).Should().Be(new DateOnly(2026, 10, 14));

        ExerciseDay.EndOfDayUtc(Kolkata, new DateOnly(2026, 10, 13), 3).Should().Be(Utc(2026, 10, 13, 21, 30));
        ExerciseDay.Today(Kolkata, Utc(2026, 10, 13, 21, 29, 59), 3).Should().Be(new DateOnly(2026, 10, 13));
        ExerciseDay.Today(Kolkata, Utc(2026, 10, 13, 21, 30, 0), 3).Should().Be(new DateOnly(2026, 10, 14));
    }

    // ---------------------------------------------------------------- a local midnight that does not exist

    [Fact]
    public void Havana_MidnightDoesNotExist_TheNextValidInstantIsUsed()
    {
        // Cuba springs forward at local midnight: 2026-03-08 00:00 CST (UTC-5) -> 01:00 CDT (UTC-4).
        var zone = ExerciseDay.ResolveTimeZone(Havana);
        zone.IsInvalidTime(new DateTime(2026, 3, 8, 0, 0, 0, DateTimeKind.Unspecified)).Should().BeTrue(
            "precondition: local midnight on 2026-03-08 does not exist in {0}", Havana);

        ExerciseDay.EndOfDayUtc(Havana, new DateOnly(2026, 3, 7), 0).Should().Be(
            Utc(2026, 3, 8, 5), "the day ends at the next valid instant, 01:00 CDT = 05:00Z");
        ExerciseDay.Today(Havana, Utc(2026, 3, 8, 4, 59, 59), 0).Should().Be(new DateOnly(2026, 3, 7));
        ExerciseDay.Today(Havana, Utc(2026, 3, 8, 5, 0, 0), 0).Should().Be(new DateOnly(2026, 3, 8));
    }

    // ---------------------------------------------------------------- Today and EndOfDayUtc always agree

    [Theory]
    [InlineData(NewYork, 2026, 3, 6)]
    [InlineData(NewYork, 2026, 10, 30)]
    [InlineData(Kolkata, 2026, 10, 12)]
    [InlineData(Havana, 2026, 3, 6)]
    [InlineData("UTC", 2026, 10, 12)]
    public void TodayAndEndOfDayUtc_AgreeOnEveryBoundary_AcrossThreeDays(string zone, int year, int month, int day)
    {
        var start = new DateTimeOffset(year, month, day, 0, 0, 0, TimeSpan.Zero);

        for (var rollover = 0; rollover <= EasyLoginOptions.MaxDayRolloverHour; rollover++)
        {
            for (var t = start; t < start.AddDays(3); t = t.AddMinutes(15))
            {
                var today = ExerciseDay.Today(zone, t, rollover);

                ExerciseDay.EndOfDayUtc(zone, today, rollover).Should().BeAfter(
                    t, "{0} at {1:O} (rollover {2}) is inside day {3}, which must end after it", zone, t, rollover, today);
                ExerciseDay.EndOfDayUtc(zone, today.AddDays(-1), rollover).Should().BeOnOrBefore(
                    t, "{0} at {1:O} (rollover {2}): the previous day must already have ended", zone, t, rollover);
            }
        }
    }

    // ---------------------------------------------------------------- zone resolution and argument guards

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Not/AZone")]
    [InlineData("Mars/Olympus_Mons")]
    public void BlankOrUnknownZone_FallsBackToUtc(string? zone)
    {
        var instant = Utc(2026, 10, 13, 23, 30);

        ExerciseDay.Today(zone, instant, 0).Should().Be(ExerciseDay.Today("UTC", instant, 0));
        ExerciseDay.EndOfDayUtc(zone, new DateOnly(2026, 10, 13), 3).Should().Be(Utc(2026, 10, 14, 3));
        ExerciseDay.TryResolveTimeZone(zone, out var resolved).Should().BeFalse("the fallback is reported, so a caller can warn once");
        resolved.Should().Be(TimeZoneInfo.Utc);
    }

    [Theory]
    [InlineData("UTC")]
    [InlineData("utc")]
    [InlineData(NewYork)]
    [InlineData(Kolkata)]
    public void KnownZones_Resolve(string zone)
    {
        ExerciseDay.TryResolveTimeZone(zone, out _).Should().BeTrue();
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(24)]
    public void RolloverHour_OutsideZeroToTwentyThree_IsRefused(int rollover)
    {
        ((Action)(() => ExerciseDay.Today("UTC", Utc(2026, 10, 13, 12), rollover))).Should().Throw<ArgumentOutOfRangeException>();
        ((Action)(() => ExerciseDay.EndOfDayUtc("UTC", new DateOnly(2026, 10, 13), rollover))).Should().Throw<ArgumentOutOfRangeException>();
    }
}
