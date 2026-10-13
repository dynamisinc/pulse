namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Easy-login story 06 (EL-10) — the participant day cap shared by issue and refresh, with no database and no real
/// clock: which kinds are capped, the two windows, the end of the exercise day across a spring-forward and a fall-back
/// change in <c>America/New_York</c> with rollover 0 and a 3 a.m. rollover, the UTC fallback logged once per exercise
/// per process, and the 0-to-6 rollover bound.
/// </summary>
public sealed class ParticipantSessionCapTests
{
    private const string NewYork = "America/New_York";

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    // ---------------------------------------------------------------- who is capped

    [Fact]
    public void AppliesTo_OnlyParticipantKind_AndOnlyWithTheOptionOn()
    {
        var on = new SessionOptions();
        var off = new SessionOptions { ParticipantDayLong = false };

        on.ParticipantDayLong.Should().BeTrue("the option defaults to on");
        ParticipantSessionCap.AppliesTo("participant", on).Should().BeTrue();
        ParticipantSessionCap.AppliesTo("participant", off).Should().BeFalse("option off: participants behave as before");
        ParticipantSessionCap.AppliesTo("staff", on).Should().BeFalse("staff sessions are never day-capped");
        ParticipantSessionCap.AppliesTo("readonly", on).Should().BeFalse("shared read-only sessions are never day-capped");
        ParticipantSessionCap.AppliesTo(null, on).Should().BeFalse();
    }

    // ---------------------------------------------------------------- the windows

    [Fact]
    public void Windows_Uncapped_AreNowPlusTheConfiguredLifetimes()
    {
        var now = Utc(2026, 10, 14, 15);

        var windows = ParticipantSessionCap.Windows(now, endOfExerciseDay: null, new SessionOptions());

        windows.ExpiresAt.Should().Be(now.AddMinutes(60));
        windows.RefreshExpiresAt.Should().Be(now.AddMinutes(720));
    }

