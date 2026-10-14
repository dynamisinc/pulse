namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System;
using System.Linq;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using static Pulse.WebApi.Tests.Features.Identity.DayWord.DayWordTestSupport;

/// <summary>
/// easy-login/05 — exercise isolation (XC-001 / COR-001, always-Critical; extends the standing suite modelled on
/// <c>Data/QueryFilterIsolationTests</c>). <see cref="Pulse.WebApi.Data.Entities.ExerciseDayWord"/> and
/// <see cref="Pulse.WebApi.Data.Entities.Account"/> are read under the central filter, so: exercise B's word never
/// opens A; a B account named on A's host with A's word is the uniform refusal; A's staff can neither see, set nor
/// clear B's word; an unset or empty scope sees ZERO rows (fail closed) while <c>IgnoreQueryFilters()</c> proves the
/// rows exist; a by-id read of B's row from A's scope (IDOR) is null. The last test drives the real pipeline, where the
/// exercise comes from the request's <c>Host</c> header.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DayWordIsolationTests
{
    private const string WordA = "Alpha Word 11";
    private const string WordB = "Bravo Word 22";

    private static readonly DateOnly Today = new(2026, 10, 13);

    private readonly MsSqlContainerFixture _fixture;

    public DayWordIsolationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task ExerciseBsWord_NeverOpensA()
    {
        var (a, b) = await SeedTwoExercisesAsync();
        await SeedAccountAsync(_fixture, a, "alice");
        await SeedWordAsync(_fixture, b, Today, WordB);

        (await SignInAsync(a, "alice", WordB)).Should().Be(
            WordLoginOutcome.Rejected, "A has no word today, and B's word is invisible on A's host");

        await SeedWordAsync(_fixture, a, Today, WordA);
        (await SignInAsync(a, "alice", WordB)).Should().Be(WordLoginOutcome.Rejected, "B's word is not A's word");
        (await SignInAsync(a, "alice", WordA)).Should().Be(WordLoginOutcome.Authenticated, "anti-vacuity: A's own word works");
    }

    [RequiresDockerFact]
    public async Task ABAccountNamedOnAsHost_WithAsWord_IsTheUniformRefusal()
    {
        var (a, b) = await SeedTwoExercisesAsync();
        var bob = await SeedAccountAsync(_fixture, b, "bob");
        await SeedWordAsync(_fixture, a, Today, WordA);
        await SeedWordAsync(_fixture, b, Today, WordB);

        var issuer = new RecordingSessionIssuer();
        (await SignInAsync(a, "bob", WordA, issuer)).Should().Be(WordLoginOutcome.Rejected);
        (await SignInAsync(a, "bob", WordB, issuer)).Should().Be(WordLoginOutcome.Rejected, "nor with B's own word on A's host");
        issuer.IssueCount.Should().Be(0, "no session is ever bound across exercises");

        await using var read = _fixture.CreateContext();
        (await read.Accounts.IgnoreQueryFilters().SingleAsync(x => x.Id == bob.Id)).LastLoginAt.Should().BeNull();
        (await SignInAsync(b, "bob", WordB)).Should().Be(WordLoginOutcome.Authenticated, "anti-vacuity: bob signs in on B");
    }

    [RequiresDockerFact]
    public async Task AsStaff_CannotSeeSetOrClearBsWord()
    {
        var (a, b) = await SeedTwoExercisesAsync();
        var staffA = await SeedStaffAsync(_fixture, a);
        var bToday = await SeedWordAsync(_fixture, b, Today, WordB);
        var bLater = await SeedWordAsync(_fixture, b, Today.AddDays(3), WordB);

        var status = (await StaffAsync(a, staffA, s => s.GetStatusAsync())).Status!;
        status.TodaySet.Should().BeFalse("B's word for today is invisible from A");
        status.Upcoming.Should().BeEmpty("B's preset dates are invisible from A");

        (await StaffAsync(a, staffA, s => s.ClearAsync(null))).Outcome.Should().Be(DayWordOutcome.Ok);
        (await StaffAsync(a, staffA, s => s.ClearAsync("2026-10-16"))).Outcome.Should().Be(DayWordOutcome.Ok);
        (await StaffAsync(a, staffA, s => s.SetAsync(new DayWordPutBody { Word = WordA }))).SetResult!.Replaced.Should().BeFalse(
            "A's set creates A's own row; it does not 'replace' B's");

        var bRows = await ReadWordsAsync(_fixture, b);
        bRows.Select(r => r.Id).Should().BeEquivalentTo([bToday.Id, bLater.Id], "A's clears never touch B's rows");
        bRows.Single(r => r.Id == bToday.Id).WordHash.Should().Be(bToday.WordHash, "A's set never rewrites B's word");
        new SharedCredentialHasher().Verify(bRows.Single(r => r.Id == bToday.Id).WordHash, "bravoword22").Should().BeTrue();

        var aRow = (await ReadWordsAsync(_fixture, a)).Should().ContainSingle().Subject;
        aRow.ExerciseId.Should().Be(a, "the scope is stamped from IExerciseContext, never the request");
    }

    [RequiresDockerFact]
    public async Task StaffAssignedOnlyToB_AreForbiddenOnA()
    {
        var (a, b) = await SeedTwoExercisesAsync();
        var staffB = await SeedStaffAsync(_fixture, b);

        (await StaffAsync(a, staffB, s => s.SetAsync(new DayWordPutBody { Word = WordA }))).Outcome.Should().Be(DayWordOutcome.Forbidden);
        (await StaffAsync(a, staffB, s => s.GetStatusAsync())).Outcome.Should().Be(DayWordOutcome.Forbidden);
        (await ReadWordsAsync(_fixture, a)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AnUnsetOrEmptyScope_SeesZeroRows_WhileTheRowsExist_AndAByIdReadAcrossExercisesIsNull()
    {
        var (a, b) = await SeedTwoExercisesAsync();
        var rowA = await SeedWordAsync(_fixture, a, Today, WordA);
        var rowB = await SeedWordAsync(_fixture, b, Today, WordB);

        await using (var unset = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = null }))
        {
            (await unset.ExerciseDayWords.CountAsync(r => r.Id == rowA.Id || r.Id == rowB.Id)).Should().Be(0, "an unset scope fails closed");
        }

        await using (var empty = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = Guid.Empty }))
        {
            (await empty.ExerciseDayWords.CountAsync(r => r.Id == rowA.Id || r.Id == rowB.Id)).Should().Be(0, "Guid.Empty matches nothing");
            (await empty.ExerciseDayWords.IgnoreQueryFilters().CountAsync(r => r.Id == rowA.Id || r.Id == rowB.Id)).Should().Be(
                2, "the zero is the filter closing the door, not an empty table");
        }

        await using (var scopedToA = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = a }))
        {
            (await scopedToA.ExerciseDayWords.FindAsync(rowB.Id)).Should().BeNull("IDOR: B's row by its id is invisible from A");
            (await scopedToA.ExerciseDayWords.SingleOrDefaultAsync(r => r.Id == rowB.Id)).Should().BeNull();
            (await scopedToA.ExerciseDayWords.CountAsync()).Should().Be(1, "an aggregate from A counts only A's rows");
        }

        (await SignInAsync(scope: null, "alice", WordA)).Should().Be(WordLoginOutcome.Rejected);
    }

    [RequiresDockerFact]
    public async Task OverHttp_TheHostDecidesTheExercise_AndBsWordIsRefusedOnAsHost()
    {
        var hostA = $"dwa{Guid.NewGuid():N}.example.test";
        var hostB = $"dwb{Guid.NewGuid():N}.example.test";
        var exerciseA = await SeedExerciseAsync(_fixture, hostname: hostA);
        var exerciseB = await SeedExerciseAsync(_fixture, hostname: hostB);
        var alice = await SeedAccountAsync(_fixture, exerciseA.Id, "alice");
        await SeedAccountAsync(_fixture, exerciseB.Id, "bob");
        await SeedWordAsync(_fixture, exerciseA.Id, Today, WordA);
        await SeedWordAsync(_fixture, exerciseB.Id, Today, WordB);

        await using var host = await DayWordHttpTestHost.StartAsync(_fixture.ConnectionString!);
        using var onA = host.CreateClient(hostA);

        using var withBsWord = await onA.PostAsJsonAsync("/api/auth/word", new { signInName = "alice", word = WordB });
        using var bobOnA = await onA.PostAsJsonAsync("/api/auth/word", new { signInName = "bob", word = WordA });
        using var ownWord = await onA.PostAsJsonAsync("/api/auth/word", new { signInName = "alice", word = WordA });

        withBsWord.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        bobOnA.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await bobOnA.Content.ReadAsByteArrayAsync()).Should().BeEmpty();
        ownWord.StatusCode.Should().Be(HttpStatusCode.OK);
        var session = (await ownWord.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("session");
        session.GetProperty("exerciseId").GetString().Should().Be(exerciseA.Id.ToString(), "the session is bound to the host's exercise");
        session.GetProperty("accountId").GetString().Should().Be(alice.Id.ToString());
    }

    // ---------------------------------------------------------------- helpers

    private async Task<(Guid A, Guid B)> SeedTwoExercisesAsync()
    {
        var a = await SeedExerciseAsync(_fixture);
        var b = await SeedExerciseAsync(_fixture);
        return (a.Id, b.Id);
    }

    private async Task<WordLoginOutcome> SignInAsync(Guid? scope, string name, string word, RecordingSessionIssuer? issuer = null)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        var service = LoginService(context, scope, ClockAt(DefaultNow), issuer ?? new RecordingSessionIssuer());
        return (await service.SignInAsync(Body(name, word))).Outcome;
    }

    private async Task<DayWordResult> StaffAsync(Guid scope, Guid staffUserId, Func<DayWordService, Task<DayWordResult>> action)
    {
        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = scope });
        return await action(StaffService(context, scope, staffUserId, ClockAt(DefaultNow)));
    }
}
