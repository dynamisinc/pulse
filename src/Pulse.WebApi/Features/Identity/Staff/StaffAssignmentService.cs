namespace Pulse.WebApi.Features.Identity.Staff;

using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;

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
/// <b>Bounded by the CUSTOMER tenant (exercise-isolation/11 AC3, COR-010).</b> "Cross-exercise" has never
/// meant "cross-customer". Both operations here now resolve the caller's own <c>StaffUser.OrganizationId</c>
/// SERVER-SIDE and bound the exercise by it: the listing joins through
/// <see cref="OrganizationScope.InOrganization{TEntity}"/>, and the switch refuses (403 NotAssigned) an
/// exercise belonging to another organization. Both fail CLOSED on an unresolved tenant — an unknown
/// organization reaches nothing, never everything. <c>Exercise</c> and <c>StaffUser</c> carry no global query
/// filter on either axis (they are the resolution roots), which is precisely why the bound must be written
/// here rather than inherited.
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
    private readonly ISessionConnectionRevoker? _connectionRevoker;

    /// <summary>Creates the service over its persistence context and the current-staff-session seam.</summary>
    /// <param name="dbContext">The persistence context the assignment read + session mutation run through.</param>
    /// <param name="currentStaffSession">The cross-wave accessor that identifies the authenticated staff caller.</param>
    /// <param name="connectionRevoker">
    /// identity-auth-roles/15: drops the switching session's live hub connections out of the OLD exercise's groups
    /// (and closes them, so the client reconnects into the new exercise). Optional: a host without the realtime hub
    /// has no connections to move.
    /// </param>
    public StaffAssignmentService(
        PulseDbContext dbContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        ISessionConnectionRevoker? connectionRevoker = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _currentStaffSession = currentStaffSession;
        _connectionRevoker = connectionRevoker;
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

        // exercise-isolation/11 AC3 (COR-010): reachability is bounded by the CUSTOMER tenant. Resolve the
        // caller's own organization from their StaffUser row — server-side, never a client value — and use it
        // to bound the exercise join below. A staff user whose row has somehow vanished resolves to no tenant
        // and therefore reaches nothing (fail closed), rather than falling back to "all exercises".
        // org-scope-exempt(OwnIdentity): this reads the CALLER'S OWN staff row, by the id their server-issued
        // session carries — it is how the caller's tenant is discovered, so it cannot itself be tenant-bound.
        var callerOrganizationId = await _dbContext.StaffUsers
            .AsNoTracking()
            .Where(u => u.Id == current.StaffUserId)
            .Select(u => (Guid?)u.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken);

        // Own-only (filtered by StaffUserId) + cross-exercise (StaffAssignment is unscoped) + within-tenant
        // (InOrganization). Inner-join to Exercise for the display name — an assignment pointing at a missing
        // exercise is dropped rather than surfaced with a null name. Exercise carries no global query filter
        // on EITHER axis (it is both scope roots' resolution target), which is exactly why the tenant bound
        // has to be written explicitly here; OrganizationScope.InOrganization is the fail-closed helper that
        // makes "explicit" mean "matches nothing when unresolved".
        //
        // Project the raw Guid (NOT a.ExerciseId.ToString()) so the join materializes first and the Guid is
        // stringified CLIENT-SIDE below. A `.ToString()` inside this EF projection is translated to SQL and
        // SQL Server returns a uniqueidentifier as an UPPERCASE string — which would then mismatch the
        // lowercase exerciseId every other endpoint emits (SessionDto / ExerciseScopeDto both call
        // Guid.ToString() on an already-materialized entity, i.e. .NET's lowercase form). The switcher
        // compares assignment.exerciseId against the resolved scope's exerciseId, so an uppercase/lowercase
        // split makes the active exercise fail to match. Materialize, then ToString() in memory for one
        // consistent (lowercase) casing across the whole API surface.
        //
        // identity-auth-roles/16: the caller's STAFF enrollments (StaffUser.Id == Person.Id). This read is CROSS-exercise
        // by design (the switcher lists every exercise the caller may enter), so the central exercise filter is
        // bypassed explicitly and the tenant bound is the InOrganization join on Exercise below.
        var rows = await (
            // org-scope-exempt(TenantChecked): own-only (PersonId == the caller's session-carried id) and every row
            // must inner-join an Exercise of the caller's OWN organization, so no other customer's exercise is listed.
            from a in _dbContext.Enrollments.IgnoreQueryFilters().Active().AsNoTracking().Where(EnrollmentRoles.IsStaffEnrollment)
            where a.PersonId == current.StaffUserId
            join e in _dbContext.Exercises.AsNoTracking().InOrganization(callerOrganizationId) on a.ExerciseId equals e.Id
            orderby e.Name
            select new { a.ExerciseId, ExerciseName = e.Name, a.Role, a.IsLead }).ToListAsync(cancellationToken);

        var personId = current.StaffUserId.ToString();
        return rows
            .Select(r => new StaffAssignmentDto
            {
                ExerciseId = r.ExerciseId.ToString(),
                ExerciseName = r.ExerciseName,
                Role = r.Role,
                PersonId = personId,
                IsLead = r.IsLead,
            })
            .ToList();
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

        // identity-auth-roles/16 + 15: a target that is not an exercise of the caller's OWN organization — missing, or
        // another customer's — is the bare 404 for EVERY caller (ADMIN-IDENTITY-MODEL §1.2 / §7.2, the bare-404
        // pattern: a cross-org id answers exactly like a missing id). An ORG-SCOPE session (no exercise bound) also gets
        // the 404 for a same-org exercise it is not enrolled in; an exercise-bound session keeps its documented 403
        // (story 05) for that one case. Session is unscoped; this is the caller's own row by the authenticated id.
        var isOrgScope = await _dbContext.Sessions
            .AsNoTracking()
            .AnyAsync(s => s.Id == current.SessionId && s.ExerciseId == null, cancellationToken);

        // exercise-isolation/11 AC3 (COR-010): the caller's own CUSTOMER tenant, resolved server-side.
        // org-scope-exempt(OwnIdentity): this reads the CALLER'S OWN staff row, by the id their server-issued
        // session carries — it is how the caller's tenant is discovered, so it cannot itself be tenant-bound.
        var callerOrganizationId = await _dbContext.StaffUsers
            .AsNoTracking()
            .Where(u => u.Id == current.StaffUserId)
            .Select(u => (Guid?)u.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken);

        // The target, bounded by the caller's tenant (fail closed: an unresolved tenant matches nothing). Exercise is
        // the unfiltered scope root on both axes, which is why the bound is written here. Missing and foreign are one
        // answer, so nothing distinguishes "exists elsewhere" from "does not exist".
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(callerOrganizationId)
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return SetActiveExerciseResult.NotFound();
        }

        // Authorization: the caller must hold a STAFF enrollment in the target exercise (never one with an account,
        // so a staff session can never cross into the participant world). Rejecting an unassigned exercise is the
        // crux of this endpoint (COR-005) — it fails closed. The read is cross-exercise (the target is not the
        // session's scope), so the central exercise filter is bypassed and the exercise is named explicitly.
        // org-scope-exempt(TenantChecked): own-only (PersonId == the caller's session-carried id), and the target
        // exercise was just resolved INSIDE the caller's own organization, so this never reaches another customer.
        var assignment = await _dbContext.Enrollments
            .IgnoreQueryFilters()
            .Active()
            .AsNoTracking()
            .Where(EnrollmentRoles.IsStaffEnrollment)
            .FirstOrDefaultAsync(a => a.PersonId == current.StaffUserId && a.ExerciseId == exerciseId, cancellationToken);

        if (assignment is null)
        {
            return isOrgScope ? SetActiveExerciseResult.NotFound() : SetActiveExerciseResult.NotAssigned();
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
        var previousExerciseId = session.ExerciseId;

        // Persist the selection: the session's bound exercise AND its per-exercise role both move to the newly
        // selected assignment. Story 03's session middleware applies this to CurrentExerciseId per request.
        session.ExerciseId = exerciseId;
        session.Role = assignment.Role;

        // identity-auth-roles/16: the person is the caller (shared key) — stamped here too so a pre-migration row gains
        // it on its first switch. (The lead flag is never stored on the session; it is read live.)
        session.PersonId ??= current.StaffUserId;

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

        // identity-auth-roles/15 (ADMIN-IDENTITY-MODEL §1.2, realtime scope): the switch MOVES the session's live hub
        // connections — out of the old exercise's groups now (no further old-exercise push reaches them), and closed so
        // the client reconnects, where the hub joins the NEW exercise from the session row persisted above.
        if (_connectionRevoker is not null && previousExerciseId != exerciseId)
        {
            await _connectionRevoker.RevokeAsync([session.Id], cancellationToken);
        }

        return SetActiveExerciseResult.Ok(new StaffAssignmentDto
        {
            ExerciseId = exerciseId.ToString(),
            ExerciseName = exercise.Name,
            Role = assignment.Role,
            PersonId = current.StaffUserId.ToString(),
            IsLead = assignment.IsLead,
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

    /// <summary>
    /// The target is missing or another organization's exercise (any caller), or — for an ORG-SCOPE caller — a same-org
    /// exercise it holds no staff enrollment in: the bare 404 (identity-auth-roles/16, aligned for every caller in 15).
    /// </summary>
    NotFound,
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

    /// <summary>The fail-closed result for an exercise-bound caller's unassigned same-org exercise (403).</summary>
    /// <returns>A not-assigned result.</returns>
    public static SetActiveExerciseResult NotAssigned() =>
        new(SetActiveExerciseOutcome.NotAssigned, null, null);

    /// <summary>The bare-404 result for an org-scope caller whose target is not its own same-org enrollment.</summary>
    /// <returns>A not-found result.</returns>
    public static SetActiveExerciseResult NotFound() =>
        new(SetActiveExerciseOutcome.NotFound, null, null);
}
