namespace Pulse.WebApi.Features.Identity.Staff;

using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The staff cross-exercise read/switch service behind <c>GET /api/staff/assignments</c> and
/// <c>POST /api/staff/active-exercise</c> (COR-005). It lists the authenticated staff user's OWN assignments
/// across exercises (the data source for the <c>exercise-isolation/05</c> switcher) and sets the staff
/// session's active exercise — the staff arm of the shared scope seam. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>The one deliberate cross-exercise read (XC-002-safe).</b> <c>StaffAssignment</c> is the ONLY
/// cross-exercise object in the model (COR-005) and is NOT <see cref="IExerciseScoped"/>, so the global query
/// filter never confines it — a staff user's assignment read intentionally spans exercises. It is safe because
/// the read is (a) staff-only (gated by <see cref="ICurrentStaffSessionAccessor"/>, which yields a session only
/// for a staff caller), (b) own-only (filtered by the caller's <c>StaffUserId</c> — a staff user never sees
/// another's assignments), and (c) an access record (exercise id + name + role), never participant content.
/// Content isolation is unaffected: selecting an active exercise re-scopes every <see cref="IExerciseScoped"/>
/// content query from then on.
/// </para>
/// <para>
/// <b>Active-exercise selection persistence + the Wave-2 seam.</b> Setting the active exercise persists the
/// selection onto the staff <c>Session</c> row (its bound <see cref="Session.ExerciseId"/> and per-exercise
/// <see cref="Session.Role"/>). The PER-REQUEST application of that selection into
/// <c>ExerciseContext.CurrentExerciseId</c> on the staff user's SUBSEQUENT requests is story 03's session
/// middleware (Wave 2) — it reads the persisted <see cref="Session.ExerciseId"/> and writes the scope seam.
/// This service therefore validates + persists the durable selection; it does not itself drive the scope of
/// the switch request (which returns immediately and runs no scoped content query).
/// </para>
/// </remarks>
public sealed class StaffAssignmentService
{
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string StaffSessionKind = "staff";
    private const string ExerciseSwitchedEventType = "exercise.switched";

    private readonly PulseDbContext _dbContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over its persistence context and the current-staff-session seam.</summary>
    /// <param name="dbContext">The persistence context the assignment read + session mutation run through.</param>
    /// <param name="currentStaffSession">The cross-wave accessor that identifies the authenticated staff caller.</param>
    public StaffAssignmentService(PulseDbContext dbContext, ICurrentStaffSessionAccessor currentStaffSession)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _currentStaffSession = currentStaffSession;
    }

    /// <summary>
    /// Lists the authenticated staff user's OWN assignments (exercise id + name + role) across every exercise
    /// they are assigned to. Returns <c>null</c> when there is no authenticated staff session (fail closed —
    /// the endpoint returns 401).
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The caller's assignments, or <c>null</c> when unauthenticated.</returns>
    public async Task<IReadOnlyList<StaffAssignmentDto>?> GetAssignmentsAsync(CancellationToken cancellationToken = default)
    {
        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return null;
        }

        // Own-only (filtered by StaffUserId) + cross-exercise (StaffAssignment is unscoped). Inner-join to
        // Exercise (the scope root, unfiltered) for the display name — an assignment pointing at a missing
        // exercise is dropped rather than surfaced with a null name.
        var assignments = await (
            from a in _dbContext.StaffAssignments.AsNoTracking()
            where a.StaffUserId == current.StaffUserId
            join e in _dbContext.Exercises.AsNoTracking() on a.ExerciseId equals e.Id
            orderby e.Name
            select new StaffAssignmentDto
            {
                ExerciseId = a.ExerciseId.ToString(),
                ExerciseName = e.Name,
                Role = a.Role,
            }).ToListAsync(cancellationToken);

        return assignments;
    }

    /// <summary>
    /// Sets the authenticated staff session's active exercise to <paramref name="exerciseId"/>, validated
    /// against the caller's <c>StaffAssignment</c> set and against a real <see cref="Exercise"/>. Persists the
    /// selection onto the <c>Session</c> row and emits one XC-004 <c>exercise.switched</c> event in the same
    /// unit of work. Fails CLOSED: an unauthenticated caller, an unknown exercise, or an unassigned exercise
    /// changes nothing.
    /// </summary>
    /// <param name="exerciseId">The exercise to make active.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<SetActiveExerciseResult> SetActiveExerciseAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            return SetActiveExerciseResult.Invalid("exerciseId must be a non-empty GUID.");
        }

        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return SetActiveExerciseResult.Unauthenticated();
        }

        // Authorization: the caller must be assigned to the target exercise. Rejecting an unassigned exercise
        // is the crux of this endpoint (COR-005) — it fails closed to 403.
        var assignment = await _dbContext.StaffAssignments
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.StaffUserId == current.StaffUserId && a.ExerciseId == exerciseId, cancellationToken);

        if (assignment is null)
        {
            return SetActiveExerciseResult.NotAssigned();
        }

        // Wave-0 deferred FKs → validate the exercise resolves to a real Exercise before persisting the
        // selection (and to read its display name for the confirmation). Exercise is the unfiltered scope root.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return SetActiveExerciseResult.Invalid("exerciseId does not resolve to a known exercise.");
        }

        // Load the persisted staff session row to update (Session is unscoped → findable regardless of scope).
        var session = await _dbContext.Sessions
            .FirstOrDefaultAsync(s => s.Id == current.SessionId, cancellationToken);

        if (session is null)
        {
            // The accessor reported a session that no longer exists — treat as unauthenticated (fail closed).
            return SetActiveExerciseResult.Unauthenticated();
        }

        // Defense-in-depth (identity-auth-roles/03 hardening, Gate-1 Info): now that the real
        // ICurrentStaffSessionAccessor backs this seam, re-assert at the point of mutation that the loaded
        // session actually belongs to the caller the accessor reported AND is a staff-kind session. This costs
        // nothing on the happy path and fails closed against any future accessor regression that could hand back
        // a session id that is not the caller's own staff session — never mutate someone else's / a non-staff row.
        if (session.StaffUserId != current.StaffUserId ||
            !string.Equals(session.Kind, StaffSessionKind, StringComparison.Ordinal))
        {
            return SetActiveExerciseResult.Unauthenticated();
        }

        var now = DateTimeOffset.UtcNow;
        var scenarioTime = exercise.CurrentScenarioTime ?? now;

        // Persist the selection: the session's bound exercise AND its per-exercise role both move to the newly
        // selected assignment. Story 03's session middleware applies this to CurrentExerciseId per request.
        session.ExerciseId = exerciseId;
        session.Role = assignment.Role;

        _dbContext.TelemetryEvents.Add(new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = "v0",
            ExerciseId = exerciseId,
            EventType = ExerciseSwitchedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                Role = assignment.Role,
                ActingHumanId = current.StaffUserId.ToString(),
            },
            WallClockTime = now,
            ScenarioTime = scenarioTime,
            TimeZone = exercise.TimeZone,
            Target = new TelemetryTarget { EntityType = "exercise", EntityId = exerciseId.ToString() },
            EmittedAt = now,
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return SetActiveExerciseResult.Ok(new StaffAssignmentDto
        {
            ExerciseId = exerciseId.ToString(),
            ExerciseName = exercise.Name,
            Role = assignment.Role,
        });
    }
}

