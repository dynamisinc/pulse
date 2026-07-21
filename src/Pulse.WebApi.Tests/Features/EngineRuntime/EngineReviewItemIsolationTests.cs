namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// Extends the standing cross-exercise isolation suite (COR-001, always-Critical) to the new
/// <see cref="EngineReviewItemEntity"/> and its <see cref="EngineReviewStore"/>, against a REAL SQL Server
/// (Testcontainers) — proving the new scoped entity inherits the central read filter + write guard, and
/// that the store fails closed. Also proves the EF migration applies (the fixture migrates the container).
/// Every test is <see cref="RequiresDockerFactAttribute"/> — a real <c>Skipped</c> on a Docker-less machine,
/// never a silent <c>Passed</c>. Fresh <see cref="Guid.NewGuid"/> ids per test keep them independent.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class EngineReviewItemIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public EngineReviewItemIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private static IExerciseContext ScopeFor(Guid exerciseId) =>
        new ExerciseContext { CurrentExerciseId = exerciseId };

    private static EngineReviewItemEntity NewReviewItem(Guid draftId, Guid exerciseId) => new()
    {
        DraftId = draftId,
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = AutonomyLevel.DelayedAuto,
        Disposition = DraftDisposition.CountingDown,
        CountdownStartedScenarioMinute = 12,
        CountdownMinutes = 5,
        CountdownDecision = ControllerDecision.None,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost>
        {
            new()
            {
                PersonaHandle = "@mvega_fh",
                Text = "Water pressure is dropping on the east side.",
                Sentiment = -0.4,
                Hashtags = new List<string> { "#WaterIssues" },
            },
        },
    };

    [RequiresDockerFact]
    public async Task ReviewItemQuery_InExerciseA_ReturnsOnlyExerciseARows()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.EngineReviewItems.Add(NewReviewItem(draftA, exerciseA));
            seed.EngineReviewItems.Add(NewReviewItem(draftB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var visible = await readA.EngineReviewItems
            .Where(item => item.DraftId == draftA || item.DraftId == draftB)
            .Select(item => item.DraftId)
            .ToListAsync();

        visible.Should().ContainSingle().Which.Should().Be(
            draftA, "a query in exercise A must see only exercise A's review item, never exercise B's");
    }

    [RequiresDockerFact]
    public async Task UnsetScope_ReturnsZeroReviewItems_FailClosed()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.EngineReviewItems.Add(NewReviewItem(draftId, exerciseId));
            await seed.SaveChangesAsync();
        }

        // No scope resolved → Guid.Empty scope → zero rows (fail closed), never all exercises.
        await using var read = _fixture.CreateContext((IExerciseContext?)null);
        (await read.EngineReviewItems.CountAsync(item => item.DraftId == draftId)).Should().Be(
            0, "an unresolved scope collapses to Guid.Empty, which matches no scoped review item — fail closed");

        // Prove the row physically exists, so the zero above is the filter closing the door, not an empty table.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.EngineReviewItems.IgnoreQueryFilters().CountAsync(item => item.DraftId == draftId))
            .Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task IgnoreQueryFilters_RevealsBothExercises_ProvingScopingIsTheFilter()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.EngineReviewItems.Add(NewReviewItem(draftA, exerciseA));
            seed.EngineReviewItems.Add(NewReviewItem(draftB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        (await readA.EngineReviewItems.CountAsync(i => i.DraftId == draftA || i.DraftId == draftB)).Should().Be(
            1, "the query filter confines a scope-A read to exercise A");
        (await readA.EngineReviewItems.IgnoreQueryFilters().CountAsync(i => i.DraftId == draftA || i.DraftId == draftB))
            .Should().Be(2, "ignoring the filter reveals BOTH rows exist — the scoping is the filter, not missing data");
    }

    [RequiresDockerFact]
    public async Task IdorAttempt_FindByKnownCrossExerciseDraftId_ReturnsNull()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.EngineReviewItems.Add(NewReviewItem(draftA, exerciseA));
            seed.EngineReviewItems.Add(NewReviewItem(draftB, exerciseB));
            await seed.SaveChangesAsync();
        }

        await using var readA = _fixture.CreateContext(ScopeFor(exerciseA));
        var store = new EngineReviewStore(readA);

        (await store.FindAsync(draftB)).Should().BeNull(
            "an IDOR by exercise B's real draft id, from an exercise-A scope, must fail closed");
        (await store.FindAsync(draftA)).Should().NotBeNull(
            "the caller's own exercise A review item must still resolve — proving the null above is isolation, not a broken Find");
    }

    [RequiresDockerFact]
    public async Task WriteGuard_RejectsReviewItemWithEmptyExerciseId_AndWritesNoRow()
    {
        var draftId = Guid.NewGuid();

        await using var writeContext = _fixture.CreateContext();
        writeContext.EngineReviewItems.Add(NewReviewItem(draftId, Guid.Empty));

        var act = async () => await writeContext.SaveChangesAsync();

        await act.Should().ThrowAsync<ExerciseScopeViolationException>(
            "the write-time guard must reject a scoped review item with a default ExerciseId before it reaches the database");

        await using var verify = _fixture.CreateContext();
        (await verify.EngineReviewItems.IgnoreQueryFilters().CountAsync(i => i.DraftId == draftId)).Should().Be(
            0, "the rejected review item must never have been written to the database");
    }

    [RequiresDockerFact]
    public async Task Store_EnqueueThenGetQueue_RoundTripsPostsAndCountdown_WithinScope()
    {
        var exerciseId = Guid.NewGuid();
        var draftId = Guid.NewGuid();

        await using (var writeContext = _fixture.CreateContext(ScopeFor(exerciseId)))
        {
            var store = new EngineReviewStore(writeContext);
            await store.EnqueueAsync(NewReviewItem(draftId, exerciseId));
        }

        await using var readContext = _fixture.CreateContext(ScopeFor(exerciseId));
        var queue = await new EngineReviewStore(readContext).GetQueueAsync();

        var item = queue.Should().ContainSingle().Subject;
        item.DraftId.Should().Be(draftId);
        item.CountdownStartedScenarioMinute.Should().Be(12);
        item.CountdownMinutes.Should().Be(5);
        item.Posts.Should().ContainSingle().Which.PersonaHandle.Should().Be("@mvega_fh");
        item.Posts[0].Hashtags.Should().ContainSingle().Which.Should().Be("#WaterIssues");
    }

    [RequiresDockerFact]
    public async Task Store_UpdateDisposition_MutatesWithinScope_ButNotCrossExercise()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var draftA = Guid.NewGuid();
        var draftB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.EngineReviewItems.Add(NewReviewItem(draftA, exerciseA));
            seed.EngineReviewItems.Add(NewReviewItem(draftB, exerciseB));
            await seed.SaveChangesAsync();
        }

        // From exercise A's scope, mutating A's own item succeeds; mutating B's fails closed (not visible).
        await using (var writeA = _fixture.CreateContext(ScopeFor(exerciseA)))
        {
            var storeA = new EngineReviewStore(writeA);
            (await storeA.UpdateDispositionAsync(draftA, DraftDisposition.Published, ControllerDecision.Approved))
                .Should().BeTrue("the caller's own review item must be updatable");
            (await storeA.UpdateDispositionAsync(draftB, DraftDisposition.Vetoed))
                .Should().BeFalse("exercise B's review item is not visible under exercise A's scope — fail closed");
        }

        await using var verify = _fixture.CreateContext();
        var a = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftA);
        var b = await verify.EngineReviewItems.IgnoreQueryFilters().SingleAsync(i => i.DraftId == draftB);
        a.Disposition.Should().Be(DraftDisposition.Published);
        a.CountdownDecision.Should().Be(ControllerDecision.Approved);
        b.Disposition.Should().Be(DraftDisposition.CountingDown, "exercise B's item must be untouched by an exercise-A caller");
    }
}