    [Fact]
    public void Windows_Capped_MidDay_AccessIsTheLifetime_RefreshIsTheDayEnd()
    {
        var windows = ParticipantSessionCap.Windows(Utc(2026, 10, 14, 15), Utc(2026, 10, 15, 4), new SessionOptions());

        windows.ExpiresAt.Should().Be(Utc(2026, 10, 14, 16), "COR-012: the access token stays 60 minutes");
        windows.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4));
    }

    [Fact]
    public void Windows_Capped_LateInTheDay_AccessIsCappedAtTheDayEnd()
    {
        var windows = ParticipantSessionCap.Windows(Utc(2026, 10, 15, 3, 30), Utc(2026, 10, 15, 4), new SessionOptions());

        windows.ExpiresAt.Should().Be(Utc(2026, 10, 15, 4), "min(now + 60 min, end of day)");
        windows.RefreshExpiresAt.Should().Be(Utc(2026, 10, 15, 4));
    }

    // ---------------------------------------------------------------- the day, across DST and a 3 a.m. rollover

    [Fact]
    public void SpringForward_RolloverZero_TheTwentyThreeHourDayEndsAtLocalMidnightInDaylightTime()
    {
        // 8 Mar 2026: clocks jump 02:00 EST -> 03:00 EDT. A session at 10:00 EDT ends at local midnight = 04:00Z.
        var clock = new ManualTimeProvider(Utc(2026, 3, 8, 14));

        var dayEnd = EndOfDay(NewYork, clock.GetUtcNow(), 0);

        dayEnd.Should().Be(Utc(2026, 3, 9, 4));
        ParticipantSessionCap.Windows(clock.GetUtcNow(), dayEnd, new SessionOptions()).ExpiresAt
            .Should().Be(Utc(2026, 3, 8, 15));

        // Just before the jump (01:30 EST) the same day is still running; it ends at the same instant.
        EndOfDay(NewYork, Utc(2026, 3, 8, 6, 30), 0).Should().Be(Utc(2026, 3, 9, 4));
    }

    [Fact]
    public void SpringForward_ThreeAmRollover_TheDayEndsAtThreeLocalDaylightTime()
    {
        // 01:30 EST on 8 Mar is still 7 Mar's day with a 3 a.m. rollover. It ends at local 03:00, which on this date is
        // already daylight time (03:00 EDT = 07:00Z, the instant the clocks jump), so the day is 23 hours long and the
        // access token is capped at its end.
        var clock = new ManualTimeProvider(Utc(2026, 3, 8, 6, 30));

        var dayEnd = EndOfDay(NewYork, clock.GetUtcNow(), 3);

        dayEnd.Should().Be(Utc(2026, 3, 8, 7));
        ParticipantSessionCap.Windows(clock.GetUtcNow(), dayEnd, new SessionOptions()).ExpiresAt
            .Should().Be(Utc(2026, 3, 8, 7), "now + 60 min would run 30 minutes past the day end");

        clock.Advance(TimeSpan.FromMinutes(30)); // 07:00Z — the new day has started.
        EndOfDay(NewYork, clock.GetUtcNow(), 3).Should().Be(Utc(2026, 3, 9, 7), "8 Mar's day ends at 03:00 EDT on the 9th");
    }

    [Fact]
    public void FallBack_RolloverZero_TheTwentyFiveHourDayEndsAtLocalMidnightInStandardTime()
    {
        // 1 Nov 2026: clocks fall 02:00 EDT -> 01:00 EST. A session at 10:00 EST on the 1st ends at local midnight =
        // 05:00Z on the 2nd.
        EndOfDay(NewYork, Utc(2026, 11, 1, 15), 0).Should().Be(Utc(2026, 11, 2, 5));

        // A session on 31 Oct (EDT) ends at local midnight on 1 Nov, still EDT = 04:00Z.
        EndOfDay(NewYork, Utc(2026, 10, 31, 20), 0).Should().Be(Utc(2026, 11, 1, 4));
    }

    [Fact]
    public void FallBack_ThreeAmRollover_TheDayEndsAtThreeLocalAfterTheClocksFall()
    {
        // 01:30 EDT (first occurrence) on 1 Nov is still 31 Oct's day; it ends at 03:00 EST = 08:00Z, a 25-hour day.
        var clock = new ManualTimeProvider(Utc(2026, 11, 1, 5, 30));

        var dayEnd = EndOfDay(NewYork, clock.GetUtcNow(), 3);

        dayEnd.Should().Be(Utc(2026, 11, 1, 8));

        // 01:30 EST (the second occurrence, an hour later in real time) is the same day with the same end.
        clock.Advance(TimeSpan.FromHours(1));
        EndOfDay(NewYork, clock.GetUtcNow(), 3).Should().Be(Utc(2026, 11, 1, 8));
    }

    [Fact]
    public void AtTheDayEndExactly_TheNextDayHasBegun()
    {
        EndOfDay(NewYork, Utc(2026, 10, 15, 4), 0).Should().Be(
            Utc(2026, 10, 16, 4), "the boundary instant belongs to the new day, so an anchor there is the next day");
    }

    // ---------------------------------------------------------------- the rollover bound

    [Theory]
    [InlineData(7, 6)]
    [InlineData(23, 6)]
    [InlineData(-1, 0)]
    public void RolloverHour_OutsideZeroToSix_IsBoundedIntoRange(int configured, int effective)
    {
        var asOf = Utc(2026, 10, 14, 15);

        EndOfDay(NewYork, asOf, configured).Should().Be(EndOfDay(NewYork, asOf, effective),
            "the day boundary never moves outside midnight to 06:00 local");
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(6, true)]
    [InlineData(7, false)]
    [InlineData(-1, false)]
    public void EasyLoginOptions_ValidatesTheRolloverHourZeroToSix(int hour, bool valid)
    {
        new EasyLoginOptions { DayRolloverHour = hour }.IsValid().Should().Be(valid);
    }

    // ---------------------------------------------------------------- UTC fallback, warned once per exercise

    [Fact]
    public void UnknownOrBlankZone_FallsBackToTheUtcDay()
    {
        var asOf = Utc(2026, 10, 14, 22);

        EndOfDay("Not/AZone", asOf, 0).Should().Be(Utc(2026, 10, 15, 0));
        EndOfDay(string.Empty, asOf, 0).Should().Be(Utc(2026, 10, 15, 0));
        EndOfDay(null, asOf, 0).Should().Be(Utc(2026, 10, 15, 0), "an exercise that cannot be read is capped at the UTC day");
    }

    [Fact]
    public void UnknownZone_IsWarnedOncePerExercisePerProcess_NotPerRequest()
    {
        var logger = new RecordingLogger();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var asOf = Utc(2026, 10, 14, 12);

        for (var request = 0; request < 5; request++)
        {
            ParticipantSessionCap.EndOfExerciseDay(exerciseA, "Not/AZone", asOf, 0, logger);
        }

        logger.Warnings.Should().ContainSingle("five requests for the same exercise log one warning")
            .Which.Should().Contain(exerciseA.ToString());

        ParticipantSessionCap.EndOfExerciseDay(exerciseB, " ", asOf, 0, logger);
        ParticipantSessionCap.EndOfExerciseDay(exerciseB, null, asOf, 0, logger);
        logger.Warnings.Should().HaveCount(2, "a second exercise with a bad zone gets its own single warning");
        logger.Warnings[1].Should().Contain(exerciseB.ToString());
    }

    [Fact]
    public void KnownZone_IsNeverWarned()
    {
        var logger = new RecordingLogger();

        ParticipantSessionCap.EndOfExerciseDay(Guid.NewGuid(), NewYork, Utc(2026, 10, 14, 12), 0, logger);
        ParticipantSessionCap.EndOfExerciseDay(Guid.NewGuid(), "UTC", Utc(2026, 10, 14, 12), 0, logger);

        logger.Warnings.Should().BeEmpty();
    }

    private static DateTimeOffset EndOfDay(string? zone, DateTimeOffset asOf, int rolloverHour) =>
        ParticipantSessionCap.EndOfExerciseDay(Guid.NewGuid(), zone, asOf, rolloverHour, new RecordingLogger());

    /// <summary>Records the formatted warnings it receives.</summary>
    private sealed class RecordingLogger : ILogger
    {
        public List<string> Warnings { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning)
            {
                Warnings.Add(formatter(state, exception));
            }
        }
    }
}