/// <summary>The outcome kind of a <see cref="StaffAssignmentService.SetActiveExerciseAsync"/> call.</summary>
public enum SetActiveExerciseOutcome
{
    /// <summary>The active exercise was validated, persisted onto the session, and telemetered.</summary>
    Ok,

    /// <summary>The request failed validation (bad / unknown exercise) — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>No authenticated staff session — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>The caller is not assigned to the requested exercise — the endpoint returns 403 (fail closed).</summary>
    NotAssigned,
}

/// <summary>
/// The result of an active-exercise selection. <see cref="SetActiveExerciseOutcome.Ok"/> carries the newly
/// active assignment; <see cref="SetActiveExerciseOutcome.Invalid"/> carries a reason; the fail-closed
/// outcomes carry neither.
/// </summary>
public sealed class SetActiveExerciseResult
{
    private SetActiveExerciseResult(SetActiveExerciseOutcome outcome, StaffAssignmentDto? active, string? validationError)
    {
        Outcome = outcome;
        Active = active;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public SetActiveExerciseOutcome Outcome { get; }

    /// <summary>The newly active assignment — non-null only when <see cref="Outcome"/> is <see cref="SetActiveExerciseOutcome.Ok"/>.</summary>
    public StaffAssignmentDto? Active { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="SetActiveExerciseOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful selection.</summary>
    /// <param name="active">The newly active assignment.</param>
    /// <returns>An OK result.</returns>
    public static SetActiveExerciseResult Ok(StaffAssignmentDto active)
    {
        ArgumentNullException.ThrowIfNull(active);
        return new SetActiveExerciseResult(SetActiveExerciseOutcome.Ok, active, null);
    }

    /// <summary>A rejected request (bad / unknown exercise).</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static SetActiveExerciseResult Invalid(string validationError) =>
        new(SetActiveExerciseOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for an unauthenticated caller.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static SetActiveExerciseResult Unauthenticated() =>
        new(SetActiveExerciseOutcome.Unauthenticated, null, null);

    /// <summary>The fail-closed result for an unassigned exercise.</summary>
    /// <returns>A not-assigned result.</returns>
    public static SetActiveExerciseResult NotAssigned() =>
        new(SetActiveExerciseOutcome.NotAssigned, null, null);
}
