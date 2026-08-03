namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The resolved exercise's lifecycle state as every consumer sees it — the canonical COR-032 literal, the raw
/// stored value it came from, the transitions currently available, and the behaviour hooks the state implies.
/// </summary>
/// <param name="ExerciseId">The SERVER-resolved exercise (COR-001) — never a client parameter.</param>
/// <param name="State">The canonical COR-032 literal.</param>
/// <param name="StoredStatus">The raw <c>Exercise.Status</c> value, so a legacy row stays diagnosable.</param>
/// <param name="AllowedTransitions">The states reachable from <paramref name="State"/>.</param>
/// <param name="Behaviour">The per-state behaviour hooks (AC7).</param>
public sealed record ExerciseLifecycleSnapshot(
    Guid ExerciseId,
    string State,
    string StoredStatus,
    IReadOnlyList<string> AllowedTransitions,
    ExerciseLifecycleBehaviour Behaviour);

/// <summary>The outcome kind of an <see cref="ExerciseLifecycleService"/> call.</summary>
public enum ExerciseLifecycleOutcome
{
    /// <summary>The state was read, or the transition was applied — the endpoint returns 200.</summary>
    Ok,

    /// <summary>The requested target is not a COR-032 literal — the endpoint returns 400; nothing changed.</summary>
    Invalid,

    /// <summary>The machine does not allow the transition — the endpoint returns 409; nothing changed.</summary>
    TransitionNotAllowed,

    /// <summary>No exercise scope was resolved — the endpoint returns 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no <c>Exercise</c> row — the endpoint returns 404.</summary>
    NotFound,
}

/// <summary>
/// The result of an <see cref="ExerciseLifecycleService"/> call. <see cref="ExerciseLifecycleOutcome.Ok"/>
/// carries the snapshot; the two rejection outcomes carry a reason; the fail-closed outcomes carry neither.
/// </summary>
public sealed class ExerciseLifecycleResult
{
    private ExerciseLifecycleResult(
        ExerciseLifecycleOutcome outcome,
        ExerciseLifecycleSnapshot? snapshot,
        string? error)
    {
        Outcome = outcome;
        Snapshot = snapshot;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseLifecycleOutcome Outcome { get; }

    /// <summary>The lifecycle snapshot — non-null only for <see cref="ExerciseLifecycleOutcome.Ok"/>.</summary>
    public ExerciseLifecycleSnapshot? Snapshot { get; }

    /// <summary>The human-readable reason — non-null for the <c>400</c> and <c>409</c> outcomes.</summary>
    public string? Error { get; }

    /// <summary>A successful read or transition.</summary>
    /// <param name="snapshot">The (post-transition) lifecycle snapshot.</param>
    /// <returns>An OK result.</returns>
    public static ExerciseLifecycleResult Ok(ExerciseLifecycleSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return new ExerciseLifecycleResult(ExerciseLifecycleOutcome.Ok, snapshot, null);
    }

    /// <summary>A malformed request — nothing was persisted.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ExerciseLifecycleResult Invalid(string error) =>
        new(ExerciseLifecycleOutcome.Invalid, null, error);

    /// <summary>A transition the state machine refuses — nothing was persisted (AC2's 409).</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>A conflict result.</returns>
    public static ExerciseLifecycleResult TransitionNotAllowed(string error) =>
        new(ExerciseLifecycleOutcome.TransitionNotAllowed, null, error);

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ExerciseLifecycleResult ScopeUnresolved() =>
        new(ExerciseLifecycleOutcome.ScopeUnresolved, null, null);

    /// <summary>The result for a resolved scope with no backing exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static ExerciseLifecycleResult NotFound() =>
        new(ExerciseLifecycleOutcome.NotFound, null, null);
}

/// <summary>
/// <b>The single lifecycle read (COR-032) other features subscribe to</b> — <c>exercise-build-golive</c>
/// (transitions), <c>exercise-clock</c> (Live starts the clock), E8 (dormant until Live) and this story's own
/// gating middleware and shell projections. It owns both halves: reading the resolved exercise's state, and
/// applying a staff-driven transition through <see cref="ExerciseLifecycleStates"/>'s machine. Scoped
/// lifetime, matching the request-scoped <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central read-side query filter is a
/// NO-OP on the <c>Exercises</c> table — an unguarded lookup here would happily return, and transition,
/// ANOTHER exercise's row. The exercise is therefore taken ONLY from <see cref="IExerciseContext"/>. No method
/// on this type accepts an exercise id, and the transition request body carries none, so a cross-exercise
/// transition is structurally impossible rather than merely rejected; the endpoint layers the staff
/// assignment gate (403) on top.
/// </para>
/// <para>
/// <b>No schema, no migration (story 01a owns the column).</b> This service reads and writes
/// <c>Exercise.Status</c> itself — AC1's "no second vocabulary, no parallel lifecycle column, no projection
/// layer". It always PERSISTS a canonical COR-032 literal, so a legacy row heals the first time it moves.
/// </para>
/// <para>
/// <b>XC-004.</b> An applied transition emits exactly ONE <c>exercise.lifecycle.transitioned</c> v0 envelope
/// in the SAME unit of work as the status write (one <c>SaveChangesAsync</c>), stamped from a single server
/// clock read and carrying the from/to states plus the acting staff human. A REJECTED transition writes
/// nothing and emits nothing — the audit trail records what happened, not what was attempted.
/// </para>
/// </remarks>
public sealed class ExerciseLifecycleService
{
    private const string TransitionedEventType = "exercise.lifecycle.transitioned";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over persistence, the resolved scope, and the staff-session seam.</summary>
    /// <param name="dbContext">The persistence context the status is read and written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="currentStaffSession">Identifies the acting staff human for the XC-004 event.</param>
    public ExerciseLifecycleService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
    }

