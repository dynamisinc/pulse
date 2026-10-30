namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.PersonalLinks;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 (AC3, AC4; EL-9, EL-11) — <see cref="WordLoginService"/> against REAL SQL Server. A sign-in name plus
/// today's word signs an enabled participant in with exactly the <c>/api/auth/login</c> session request; every other
/// outcome is the same refusal. Exactly ONE word verification (the real hash, or the decoy when no word is set) runs on
/// every path, BEFORE the account is looked up; every refusal then runs exactly one more KDF call, the redaction check
/// of the attempted name (story 01 Gate-1 fold), so all refusals cost the same. The route never creates or changes an
/// account beyond <c>LastLoginAt</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class WordLoginServiceTests
{
    private const string Word = "Maple Harbor 42";

    private static readonly DateOnly Today = new(2026, 10, 13);

    private readonly MsSqlContainerFixture _fixture;

    public WordLoginServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---------------------------------------------------------------- success (AC3)

    [RequiresDockerFact]
    public async Task Success_IssuesTheLoginSession_RecordsLastLoginAt_AndRunsExactlyOneKdf()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var persona = Guid.NewGuid();
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith", role: "pio", personaId: persona, actingHumanId: "human-jane");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        var issuer = new RecordingSessionIssuer();
        var hasher = new CountingHasher();
        var result = await SignInAsync(exercise.Id, Body("jsmith", Word), issuer, hasher);

        result.Outcome.Should().Be(WordLoginOutcome.Authenticated);
        result.Issued.Should().NotBeNull();
        hasher.Calls.Should().Equal(["Verify"], "today's real hash is verified exactly once");

        issuer.IssueCount.Should().Be(1);
        issuer.LastRequest.Should().BeEquivalentTo(
            ParticipantSessionRequests.For(account, exercise.Id),
            "the session request is exactly the one /api/auth/login builds (persona and acting human as the account has them)");
        issuer.LastRequest!.Kind.Should().Be("participant");
        issuer.LastRequest.PersonaId.Should().Be(persona);
        issuer.LastRequest.ActingHumanId.Should().Be("human-jane");
        issuer.LastRequest.IsReadOnly.Should().BeFalse();

        (await ReadAccountAsync(account.Id)).LastLoginAt.Should().Be(DefaultNow, "a word sign-in records LastLoginAt from the one clock read");
    }

    [RequiresDockerTheory]
    [InlineData("jsmith")]
    [InlineData("JSMITH")]
    [InlineData("  JSmith  ")]
    public async Task TheName_IsMatchedCaseInsensitively_AndTrimmed(string typed)
    {
        var exercise = await SeedExerciseAsync(_fixture);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        var result = await SignInAsync(exercise.Id, Body(typed, Word));

        result.Outcome.Should().Be(WordLoginOutcome.Authenticated, "'{0}' is the sign-in name jsmith", typed);
    }

    [RequiresDockerTheory]
    [InlineData("Maple Harbor 42")]
    [InlineData("maple-harbor-42")]
    [InlineData("MAPLEHARBOR42")]
    [InlineData("  máple hárbor 42 ")]
    public async Task TheWord_IsNormalisedOnBothSides(string typed)
    {
        var exercise = await SeedExerciseAsync(_fixture);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        var result = await SignInAsync(exercise.Id, Body("jsmith", typed));

        result.Outcome.Should().Be(WordLoginOutcome.Authenticated, "'{0}' is the same word as '{1}'", typed, Word);
    }

    [RequiresDockerTheory]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("active")]
    [InlineData("complete")]
    public async Task ParticipantReadLifecycleStates_Admit(string status)
    {
        var exercise = await SeedExerciseAsync(_fixture, status: status);
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        (await SignInAsync(exercise.Id, Body("jsmith", Word))).Outcome.Should().Be(
            WordLoginOutcome.Authenticated, "one rule for all (2026-10-19): {0} accepts participant reads, so it admits sign-in", status);
    }

    // ---------------------------------------------------------------- the uniform refusal (AC4)

    [RequiresDockerFact]
    public async Task WrongWord_IsRefused_AfterTheRealWordCheck()
    {
        var (exercise, account) = await SeedLiveWithWordAsync();

        await AssertRefusedAsync(exercise.Id, Body("jsmith", "Maple Harbor 43"), account, expectedCalls: ["Verify", "Verify"]);
    }

    [RequiresDockerFact]
    public async Task UnknownName_IsRefused_AfterTheRealWordCheck()
    {
        var (exercise, account) = await SeedLiveWithWordAsync();

        await AssertRefusedAsync(exercise.Id, Body("nobody", Word), account, expectedCalls: ["Verify", "Verify"]);
    }

    [RequiresDockerFact]
    public async Task NoWordSetToday_IsRefused_AfterTheDecoy()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith");

        await AssertRefusedAsync(exercise.Id, Body("jsmith", Word), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);
    }

    [RequiresDockerFact]
    public async Task YesterdaysWord_AndTomorrowsPresetWord_AreRefused()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today.AddDays(-1), "yesterday word");
        await SeedWordAsync(_fixture, exercise.Id, Today.AddDays(1), "tomorrow word");

        await AssertRefusedAsync(exercise.Id, Body("jsmith", "yesterday word"), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);
        await AssertRefusedAsync(exercise.Id, Body("jsmith", "tomorrow word"), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);
    }

    [RequiresDockerFact]
    public async Task ADisabledAccount_IsRefused_EvenWithTheRightWord()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith", disabledAt: DefaultNow.AddHours(-1));
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        await AssertRefusedAsync(exercise.Id, Body("jsmith", Word), account, expectedCalls: ["Verify", "Verify"]);
    }

    [RequiresDockerFact]
    public async Task ADisableRacingTheIssue_IsTheSameRefusal_AtTheSameKdfCost_AndRecordsNoSuccess()
    {
        // Gate-2 W-001 (story 03's join pattern): the word and name check out, then staff disable the account BEFORE the
        // session is minted (the racing issuer commits the Disable on its own connection first). The sign-in re-reads
        // the account after minting, so it is refused, and refused exactly as a disabled account is: the same two KDF
        // calls (Gate-1 W-1), the same identity-less event, no LastLoginAt and no success event.
        var (exercise, account) = await SeedLiveWithWordAsync();
        var recording = new RecordingSessionIssuer();
        var issuer = new RacingSessionIssuer(recording, async () =>
        {
            await using var staffSide = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
            (await staffSide.Accounts.SingleAsync(a => a.Id == account.Id)).DisabledAt = DefaultNow;
            await staffSide.SaveChangesAsync();
        });
        var hasher = new CountingHasher();

        WordLoginResult result;
        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            result = await LoginService(context, exercise.Id, ClockAt(DefaultNow), issuer, hasher).SignInAsync(Body("jsmith", Word));
        }

        result.Outcome.Should().Be(WordLoginOutcome.Rejected, "a sign-in that lost the race to Disable is the uniform refusal");
        result.Issued.Should().BeNull();
        recording.IssueCount.Should().Be(1, "precondition: the session was minted before the re-read");
        hasher.Calls.Should().Equal(
            ["Verify", "Verify"], "the raced refusal pays the word check plus the redaction check, like every refusal (W-1)");
        (await ReadAccountAsync(account.Id)).LastLoginAt.Should().BeNull("LastLoginAt is written only once the re-read passes");

        var evt = (await ReadEventsAsync(_fixture, exercise.Id)).Should().ContainSingle(
            "a raced attempt emits exactly one login event, and no success event").Subject;
        evt.Payload.Should().Be("{\"outcome\":\"failure\",\"method\":\"word\"}");
        evt.Actor.Kind.Should().Be("system");
        evt.Actor.ParticipantId.Should().BeNull("the refusal names nobody");
        evt.Target!.EntityId.Should().Be("jsmith", "the same attempted-name target a disabled account's refusal records");
    }

    [RequiresDockerTheory]
    [InlineData("controller")]
    [InlineData("evaluator")]
    [InlineData("planner")]
    public async Task AnAccountOutsideTheParticipantWorld_IsRefused(string role)
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith", role: role);
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        await AssertRefusedAsync(exercise.Id, Body("jsmith", Word), account, expectedCalls: ["Verify", "Verify"]);
    }

    [RequiresDockerTheory]
    [InlineData("build")]
    [InlineData("archived")]
    [InlineData("scheduled")]
    [InlineData("not-a-state")]
    public async Task AnExerciseWhoseParticipantReadsAreRefused_IsRefused(string status)
    {
        var exercise = await SeedExerciseAsync(_fixture, status: status);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);

        await AssertRefusedAsync(exercise.Id, Body("jsmith", Word), account, expectedCalls: ["Verify", "Verify"]);
    }

    [RequiresDockerFact]
    public async Task AnUnresolvedOrEmptyHost_IsRefused_AfterTheDecoy_WithNoTelemetry()
    {
        var (exercise, account) = await SeedLiveWithWordAsync();

        await AssertRefusedAsync(scope: null, Body("jsmith", Word), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);
        await AssertRefusedAsync(scope: Guid.Empty, Body("jsmith", Word), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);
        await AssertRefusedAsync(scope: Guid.NewGuid(), Body("jsmith", Word), account, expectedCalls: ["VerifyDecoy", "VerifyDecoy"]);

        (await ReadEventsAsync(_fixture, exercise.Id)).Should().BeEmpty("there was no resolved exercise to stamp an event against");
    }

    [RequiresDockerTheory]
    [InlineData("abc")]
    [InlineData("!!!!!!!!")]
    public async Task AWordThatCannotBeValid_StillPaysTheDecoy(string typed)
    {
        var (exercise, account) = await SeedLiveWithWordAsync();

        await AssertRefusedAsync(exercise.Id, Body("jsmith", typed), account, expectedCalls: ["VerifyDecoy", "Verify"]);
    }

    [RequiresDockerFact]
    public async Task TheWordIsVerifiedBeforeTheNameLookup_AndEveryRefusalRunsTheSameStatements()
    {
        var (exercise, _) = await SeedLiveWithWordAsync();
        await SeedAccountAsync(_fixture, exercise.Id, "disabled1", disabledAt: DefaultNow.AddDays(-1));

        // Gate-1 W-1: a wrong word, a right word with an unknown name, and a right word for a disabled account must run
        // the SAME statements in the SAME order, or the work done would tell a guesser that the word was right.
        var wrongWord = await SignInWithLogAsync(exercise.Id, Body("jsmith", "Maple Harbor 99"));
        var unknownName = await SignInWithLogAsync(exercise.Id, Body("nobody", Word));
        var disabled = await SignInWithLogAsync(exercise.Id, Body("disabled1", Word));
        var success = await SignInWithLogAsync(exercise.Id, Body("jsmith", Word));

        foreach (var log in new[] { wrongWord, unknownName, disabled, success })
        {
            var firstKdf = log.FindIndex(entry => entry.StartsWith("KDF:", StringComparison.Ordinal));
            var accountsRead = log.FindIndex(entry => entry.StartsWith("SQL:", StringComparison.Ordinal)
                && entry.Contains("FROM [Accounts]", StringComparison.Ordinal));
            firstKdf.Should().BeGreaterThanOrEqualTo(0);
            accountsRead.Should().BeGreaterThan(firstKdf, "EL-9: the word is verified BEFORE the sign-in name is looked up, on every path");
        }

        wrongWord.Should().Equal(unknownName, "a right word with an unknown name runs exactly what a wrong word runs");
        wrongWord.Should().Equal(disabled, "a right word for a disabled account runs exactly what a wrong word runs");
        wrongWord.Count(entry => entry.StartsWith("KDF:", StringComparison.Ordinal)).Should().Be(2, "the word check plus the refusal's redaction check");
        wrongWord.Should().NotContain(
            entry => entry.Contains("UPDATE", StringComparison.OrdinalIgnoreCase),
            "the account read on a refusal is left untouched, so the refusal's save writes only its event");
        wrongWord.Where(entry => entry.StartsWith("SQL:", StringComparison.Ordinal)).Last().Should().Contain(
            "INSERT INTO [TelemetryEvents]", "the refusal's one write is its failure event");
        success.Should().Contain(entry => entry.Contains("UPDATE [Accounts]", StringComparison.Ordinal), "anti-vacuity: a success does write LastLoginAt");
    }

    [RequiresDockerFact]
    public async Task AnUnknownTimeZone_FallsBackToUtc_AndWarnsOncePerExercise_WithOnlyTheIdAndZone()
    {
        var exercise = await SeedExerciseAsync(_fixture, timeZone: "Mars/Olympus_Mons");
        await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);
        var logger = new ListLogger<WordLoginService>();

        // 2026-10-13T23:30Z is still the 13th in UTC (the fallback), though it is the 13th in New York too.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id });
            var service = LoginService(
                context, exercise.Id, ClockAt(new DateTimeOffset(2026, 10, 13, 23, 30, 0, TimeSpan.Zero)), new RecordingSessionIssuer(), logger: logger);
            (await service.SignInAsync(Body("jsmith", Word))).Outcome.Should().Be(WordLoginOutcome.Authenticated);
        }

        await using (var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exercise.Id }))
        {
            var service = LoginService(
                context, exercise.Id, ClockAt(new DateTimeOffset(2026, 10, 14, 0, 0, 0, TimeSpan.Zero)), new RecordingSessionIssuer(), logger: logger);
            (await service.SignInAsync(Body("jsmith", Word))).Outcome.Should().Be(
                WordLoginOutcome.Rejected, "with the UTC fallback the 13th's word ends at UTC midnight");
        }

        var warning = logger.Entries.Should().ContainSingle("the fallback is logged once per exercise per process, not per request").Subject;
        warning.Level.Should().Be(LogLevel.Warning);
        warning.Message.Should().Contain(exercise.Id.ToString()).And.Contain("Mars/Olympus_Mons");
        warning.Message.Should().NotContainEquivalentOf("maple").And.NotContain("jsmith", "never a word or a sign-in name");
    }

    [RequiresDockerFact]
    public async Task TheRoute_NeverCreatesOrChangesAnAccount()
    {
        var (exercise, account) = await SeedLiveWithWordAsync();

        await SignInAsync(exercise.Id, Body("newcomer", Word));
        await SignInAsync(exercise.Id, Body("jsmith", "wrong word here"));

        await using var read = _fixture.CreateContext();
        var accounts = await read.Accounts.IgnoreQueryFilters().Where(a => a.ExerciseId == exercise.Id).ToListAsync();
        accounts.Should().ContainSingle("COR-011: no sign-in path provisions an account").Which.Should().BeEquivalentTo(
            account,
            options => options.Excluding(a => a.CreatedAt).Excluding(a => a.Enrollment),
            "a refused sign-in changes nothing on the account");
    }

    // ---------------------------------------------------------------- 400s

    [RequiresDockerTheory]
    [InlineData(null, Word, WordLoginService.SignInNameRequiredError)]
    [InlineData("   ", Word, WordLoginService.SignInNameRequiredError)]
    [InlineData("<b></b>", Word, WordLoginService.SignInNameRequiredError)]
    [InlineData("jsmith", null, WordLoginService.WordRequiredError)]
    [InlineData("jsmith", "   ", WordLoginService.WordRequiredError)]
    public async Task AMissingField_IsInvalid_BeforeAnyWork(string? name, string? word, string reason)
    {
        var (exercise, _) = await SeedLiveWithWordAsync();
        var hasher = new CountingHasher();

        var result = await SignInAsync(exercise.Id, Body(name, word), hasher: hasher);

        result.Outcome.Should().Be(WordLoginOutcome.Invalid);
        result.ValidationError.Should().Be(reason);
        hasher.Calls.Should().BeEmpty("a malformed body is refused before the slow KDF");
    }

    [RequiresDockerFact]
    public async Task AnOversizedField_IsInvalid_AndTheReasonNeverQuotesIt()
    {
        var (exercise, _) = await SeedLiveWithWordAsync();

        var longName = new string('n', WordLoginService.MaxRawSignInNameLength + 1);
        var longWord = new string('w', DayWordNormalizer.MaxRawLength + 1);

        var byName = await SignInAsync(exercise.Id, Body(longName, Word));
        var byWord = await SignInAsync(exercise.Id, Body("jsmith", longWord));
        var bySanitizedName = await SignInAsync(exercise.Id, Body(new string('n', 300), Word));

        byName.Outcome.Should().Be(WordLoginOutcome.Invalid);
        byName.ValidationError.Should().Be(WordLoginService.SignInNameTooLongError);
        byWord.Outcome.Should().Be(WordLoginOutcome.Invalid);
        byWord.ValidationError.Should().Be(WordLoginService.WordTooLongError);
        bySanitizedName.Outcome.Should().Be(WordLoginOutcome.Invalid, "a name longer than any stored sign-in name is a 400, not a credential check");
        bySanitizedName.ValidationError.Should().Be(WordLoginService.SignInNameTooLongError);
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(Exercise Exercise, Account Account)> SeedLiveWithWordAsync()
    {
        var exercise = await SeedExerciseAsync(_fixture);
        var account = await SeedAccountAsync(_fixture, exercise.Id, "jsmith");
        await SeedWordAsync(_fixture, exercise.Id, Today, Word);
        return (exercise, account);
    }

    private async Task<WordLoginResult> SignInAsync(
        Guid? scope,
        WordSignInRequestBody body,
        RecordingSessionIssuer? issuer = null,
        CountingHasher? hasher = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        var service = LoginService(context, scope, ClockAt(DefaultNow), issuer ?? new RecordingSessionIssuer(), hasher);
        return await service.SignInAsync(body);
    }

    private async Task<List<string>> SignInWithLogAsync(Guid scope, WordSignInRequestBody body)
    {
        var log = new List<string>();
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(new CommandLogInterceptor(log))
            .Options;

        var exerciseContext = new ExerciseContext { CurrentExerciseId = scope };
        await using var context = new PulseDbContext(options, exerciseContext, null);
        var service = LoginService(context, scope, ClockAt(DefaultNow), new RecordingSessionIssuer(), new CountingHasher(log));
        await service.SignInAsync(body);
        return log;
    }

    private async Task AssertRefusedAsync(Guid? scope, WordSignInRequestBody body, Account account, string[] expectedCalls)
    {
        var issuer = new RecordingSessionIssuer();
        var hasher = new CountingHasher();

        var result = await SignInAsync(scope, body, issuer, hasher);

        result.Outcome.Should().Be(WordLoginOutcome.Rejected, "every failure is the same refusal");
        result.Issued.Should().BeNull();
        result.ValidationError.Should().BeNull("the refusal carries no detail");
        issuer.IssueCount.Should().Be(0, "a refusal never mints a session");
        hasher.Verifications.Should().Be(2, "every refusal costs the same: one word verification plus one redaction check");
        hasher.Calls[0].Should().Be(expectedCalls[0], "the first call is always the word check");
        hasher.Calls.Should().Equal(expectedCalls);
        (await ReadAccountAsync(account.Id)).LastLoginAt.Should().BeNull("a refusal does not record a sign-in");
    }

    private async Task<Account> ReadAccountAsync(Guid accountId)
    {
        await using var read = _fixture.CreateContext();
        return await read.Accounts.IgnoreQueryFilters().AsNoTracking().SingleAsync(a => a.Id == accountId);
    }
}
