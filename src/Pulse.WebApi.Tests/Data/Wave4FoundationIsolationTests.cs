namespace Pulse.WebApi.Tests.Data;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// demo-feedback/17 (Isolation AC, XC-001/COR-001) — the always-Critical behavioural proof for Wave 4's two new
/// <see cref="IExerciseScoped"/> entities, <see cref="ExerciseRuntimeState"/> and <see cref="PostEdit"/>. Same rigor as
/// <see cref="DemoFeedbackIsolationTests"/>: real SQL Server, fresh ids per test, because-reasons. It proves the central
/// filter and write guard cover both sets with no per-entity code: exercise B's rows are invisible under A's scope (by
/// list, by id and by aggregate), an unset or empty scope sees ZERO rows while the rows provably exist, and saving a row
/// with no resolved scope throws and persists nothing.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class Wave4FoundationIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public Wave4FoundationIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static IExerciseContext?[] UnresolvedScopes() =>
    [
        null,
        new ExerciseContext(),
        new ExerciseContext { CurrentExerciseId = Guid.Empty },
    ];

    // ---- ExerciseRuntimeState -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task RuntimeStateQuery_InExerciseA_ReturnsOnlyExerciseARow()
    {
        var exerciseA = await SeedExerciseWithRuntimeStateAsync("freeze");
        var exerciseB = await SeedExerciseWithRuntimeStateAsync("engine");

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.ExerciseRuntimeStates
            .Where(s => s.ExerciseId == exerciseA || s.ExerciseId == exerciseB)
            .ToListAsync();

        visible.Should().ContainSingle().Which.ExerciseId.Should().Be(
            exerciseA, "a read under exercise A must see only A's runtime state — B's tier must never steer A");
        visible.Single().PauseTier.Should().Be("freeze");
    }

    [RequiresDockerFact]
    public async Task RuntimeState_FindByAnotherExercisesKey_ReturnsNull_AndCountsDoNotLeak()
    {
        var exerciseA = await SeedExerciseWithRuntimeStateAsync("running");
        var exerciseB = await SeedExerciseWithRuntimeStateAsync("freeze");

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.ExerciseRuntimeStates.FindAsync(exerciseB)).Should().BeNull(
            "FindAsync by exercise B's key from an exercise-A scope must fail closed (IDOR)");
        (await readA.ExerciseRuntimeStates.FindAsync(exerciseA)).Should().NotBeNull("A's own row still resolves");
        (await readA.ExerciseRuntimeStates.CountAsync()).Should().Be(
            1, "a count under A's scope is A's row alone, never every exercise's");
    }

    [RequiresDockerFact]
    public async Task RuntimeState_UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowExists()
    {
        var exerciseId = await SeedExerciseWithRuntimeStateAsync("engine");

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.ExerciseRuntimeStates.CountAsync(s => s.ExerciseId == exerciseId)).Should().Be(
                0, "an unresolved scope collapses to Guid.Empty, which no runtime-state row can carry — zero rows");
        }

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.ExerciseRuntimeStates.IgnoreQueryFilters().CountAsync(s => s.ExerciseId == exerciseId))
            .Should().Be(1, "the zeros above are the filter closing the door, not an empty table");
    }

    [RequiresDockerFact]
    public async Task SavingARuntimeState_WithNoResolvedScope_ThrowsAndPersistsNothing()
    {
        await using (var write = _fixture.CreateContext())
        {
            write.ExerciseRuntimeStates.Add(new ExerciseRuntimeState { ExerciseId = Guid.Empty, UpdatedAt = DateTimeOffset.UtcNow });
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses a runtime-state row with an empty ExerciseId — no per-entity code");
        }

        await using var verify = _fixture.CreateContext();
        (await verify.ExerciseRuntimeStates.IgnoreQueryFilters().CountAsync(s => s.ExerciseId == Guid.Empty))
            .Should().Be(0, "the guard throws before SaveChanges reaches the database");
    }

    // ---- PostEdit -------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task PostEditQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var editA = await SeedPostWithEditAsync(exerciseA);
        var editB = await SeedPostWithEditAsync(exerciseB);

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.PostEdits
            .Where(e => e.Id == editA.Id || e.Id == editB.Id)
            .Select(e => e.Id)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            editA.Id, "a read under exercise A must see only A's edit history — B's previous text must never leak");
    }

    [RequiresDockerFact]
    public async Task PostEdit_IdorByKnownCrossExerciseIds_ReturnsNull_AndCountsDoNotLeak()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var editA = await SeedPostWithEditAsync(exerciseA);
        var editB = await SeedPostWithEditAsync(exerciseB);

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));

        (await readA.PostEdits.FindAsync(editB.Id)).Should().BeNull(
            "FindAsync by exercise B's real edit id from an exercise-A scope must fail closed (IDOR)");
        (await readA.PostEdits.Where(e => e.PostId == editB.PostId).ToListAsync()).Should().BeEmpty(
            "the history read by B's post id (story 19's GET /edits shape) must be filtered out too");
        (await readA.PostEdits.FindAsync(editA.Id)).Should().NotBeNull("A's own edit still resolves");
        (await readA.PostEdits.CountAsync(e => e.PostId == editA.PostId || e.PostId == editB.PostId)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task PostEdit_UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowExists()
    {
        var edit = await SeedPostWithEditAsync(Guid.NewGuid());

        foreach (var scope in UnresolvedScopes())
        {
            await using var read = _fixture.CreateContext(scope);
            (await read.PostEdits.CountAsync(e => e.Id == edit.Id)).Should().Be(
                0, "an unresolved scope collapses to Guid.Empty, which no PostEdit can carry — zero rows, never all");
        }

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.PostEdits.IgnoreQueryFilters().CountAsync(e => e.Id == edit.Id)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task SavingAPostEdit_WithNoResolvedScope_ThrowsAndPersistsNothing()
    {
        var exerciseId = Guid.NewGuid();
        var post = NewPost(exerciseId);
        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(post);
            await seed.SaveChangesAsync();
        }

        var edit = NewEdit(Guid.Empty, post.Id);
        await using (var write = _fixture.CreateContext())
        {
            write.PostEdits.Add(edit);
            var act = async () => await write.SaveChangesAsync();
            await act.Should().ThrowAsync<ExerciseScopeViolationException>(
                "the central write guard refuses a PostEdit with an empty ExerciseId — no per-entity code needed");
        }

        await using var verify = _fixture.CreateContext();
        (await verify.PostEdits.IgnoreQueryFilters().CountAsync(e => e.Id == edit.Id)).Should().Be(
            0, "the guard throws before SaveChanges reaches the database");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private async Task<Guid> SeedExerciseWithRuntimeStateAsync(string tier)
    {
        var exerciseId = Guid.NewGuid();
        await using var seed = _fixture.CreateContext();
        seed.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            OrganizationId = Organization.DefaultOrganizationId,
            Name = $"DF17 isolation {exerciseId:N}",
        });
        seed.ExerciseRuntimeStates.Add(new ExerciseRuntimeState
        {
            ExerciseId = exerciseId,
            PauseTier = tier,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await seed.SaveChangesAsync();
        return exerciseId;
    }

    private async Task<PostEdit> SeedPostWithEditAsync(Guid exerciseId)
    {
        var post = NewPost(exerciseId);
        var edit = NewEdit(exerciseId, post.Id);
        await using var seed = _fixture.CreateContext();
        seed.Posts.Add(post);
        seed.PostEdits.Add(edit);
        await seed.SaveChangesAsync();
        return edit;
    }

    private static Post NewPost(Guid exerciseId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = "edited text",
        CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 0, 0, TimeSpan.Zero),
        Origin = "participant",
        ActingHumanId = "human-1",
        CreatedWallClock = DateTimeOffset.UtcNow,
        EditCount = 1,
    };

    private static PostEdit NewEdit(Guid exerciseId, Guid postId) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PostId = postId,
        EditNumber = 1,
        PreviousBody = $"original text {Guid.NewGuid():N}",
        EditedAt = DateTimeOffset.UtcNow,
        EditedScenarioTime = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.Zero),
        ActingHumanId = "human-1",
    };
}
