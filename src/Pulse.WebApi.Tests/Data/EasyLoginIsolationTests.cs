namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (Isolation AC, XC-001/COR-001) — the always-Critical behavioural proof for the TWO new
/// <see cref="IExerciseScoped"/> entities the feature's one migration adds: <see cref="ParticipantLink"/> (a personal
/// sign-in link, i.e. a bearer credential) and <see cref="ExerciseDayWord"/> (the hashed word for the day). Modelled
/// on <see cref="AccountAndSharedCredentialIsolationTests"/> and with the same rigor: real SQL Server, fresh ids per
/// test, because-reasons. It proves, entity by entity, that the central filter and write guard cover them with no
/// per-entity code: a row in exercise B is invisible under A's scope (by list, by id, by the join's token-hash lookup
/// and by aggregate), an unset or empty scope sees ZERO rows (fail closed, and the rows provably exist), and saving
/// either with no resolved scope throws.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class EasyLoginIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EasyLoginIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static ParticipantLink NewLink(Guid exerciseId, Guid? accountId = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AccountId = accountId ?? Guid.NewGuid(),
        TokenHash = ParticipantLinkTokens.Hash(ParticipantLinkTokens.Generate()),
        ProtectedToken = "protected-copy",
        Generation = 1,
        IssuedAt = DateTimeOffset.UtcNow,
    };

    private static ExerciseDayWord NewDayWord(Guid exerciseId, DateOnly? forDate = null) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        ForDate = forDate ?? new DateOnly(2026, 10, 20),
        WordHash = $"hash-{Guid.NewGuid():N}",
        SetAt = DateTimeOffset.UtcNow,
        SetByStaffUserId = Guid.NewGuid(),
    };

    [RequiresDockerFact]
    public async Task ParticipantLinkQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var linkA = NewLink(exerciseA);
        var linkB = NewLink(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.AddRange(linkA, linkB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.ParticipantLinks
            .Where(l => l.Id == linkA.Id || l.Id == linkB.Id)
            .Select(l => l.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            linkA.Id, "a query in exercise A must see only A's link, never B's — a link is a bearer credential");
    }

    [RequiresDockerFact]
    public async Task ExerciseDayWordQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var wordA = NewDayWord(exerciseA);
        var wordB = NewDayWord(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            // Same date in two exercises: (ExerciseId, ForDate) is unique per exercise, so both rows are valid.
            seed.ExerciseDayWords.AddRange(wordA, wordB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.ExerciseDayWords
            .Where(w => w.ForDate == wordA.ForDate && (w.Id == wordA.Id || w.Id == wordB.Id))
            .Select(w => w.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            wordA.Id, "exercise B's word for the same date must never be visible to (and so never open) exercise A");
    }

    [RequiresDockerFact]
    public async Task JoinLookupShape_ByExerciseBTokenHash_UnderExerciseAScope_FindsNothing()
    {
        // The exact query story 03's join performs: one equality match on TokenHash, under the host-resolved scope.
        // A token minted in B and presented on A's host must be indistinguishable from an unknown token.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var linkB = NewLink(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.Add(linkB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.ParticipantLinks.SingleOrDefaultAsync(l => l.TokenHash == linkB.TokenHash)).Should().BeNull(
            "exercise B's token hash looked up under exercise A's scope must resolve to nothing — the cross-exercise " +
            "token is the same 'not found' as an unknown one");

        await using var readB = _fixture.CreateContext(ScopeFor(exerciseB));
        (await readB.ParticipantLinks.SingleOrDefaultAsync(l => l.TokenHash == linkB.TokenHash)).Should().NotBeNull(
            "the same lookup on B's own host does find it, so the null above is isolation, not a broken lookup");
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByKnownCrossExerciseIds_ReturnsNull_ForBothEntities()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var linkA = NewLink(exerciseA);
        var linkB = NewLink(exerciseB);
        var wordA = NewDayWord(exerciseA);
        var wordB = NewDayWord(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.AddRange(linkA, linkB);
            seed.ExerciseDayWords.AddRange(wordA, wordB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.ParticipantLinks.FindAsync(linkB.Id)).Should().BeNull(
            "FindAsync by exercise B's real link id from an exercise-A scope must fail closed (IDOR)");
        (await readA.ParticipantLinks.SingleOrDefaultAsync(l => l.AccountId == linkB.AccountId)).Should().BeNull(
            "a link looked up by exercise B's account id (the roster's per-participant lookup) must be filtered out");
        (await readA.ExerciseDayWords.FindAsync(wordB.Id)).Should().BeNull(
            "FindAsync by exercise B's day-word id from an exercise-A scope must fail closed (IDOR)");

        (await readA.ParticipantLinks.FindAsync(linkA.Id)).Should().NotBeNull("A's own link still resolves");
        (await readA.ExerciseDayWords.FindAsync(wordA.Id)).Should().NotBeNull("A's own word still resolves");
    }

    [RequiresDockerFact]
    public async Task AggregateCounts_DoNotLeakAnotherExercisesSize()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.Add(NewLink(exerciseA));
            seed.ParticipantLinks.AddRange(NewLink(exerciseB), NewLink(exerciseB), NewLink(exerciseB));
            seed.ExerciseDayWords.Add(NewDayWord(exerciseA));
            seed.ExerciseDayWords.AddRange(
                NewDayWord(exerciseB, new DateOnly(2026, 10, 20)),
                NewDayWord(exerciseB, new DateOnly(2026, 10, 21)));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.ParticipantLinks.CountAsync()).Should().Be(
            1, "a count under exercise A's scope is A's size alone — B's roster size must not leak through an aggregate");
        (await readA.ExerciseDayWords.CountAsync()).Should().Be(
            1, "the same holds for the day-word table");
    }

    [RequiresDockerFact]
    public async Task UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowsExist()
    {
        var exerciseId = Guid.NewGuid();
        var link = NewLink(exerciseId);
        var word = NewDayWord(exerciseId);

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.Add(link);
            seed.ExerciseDayWords.Add(word);
            await seed.SaveChangesAsync();
        }

        // Every fail-closed input shape: no accessor at all, an accessor with a null scope, and an explicit empty scope.
        var unresolvedScopes = new IExerciseContext?[]
        {
            null,
            new ExerciseContext(),
            new ExerciseContext { CurrentExerciseId = Guid.Empty },
        };

        foreach (var scope in unresolvedScopes)
        {
            await using var read = _fixture.CreateContext(scope);

            (await read.ParticipantLinks.CountAsync(l => l.Id == link.Id)).Should().Be(
                0, "an unresolved scope collapses to Guid.Empty, which no ParticipantLink can carry — zero rows, never all");
            (await read.ParticipantLinks.CountAsync(l => l.TokenHash == link.TokenHash)).Should().Be(
                0, "an unresolved host must not be able to resolve ANY token");
            (await read.ExerciseDayWords.CountAsync(w => w.Id == word.Id)).Should().Be(
                0, "an unresolved scope must see no day word — fail closed");
        }

        // The zeros above are the filter closing the door, not an empty table.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.ParticipantLinks.IgnoreQueryFilters().CountAsync(l => l.Id == link.Id)).Should().Be(1);
        (await unfiltered.ExerciseDayWords.IgnoreQueryFilters().CountAsync(w => w.Id == word.Id)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task IgnoreQueryFilters_RevealsBothExercisesRows_ProvingScopingIsTheFilter()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var linkA = NewLink(exerciseA);
        var linkB = NewLink(exerciseB);
        var wordA = NewDayWord(exerciseA);
        var wordB = NewDayWord(exerciseB);

        await using (var seed = _fixture.CreateContext())
        {
            seed.ParticipantLinks.AddRange(linkA, linkB);
            seed.ExerciseDayWords.AddRange(wordA, wordB);
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.ParticipantLinks.CountAsync(l => l.Id == linkA.Id || l.Id == linkB.Id)).Should().Be(1);
        (await readA.ParticipantLinks.IgnoreQueryFilters().CountAsync(l => l.Id == linkA.Id || l.Id == linkB.Id))
            .Should().Be(2, "ignoring the filter reveals both links — the scoping is the central filter, not missing data");

        (await readA.ExerciseDayWords.CountAsync(w => w.Id == wordA.Id || w.Id == wordB.Id)).Should().Be(1);
        (await readA.ExerciseDayWords.IgnoreQueryFilters().CountAsync(w => w.Id == wordA.Id || w.Id == wordB.Id))
            .Should().Be(2, "ignoring the filter reveals both words");
    }

    [RequiresDockerFact]
    public async Task SavingEitherEntity_WithNoResolvedScope_ThrowsAndPersistsNothing()
    {
        var link = NewLink(Guid.Empty);
        var word = NewDayWord(Guid.Empty);

        await using (var write = _fixture.CreateContext())
        {
            write.ParticipantLinks.Add(link);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses a ParticipantLink with an empty ExerciseId — no per-entity code needed");
        }

        await using (var write = _fixture.CreateContext())
        {
            write.ExerciseDayWords.Add(word);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses an ExerciseDayWord with an empty ExerciseId");
        }

        await using var verify = _fixture.CreateContext();
        (await verify.ParticipantLinks.IgnoreQueryFilters().CountAsync(l => l.Id == link.Id)).Should().Be(
            0, "the guard throws before SaveChanges reaches the database");
        (await verify.ExerciseDayWords.IgnoreQueryFilters().CountAsync(w => w.Id == word.Id)).Should().Be(0);
    }
}
