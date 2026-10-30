namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;

/// <summary>
/// The lifecycle service against REAL SQL Server: transitions persist the canonical literal, a refused
/// transition changes nothing, and an applied transition emits exactly one XC-004 envelope in the same unit
/// of work.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseLifecycleServiceTests
{
    private const string TransitionedEventType = "exercise.lifecycle.transitioned";

    private readonly MsSqlContainerFixture _fixture;

    public ExerciseLifecycleServiceTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>AC2: an allowed transition persists the new state on <c>Exercise.Status</c> itself (AC1).</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_AllowedTransition_PersistsTheNewStateOnTheStatusColumn()
    {
        var exerciseId = await SeedAsync("build", stageReady: true);

        var result = await TransitionAsync(exerciseId, "staged");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);
        result.Snapshot!.State.Should().Be("staged");
        (await ReadStatusAsync(exerciseId)).Should().Be(
            "staged", "the lifecycle lives on Exercise.Status — no parallel column, no projection layer (AC1)");
    }

    /// <summary>AC2: a disallowed transition is refused and NOTHING changes.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_DisallowedTransition_IsRefusedAndChangesNothing()
    {
        var exerciseId = await SeedAsync("build");

        var result = await TransitionAsync(exerciseId, "live");

        result.Outcome.Should().Be(
            ExerciseLifecycleOutcome.TransitionNotAllowed, "'build' -> 'live' skips Staged (COR-032)");
        result.Error.Should().Contain("not an allowed lifecycle transition");
        (await ReadStatusAsync(exerciseId)).Should().Be("build", "a refused transition must leave the state untouched");
        (await CountTransitionEventsAsync(exerciseId)).Should().Be(
            0, "the audit trail records what happened, not what was attempted");
    }

    /// <summary>A target outside the COR-032 vocabulary is a 400, not a 409 — and changes nothing.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_UnknownTargetLiteral_IsInvalidAndChangesNothing()
    {
        var exerciseId = await SeedAsync("live");

        var result = await TransitionAsync(exerciseId, "ended");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Invalid);
        (await ReadStatusAsync(exerciseId)).Should().Be("live");
    }

    /// <summary>AC8: exactly ONE v0 envelope, carrying from/to, the acting human, and server wall time.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_EmitsExactlyOneV0TelemetryEnvelopeWithTheFromAndToStates()
    {
        var exerciseId = await SeedAsync("live");
        var staffUserId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);

        var result = await TransitionAsync(exerciseId, "paused", staffUserId, sessionId);
        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);

        await using var context = _fixture.CreateContext();
        var events = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .ToListAsync();

        var telemetry = events.Should().ContainSingle(
            "exactly one XC-004 event per meaningful action").Which;

        telemetry.SchemaVersion.Should().Be("v0");
        telemetry.EventType.Should().Be(TransitionedEventType);
        telemetry.Channel.Should().Be("system");
        telemetry.Actor.Kind.Should().Be("system");
        telemetry.Actor.ActingHumanId.Should().Be(staffUserId.ToString(), "the acting staff human is on the envelope (AC8)");
        telemetry.Actor.SessionId.Should().Be(sessionId.ToString());
        telemetry.Target!.EntityType.Should().Be("exercise");
        telemetry.Target.EntityId.Should().Be(exerciseId.ToString());
        telemetry.TimeZone.Should().Be("UTC");
        telemetry.WallClockTime.Should().BeOnOrAfter(before, "wall clock is the SERVER clock, never client input");
        telemetry.ScenarioTime.Should().Be(telemetry.WallClockTime, "no scenario instant is persisted on this row yet");

        using var payload = JsonDocument.Parse(telemetry.Payload!);
        payload.RootElement.GetProperty("from").GetString().Should().Be("live");
        payload.RootElement.GetProperty("to").GetString().Should().Be("paused");
    }

    /// <summary>The persisted scenario instant is round-tripped, never re-derived from the server clock.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_StampsThePersistedScenarioInstant_RatherThanTheServerClock()
    {
        var exerciseId = Guid.NewGuid();
        var scenarioNow = new DateTimeOffset(2033, 3, 1, 9, 30, 0, TimeSpan.Zero);

        await using (var seed = _fixture.CreateContext())
        {
            var exercise = ExerciseLifecycleTestData.ExerciseInState(exerciseId, "live");
            exercise.CurrentScenarioTime = scenarioNow;
            seed.Exercises.Add(exercise);
            await seed.SaveChangesAsync();
        }

        await TransitionAsync(exerciseId, "completed");

        await using var context = _fixture.CreateContext();
        var telemetry = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(e => e.ExerciseId == exerciseId);

        telemetry.ScenarioTime.Should().Be(scenarioNow, "scenario time is the exercise's persisted instant (COR-053)");
    }

    /// <summary>A legacy row transitions as its canonical equivalent and HEALS to the COR-032 literal.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_ALegacyRow_TransitionsAsItsCanonicalEquivalentAndPersistsTheNewVocabulary()
    {
        var exerciseId = await SeedAsync("active");

        var result = await TransitionAsync(exerciseId, "paused");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok, "'active' folds onto 'live', from which 'paused' is allowed");
        (await ReadStatusAsync(exerciseId)).Should().Be(
            "paused", "a transition always persists a canonical COR-032 literal — never a legacy one");
    }

    /// <summary>A row carrying an unrecognized literal cannot be moved — 409, and nothing changes.</summary>
    [RequiresDockerFact]
    public async Task TransitionAsync_ARowWithAnUnknownStoredStatus_IsRefused()
    {
        var exerciseId = await SeedAsync("running");

        var result = await TransitionAsync(exerciseId, "live");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.TransitionNotAllowed);
        (await ReadStatusAsync(exerciseId)).Should().Be("running");
    }

    /// <summary>AC9 / fail closed: an unresolved scope reads and transitions nothing.</summary>
    [RequiresDockerFact]
    public async Task WithAnUnresolvedScope_ReadAndTransitionBothFailClosed()
    {
        var exerciseId = await SeedAsync("live");

        await using var context = _fixture.CreateContext();
        var service = NewService(
            context,
            new ExerciseContext { CurrentExerciseId = null },
            new StubCurrentStaffSessionAccessor(null));

        (await service.GetAsync()).Outcome.Should().Be(ExerciseLifecycleOutcome.ScopeUnresolved);
        (await service.GetCurrentStateAsync()).Should().BeNull();
        (await service.TransitionAsync(new ExerciseLifecycleTransitionRequest { To = "paused" })).Outcome
            .Should().Be(ExerciseLifecycleOutcome.ScopeUnresolved);

        (await ReadStatusAsync(exerciseId)).Should().Be("live", "an unresolved scope must not be able to move any exercise");
    }

    /// <summary>
    /// AC9 (isolation, always-Critical): the scope is the ONLY source of "which exercise". A service bound to
    /// exercise A cannot read or transition exercise B, even though <c>Exercise</c> is unfiltered.
    /// </summary>
    [RequiresDockerFact]
    public async Task TheScopeIsTheOnlyExerciseSelector_AServiceBoundToAneverTouchesB()
    {
        var exerciseA = await SeedAsync("build", stageReady: true);
        var exerciseB = await SeedAsync("live");

        var result = await TransitionAsync(exerciseA, "staged");
        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);
        result.Snapshot!.ExerciseId.Should().Be(exerciseA);

        (await ReadStatusAsync(exerciseA)).Should().Be("staged");
        (await ReadStatusAsync(exerciseB)).Should().Be(
            "live", "the Exercises table is NOT covered by the central query filter, so the scope is the only guard");

        await using var context = _fixture.CreateContext();
        var crossExerciseEvents = await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(e => e.ExerciseId == exerciseB);

        crossExerciseEvents.Should().Be(0, "no event may be stamped against an exercise the caller never resolved");
    }

    /// <summary>A read exposes the state, its allowed transitions and its behaviour hooks (AC7).</summary>
    [RequiresDockerFact]
    public async Task GetAsync_ExposesTheStateItsAllowedTransitionsAndItsBehaviourHooks()
    {
        var exerciseId = await SeedAsync("staged");

        await using var context = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var service = NewService(
            context,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            new StubCurrentStaffSessionAccessor(null));

        var snapshot = (await service.GetAsync()).Snapshot!;

        snapshot.State.Should().Be("staged");
        snapshot.StoredStatus.Should().Be("staged");
        snapshot.AllowedTransitions.Should().Equal(["live"]);
        snapshot.Behaviour.ClockRuns.Should().BeFalse("Staged: the clock has not started (AC7)");
        snapshot.Behaviour.ScenarioContentFires.Should().BeFalse("Staged: scheduled content is held (AC7)");
    }

    /// <summary>A resolved scope with no exercise row is a 404, not a silent success.</summary>
    [RequiresDockerFact]
    public async Task GetAsync_WithNoExerciseRowForTheResolvedScope_IsNotFound()
    {
        var missing = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        var service = NewService(
            context,
            new ExerciseContext { CurrentExerciseId = missing },
            new StubCurrentStaffSessionAccessor(null));

        (await service.GetAsync()).Outcome.Should().Be(ExerciseLifecycleOutcome.NotFound);
    }

    /// <summary>
    /// identity-auth-roles/16 (Copilot fold C): StartEx (staged → live) stamps Exercises.FirstLiveAt in the same unit of
    /// work as the transition, and a later resume (paused → live) never moves it.
    /// </summary>
    [RequiresDockerFact]
    public async Task StartEx_StampsFirstLiveAtOnce_AndAResumeNeverMovesIt()
    {
        var exerciseId = await SeedAsync("staged");

        var before = DateTimeOffset.UtcNow.AddSeconds(-1);
        (await TransitionAsync(exerciseId, "live")).Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);

        DateTimeOffset? stamped;
        await using (var read = _fixture.CreateContext())
        {
            stamped = (await read.Exercises.SingleAsync(e => e.Id == exerciseId)).FirstLiveAt;
            stamped.Should().NotBeNull("the first transition to live records when the exercise first ran");
            stamped!.Value.Should().BeOnOrAfter(before);
        }

        (await TransitionAsync(exerciseId, "paused")).Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);
        (await TransitionAsync(exerciseId, "live")).Outcome.Should().Be(ExerciseLifecycleOutcome.Ok);

        await using var after = _fixture.CreateContext();
        (await after.Exercises.SingleAsync(e => e.Id == exerciseId)).FirstLiveAt.Should().Be(
            stamped, "FirstLiveAt is the FIRST time — a resume after a pause never moves it");
    }

    // ---- exercise-build-golive/04: the stage readiness gate ----

    /// <summary>
    /// exercise-build-golive/04: a stage with an open blocking readiness item is refused with the open items only, and
    /// nothing changes — no state, no FirstLiveAt, no transition event.
    /// </summary>
    [RequiresDockerFact]
    public async Task Stage_WithAnOpenBlockingItem_IsRefusedWithTheOpenItems_AndChangesNothing()
    {
        // No controller, no participant access, no start time: three blocking items open.
        var exerciseId = await SeedAsync("build");

        var result = await TransitionAsync(exerciseId, "staged");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.ReadinessBlocked);
        result.Snapshot.Should().BeNull();
        result.OpenBlocking!.Select(i => i.Id).Should().Equal(
            ["controller-enrolled", "participant-access", "schedule-set"], "only the OPEN blocking items, in checklist order");
        result.OpenBlocking.Should().OnlyContain(i => i.Status == ReadinessItemStatuses.Open);
        (await ReadStatusAsync(exerciseId)).Should().Be("build", "a refused stage leaves the state untouched");
        (await CountTransitionEventsAsync(exerciseId)).Should().Be(0, "a refused stage emits no transition event");

        await using var read = _fixture.CreateContext();
        (await read.Exercises.AsNoTracking().SingleAsync(e => e.Id == exerciseId)).FirstLiveAt.Should().BeNull();
    }

    /// <summary>exercise-build-golive/04: notChecked blocking items never block a stage.</summary>
    [RequiresDockerFact]
    public async Task Stage_WithEveryEvaluableBlockingItemOk_AndNotCheckedItemsPresent_IsApplied()
    {
        var exerciseId = await SeedAsync("build", stageReady: true);

        var result = await TransitionAsync(exerciseId, "staged");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok, "participant-name and sign-in-methods are notChecked and never block");
        (await ReadStatusAsync(exerciseId)).Should().Be("staged");
        (await CountTransitionEventsAsync(exerciseId)).Should().Be(1);
    }

    /// <summary>exercise-build-golive/04: StartEx (staged → live) does NOT re-run the readiness check.</summary>
    [RequiresDockerFact]
    public async Task StartEx_WithAnOpenBlockingItem_IsStillApplied()
    {
        // Seeded straight into staged with every evaluable blocking item open.
        var exerciseId = await SeedAsync("staged");

        var result = await TransitionAsync(exerciseId, "live");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.Ok, "readiness is shown at StartEx, never enforced");
        (await ReadStatusAsync(exerciseId)).Should().Be("live");
    }

    /// <summary>
    /// exercise-build-golive/04 (isolation): another exercise's readiness rows never satisfy this exercise's gate.
    /// </summary>
    [RequiresDockerFact]
    public async Task Stage_IsJudgedOnlyOnTheResolvedExercise_AnotherExercisesReadinessNeverCounts()
    {
        var notReady = await SeedAsync("build");
        await SeedAsync("build", stageReady: true);

        var result = await TransitionAsync(notReady, "staged");

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.ReadinessBlocked);
        (await ReadStatusAsync(notReady)).Should().Be("build");
    }

    /// <summary>
    /// exercise-build-golive/04: the org-tier entry point names an exercise by id while the readiness checklist reads
    /// the resolved scope, so it cannot judge that exercise — staging there is refused outright (fail closed).
    /// </summary>
    [RequiresDockerFact]
    public async Task Stage_ThroughTheOrgTierEntryPoint_ForAnExerciseOtherThanTheScope_IsRefused()
    {
        var exerciseId = await SeedAsync("build", stageReady: true);

        var exerciseContext = new ExerciseContext { CurrentExerciseId = null };
        await using var context = _fixture.CreateContext(exerciseContext);
        var service = NewService(context, exerciseContext, new StubCurrentStaffSessionAccessor(null));

        var result = await service.TransitionTenantCheckedAsync(
            Organization.DefaultOrganizationId,
            exerciseId,
            new ExerciseLifecycleTransitionRequest { To = "staged" });

        result.Outcome.Should().Be(
            ExerciseLifecycleOutcome.TransitionNotAllowed, "no item was judged, so this is not a readiness-blocking 409");
        result.OpenBlocking.Should().BeNull();
        (await ReadStatusAsync(exerciseId)).Should().Be("build");
        (await CountTransitionEventsAsync(exerciseId)).Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Stage_ThroughTheOrgTierEntryPoint_WhileScopedToAnotherReadyExercise_IsRefused()
    {
        // Both exercises are stage-ready, so only the scope != target guard can refuse: a regression to a
        // null-scope-only check would stage the target on the OTHER exercise's checklist.
        var target = await SeedAsync("build", stageReady: true);
        var other = await SeedAsync("build", stageReady: true);

        var exerciseContext = new ExerciseContext { CurrentExerciseId = other };
        await using var context = _fixture.CreateContext(exerciseContext);
        var service = NewService(context, exerciseContext, new StubCurrentStaffSessionAccessor(null));

        var result = await service.TransitionTenantCheckedAsync(
            Organization.DefaultOrganizationId,
            target,
            new ExerciseLifecycleTransitionRequest { To = "staged" });

        result.Outcome.Should().Be(ExerciseLifecycleOutcome.TransitionNotAllowed);
        (await ReadStatusAsync(target)).Should().Be("build");
        (await ReadStatusAsync(other)).Should().Be("build");
        (await CountTransitionEventsAsync(target)).Should().Be(0);
    }

    private async Task<Guid> SeedAsync(string status, bool stageReady = false)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();

        if (stageReady)
        {
            await ExerciseLifecycleTestData.MakeStageReadyAsync(context, exerciseId);
        }

        return exerciseId;
    }

    private static ExerciseLifecycleService NewService(
        PulseDbContext context,
        ExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor staff) =>
        new(
            context,
            exerciseContext,
            staff,
            new NoOpExerciseLifecycleTransitionObserver(),
            NullLogger<ExerciseLifecycleService>.Instance,
            new ExerciseReadinessService(context, exerciseContext));

    private async Task<ExerciseLifecycleResult> TransitionAsync(
        Guid exerciseId,
        string to,
        Guid? staffUserId = null,
        Guid? sessionId = null)
    {
        var staff = staffUserId is null
            ? new StubCurrentStaffSessionAccessor(null)
            : new StubCurrentStaffSessionAccessor(new CurrentStaffSession
            {
                SessionId = sessionId ?? Guid.NewGuid(),
                StaffUserId = staffUserId.Value,
            });

        var exerciseContext = new ExerciseContext { CurrentExerciseId = exerciseId };

        await using var context = _fixture.CreateContext(exerciseContext);
        var service = NewService(context, exerciseContext, staff);

        return await service.TransitionAsync(new ExerciseLifecycleTransitionRequest { To = to });
    }

    private async Task<string> ReadStatusAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.Exercises.AsNoTracking().Where(e => e.Id == exerciseId).Select(e => e.Status).SingleAsync();
    }

    private async Task<int> CountTransitionEventsAsync(Guid exerciseId)
    {
        await using var context = _fixture.CreateContext();
        return await context.TelemetryEvents
            .IgnoreQueryFilters()
            .AsNoTracking()
            .CountAsync(e => e.ExerciseId == exerciseId && e.EventType == TransitionedEventType);
    }
}
