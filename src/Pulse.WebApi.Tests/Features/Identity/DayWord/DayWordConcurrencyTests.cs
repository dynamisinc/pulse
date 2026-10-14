namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 (AC1, AC2; Copilot review on #486) — concurrent writes to ONE (exercise, date) day-word row serialize,
/// against REAL SQL Server. <see cref="ExerciseDayWord.ReplacedCount"/> is the row's optimistic-concurrency token, so a
/// rotation (or clear) whose read went stale before its save matches no row, and <see cref="DayWordService"/> re-reads
/// and re-applies the SAME caller's write on top of the winner's, bounded by <see cref="DayWordService.MaxWriteAttempts"/>.
/// One model-only test pins the token in the model, the snapshot and the easy-login migration's designer.
/// <para>
/// Every race is forced deterministically, with no threads and no timing: a <see cref="RacingSaveInterceptor"/> on the
/// caller's context runs another staff member's whole request (its own context, its own commit) just before the caller's
/// save, i.e. after the caller has read the row. Both requests therefore read the same row state before either saves.
/// </para>
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordConcurrencyTests
{
    private static readonly DateOnly Today = new(2026, 10, 13);

    /// <summary>Distinct, acceptable words for the racer's successive rotations (index = fire number, from 1).</summary>
    private static readonly string[] RacerWords = ["zero", "alpha", "bravo", "charlie", "delta", "echo"];

    private readonly MsSqlContainerFixture _fixture;
    private readonly SharedCredentialHasher _hasher = new();

    public DayWordConcurrencyTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---------------------------------------------------------------- rotation vs rotation

    [RequiresDockerFact]
    public async Task Set_TwoRotationsRacingOnOneRow_BothApply_AndReplacedCountCountsBoth()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        var seeded = await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");
        DayWordResult? racerResult = null;

        // We read the row (ReplacedCount 0); before our save, the racer reads the same row (still 0) and commits its
        // rotation (0 -> 1). Our save then carries a stale count.
        var interceptor = new RacingSaveInterceptor(
            async _ => racerResult = await SetAsync(exerciseId, racer, new DayWordPutBody { Word = "racer word two" }, DefaultNow.AddSeconds(1)),
            times: 1);

        var result = await RacedAsync(
            interceptor,
            exerciseId,
            staffUserId,
            DefaultNow.AddSeconds(2),
            service => service.SetAsync(new DayWordPutBody { Word = "caller word three" }));

        interceptor.Fires.Should().Be(1, "anti-vacuity: the racer committed between our read and our save");
        racerResult!.Outcome.Should().Be(DayWordOutcome.Ok);
        racerResult.SetResult!.Replaced.Should().BeTrue();
        result.Outcome.Should().Be(DayWordOutcome.Ok, "no request fails merely because another rotated at the same moment");
        result.SetResult!.Replaced.Should().BeTrue();
        result.SetResult.Word.Should().Be("caller word three");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle("still one row per exercise per date").Subject;
        row.Id.Should().Be(seeded.Id, "both rotations replaced the row in place");
        row.ReplacedCount.Should().Be(2, "each rotation is applied on top of the other: the start (0) plus two, none lost");
        row.SetByStaffUserId.Should().Be(staffUserId, "the later committer's rotation is the current one");
        row.SetAt.Should().Be(DefaultNow.AddSeconds(2));
        _hasher.Verify(row.WordHash, "callerwordthree").Should().BeTrue("the later committer's word is the date's word");
        _hasher.Verify(row.WordHash, "racerwordtwo").Should().BeFalse();

        var events = await ReadEventsAsync(_fixture, exerciseId);
        events.Should().HaveCount(2, "one credential.rotated per successful request; our lost save's event was dropped with it")
            .And.OnlyContain(e => e.EventType == "credential.rotated"
                && e.Payload == "{\"date\":\"2026-10-13\",\"first\":false,\"generated\":false}"
                && e.Target!.EntityId == seeded.Id.ToString());
        events.Select(e => e.Actor.ActingHumanId).Should().BeEquivalentTo(new[] { racer.ToString(), staffUserId.ToString() });
    }

    // ---------------------------------------------------------------- rotation vs clear

    [RequiresDockerFact]
    public async Task Set_ARotationRacingAClearThatCommitsFirst_SetsTheWordAfresh_AsAFirstSet()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        var seeded = await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");

        // We read the row to rotate it; before our save, the racer clears the date (the row is deleted).
        var interceptor = new RacingSaveInterceptor(
            async _ => (await ClearAsync(exerciseId, racer, rawDate: null)).Outcome.Should().Be(DayWordOutcome.Ok),
            times: 1);

        var result = await RacedAsync(
            interceptor,
            exerciseId,
            staffUserId,
            DefaultNow.AddSeconds(2),
            service => service.SetAsync(new DayWordPutBody { Word = "caller word three" }));

        interceptor.Fires.Should().Be(1, "anti-vacuity: the clear committed between our read and our save");
        result.Outcome.Should().Be(DayWordOutcome.Ok, "a rotation racing a clear is never a 500");
        result.SetResult!.Word.Should().Be("caller word three");
        result.SetResult.Replaced.Should().BeFalse("at our commit the date had no word, so ours is a first set");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle(
            "serialized as clear-then-set: the caller asked for this word to be the date's word, and it is").Subject;
        row.Id.Should().NotBe(seeded.Id, "the cleared row stays cleared; ours is a fresh row");
        row.ReplacedCount.Should().Be(0, "a first set");
        row.SetByStaffUserId.Should().Be(staffUserId);
        _hasher.Verify(row.WordHash, "callerwordthree").Should().BeTrue();

        var events = await ReadEventsAsync(_fixture, exerciseId);
        events.Should().HaveCount(2, "the racer's revoke and exactly one set for the caller");
        events.Should().ContainSingle(e => e.EventType == "credential.revoked"
            && e.Actor.ActingHumanId == racer.ToString() && e.Target!.EntityId == seeded.Id.ToString());
        events.Should().ContainSingle(e => e.EventType == "credential.rotated"
            && e.Actor.ActingHumanId == staffUserId.ToString()
            && e.Payload == "{\"date\":\"2026-10-13\",\"first\":true,\"generated\":false}"
            && e.Target!.EntityId == row.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task Clear_RacingARotationThatCommitsFirst_StillClears_OnTopOfIt()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        var seeded = await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");

        // We read the row to clear it; before our delete, the racer rotates it (ReplacedCount 0 -> 1).
        var interceptor = new RacingSaveInterceptor(
            async _ => (await SetAsync(exerciseId, racer, new DayWordPutBody { Word = "racer word two" }, DefaultNow.AddSeconds(1)))
                .Outcome.Should().Be(DayWordOutcome.Ok),
            times: 1);

        var result = await RacedAsync(interceptor, exerciseId, staffUserId, DefaultNow.AddSeconds(2), service => service.ClearAsync(null));

        interceptor.Fires.Should().Be(1, "anti-vacuity: the rotation committed between our read and our delete");
        result.Outcome.Should().Be(DayWordOutcome.Ok, "a clear racing a rotation is never a 500");
        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty(
            "serialized as rotate-then-clear: the staff member who cleared closed the word path, including the racer's new word");

        var events = await ReadEventsAsync(_fixture, exerciseId);
        events.Should().HaveCount(2, "the racer's rotation and exactly one revoke for the caller");
        events.Should().ContainSingle(e => e.EventType == "credential.rotated" && e.Actor.ActingHumanId == racer.ToString());
        events.Should().ContainSingle(e => e.EventType == "credential.revoked"
            && e.Actor.ActingHumanId == staffUserId.ToString() && e.Target!.EntityId == seeded.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task Clear_RacingAnotherClear_IsStillIdempotent_AndOnlyTheRemoverEmits()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        var seeded = await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");

        // Both read the row; the racer's delete commits first, so ours finds nothing left to delete.
        var interceptor = new RacingSaveInterceptor(
            async _ => (await ClearAsync(exerciseId, racer, rawDate: null)).Outcome.Should().Be(DayWordOutcome.Ok),
            times: 1);

        var result = await RacedAsync(interceptor, exerciseId, staffUserId, DefaultNow.AddSeconds(2), service => service.ClearAsync(null));

        interceptor.Fires.Should().Be(1, "anti-vacuity: the other clear committed between our read and our delete");
        result.Outcome.Should().Be(DayWordOutcome.Ok, "clear is idempotent, even when another clear wins the race");
        (await ReadWordsAsync(_fixture, exerciseId)).Should().BeEmpty();

        var evt = (await ReadEventsAsync(_fixture, exerciseId)).Should().ContainSingle(
            "only the clear that removed the row emits; ours became the no-op clear, which emits nothing").Subject;
        evt.EventType.Should().Be("credential.revoked");
        evt.Actor.ActingHumanId.Should().Be(racer.ToString());
        evt.Target!.EntityId.Should().Be(seeded.Id.ToString());
    }

    // ---------------------------------------------------------------- the retry bound

    [RequiresDockerFact]
    public async Task Set_WhenEverySaveLosesARace_FailsAfterTheBound_WithoutLooping()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");

        // A competing rotation commits before EVERY one of our saves, so each of our attempts carries a stale count.
        // One more race than the bound is armed: an extra attempt would show up as an extra fire.
        var interceptor = new RacingSaveInterceptor(
            async fire => (await SetAsync(exerciseId, racer, new DayWordPutBody { Word = $"racer word {RacerWords[fire]}" }, DefaultNow))
                .Outcome.Should().Be(DayWordOutcome.Ok),
            times: DayWordService.MaxWriteAttempts + 1);

        var act = () => RacedAsync(
            interceptor,
            exerciseId,
            staffUserId,
            DefaultNow.AddSeconds(2),
            service => service.SetAsync(new DayWordPutBody { Word = "caller word three" }));

        await act.Should().ThrowAsync<DbUpdateConcurrencyException>(
            "after the bound the last lost race propagates (a 500 naming no word) rather than loop");
        interceptor.Fires.Should().Be(DayWordService.MaxWriteAttempts, "one try per attempt, and no try past the bound");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle().Subject;
        row.ReplacedCount.Should().Be(DayWordService.MaxWriteAttempts, "only the racer's rotations committed");
        row.SetByStaffUserId.Should().Be(racer);
        _hasher.Verify(row.WordHash, "racerword" + RacerWords[DayWordService.MaxWriteAttempts]).Should().BeTrue();
        _hasher.Verify(row.WordHash, "callerwordthree").Should().BeFalse("the failed request changed nothing");

        var events = await ReadEventsAsync(_fixture, exerciseId);
        events.Should().HaveCount(DayWordService.MaxWriteAttempts).And.OnlyContain(
            e => e.Actor.ActingHumanId == racer.ToString(), "the failed request left no event behind");
    }

    [RequiresDockerFact]
    public async Task Clear_WhenEverySaveLosesARace_FailsAfterTheBound_WithoutLooping()
    {
        var (exerciseId, staffUserId) = await SeedAsync();
        var racer = await SeedStaffAsync(_fixture, exerciseId, "planner");
        await SeedWordAsync(_fixture, exerciseId, Today, "opening word one");

        var interceptor = new RacingSaveInterceptor(
            async fire => (await SetAsync(exerciseId, racer, new DayWordPutBody { Word = $"racer word {RacerWords[fire]}" }, DefaultNow))
                .Outcome.Should().Be(DayWordOutcome.Ok),
            times: DayWordService.MaxWriteAttempts + 1);

        var act = () => RacedAsync(interceptor, exerciseId, staffUserId, DefaultNow.AddSeconds(2), service => service.ClearAsync(null));

        await act.Should().ThrowAsync<DbUpdateConcurrencyException>(
            "after the bound the last lost race propagates rather than loop");
        interceptor.Fires.Should().Be(DayWordService.MaxWriteAttempts, "one try per attempt, and no try past the bound");

        var row = (await ReadWordsAsync(_fixture, exerciseId)).Should().ContainSingle("the failed clear removed nothing").Subject;
        row.ReplacedCount.Should().Be(DayWordService.MaxWriteAttempts);
        (await ReadEventsAsync(_fixture, exerciseId)).Should().OnlyContain(
            e => e.EventType == "credential.rotated" && e.Actor.ActingHumanId == racer.ToString(),
            "the failed clear left no credential.revoked behind");
    }

    // ---------------------------------------------------------------- the token itself (model-only)

    [Fact]
    public void ReplacedCount_IsTheConcurrencyToken_InTheModel_TheSnapshot_AndTheEasyLoginMigration()
    {
        // Model-only: no connection is opened. HasPendingModelChanges (EasyLoginMigrationTests) cannot see this: a
        // concurrency token is no DDL, so a snapshot or migration designer missing it still diffs as "no changes".
        // Pin all three directly, so the next migration is generated from a baseline that already records it.
        using var context = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=model-only;Database=none;").Options);
        var migrations = context.GetService<IMigrationsAssembly>();
        var easyLogin = migrations.Migrations.Single(m => m.Key.EndsWith("_EasyLoginSchema", StringComparison.Ordinal));
        var targetModel = migrations.CreateMigration(easyLogin.Value, context.Database.ProviderName!).TargetModel;

        IsToken(context.Model).Should().BeTrue("the runtime model puts the token on the rotation UPDATE and the clear DELETE");
        IsToken(migrations.ModelSnapshot!.Model).Should().BeTrue("the committed model snapshot records it");
        IsToken(targetModel!).Should().BeTrue("the one easy-login migration's designer records it");
    }

    // ---------------------------------------------------------------- helpers

    private static bool IsToken(IReadOnlyModel model) =>
        model.FindEntityType(typeof(ExerciseDayWord).FullName!)!
            .FindProperty(nameof(ExerciseDayWord.ReplacedCount))!
            .IsConcurrencyToken;

    private async Task<(Guid ExerciseId, Guid StaffUserId)> SeedAsync()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var staffUserId = await SeedStaffAsync(_fixture, exercise.Id);
        return (exercise.Id, staffUserId);
    }

    /// <summary>Runs one caller request over a context carrying <paramref name="interceptor"/> (the race).</summary>
    private async Task<DayWordResult> RacedAsync(
        RacingSaveInterceptor interceptor,
        Guid exerciseId,
        Guid staffUserId,
        DateTimeOffset now,
        Func<DayWordService, Task<DayWordResult>> call)
    {
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(interceptor)
            .Options;

        await using var context = new PulseDbContext(options, new ExerciseContext { CurrentExerciseId = exerciseId }, null);
        return await call(StaffService(context, exerciseId, staffUserId, ClockAt(now)));
    }

    /// <summary>Another staff member's whole set request, in its own context (no interceptor), committing on its own.</summary>
    private async Task<DayWordResult> SetAsync(Guid exerciseId, Guid staffUserId, DayWordPutBody body, DateTimeOffset now)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await StaffService(context, exerciseId, staffUserId, ClockAt(now)).SetAsync(body);
    }

    /// <summary>Another staff member's whole clear request, in its own context (no interceptor), committing on its own.</summary>
    private async Task<DayWordResult> ClearAsync(Guid exerciseId, Guid staffUserId, string? rawDate)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        return await StaffService(context, exerciseId, staffUserId, ClockAt(DefaultNow)).ClearAsync(rawDate);
    }
}

/// <summary>
/// Runs a competing write just before each of the first <c>times</c> saves of the context it is attached to (the caller
/// has already read the row by then), so a test forces "another request committed between our read and our save"
/// deterministically. The competing write runs in its own context, so it never re-enters this interceptor.
/// </summary>
internal sealed class RacingSaveInterceptor : SaveChangesInterceptor
{
    private readonly Func<int, Task> _race;
    private readonly int _times;

    public RacingSaveInterceptor(Func<int, Task> race, int times)
    {
        _race = race;
        _times = times;
    }

    /// <summary>How many of the context's saves the competing write ran before (1-based fire number passed to the race).</summary>
    public int Fires { get; private set; }

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (Fires < _times)
        {
            Fires++;
            await _race(Fires);
        }

        return await base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