    /// <summary>
    /// Reads the resolved exercise's lifecycle state. Fails closed on an unresolved scope.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseLifecycleResult> GetAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return ExerciseLifecycleResult.ScopeUnresolved();
        }

        var stored = await ReadStoredStatusAsync(exerciseId, cancellationToken);

        return stored is null
            ? ExerciseLifecycleResult.NotFound()
            : ExerciseLifecycleResult.Ok(Snapshot(exerciseId, stored));
    }

    /// <summary>
    /// The hot, allocation-light read the gating middleware and the shell projections use: the resolved
    /// exercise's CANONICAL state literal, or <c>null</c> when the scope is unresolved or the row is missing.
    /// </summary>
    /// <remarks>
    /// Deliberately projects a single column rather than materializing the whole <see cref="Exercise"/> row —
    /// this runs on every gated participant request.
    /// </remarks>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The canonical state, or <c>null</c>.</returns>
    public async Task<string?> GetCurrentStateAsync(CancellationToken cancellationToken = default)
    {
        if (!TryResolveScope(out var exerciseId))
        {
            return null;
        }

        var stored = await ReadStoredStatusAsync(exerciseId, cancellationToken);
        if (stored is null)
        {
            return null;
        }

        // An unrecognized stored literal canonicalizes to nothing; report it verbatim so the CALLER decides
        // (every consumer here fails closed on an unknown state rather than guessing at one).
        return ExerciseLifecycleStates.TryParse(stored, out var canonical) ? canonical : stored;
    }

    /// <summary>
    /// Applies a staff-driven lifecycle transition to the resolved exercise. Validation and the machine both
    /// run BEFORE anything is written, so a rejected transition leaves the stored state untouched (AC2).
    /// </summary>
    /// <param name="request">The requested target state.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseLifecycleResult> TransitionAsync(
        ExerciseLifecycleTransitionRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!TryResolveScope(out var exerciseId))
        {
            return ExerciseLifecycleResult.ScopeUnresolved();
        }

        if (!ExerciseLifecycleStates.TryParse(request.To, out var target))
        {
            return ExerciseLifecycleResult.Invalid(
                $"'to' must be one of: {string.Join(", ", ExerciseLifecycleStates.All)}.");
        }

        // org-scope-exempt(ResolvedScope): exerciseId comes from the server-resolved scope, never the request
        // body (the body carries only the target state), so this lifecycle write stays inside the caller's tenant.
        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return ExerciseLifecycleResult.NotFound();
        }

        var storedBefore = exercise.Status;
        if (!ExerciseLifecycleStates.TryParse(storedBefore, out var from))
        {
            // A row carrying an unrecognized literal cannot be moved safely — the machine has no edge to
            // reason from. 409 (not 500): the world is in a state the state machine does not admit.
            return ExerciseLifecycleResult.TransitionNotAllowed(
                $"the exercise's stored status '{storedBefore}' is not a known lifecycle state, so no transition is allowed.");
        }

        if (!ExerciseLifecycleStates.IsTransitionAllowed(from, target))
        {
            var allowed = ExerciseLifecycleStates.AllowedTransitionsFrom(from);
            var allowedText = allowed.Count == 0
                ? $"'{from}' is a terminal state"
                : $"allowed from '{from}': {string.Join(", ", allowed)}";

            return ExerciseLifecycleResult.TransitionNotAllowed(
                $"'{from}' -> '{target}' is not an allowed lifecycle transition ({allowedText}).");
        }

        exercise.Status = target;

        // One server clock read shared by the entity write and its telemetry (never client input).
        var now = DateTimeOffset.UtcNow;
        var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);

        _dbContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = TransitionedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,

                // Off-envelope empty strings are null-omitted: the v0 schema types actingHumanId as an
                // optional NON-EMPTY string, so an unknown staff id is null, never "".
                ActingHumanId = staff?.StaffUserId.ToString(),
                SessionId = staff?.SessionId.ToString(),
            },
            WallClockTime = now,

            // Scenario time is the exercise's stored instant (the documented B2/B3 placeholder), never
            // re-derived from the server clock when one is persisted (COR-053).
            ScenarioTime = exercise.CurrentScenarioTime ?? now,
            TimeZone = exercise.TimeZone,
            Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
            Payload = JsonSerializer.Serialize(new LifecycleTransitionPayload
            {
                From = from,
                To = target,
                StoredStatusBefore = storedBefore,
            }),
            EmittedAt = now,
        });

        // ONE unit of work: the status change and its audit event commit together or not at all.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ExerciseLifecycleResult.Ok(Snapshot(exerciseId, target));
    }

    /// <summary>Builds the snapshot for a stored status value.</summary>
    private static ExerciseLifecycleSnapshot Snapshot(Guid exerciseId, string storedStatus)
    {
        var canonical = ExerciseLifecycleStates.TryParse(storedStatus, out var parsed) ? parsed : storedStatus;

        return new ExerciseLifecycleSnapshot(
            exerciseId,
            canonical,
            storedStatus,
            ExerciseLifecycleStates.AllowedTransitionsFrom(storedStatus),
            ExerciseLifecycleStates.BehaviourOf(storedStatus));
    }

    /// <summary>Reads just the status column of the SERVER-RESOLVED exercise, or <c>null</c> when absent.</summary>
    private async Task<string?> ReadStoredStatusAsync(Guid exerciseId, CancellationToken cancellationToken) =>
        // org-scope-exempt(ResolvedScope): every caller passes the SERVER-RESOLVED exercise id (see the
        // summary above), never a client value, so this status read cannot reach another customer's row.
        await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => e.Status)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The fail-closed scope check: an unset scope collapses to <see cref="Guid.Empty"/> and is refused.</summary>
    private bool TryResolveScope(out Guid exerciseId)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        exerciseId = scope ?? Guid.Empty;
        return exerciseId != Guid.Empty;
    }

    /// <summary>The opaque XC-004 payload: the from/to states of the applied transition.</summary>
    private sealed class LifecycleTransitionPayload
    {
        [JsonPropertyName("from")]
        public required string From { get; init; }

        [JsonPropertyName("to")]
        public required string To { get; init; }

        /// <summary>The raw stored value before the write — non-canonical only for a legacy row.</summary>
        [JsonPropertyName("storedStatusBefore")]
        public required string StoredStatusBefore { get; init; }
    }
}
