namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 (AC5; EL-9, EL-19c) — the day boundary. A word set for date D signs in until the exercise-zone rollover
/// that ends D (local midnight plus <c>DayRolloverHour</c>) and not a second after; the word for D+1 does not work before
/// it. Driven by a hand-advanced <see cref="TimeProvider"/> (no real sleeping) across <c>America/New_York</c>'s fall-back
/// (a 25-hour day) and spring-forward (a 23-hour day), <c>Asia/Kolkata</c> (a half-hour offset) and a rollover hour of 3.
/// The staff side agrees: <c>today</c>, <c>todayEndsAt</c>, <c>validUntil</c> and "a past date" all flip at the same
/// instant.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordBoundaryTests
{
    private const string NewYork = "America/New_York";
    private const string Kolkata = "Asia/Kolkata";

    private readonly MsSqlContainerFixture _fixture;

    public DayWordBoundaryTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);

    [RequiresDockerFact]
    public async Task NewYork_RolloverZero_TheWordEndsAtLocalMidnight_ToTheSecond()
    {
        var exerciseId = await SeedTwoDaysAsync(NewYork, new DateOnly(2026, 10, 13));

        // EDT (UTC-4): the 13th ends at 2026-10-14T04:00Z.
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 14, 3, 59, 59))).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 10, 14, 3, 59, 59))).Should().Be(
            WordLoginOutcome.Rejected, "the next day's word does not work before the rollover");
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 14, 4, 0, 0))).Should().Be(
            WordLoginOutcome.Rejected, "not a second after the rollover");
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 10, 14, 4, 0, 0))).Should().Be(WordLoginOutcome.Authenticated);
    }

    [RequiresDockerFact]
    public async Task NewYork_FallBack_The25HourDayEndsAtTheNextLocalMidnight()
    {
        // 2026-11-01: EDT -> EST at 02:00 local. The 1st runs 04:00Z to 2026-11-02T05:00Z (25 hours).
        var exerciseId = await SeedTwoDaysAsync(NewYork, new DateOnly(2026, 11, 1));
        await SeedWordAsync(_fixture, exerciseId, new DateOnly(2026, 10, 31), "day before word");

        (await AttemptAsync(exerciseId, "day before word", Utc(2026, 11, 1, 3, 59, 59))).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 11, 1, 4, 0, 0))).Should().Be(
            WordLoginOutcome.Authenticated, "the 1st began at local midnight EDT (04:00Z)");
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 11, 2, 4, 59, 59))).Should().Be(
            WordLoginOutcome.Authenticated, "the fall-back day is 25 hours long: still the 1st at 23:59:59 EST");
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 11, 2, 5, 0, 0))).Should().Be(WordLoginOutcome.Rejected);
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 11, 2, 5, 0, 0))).Should().Be(WordLoginOutcome.Authenticated);
    }

    [RequiresDockerFact]
    public async Task NewYork_SpringForward_The23HourDayEndsAtTheNextLocalMidnight()
    {
        // 2027-03-14: EST -> EDT at 02:00 local. The 14th runs 05:00Z to 2027-03-15T04:00Z (23 hours).
        var exerciseId = await SeedTwoDaysAsync(NewYork, new DateOnly(2027, 3, 14));

        (await AttemptAsync(exerciseId, "first day word", Utc(2027, 3, 14, 4, 59, 59))).Should().Be(
            WordLoginOutcome.Rejected, "still the 13th (EST) one second before local midnight");
        (await AttemptAsync(exerciseId, "first day word", Utc(2027, 3, 14, 5, 0, 0))).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "first day word", Utc(2027, 3, 15, 3, 59, 59))).Should().Be(
            WordLoginOutcome.Authenticated, "23:59:59 EDT is still the 14th");
        (await AttemptAsync(exerciseId, "first day word", Utc(2027, 3, 15, 4, 0, 0))).Should().Be(
            WordLoginOutcome.Rejected, "the spring-forward day is only 23 hours long");
        (await AttemptAsync(exerciseId, "second day word", Utc(2027, 3, 15, 4, 0, 0))).Should().Be(WordLoginOutcome.Authenticated);
    }

    [RequiresDockerFact]
    public async Task Kolkata_AHalfHourOffsetZone_RollsOverAt1830Utc()
    {
        // IST (UTC+5:30): the 13th runs 2026-10-12T18:30Z to 2026-10-13T18:30Z.
        var exerciseId = await SeedTwoDaysAsync(Kolkata, new DateOnly(2026, 10, 13));

        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 12, 18, 29, 59))).Should().Be(WordLoginOutcome.Rejected);
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 12, 18, 30, 0))).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 13, 18, 29, 59))).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 13, 18, 30, 0))).Should().Be(WordLoginOutcome.Rejected);
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 10, 13, 18, 30, 0))).Should().Be(WordLoginOutcome.Authenticated);
    }

    [RequiresDockerFact]
    public async Task RolloverHourThree_TheDayEndsAtThreeLocal()
    {
        // EDT: with a 03:00 rollover the 13th runs 2026-10-13T07:00Z to 2026-10-14T07:00Z.
        var exerciseId = await SeedTwoDaysAsync(NewYork, new DateOnly(2026, 10, 13));

        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 14, 5, 0, 0), rolloverHour: 3)).Should().Be(
            WordLoginOutcome.Authenticated, "01:00 local on the 14th is still the 13th's exercise day");
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 14, 6, 59, 59), rolloverHour: 3)).Should().Be(WordLoginOutcome.Authenticated);
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 10, 14, 6, 59, 59), rolloverHour: 3)).Should().Be(WordLoginOutcome.Rejected);
        (await AttemptAsync(exerciseId, "first day word", Utc(2026, 10, 14, 7, 0, 0), rolloverHour: 3)).Should().Be(WordLoginOutcome.Rejected);
        (await AttemptAsync(exerciseId, "second day word", Utc(2026, 10, 14, 7, 0, 0), rolloverHour: 3)).Should().Be(WordLoginOutcome.Authenticated);
    }

    [RequiresDockerFact]
    public async Task TheStaffSide_FlipsTodayAndThePastAtTheSameInstant()
    {
        var exercise = await SeedExerciseAsync(_fixture, timeZone: NewYork);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        var before = Utc(2026, 10, 14, 3, 59, 59);
        var at = Utc(2026, 10, 14, 4, 0, 0);

        var statusBefore = (await StaffAsync(exercise.Id, staffUserId, before, s => s.GetStatusAsync())).Status!;
        var statusAt = (await StaffAsync(exercise.Id, staffUserId, at, s => s.GetStatusAsync())).Status!;
        statusBefore.Today.Should().Be("2026-10-13");
        statusBefore.TodayEndsAt.Should().Be(at.ToString("O"));
        statusAt.Today.Should().Be("2026-10-14");
        statusAt.TodayEndsAt.Should().Be(Utc(2026, 10, 15, 4, 0, 0).ToString("O"));

        var setBefore = await StaffAsync(exercise.Id, staffUserId, before, s => s.SetAsync(new DayWordPutBody { Word = "late word" }));
        setBefore.SetResult!.Date.Should().Be("2026-10-13");
        setBefore.SetResult.ValidUntil.Should().Be(at.ToString("O"), "validUntil is the rollover that ends the date");

        var setPast = await StaffAsync(exercise.Id, staffUserId, at, s => s.SetAsync(new DayWordPutBody { Word = "late word", Date = "2026-10-13" }));
        setPast.Outcome.Should().Be(DayWordOutcome.Invalid, "one second later the 13th is a past date");
        setPast.Error.Should().Be(DayWordService.PastDateError);
    }

    [RequiresDockerFact]
    public async Task TheStaffSide_HonoursTheRolloverHour()
    {
        var exercise = await SeedExerciseAsync(_fixture, timeZone: NewYork);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);

        var set = await StaffAsync(
            exercise.Id, staffUserId, Utc(2026, 10, 14, 5, 0, 0), s => s.SetAsync(new DayWordPutBody { Word = "night shift" }), rolloverHour: 3);

        set.SetResult!.Date.Should().Be("2026-10-13", "01:00 local is still the 13th with a 3 a.m. rollover");
        set.SetResult.ValidUntil.Should().Be(Utc(2026, 10, 14, 7, 0, 0).ToString("O"));
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>An exercise with one account and words for <paramref name="day"/> ("first day word") and the next day ("second day word").</summary>
    private async Task<Guid> SeedTwoDaysAsync(string timeZone, DateOnly day)
    {
        var exercise = await SeedExerciseAsync(_fixture, timeZone: timeZone);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, day, "first day word");
        await SeedWordAsync(_fixture, exercise.Id, day.AddDays(1), "second day word");
        return exercise.Id;
    }

    private async Task<WordLoginOutcome> AttemptAsync(Guid exerciseId, string word, DateTimeOffset at, int rolloverHour = 0)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var service = LoginService(context, exerciseId, ClockAt(at), new RecordingSessionIssuer(), rolloverHour: rolloverHour);
        return (await service.SignInAsync(Body("jsmith", word))).Outcome;
    }

    private async Task<DayWordResult> StaffAsync(
        Guid exerciseId,
        Guid staffUserId,
        DateTimeOffset at,
        Func<DayWordService, Task<DayWordResult>> action,
        int rolloverHour = 0)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await action(StaffService(context, exerciseId, staffUserId, ClockAt(at), rolloverHour: rolloverHour));
    }
}
