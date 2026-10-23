namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Readiness;
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

    /// <summary>
    /// exercise-build-golive/04: a stage (build → staged) refused because a blocking readiness item is open — the
    /// endpoint returns 409 with the open items; nothing changed.
    /// </summary>
    ReadinessBlocked,
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
        string? error,
        IReadOnlyList<ReadinessItem>? openBlocking = null)
    {
        Outcome = outcome;
        Snapshot = snapshot;
        Error = error;
        OpenBlocking = openBlocking;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseLifecycleOutcome Outcome { get; }

    /// <summary>The lifecycle snapshot — non-null only for <see cref="ExerciseLifecycleOutcome.Ok"/>.</summary>
    public ExerciseLifecycleSnapshot? Snapshot { get; }

    /// <summary>The human-readable reason — non-null for the <c>400</c> and <c>409</c> outcomes.</summary>
    public string? Error { get; }

    /// <summary>
    /// The open blocking readiness items — non-null only for <see cref="ExerciseLifecycleOutcome.ReadinessBlocked"/>.
    /// </summary>
    public IReadOnlyList<ReadinessItem>? OpenBlocking { get; }

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

    /// <summary>A stage refused by the readiness gate (exercise-build-golive/04) — nothing was persisted.</summary>
    /// <param name="message">The short human-readable reason.</param>
    /// <param name="openBlocking">The blocking items that are open.</param>
    /// <returns>A readiness-blocked result.</returns>
    public static ExerciseLifecycleResult ReadinessBlocked(string message, IReadOnlyList<ReadinessItem> openBlocking)
    {
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(openBlocking);
        return new ExerciseLifecycleResult(ExerciseLifecycleOutcome.ReadinessBlocked, null, message, openBlocking);
    }

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
/// ANOTHER exercise's row. The exercise therefore has exactly TWO provenances, and no other: (1) every PUBLIC
/// method takes it ONLY from <see cref="IExerciseContext"/> (no public method accepts an exercise id, and the
/// transition request body carries none, so a cross-exercise transition is structurally impossible rather than
/// merely rejected; the endpoint layers the staff assignment gate (403) on top); and (2) the INTERNAL
/// <see cref="TransitionTenantCheckedAsync"/>, used only by the org-tier archive row action
/// (<c>ExerciseLifecycleAdmin.ExerciseManagementService</c>, demo-feedback story 22), which takes an exercise id
/// together with the caller's server-resolved organization and re-bounds its own read with
/// <c>InOrganization(...)</c>, so another customer's exercise reads as not found there too.
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
/// <para>
/// <b>After the commit (#390).</b> An applied transition then notifies the one
/// <see cref="IExerciseLifecycleTransitionObserver"/> (world-steering pushes the participant overlay from it), best
/// effort: after the commit, with <see cref="CancellationToken.None"/>, and with any failure logged and swallowed —
/// the transition has already happened, so a broken notification must never report it as failed.
/// <b>The stage readiness gate (exercise-build-golive/04).</b> A transition whose target is <c>staged</c> first runs
/// <see cref="ExerciseReadinessService"/> and is refused (<see cref="ExerciseLifecycleOutcome.ReadinessBlocked"/>, no
/// write, no event) while any blocking item is <c>open</c>; <c>notChecked</c> items never block. The checklist reads
/// <see cref="IExerciseContext"/>, so the gate only evaluates when the exercise being moved IS the resolved scope;
/// otherwise (the org-tier entry point naming an exercise other than the scope) staging is refused outright rather
/// than judged against a different exercise's checklist. StartEx and every other transition are not gated.
/// </para>
/// </remarks>
public sealed partial class ExerciseLifecycleService
{
    private const string TransitionedEventType = "exercise.lifecycle.transitioned";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly IExerciseLifecycleTransitionObserver _transitionObserver;
    private readonly ILogger<ExerciseLifecycleService> _logger;
    private readonly ExerciseReadinessService _readiness;

    /// <summary>Creates the service over persistence, the resolved scope, the staff-session seam and readiness.</summary>
    /// <param name="dbContext">The persistence context the status is read and written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    /// <param name="currentStaffSession">Identifies the acting staff human for the XC-004 event.</param>
    /// <param name="transitionObserver">Notified, best effort, after an applied transition commits (#390).</param>
    /// <param name="logger">Logs a failed post-commit notification.</param>
    /// <param name="readiness">The go-live checklist the stage transition is gated on (exercise-build-golive/04).</param>
    public ExerciseLifecycleService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        IExerciseLifecycleTransitionObserver transitionObserver,
        ILogger<ExerciseLifecycleService> logger,
        ExerciseReadinessService readiness)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(transitionObserver);
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentNullException.ThrowIfNull(readiness);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _transitionObserver = transitionObserver;
        _logger = logger;
        _readiness = readiness;
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

        // org-scope-exempt(ResolvedScope): the SERVER-resolved exercise id, never a client value.
        var row = await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => new { e.Status, e.FirstLiveAt })
            .FirstOrDefaultAsync(cancellationToken);

        return row is null
            ? ExerciseLifecycleResult.NotFound()
            : ExerciseLifecycleResult.Ok(Snapshot(exerciseId, row.Status, row.FirstLiveAt));
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
        // (The one other way in, TransitionTenantCheckedAsync, carries its own InOrganization bound below.)
        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        return await ApplyTransitionAsync(exercise, target, actorRole: null, cancellationToken);
    }

    /// <summary>
    /// Applies a lifecycle transition to an exercise named by id, for the ORG-TIER row actions only
    /// (demo-feedback story 22's archive). This is the second, tenant-checked provenance the class remarks name:
    /// the read is bounded by <paramref name="organizationId"/> — the caller's SERVER-resolved tenant, never a
    /// request value — so another customer's exercise is <see cref="ExerciseLifecycleOutcome.NotFound"/> here,
    /// exactly like an id that does not exist. Everything after the read is the same machine and the same single
    /// unit of work as <see cref="TransitionAsync"/>.
    /// </summary>
    /// <param name="organizationId">The caller's server-resolved customer tenant.</param>
    /// <param name="exerciseId">The exercise to move (a route value the caller has already tenant-checked).</param>
    /// <param name="request">The requested target state.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the caller maps to a status.</returns>
    /// <param name="actorRole">The caller's role for the XC-004 actor (identity-auth-roles/17), e.g. <c>orgAdmin</c>.</param>
    internal async Task<ExerciseLifecycleResult> TransitionTenantCheckedAsync(
        Guid organizationId,
        Guid exerciseId,
        ExerciseLifecycleTransitionRequest request,
        string? actorRole = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (organizationId == Guid.Empty || exerciseId == Guid.Empty)
        {
            return ExerciseLifecycleResult.NotFound();
        }

        if (!ExerciseLifecycleStates.TryParse(request.To, out var target))
        {
            return ExerciseLifecycleResult.Invalid(
                $"'to' must be one of: {string.Join(", ", ExerciseLifecycleStates.All)}.");
        }

        var exercise = await _dbContext.Exercises
            .InOrganization(organizationId)
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        return await ApplyTransitionAsync(exercise, target, actorRole, cancellationToken);
    }

    /// <summary>
    /// The shared transition step: runs the machine against the loaded row and, when allowed, stages the status
    /// change and its one audit event and saves them together. Nothing is written on any refusal.
    /// </summary>
    private async Task<ExerciseLifecycleResult> ApplyTransitionAsync(
        Exercise? exercise,
        string target,
        string? actorRole,
        CancellationToken cancellationToken)
    {
        if (exercise is null)
        {
            return ExerciseLifecycleResult.NotFound();
        }

        var exerciseId = exercise.Id;

        var storedBefore = exercise.Status;
        if (!ExerciseLifecycleStates.TryParse(storedBefore, out var from))
        {
            // A row carrying an unrecognized literal cannot be moved safely — the machine has no edge to
            // reason from. 409 (not 500): the world is in a state the state machine does not admit.
            return ExerciseLifecycleResult.TransitionNotAllowed(
                $"the exercise's stored status '{storedBefore}' is not a known lifecycle state, so no transition is allowed.");
        }

        if (!IsAllowed(from, target, exercise.FirstLiveAt))
        {
            var allowed = AllowedFrom(from, exercise.FirstLiveAt);
            var allowedText = allowed.Count == 0
                ? $"'{from}' is a terminal state"
                : $"allowed from '{from}': {string.Join(", ", allowed)}";

            return ExerciseLifecycleResult.TransitionNotAllowed(
                $"'{from}' -> '{target}' is not an allowed lifecycle transition ({allowedText}).");
        }

        // exercise-build-golive/04: the stage readiness gate, BEFORE any mutation. Only the staged target is gated;
        // StartEx (staged -> live) shows readiness at the decision but never re-runs it.
        if (string.Equals(target, ExerciseLifecycleStates.Staged, StringComparison.Ordinal))
        {
            var refusal = await CheckStageReadinessAsync(exerciseId, cancellationToken);
            if (refusal is not null)
            {
                return refusal;
            }
        }

        exercise.Status = target;

        // One server clock read shared by the entity write and its telemetry (never client input).
        var now = DateTimeOffset.UtcNow;
        var staff = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);

        // identity-auth-roles/17 (ADMIN-IDENTITY-MODEL §5.2): the event carries the actor's role. The org tier passes it;
        // in-exercise it is the caller's own live staff enrollment on this exercise (null-omitted when there is none).
        actorRole ??= staff is null
            ? null
            : await _dbContext.Enrollments
                .Active()
                .AsNoTracking()
                .Where(EnrollmentRoles.IsStaffEnrollment)
                .Where(e => e.ExerciseId == exerciseId && e.PersonId == staff.StaffUserId)
                .Select(e => e.Role)
                .FirstOrDefaultAsync(cancellationToken);

        // identity-auth-roles/16 (ADMIN-IDENTITY-MODEL §9): the first time an exercise goes live is recorded once and
        // never moved (the AdminIdentityFoundation migration backfilled it for exercises already past staged).
        if (string.Equals(target, ExerciseLifecycleStates.Live, StringComparison.Ordinal) && exercise.FirstLiveAt is null)
        {
            exercise.FirstLiveAt = now;
        }

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
                Role = string.IsNullOrEmpty(actorRole) ? null : actorRole,
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

        // #390: ONLY after a successful commit (every refusal returned above, and a failed save threw). Best effort.
        await NotifyTransitionedAsync(exercise, from);

        return ExerciseLifecycleResult.Ok(Snapshot(exerciseId, target, exercise.FirstLiveAt));
    }

    /// <summary>
    /// Tells the <see cref="IExerciseLifecycleTransitionObserver"/> about a COMMITTED transition. Never throws: the
    /// change has already happened, so a failure here is logged and swallowed rather than surfaced as a failed
    /// transition. <see cref="CancellationToken.None"/> on purpose — a client aborting after the commit must not
    /// suppress the announcement of a change that did happen.
    /// </summary>
    private async Task NotifyTransitionedAsync(Exercise exercise, string from)
    {
        try
        {
            await _transitionObserver.OnTransitionedAsync(exercise, from, CancellationToken.None);
        }
#pragma warning disable CA1031 // Best effort by design: the transition has committed; nothing here may undo or fail it.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            LogTransitionObserverFailed(ex, exercise.Id, from, exercise.Status);
        }
    }

    /// <summary>Source-generated warning for a failed post-commit notification (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The lifecycle transition of exercise {ExerciseId} ({From} -> {To}) COMMITTED, but notifying its " +
                  "transition observer failed; connected participants may not see the change until they re-read it.")]
    private partial void LogTransitionObserverFailed(Exception exception, Guid exerciseId, string from, string to);

    /// The stage gate: <c>null</c> when the exercise may be staged, else the refusal. Read-only — it writes nothing.
    /// </summary>
    /// <remarks>
    /// The checklist is computed from <see cref="IExerciseContext"/> (COR-001), never from an exercise id. So when the
    /// exercise being moved is not the resolved scope (only reachable through the org-tier
    /// <see cref="TransitionTenantCheckedAsync"/>), the checklist would describe a DIFFERENT exercise; rather than judge
    /// one exercise by another's readiness, staging is refused there (fail closed).
    /// </remarks>
    private async Task<ExerciseLifecycleResult?> CheckStageReadinessAsync(
        Guid exerciseId,
        CancellationToken cancellationToken)
    {
        if (_exerciseContext.CurrentExerciseId != exerciseId)
        {
            // Not ReadinessBlocked: that 409 body always means "these items are open", and none were judged.
            return ExerciseLifecycleResult.TransitionNotAllowed(
                "Readiness can only be checked from inside the exercise, so it cannot be staged from here.");
        }

        var readiness = await _readiness.GetAsync(cancellationToken);
        return readiness.Outcome switch
        {
            ExerciseReadinessOutcome.Ok when readiness.Report!.Ready => null,
            ExerciseReadinessOutcome.Ok => ExerciseLifecycleResult.ReadinessBlocked(
                "The exercise cannot be staged while blocking readiness items are open.",
                readiness.Report!.OpenBlocking),
            ExerciseReadinessOutcome.NotFound => ExerciseLifecycleResult.NotFound(),

            // Unreachable (the scope matched a loaded row above); fail closed rather than stage unchecked.
            _ => ExerciseLifecycleResult.ScopeUnresolved(),
        };
    }

    /// <summary>Builds the snapshot for a stored status value.</summary>
    private static ExerciseLifecycleSnapshot Snapshot(Guid exerciseId, string storedStatus, DateTimeOffset? firstLiveAt)
    {
        var canonical = ExerciseLifecycleStates.TryParse(storedStatus, out var parsed) ? parsed : storedStatus;

        return new ExerciseLifecycleSnapshot(
            exerciseId,
            canonical,
            storedStatus,
            AllowedFrom(storedStatus, firstLiveAt),
            ExerciseLifecycleStates.BehaviourOf(storedStatus));
    }

    /// <summary>
    /// Whether the edge exists for this exercise: the state machine's edges, plus <c>build → archived</c> once the
    /// exercise has ever gone live (<c>FirstLiveAt</c> set — a reset exercise being retired; ADMIN-IDENTITY-MODEL §5.1,
    /// identity-auth-roles/17).
    /// </summary>
    internal static bool IsAllowed(string? from, string target, DateTimeOffset? firstLiveAt) =>
        AllowedFrom(from, firstLiveAt).Contains(target, StringComparer.Ordinal);

    /// <summary>The states reachable from <paramref name="from"/> for an exercise with this <paramref name="firstLiveAt"/>.</summary>
    internal static IReadOnlyList<string> AllowedFrom(string? from, DateTimeOffset? firstLiveAt)
    {
        var allowed = ExerciseLifecycleStates.AllowedTransitionsFrom(from);
        return firstLiveAt is not null
            && ExerciseLifecycleStates.TryParse(from, out var canonical)
            && canonical == ExerciseLifecycleStates.Build
                ? [.. allowed, ExerciseLifecycleStates.Archived]
                : allowed;
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
