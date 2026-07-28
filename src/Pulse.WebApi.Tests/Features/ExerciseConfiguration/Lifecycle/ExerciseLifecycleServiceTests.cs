namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
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
        var exerciseId = await SeedAsync("build");

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
        var service = new ExerciseLifecycleService(
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
        var exerciseA = await SeedAsync("build");
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
        var service = new ExerciseLifecycleService(
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
        var service = new ExerciseLifecycleService(
            context,
            new ExerciseContext { CurrentExerciseId = missing },
            new StubCurrentStaffSessionAccessor(null));

        (await service.GetAsync()).Outcome.Should().Be(ExerciseLifecycleOutcome.NotFound);
    }

    private async Task<Guid> SeedAsync(string status)
    {
        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(ExerciseLifecycleTestData.ExerciseInState(exerciseId, status));
        await context.SaveChangesAsync();

        return exerciseId;
    }

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
        var service = new ExerciseLifecycleService(context, exerciseContext, staff);

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
