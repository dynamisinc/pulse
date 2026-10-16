namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 (AC1, AC2; EL-9) — <see cref="DayWordService"/> against REAL SQL Server: set (default today, up to 14
/// days ahead, never the past), generate, replace in place (a rotation), status (never the word), clear (idempotent),
/// and the plaintext is never persisted: storage holds only an <see cref="ISharedCredentialHasher"/> hash of the
/// normalised word. "Today" is the real date in the exercise zone (America/New_York here; 2026-10-13 at 14:00Z).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordServiceTests
{
    private static readonly DateOnly Today = new(2026, 10, 13);

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public DayWordServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---------------------------------------------------------------- set (AC1)

    [RequiresDockerFact]
    public async Task Set_ASuppliedWord_DefaultsToToday_ReturnsThePlaintextOnce_AndStoresOnlyTheHash()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var result = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "  Maple Harbor 42 " });

        result.Outcome.Should().Be(DayWordOutcome.Ok);
        var set = result.SetResult!;
        set.Date.Should().Be("2026-10-13", "the default date is today in the exercise zone");
        set.Word.Should().Be("Maple Harbor 42", "the word is returned once, as typed (trimmed), for staff to read aloud");
        set.Generated.Should().BeFalse();
        set.Replaced.Should().BeFalse();
        set.SetAt.Should().Be(DefaultNow.ToString("O"));
        set.ValidUntil.Should().Be(new DateTimeOffset(2026, 10, 14, 4, 0, 0, TimeSpan.Zero).ToString("O"),
            "the 13th ends at local midnight in New York (EDT), 04:00Z");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle().Subject;
        row.ForDate.Should().Be(Today);
        row.SetByStaffUserId.Should().Be(staffUserId);
        row.ReplacedCount.Should().Be(0);
        row.SetAt.Should().Be(DefaultNow);
        row.WordHash.Should().NotContainEquivalentOf("maple").And.NotContainEquivalentOf("harbor");
        _hasher.Verify(row.WordHash, "mapleharbor42").Should().BeTrue("the hash is of the NORMALISED word");
    }

    [RequiresDockerFact]
    public async Task Set_WithNoWord_GeneratesOne()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var set = (await SetAsync(exerciseId, staffUserId, new DayWordPutBody())).SetResult!;
        var nullBody = (await SetAsync(exerciseId, staffUserId, body: null)).SetResult!;

        set.Generated.Should().BeTrue();
        set.Word.Should().MatchRegex("^[a-z]+-[a-z]+-[1-9][0-9]$", "adjective-noun-NN, lower-case");
        nullBody.Generated.Should().BeTrue("an absent body is the same as {}: generate a word for today");
        nullBody.Replaced.Should().BeTrue("the second set for the same date is a rotation");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle().Subject;
        _hasher.Verify(row.WordHash, DayWordNormalizer.Normalize(nullBody.Word)).Should().BeTrue();
        _hasher.Verify(row.WordHash, DayWordNormalizer.Normalize(set.Word)).Should().BeFalse("the rotation replaced the first word");
    }

    [RequiresDockerFact]
    public async Task Set_ADateThatHasAWord_ReplacesItInPlace()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var otherStaff = await SeedStaffAsync(_fixture, exerciseId, "planner");

        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "first word one" });
        var second = (await SetAsync(exerciseId, otherStaff, new DayWordPutBody { Word = "second word two" }, DefaultNow.AddMinutes(5))).SetResult!;
        var third = (await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "third word three" }, DefaultNow.AddMinutes(9))).SetResult!;

        second.Replaced.Should().BeTrue();
        third.Replaced.Should().BeTrue();

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle("one row per exercise per date").Subject;
        row.ReplacedCount.Should().Be(2, "each replacement is ReplacedCount + 1");
        row.SetAt.Should().Be(DefaultNow.AddMinutes(9));
        row.SetByStaffUserId.Should().Be(staffUserId);
        _hasher.Verify(row.WordHash, "thirdwordthree").Should().BeTrue("the rotation takes effect on the very next attempt");
        _hasher.Verify(row.WordHash, "firstwordone").Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task Set_UpTo14DaysAhead_IsAPreset_AndTheFifteenthDayIsNot()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var last = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "preset word", Date = "2026-10-27" });
        var tooFar = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "preset word", Date = "2026-10-28" });

        last.Outcome.Should().Be(DayWordOutcome.Ok);
        last.SetResult!.Date.Should().Be("2026-10-27");
        last.SetResult.ValidUntil.Should().Be(new DateTimeOffset(2026, 10, 28, 4, 0, 0, TimeSpan.Zero).ToString("O"));
        tooFar.Outcome.Should().Be(DayWordOutcome.Invalid);
        tooFar.Error.Should().Be(DayWordService.FutureDateError);
    }

    [RequiresDockerTheory]
    [InlineData("2026-10-12", "past")]
    [InlineData("2025-10-13", "past")]
    [InlineData("2026/10/13", "format")]
    [InlineData("2026-13-01", "format")]
    [InlineData("2026-02-30", "format")]
    [InlineData("13-10-2026", "format")]
    [InlineData("", "format")]
    [InlineData(" 2026-10-13", "format")]
    public async Task Set_ABadDate_Is400(string date, string kind)
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var result = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "valid word", Date = date });

        result.Outcome.Should().Be(DayWordOutcome.Invalid);
        result.Error.Should().Be(kind == "past" ? DayWordService.PastDateError : DayWordService.DateFormatError);
        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty("a refused set writes nothing");
    }

    [RequiresDockerTheory]
    [InlineData("abcde")]
    [InlineData("ab cd e!")]
    [InlineData("   ")]
    [InlineData("")]
    [InlineData("日本語日本語日本語")]
    public async Task Set_AWordShorterThanSixOnceNormalised_Is400_AndTheReasonNeverQuotesIt(string word)
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var result = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = word });

        result.Outcome.Should().Be(DayWordOutcome.Invalid);
        result.Error.Should().Be(DayWordService.WordLengthError);
        if (word.Trim().Length > 0)
        {
            result.Error.Should().NotContain(word.Trim());
        }

        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Set_AWordLongerThan64OnceNormalised_OrOverTheRawBound_Is400()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var exactly64 = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = new string('a', 64) });
        var over64 = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = new string('b', 65) });
        var overRaw = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "abcdef" + new string(' ', DayWordNormalizer.MaxRawLength) });

        exactly64.Outcome.Should().Be(DayWordOutcome.Ok);
        over64.Outcome.Should().Be(DayWordOutcome.Invalid);
        over64.Error.Should().Be(DayWordService.WordLengthError);
        overRaw.Outcome.Should().Be(DayWordOutcome.Invalid);
        overRaw.Error.Should().Be(DayWordService.WordTooLongError);
    }

    [RequiresDockerFact]
    public async Task Set_AnAccentedWord_IsAcceptedOnItsFoldedLength()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var result = await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "Ñandú 1" });

        result.Outcome.Should().Be(DayWordOutcome.Ok, "'Ñandú 1' is six characters once folded, as the client counts it");
        var row = (await ReadWordsAsync(_fixture, exerciseId)).Single();
        _hasher.Verify(row.WordHash, "nandu1").Should().BeTrue();
    }

    // ---------------------------------------------------------------- status (AC2)

    [RequiresDockerFact]
    public async Task Status_WithNoWord_ReportsTheZoneTodayAndItsEnd()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var status = (await StatusAsync(exerciseId, staffUserId)).Status!;

        status.TimeZone.Should().Be("America/New_York");
        status.Today.Should().Be("2026-10-13");
        status.TodayEndsAt.Should().Be(new DateTimeOffset(2026, 10, 14, 4, 0, 0, TimeSpan.Zero).ToString("O"));
        status.TodaySet.Should().BeFalse();
        status.SetAt.Should().BeNull();
        status.SetByName.Should().BeNull();
        status.ReplacedCount.Should().Be(0);
        status.Upcoming.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Status_WithWords_ReportsWhoWhenHowOftenAndThePresetDates_NeverAWord()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "today word one" });
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "today word two" }, DefaultNow.AddMinutes(1));
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "later word one", Date = "2026-10-20" });
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "next word one", Date = "2026-10-14" });
        await SeedWordAsync(_fixture, exerciseId, Today.AddDays(-1), "yesterday word");

        var status = (await StatusAsync(exerciseId, staffUserId, DefaultNow.AddMinutes(2))).Status!;

        status.TodaySet.Should().BeTrue();
        status.SetAt.Should().Be(DefaultNow.AddMinutes(1).ToString("O"));
        status.SetByName.Should().Be(StaffDisplayName, "who set it is the staff display name, read within the exercise's tenant");
        status.ReplacedCount.Should().Be(1);
        status.Upcoming.Select(u => u.Date).Should().Equal(["2026-10-14", "2026-10-20"], "later dates only, in order; never yesterday");
        status.Upcoming.Should().OnlyContain(u => u.SetAt == DefaultNow.ToString("O"));

        var json = JsonSerializer.Serialize(status);
        json.Should().NotContain("\"word\"").And.NotContainEquivalentOf("todayword").And.NotContainEquivalentOf("today word")
            .And.NotContainEquivalentOf("AQAAAA", "the status never carries a word or a hash");
    }

    [RequiresDockerFact]
    public async Task Status_ASetterOutsideTheExercisesTenant_IsNotNamed()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        // A staff human homed on ANOTHER customer: the setter read is bounded by the exercise's own tenant
        // (.InOrganization), so their name never crosses the customer boundary (COR-010).
        var otherOrganizationId = Guid.NewGuid();
        var foreignStaffId = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Organizations.Add(new Organization
            {
                Id = otherOrganizationId,
                Name = $"Other customer {otherOrganizationId:N}",
                CreatedAt = DateTimeOffset.UtcNow,
                Slug = $"org-{Guid.NewGuid():N}",
            });
            var foreign = Helpers.StaffTenantSeed.StaffUserFor(foreignStaffId, otherOrganizationId);
            foreign.DisplayName = "Foreign Staff";
            seed.StaffUsers.Add(foreign);
            await seed.SaveChangesAsync();
        }

        await SeedWordAsync(_fixture, exerciseId, Today, "seeded word", setBy: foreignStaffId);
        var foreignSetter = (await StatusAsync(exerciseId, staffUserId)).Status!;

        await SeedWordAsync(_fixture, exerciseId, Today.AddDays(1), "seeded word", setBy: Guid.NewGuid());
        var unknownSetter = (await StatusAsync(exerciseId, staffUserId, DefaultNow.AddDays(1))).Status!;

        foreignSetter.TodaySet.Should().BeTrue();
        foreignSetter.SetByName.Should().BeNull("a setter outside the exercise's tenant is omitted, never named");
        unknownSetter.TodaySet.Should().BeTrue();
        unknownSetter.SetByName.Should().BeNull("a setter that resolves to no staff user is omitted, never guessed");
    }

    [RequiresDockerFact]
    public async Task Status_InAnUnknownZone_FallsBackToUtcAndSaysSo_AndWarnsOnce()
    {
        var exercise = await SeedExerciseAsync(_fixture, timeZone: "Mars/Olympus_Mons");
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        var logger = new ListLogger<DayWordService>();

        var status = (await StatusAsync(exercise.Id, staffUserId, logger: logger)).Status!;
        await StatusAsync(exercise.Id, staffUserId, logger: logger);
        await SetAsync(exercise.Id, staffUserId, new DayWordPutBody { Word = "Maple Harbor 42" }, logger: logger);

        status.TimeZone.Should().Be("UTC", "the zone shown is the zone the day maths used");
        status.TodayEndsAt.Should().Be(new DateTimeOffset(2026, 10, 14, 0, 0, 0, TimeSpan.Zero).ToString("O"));

        var warning = logger.Entries.Should().ContainSingle("Gate-1 S-6: logged once per exercise per process, not per request").Subject;
        warning.Level.Should().Be(Microsoft.Extensions.Logging.LogLevel.Warning);
        warning.Message.Should().Contain(exercise.Id.ToString()).And.Contain("Mars/Olympus_Mons");
        warning.Message.Should().NotContainEquivalentOf("maple", "the warning names only the exercise and the zone");
    }

    [RequiresDockerFact]
    public async Task Status_InAKnownZone_DoesNotWarn()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var logger = new ListLogger<DayWordService>();

        await StatusAsync(exerciseId, staffUserId, logger: logger);

        logger.Entries.Should().BeEmpty();
    }

    // ---------------------------------------------------------------- concurrent first set (Gate-1 W-3)

    [RequiresDockerFact]
    public async Task Set_WhenAnotherFirstSetWinsTheRace_RetriesOnceAsARotation()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        Guid racerRowId = Guid.Empty;

        // Just before our first save, a competing first set for the same date commits (as another staff member's
        // request would), so our insert hits the (ExerciseId, ForDate) unique index.
        var interceptor = new RacingInsertInterceptor(async () =>
        {
            var row = await SeedWordAsync(_fixture, exerciseId, Today, "racer word one", setBy: racer);
            racerRowId = row.Id;
        });

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;
        var exerciseContext = new ExerciseContext { CurrentExerciseId = exerciseId };

        DayWordResult result;
        await using (var context = new PulseDbContext(options, exerciseContext, null))
        {
            result = await StaffService(context, exerciseId, staffUserId, ClockAt(DefaultNow))
                .SetAsync(new DayWordPutBody { Word = "Maple Harbor 42" });
        }

        interceptor.Fired.Should().BeTrue("anti-vacuity: the race really happened");
        result.Outcome.Should().Be(DayWordOutcome.Ok, "no 409: the caller's word becomes the date's word");
        result.SetResult!.Replaced.Should().BeTrue("losing the race turns the first set into a rotation");
        result.SetResult.Word.Should().Be("Maple Harbor 42");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle("still one row per exercise per date").Subject;
        row.Id.Should().Be(racerRowId, "the winner's row is replaced in place");
        row.ReplacedCount.Should().Be(1, "ReplacedCount + 1");
        row.SetByStaffUserId.Should().Be(staffUserId);
        _hasher.Verify(row.WordHash, "mapleharbor42").Should().BeTrue();
        _hasher.Verify(row.WordHash, "racerwordone").Should().BeFalse();

        var evt = (await ReadEventsAsync(_fixture, exerciseId)).Should().ContainSingle(
            "the refused insert's event was dropped with it; only the retry's event is written").Subject;
        evt.EventType.Should().Be("credential.rotated");
        evt.Payload.Should().Be("{\"date\":\"2026-10-13\",\"first\":false,\"generated\":false}");
        evt.Target!.EntityId.Should().Be(racerRowId.ToString());
    }

    // ---------------------------------------------------------------- clear (AC2)

    [RequiresDockerFact]
    public async Task Clear_RemovesThatDatesWord_AndIsIdempotent()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "today word" });
        await SetAsync(exerciseId, staffUserId, new DayWordPutBody { Word = "later word", Date = "2026-10-15" });

        (await ClearAsync(exerciseId, staffUserId, rawDate: null)).Outcome.Should().Be(DayWordOutcome.Ok);
        (await ReadWordsAsync(_fixture, exerciseId)).Select(r => r.ForDate).Should().Equal([new DateOnly(2026, 10, 15)],
            "clearing today leaves the preset word for the 15th");

        (await ClearAsync(exerciseId, staffUserId, rawDate: null)).Outcome.Should().Be(DayWordOutcome.Ok, "idempotent");
        (await ClearAsync(exerciseId, staffUserId, "2026-10-15")).Outcome.Should().Be(DayWordOutcome.Ok);
        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty();

        var status = (await StatusAsync(exerciseId, staffUserId)).Status!;
        status.TodaySet.Should().BeFalse("the word path is closed for today until a new word is set");
    }

    [RequiresDockerTheory]
    [InlineData("2026-10-12")]
    [InlineData("2026-10-28")]
    [InlineData("tomorrow")]
    [InlineData("")]
    public async Task Clear_ABadOrOutOfRangeDate_Is400(string date)
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        var result = await ClearAsync(exerciseId, staffUserId, date);

        result.Outcome.Should().Be(DayWordOutcome.Invalid);
        result.Error.Should().BeOneOf(DayWordService.DateFormatError, DayWordService.ClearRangeError);
    }

    // ---------------------------------------------------------------- fail closed

    [RequiresDockerFact]
    public async Task NoStaffSession_OrNoScope_IsUnauthorized()
    {
        var (exerciseId, staffUserId) = await SeedAsync();

        (await StatusAsync(exerciseId, staffUserId: null)).Outcome.Should().Be(DayWordOutcome.Unauthorized);
        (await StatusAsync(scope: null, staffUserId)).Outcome.Should().Be(DayWordOutcome.Unauthorized);
        (await StatusAsync(Guid.Empty, staffUserId)).Outcome.Should().Be(DayWordOutcome.Unauthorized);
        (await SetAsync(exerciseId, staffUserId: null, new DayWordPutBody())).Outcome.Should().Be(DayWordOutcome.Unauthorized);
        (await ClearAsync(exerciseId, staffUserId: null, null)).Outcome.Should().Be(DayWordOutcome.Unauthorized);
        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty();
    }

    [RequiresDockerTheory]
    [InlineData("evaluator")]
    public async Task AStaffUserWithoutControllerOrPlanner_IsForbidden(string role)
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id, role);

        (await StatusAsync(exercise.Id, staffUserId)).Outcome.Should().Be(DayWordOutcome.Forbidden);
        (await SetAsync(exercise.Id, staffUserId, new DayWordPutBody())).Outcome.Should().Be(DayWordOutcome.Forbidden);
        (await ClearAsync(exercise.Id, staffUserId, null)).Outcome.Should().Be(DayWordOutcome.Forbidden);
        (await ReadWordsAsync(_fixture, exercise.Id)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task APlanner_MayManageTheWord()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var planner = await SeedStaffAsync(_fixture, exercise.Id, "planner");

        (await SetAsync(exercise.Id, planner, new DayWordPutBody())).Outcome.Should().Be(DayWordOutcome.Ok);
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(Guid ExerciseId, Guid StaffUserId)> SeedAsync()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        return (exercise.Id, staffUserId);
    }

    private async Task<DayWordResult> SetAsync(
        Guid? scope, Guid? staffUserId, DayWordPutBody? body, DateTimeOffset? now = null, ListLogger<DayWordService>? logger = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        return await StaffService(context, scope, staffUserId, ClockAt(now ?? DefaultNow), logger: logger).SetAsync(body);
    }

    private async Task<DayWordResult> StatusAsync(
        Guid? scope, Guid? staffUserId, DateTimeOffset? now = null, ListLogger<DayWordService>? logger = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        return await StaffService(context, scope, staffUserId, ClockAt(now ?? DefaultNow), logger: logger).GetStatusAsync();
    }

    private async Task<DayWordResult> ClearAsync(Guid? scope, Guid? staffUserId, string? rawDate, DateTimeOffset? now = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        return await StaffService(context, scope, staffUserId, ClockAt(now ?? DefaultNow)).ClearAsync(rawDate);
    }
}

/// <summary>Runs a competing write once, just before the first save of the context it is attached to.</summary>
internal sealed class RacingInsertInterceptor : SaveChangesInterceptor
{
    private readonly Func<Task> _race;

    public RacingInsertInterceptor(Func<Task> race) => _race = race;

    public bool Fired { get; private set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (!Fired)
        {
            Fired = true;
            await _race();
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
