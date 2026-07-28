namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>The outcome kind of a <see cref="PracticeModeService"/> call.</summary>
public enum PracticeModeOutcome
{
    /// <summary>The flag was read or written — the endpoint returns 200 with the practice-mode body.</summary>
    Ok,

    /// <summary>The request failed validation — the endpoint returns 400 and NOTHING was written.</summary>
    Invalid,

    /// <summary>No exercise scope was resolved — the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no <c>Exercise</c> row — the endpoint returns 404.</summary>
    NotFound,
}

/// <summary>
/// The result of a <see cref="PracticeModeService"/> call. <see cref="PracticeModeOutcome.Ok"/> carries the
/// state; <see cref="PracticeModeOutcome.Invalid"/> carries a reason; the fail-closed outcomes carry neither.
/// </summary>
public sealed class PracticeModeResult
{
    private PracticeModeResult(PracticeModeOutcome outcome, PracticeModeDto? state, string? validationError)
    {
        Outcome = outcome;
        State = state;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public PracticeModeOutcome Outcome { get; }

    /// <summary>The practice-mode state — non-null only when <see cref="Outcome"/> is <see cref="PracticeModeOutcome.Ok"/>.</summary>
    public PracticeModeDto? State { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="PracticeModeOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read or write.</summary>
    /// <param name="state">The current practice-mode state.</param>
    /// <returns>An OK result.</returns>
    public static PracticeModeResult Ok(PracticeModeDto state)
    {
        ArgumentNullException.ThrowIfNull(state);
        return new PracticeModeResult(PracticeModeOutcome.Ok, state, null);
    }

    /// <summary>A rejected write — nothing was persisted.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static PracticeModeResult Invalid(string validationError) =>
        new(PracticeModeOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static PracticeModeResult ScopeUnresolved() =>
        new(PracticeModeOutcome.ScopeUnresolved, null, null);

    /// <summary>The result for a resolved scope with no backing exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static PracticeModeResult NotFound() =>
        new(PracticeModeOutcome.NotFound, null, null);
}

/// <summary>
/// Staff read/write of the COR-033 practice/sandbox flag behind <c>GET/PUT /api/staff/practice-mode</c>.
/// Scoped lifetime, matching the request-scoped <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-002).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central query filter does NOT cover the
/// <c>Exercises</c> table. The exercise is taken ONLY from <see cref="IExerciseContext"/> — the server-held
/// active-exercise selection for a staff caller — and the request body carries no exercise id at all, so a
/// cross-exercise write is structurally impossible rather than merely rejected.
/// </para>
/// <para>
/// <b>The flag changes NOTHING else (the story's "otherwise fully functional" guarantee).</b> Setting it
/// writes one column. No channel is disabled, no engine behaviour is altered, and no other telemetry is
/// suppressed, re-tagged or re-routed: a rehearsal must run exactly like real conduct or it is not a
/// rehearsal. The only consumer of the flag is <see cref="IEvaluationEligibility"/>, which E10's export
/// filtering will read.
/// </para>
/// <para>
/// <b>XC-004.</b> A write that actually flips the flag emits exactly ONE <c>exercise.practice_mode.updated</c>
/// telemetry event in the SAME unit of work as the mutation (one <c>SaveChangesAsync</c>), stamped from a
/// single server clock read. A write that changes nothing persists nothing and emits nothing. This is the
/// audit record of a staff decision — it is not the flag changing anyone else's telemetry.
/// </para>
/// <para>
/// <b>Eligibility is never re-derived here.</b> Both the read and the write project their response through
/// <see cref="IEvaluationEligibility"/>, so the staff console and E10 answer the question from the same one
/// seam.
/// </para>
/// </remarks>
public sealed class PracticeModeService
{
    private const string PracticeModeUpdatedEventType = "exercise.practice_mode.updated";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly IEvaluationEligibility _evaluationEligibility;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over persistence, the resolved scope, the eligibility seam and the staff session.</summary>
    /// <param name="dbContext">The persistence context the flag is read and written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="evaluationEligibility">The single evaluation-eligibility seam (never re-derived locally).</param>
    /// <param name="currentStaffSession">Identifies the acting staff human for the XC-004 event.</param>
    public PracticeModeService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        IEvaluationEligibility evaluationEligibility,
        ICurrentStaffSessionAccessor currentStaffSession)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(evaluationEligibility);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _evaluationEligibility = evaluationEligibility;
        _currentStaffSession = currentStaffSession;
    }

    /// <summary>Reads the resolved exercise's practice/sandbox state. Fails closed on an unresolved scope.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<PracticeModeResult> GetAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return PracticeModeResult.ScopeUnresolved();
        }

        var stored = await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => (bool?)e.IsPracticeMode)
            .FirstOrDefaultAsync(cancellationToken);

        if (stored is null)
        {
            return PracticeModeResult.NotFound();
        }

        var verdict = await _evaluationEligibility.GetVerdictAsync(cancellationToken);
        return PracticeModeResult.Ok(PracticeModeDto.From(exerciseId, stored.Value, verdict));
    }

    /// <summary>
    /// Sets or clears the resolved exercise's COR-033 practice/sandbox flag. A request with no
    /// <c>isPracticeMode</c> value is rejected with a reason and persists nothing.
    /// </summary>
    /// <param name="request">The requested flag value.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<PracticeModeResult> UpdateAsync(
        UpdatePracticeModeRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return PracticeModeResult.ScopeUnresolved();
        }

        if (request.IsPracticeMode is not { } requested)
        {
            return PracticeModeResult.Invalid("isPracticeMode is required (true or false).");
        }

        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return PracticeModeResult.NotFound();
        }

        if (exercise.IsPracticeMode != requested)
        {
            exercise.IsPracticeMode = requested;

            var now = DateTimeOffset.UtcNow;
            var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);

            _dbContext.TelemetryEvents.Add(new TelemetryEvent
            {
                EventId = Guid.NewGuid().ToString(),
                SchemaVersion = "v0",
                ExerciseId = exerciseId,
                EventType = PracticeModeUpdatedEventType,
                Channel = SystemChannel,
                Actor = new TelemetryActor
                {
                    Kind = SystemActorKind,

                    // Off-envelope empty strings are null-omitted: the v0 schema types actingHumanId as an
                    // optional non-empty string, so an unknown staff id is null, never "".
                    ActingHumanId = staff?.StaffUserId.ToString(),
                    SessionId = staff?.SessionId.ToString(),
                },
                WallClockTime = now,
                ScenarioTime = exercise.CurrentScenarioTime ?? now,
                TimeZone = exercise.TimeZone,
                Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
                Payload = JsonSerializer.Serialize(new PracticeModeUpdatedPayload { IsPracticeMode = requested }),
                EmittedAt = now,
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var verdict = await _evaluationEligibility.GetVerdictAsync(cancellationToken);
        return PracticeModeResult.Ok(PracticeModeDto.From(exerciseId, requested, verdict));
    }

    /// <summary>The fail-closed scope check: an unset scope collapses to <see cref="Guid.Empty"/> and is refused.</summary>
    private bool TryResolveScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    /// <summary>The opaque XC-004 payload: the value the flag was set to.</summary>
    private sealed class PracticeModeUpdatedPayload
    {
        [JsonPropertyName("isPracticeMode")]
        public required bool IsPracticeMode { get; init; }
    }
}
