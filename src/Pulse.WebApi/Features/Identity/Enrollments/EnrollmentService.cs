namespace Pulse.WebApi.Features.Identity.Enrollments;

using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// Staff-enrollment administration (identity-auth-roles/16, ADMIN-IDENTITY-MODEL §1.1): grant a staff role, change
/// or remove it, and set the exercise's lead controller. Every change revokes, in the SAME transaction, the live
/// sessions that were minted from the grant it changed (role change / removal — a LEAD change is not a grant change and
/// revokes nothing; <c>Session.isLead</c> is read live), and is recorded twice in the same unit of work — an XC-004
/// <see cref="TelemetryEvent"/> on the exercise and an <see cref="OrgAuditEvent"/> on the organization (§7.5).
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may act.</b> A <c>planner</c> on THE exercise (their exercise-bound session's resolved scope) or an org
/// admin (an org-scope session, any exercise of their own organization). Anyone else is refused (403) before a target
/// is looked up, so a refusal discloses nothing about existence.
/// </para>
/// <para>
/// <b>Isolation (always-Critical).</b> A planner's reads go through the central exercise filter, so another
/// exercise's enrollment is simply invisible; an org admin's are cross-exercise by design and bounded by an
/// <c>InOrganization</c> join on <see cref="Exercise"/>. Either way a foreign id is the same bare 404 as a missing
/// one. Scope is never read from the request body.
/// </para>
/// <para>
/// A1 maps only the lead route (<c>PUT /api/staff/enrollments/{id}/lead</c>); grant / change / revoke are the service
/// seam the A2 staff-assignment UI (story 20) maps, and they already enforce one-role-per-exercise (409
/// <c>conflicting-enrollment</c>) and the grant-revoke rule.
/// </para>
/// <para>
/// <b>Losing the lead (M-002 / M-1).</b> Swamped mode lives in the in-memory engine autonomy registry, outside this
/// unit of work, so it is turned OFF only AFTER the enrollment change commits — a failed save never lowers autonomy for
/// a change that did not happen. The flip is idempotent (OFF is a fixed point), runs on every committed lead release,
/// and a failure is logged, never surfaced: the grant change has already committed. Its record is split by what each
/// half describes: the <c>enrollment.lead.released</c> event + audit are part of the enrollment change and are staged
/// in the SAME unit of work; the <c>engine.swamped-mode.turned-off</c> event + audit describe the in-memory flip, so
/// they are written after the flip (a second, small save) and carry the real <c>wasOn</c>. A failed flip therefore
/// leaves no "turned off" record claiming otherwise, and a failed follow-up save is logged without failing the request.
/// </para>
/// </remarks>
public sealed partial class EnrollmentService
{
    /// <summary>The 409 error code for a second enrollment of one person in one exercise.</summary>
    public const string ConflictingEnrollmentError = "conflicting-enrollment";

    /// <summary>The 409 error code for a lead target that is not a controller.</summary>
    public const string NotAControllerError = "not-a-controller";

    /// <summary>The 409 error code for a lead change that lost a race with another (the one-lead unique index).</summary>
    public const string LeadConflictError = "lead-conflict";

    /// <summary>The XC-004 event type of a lead released because its holder lost the controller grant.</summary>
    public const string LeadReleasedEventType = "enrollment.lead.released";

    /// <summary>The XC-004 event type of swamped mode turned off because the exercise lost its lead.</summary>
    public const string SwampedModeOffEventType = "engine.swamped-mode.turned-off";

    /// <summary>The org-audit kind of a lead released because its holder lost the controller grant.</summary>
    public const string LeadReleasedAuditKind = "org.enrollment.lead-released";

    /// <summary>The org-audit kind of swamped mode turned off because the exercise lost its lead.</summary>
    public const string SwampedModeOffAuditKind = "org.engine.swamped-mode-off";

    /// <summary>The swamped-off <c>reason</c> recorded when a lead transfer demotes the previous lead.</summary>
    public const string LeadTransferredReason = "lead-transferred";

    /// <summary>The XC-004 event type of a lead change.</summary>
    public const string LeadChangedEventType = "enrollment.lead.changed";

    /// <summary>The XC-004 event type of a grant.</summary>
    public const string GrantedEventType = "enrollment.granted";

    /// <summary>The XC-004 event type of a role change.</summary>
    public const string RoleChangedEventType = "enrollment.role.changed";

    /// <summary>The XC-004 event type of a removal.</summary>
    public const string RevokedEventType = "enrollment.revoked";

    /// <summary>The org-audit kind of a grant to someone else.</summary>
    public const string GrantedAuditKind = "org.enrollment.granted";

    /// <summary>The org-audit kind of a grant to oneself (ADMIN-IDENTITY-MODEL §1.1 "enroll themselves (audited)").</summary>
    public const string SelfGrantedAuditKind = "org.enrollment.self-granted";

    /// <summary>The org-audit kind of a role change.</summary>
    public const string RoleChangedAuditKind = "org.enrollment.role-changed";

    /// <summary>The org-audit kind of a removal.</summary>
    public const string RevokedAuditKind = "org.enrollment.revoked";

    /// <summary>The org-audit kind of a lead change.</summary>
    public const string LeadSetAuditKind = "org.enrollment.lead-set";

    private const string EnrollmentEntityType = "enrollment";
    private const int DuplicateKeyErrorNumber = 2601;
    private const int UniqueConstraintErrorNumber = 2627;

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;
    private readonly IExerciseContext _exerciseContext;
    private readonly TimeProvider _timeProvider;
    private readonly ISwampedModeSwitch _swampedMode;
    private readonly ISessionConnectionRevoker _connectionRevoker;
    private readonly ILogger<EnrollmentService> _logger;
    private readonly IScenarioNow _scenarioNow;

    /// <summary>Creates the service.</summary>
    /// <param name="dbContext">The request-scoped persistence context (one unit of work).</param>
    /// <param name="staffCaller">The resolved staff caller (role and tenant from the caller's own session).</param>
    /// <param name="exerciseContext">The resolved exercise scope (a planner's exercise).</param>
    /// <param name="timeProvider">The server wall clock.</param>
    /// <param name="swampedMode">The OFF-only swamped-mode seam used when an exercise loses its lead.</param>
    /// <param name="connectionRevoker">Cuts the live hub connections of the sessions a grant change revokes.</param>
    /// <param name="logger">Logs a post-commit swamped-mode flip that failed (never surfaced to the caller).</param>
    /// <param name="scenarioNow">The exercise's scenario now for telemetry (engine-runtime/08, CLK-2: clock, else latest post, else now).</param>
    public EnrollmentService(
        PulseDbContext dbContext,
        StaffCallerContext staffCaller,
        IExerciseContext exerciseContext,
        TimeProvider timeProvider,
        ISwampedModeSwitch swampedMode,
        ISessionConnectionRevoker connectionRevoker,
        IScenarioNow scenarioNow,
        ILogger<EnrollmentService>? logger = null)
    {
        _logger = logger ?? NullLogger<EnrollmentService>.Instance;
        ArgumentNullException.ThrowIfNull(swampedMode);
        ArgumentNullException.ThrowIfNull(connectionRevoker);
        _swampedMode = swampedMode;
        _connectionRevoker = connectionRevoker;
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(scenarioNow);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
        _exerciseContext = exerciseContext;
        _timeProvider = timeProvider;
        _scenarioNow = scenarioNow;
    }

    /// <summary>
    /// Makes enrollment <paramref name="enrollmentId"/> the exercise's lead controller and clears the previous lead in
    /// ONE statement (so the filtered unique index never sees two leads or a half-applied swap). A lead change is not a
    /// grant change: no session is revoked — <c>Session.isLead</c> is read live from the enrollment.
    /// </summary>
    /// <param name="enrollmentId">The target enrollment (route value).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<EnrollmentResult> SetLeadAsync(Guid enrollmentId, CancellationToken cancellationToken = default)
    {
        // Planners only: an org admin acts through their own (planner) enrollment, not an org-scope twin.
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return EnrollmentResult.Unauthenticated();
        }

        if (caller.IsOrgScope || !string.Equals(caller.Role, EnrollmentRoles.Planner, StringComparison.OrdinalIgnoreCase))
        {
            return EnrollmentResult.Forbidden();
        }

        var target = await FindReachableAsync(caller, enrollmentId, cancellationToken);
        if (target is null)
        {
            return EnrollmentResult.NotFound();
        }

        var (enrollment, exercise) = target.Value;
        if (!string.Equals(enrollment.Role, EnrollmentRoles.Controller, StringComparison.Ordinal))
        {
            return EnrollmentResult.Conflict(NotAControllerError);
        }

        if (enrollment.IsLead)
        {
            // Already the lead: nothing changes, so nothing is recorded.
            return EnrollmentResult.Ok(enrollment);
        }

        var now = _timeProvider.GetUtcNow();
        var scenarioTime = await _scenarioNow.GetAsync(exercise.Id, now, cancellationToken);

        // org-scope-exempt(TenantChecked): exercise.Id was just resolved inside the caller's own scope and organization
        // (FindReachableAsync), so this reads only that one exercise's current lead (for the audit payload).
        var previousLeadId = await _dbContext.Enrollments
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(e => e.ExerciseId == exercise.Id && e.IsLead)
            .Select(e => (Guid?)e.Id)
            .FirstOrDefaultAsync(cancellationToken);

        try
        {
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            // ONE statement: UPDATE … SET IsLead = CASE WHEN Id = @id THEN 1 ELSE 0 END
            //                WHERE ExerciseId = @exercise AND (IsLead = 1 OR Id = @id).
            // org-scope-exempt(TenantChecked): the same caller-reachable exercise as above.
            await _dbContext.Enrollments
                .IgnoreQueryFilters()
                .Where(e => e.ExerciseId == exercise.Id && (e.IsLead || e.Id == enrollment.Id))
                .ExecuteUpdateAsync(set => set.SetProperty(e => e.IsLead, e => e.Id == enrollment.Id), cancellationToken);

            // The statement above already wrote it; mirror it on the tracked entity WITHOUT marking it modified.
            var isLead = _dbContext.Entry(enrollment).Property(e => e.IsLead);
            isLead.CurrentValue = true;
            isLead.OriginalValue = true;

            var payload = string.Create(
                CultureInfo.InvariantCulture,
                $"{{\"enrollmentId\":{JsonSerializer.Serialize(enrollment.Id.ToString())}," +
                $"\"previousLeadEnrollmentId\":{JsonSerializer.Serialize(previousLeadId?.ToString())}}}");

            Record(caller, exercise, enrollment, LeadChangedEventType, LeadSetAuditKind, payload, now, scenarioTime);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueKeyViolation(exception))
        {
            _dbContext.ChangeTracker.Clear();
            return EnrollmentResult.Conflict(LeadConflictError);
        }
        catch (SqlException exception) when (exception.Number is DuplicateKeyErrorNumber or UniqueConstraintErrorNumber)
        {
            // ExecuteUpdate surfaces the index violation as a raw SqlException (a concurrent lead change won the race).
            _dbContext.ChangeTracker.Clear();
            return EnrollmentResult.Conflict(LeadConflictError);
        }

        // PROVIDER-GOVERNANCE §8: demoting the lead turns swamped mode off. A TRANSFER demotes the previous lead, and the
        // exercise still has a lead afterwards, so the no-lead heal never catches it: without this the new lead would
        // inherit timeout auto-send they never turned on (adversarial review W1 on #642).
        await TurnSwampedModeOffAfterCommitAsync(
            caller, exercise, enrollment, leadReleased: previousLeadId is not null, now, scenarioTime, cancellationToken,
            reason: LeadTransferredReason);

        return EnrollmentResult.Ok(enrollment);
    }

    /// <summary>
    /// Grants <paramref name="personId"/> a STAFF role in <paramref name="exerciseId"/>. A second enrollment of the same
    /// person in the same exercise (any role) is refused with 409 <see cref="ConflictingEnrollmentError"/> — by this
    /// check and, under a race, by the database's unique index. Creates the person's staff facet if they have none.
    /// </summary>
    /// <param name="exerciseId">The exercise (a planner's own resolved exercise, or one of an org admin's org).</param>
    /// <param name="personId">The person to enroll (must belong to the exercise's organization).</param>
    /// <param name="role">The staff role: planner, controller or evaluator.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<EnrollmentResult> GrantAsync(
        Guid exerciseId,
        Guid personId,
        string? role,
        CancellationToken cancellationToken = default)
    {
        var authorization = await AuthorizeAsync(cancellationToken);
        if (authorization.Refusal is { } refusal)
        {
            return refusal;
        }

        var caller = authorization.Caller!;
        if (!EnrollmentRoles.TryNormalizeStaffRole(role, out var staffRole))
        {
            // Participant-role enrollments are created with their account (roster / account provisioning) — a
            // participant enrollment always has an account, a staff one never does.
            return EnrollmentResult.Invalid("role must be a staff role: planner, controller or evaluator.");
        }

        var exercise = await FindReachableExerciseAsync(caller, exerciseId, cancellationToken);
        if (exercise is null)
        {
            return EnrollmentResult.NotFound();
        }

        // The person must belong to the exercise's own organization — a cross-tenant person is the bare 404.
        var person = await _dbContext.People
            .InOrganization(exercise.OrganizationId)
            .FirstOrDefaultAsync(p => p.Id == personId, cancellationToken);
        if (person is null)
        {
            return EnrollmentResult.NotFound();
        }

        // org-scope-exempt(TenantChecked): the exercise was just resolved inside the caller's own organization (or
        // scope) and the person inside the exercise's organization; this only asks whether the pair is enrolled.
        var alreadyEnrolled = await _dbContext.Enrollments
            .IgnoreQueryFilters()
            .AnyAsync(e => e.ExerciseId == exercise.Id && e.PersonId == person.Id, cancellationToken);
        if (alreadyEnrolled)
        {
            return EnrollmentResult.Conflict(ConflictingEnrollmentError);
        }

        var now = _timeProvider.GetUtcNow();
        var scenarioTime = await _scenarioNow.GetAsync(exercise.Id, now, cancellationToken);
        var enrollment = new Enrollment
        {
            Id = Guid.NewGuid(),
            ExerciseId = exercise.Id,
            PersonId = person.Id,
            Role = staffRole,
            CreatedAt = now,
        };
        _dbContext.Enrollments.Add(enrollment);

        // The staff facet exists once the person holds any staff enrollment (shared key, §1.1).
        var hasFacet = await _dbContext.StaffUsers
            .InOrganization(exercise.OrganizationId)
            .AnyAsync(u => u.Id == person.Id, cancellationToken);
        if (!hasFacet)
        {
            _dbContext.StaffUsers.Add(new StaffUser
            {
                Id = person.Id,
                OrganizationId = person.OrganizationId,
                ExternalSubject = $"pulse|{person.Id:N}",
                DisplayName = person.DisplayName,
                CreatedAt = now,
            });
        }

        var auditKind = person.Id == caller.StaffUserId ? SelfGrantedAuditKind : GrantedAuditKind;
        Record(caller, exercise, enrollment, GrantedEventType, auditKind, RolePayload(staffRole, previousRole: null), now, scenarioTime);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueKeyViolation(exception))
        {
            _dbContext.ChangeTracker.Clear();
            return EnrollmentResult.Conflict(ConflictingEnrollmentError);
        }

        return EnrollmentResult.Ok(enrollment);
    }

    /// <summary>
    /// Changes a STAFF enrollment's role, revoking the person's live sessions on that exercise in the same unit of
    /// work (the grant they were minted from changed). A lead controller moved off <c>controller</c> loses the lead.
    /// </summary>
    /// <param name="enrollmentId">The target enrollment.</param>
    /// <param name="role">The new staff role.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<EnrollmentResult> ChangeRoleAsync(Guid enrollmentId, string? role, CancellationToken cancellationToken = default)
    {
        var authorization = await AuthorizeAsync(cancellationToken);
        if (authorization.Refusal is { } refusal)
        {
            return refusal;
        }

        var caller = authorization.Caller!;
        if (!EnrollmentRoles.TryNormalizeStaffRole(role, out var staffRole))
        {
            return EnrollmentResult.Invalid("role must be a staff role: planner, controller or evaluator.");
        }

        var target = await FindReachableAsync(caller, enrollmentId, cancellationToken);
        if (target is null || !EnrollmentRoles.IsStaffRole(target.Value.Enrollment.Role))
        {
            // A participant enrollment's role belongs to the roster, never to this staff seam.
            return EnrollmentResult.NotFound();
        }

        var (enrollment, exercise) = target.Value;
        if (string.Equals(enrollment.Role, staffRole, StringComparison.Ordinal))
        {
            return EnrollmentResult.Ok(enrollment);
        }

        var now = _timeProvider.GetUtcNow();
        var scenarioTime = await _scenarioNow.GetAsync(exercise.Id, now, cancellationToken);
        var previousRole = enrollment.Role;
        var leadReleased = ReleaseLeadIfLost(caller, exercise, enrollment, newRole: staffRole, now, scenarioTime);
        enrollment.Role = staffRole;

        var revoked = await RevokeExerciseSessionsAsync(exercise.Id, [enrollment.PersonId], now, cancellationToken);
        Record(caller, exercise, enrollment, RoleChangedEventType, RoleChangedAuditKind, RolePayload(staffRole, previousRole), now, scenarioTime);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await TurnSwampedModeOffAfterCommitAsync(caller, exercise, enrollment, leadReleased, now, scenarioTime, cancellationToken);
        await CutRevokedConnectionsAfterCommitAsync(revoked, cancellationToken);

        return EnrollmentResult.Ok(enrollment);
    }

    /// <summary>
    /// Removes a STAFF enrollment, revoking the person's live sessions on that exercise in the same unit of work.
    /// </summary>
    /// <param name="enrollmentId">The target enrollment.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to a status.</returns>
    public async Task<EnrollmentResult> RevokeAsync(Guid enrollmentId, CancellationToken cancellationToken = default)
    {
        var authorization = await AuthorizeAsync(cancellationToken);
        if (authorization.Refusal is { } refusal)
        {
            return refusal;
        }

        var caller = authorization.Caller!;
        var target = await FindReachableAsync(caller, enrollmentId, cancellationToken);
        if (target is null || !EnrollmentRoles.IsStaffRole(target.Value.Enrollment.Role))
        {
            return EnrollmentResult.NotFound();
        }

        var (enrollment, exercise) = target.Value;
        var now = _timeProvider.GetUtcNow();
        var scenarioTime = await _scenarioNow.GetAsync(exercise.Id, now, cancellationToken);

        var leadReleased = ReleaseLeadIfLost(caller, exercise, enrollment, newRole: null, now, scenarioTime);
        _dbContext.Enrollments.Remove(enrollment);
        var revoked = await RevokeExerciseSessionsAsync(exercise.Id, [enrollment.PersonId], now, cancellationToken);
        Record(caller, exercise, enrollment, RevokedEventType, RevokedAuditKind, RolePayload(role: null, enrollment.Role), now, scenarioTime);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await TurnSwampedModeOffAfterCommitAsync(caller, exercise, enrollment, leadReleased, now, scenarioTime, cancellationToken);
        await CutRevokedConnectionsAfterCommitAsync(revoked, cancellationToken);

        return EnrollmentResult.Ok(enrollment);
    }

    /// <summary>
    /// THE last-lead policy, isolated here so it is one edit to change (Tom, 2026-10-16, Option A): when the lead's
    /// enrollment is removed (<paramref name="newRole"/> <c>null</c>) or moved off <c>controller</c>, the change is
    /// ALLOWED — the lead flag is cleared (so the check constraint never fires) and the release is recorded (XC-004 +
    /// org audit) in the caller's unit of work. Swamped mode is NOT touched here: the caller turns it off only after the
    /// save commits (<see cref="TurnSwampedModeOffAfterCommitAsync"/>). The exercise then has no lead until a planner
    /// sets one. A no-op for any other enrollment or change.
    /// </summary>
    /// <returns>Whether the lead was released, i.e. whether swamped mode must be turned off once the change commits.</returns>
    private bool ReleaseLeadIfLost(
        StaffCaller caller, Exercise exercise, Enrollment enrollment, string? newRole, DateTimeOffset now, DateTimeOffset scenarioTime)
    {
        if (!enrollment.IsLead || string.Equals(newRole, EnrollmentRoles.Controller, StringComparison.Ordinal))
        {
            return false;
        }

        enrollment.IsLead = false;

        var leadPayload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"enrollmentId\":{JsonSerializer.Serialize(enrollment.Id.ToString())}," +
            $"\"newRole\":{JsonSerializer.Serialize(newRole)}}}");
        Record(caller, exercise, enrollment, LeadReleasedEventType, LeadReleasedAuditKind, leadPayload, now, scenarioTime);
        return true;
    }

    /// <summary>
    /// Turns the exercise's swamped mode OFF after a committed lead release (M-002): idempotent, so it is simply called
    /// for every committed release. Then records the flip (XC-004 + org audit, with the real <c>wasOn</c>) in a small
    /// follow-up save. Neither the flip nor its record can fail the request — the enrollment change has already
    /// committed — so a failure of either is logged and swallowed.
    /// </summary>
    private async Task TurnSwampedModeOffAfterCommitAsync(
        StaffCaller caller,
        Exercise exercise,
        Enrollment enrollment,
        bool leadReleased,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        CancellationToken cancellationToken,
        string reason = "lead-released")
    {
        if (!leadReleased)
        {
            return;
        }

        bool swampedWasOn;
        try
        {
            swampedWasOn = _swampedMode.TurnOff(exercise.Id, caller.StaffUserId.ToString());
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The grant change has committed; a failed in-memory flip must never fail it.
            LogSwampedModeOffFailed(exercise.Id, exception);
            return;
        }

        if (!swampedWasOn && reason == LeadTransferredReason)
        {
            // A transfer happens routinely; when swamped mode was already off it changed nothing, so it records nothing
            // (delta review: audit noise). A release still records wasOn:false, as before.
            return;
        }

        var swampedPayload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"reason\":{JsonSerializer.Serialize(reason)},\"wasOn\":{(swampedWasOn ? "true" : "false")}}}");
        Record(caller, exercise, enrollment, SwampedModeOffEventType, SwampedModeOffAuditKind, swampedPayload, now, scenarioTime);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogSwampedModeRecordFailed(exercise.Id, exception);
        }
    }

    /// <summary>
    /// Cuts the live hub connections of the sessions the committed change revoked. Runs after the swamped-mode flip so
    /// a failure here can never skip it, and never fails the request: the sessions are already revoked in the database,
    /// so a connection that survives is refused on its next authenticated call.
    /// </summary>
    private async Task CutRevokedConnectionsAfterCommitAsync(IReadOnlyCollection<Guid> revoked, CancellationToken cancellationToken)
    {
        try
        {
            await _connectionRevoker.RevokeAsync(revoked, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogConnectionCutFailed(revoked.Count, exception);
        }
    }

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Error,
        Message = "{Count} revoked session(s) could not have their live connections cut; the enrollment change has committed.")]
    private partial void LogConnectionCutFailed(int count, Exception exception);

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Error,
        Message = "Swamped mode could not be turned off for exercise {ExerciseId} after its lead was released; the enrollment change has committed.")]
    private partial void LogSwampedModeOffFailed(Guid exerciseId, Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Swamped mode was turned off for exercise {ExerciseId}, but its telemetry/audit record could not be saved.")]
    private partial void LogSwampedModeRecordFailed(Guid exerciseId, Exception exception);

    private static string RolePayload(string? role, string? previousRole) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"role\":{JsonSerializer.Serialize(role)},\"previousRole\":{JsonSerializer.Serialize(previousRole)}}}");

    private static bool IsUniqueKeyViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException
        {
            Number: DuplicateKeyErrorNumber or UniqueConstraintErrorNumber,
        };

    /// <summary>Resolves the caller and admits only a planner or an org admin.</summary>
    private async Task<(StaffCaller? Caller, EnrollmentResult? Refusal)> AuthorizeAsync(CancellationToken cancellationToken)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return (null, EnrollmentResult.Unauthenticated());
        }

        var admitted = (ExerciseAdminRoles.IsOrgAdmin(caller.Role) && caller.IsOrgScope)
            || (string.Equals(caller.Role, EnrollmentRoles.Planner, StringComparison.OrdinalIgnoreCase) && !caller.IsOrgScope);

        return admitted ? (caller, null) : (null, EnrollmentResult.Forbidden());
    }

    /// <summary>
    /// The exercise the caller may administer by this id: a planner's own resolved exercise only; any exercise of an
    /// org admin's own organization. <c>null</c> (→ bare 404) otherwise.
    /// </summary>
    private async Task<Exercise?> FindReachableExerciseAsync(StaffCaller caller, Guid exerciseId, CancellationToken cancellationToken)
    {
        if (!caller.IsOrgScope && _exerciseContext.CurrentExerciseId != exerciseId)
        {
            return null;
        }

        return await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(caller.OrganizationId)
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);
    }

    /// <summary>
    /// The enrollment the caller may administer by this id, with its exercise; <c>null</c> (→ bare 404) when it is
    /// missing, in another exercise (planner), or in another organization (both).
    /// </summary>
    private async Task<(Enrollment Enrollment, Exercise Exercise)?> FindReachableAsync(
        StaffCaller caller,
        Guid enrollmentId,
        CancellationToken cancellationToken)
    {
        Enrollment? enrollment;
        if (caller.IsOrgScope)
        {
            // An org admin works across the org's exercises: bypass the exercise filter, bound by the tenant join.
            enrollment = await (
                // org-scope-exempt(TenantChecked): the row must inner-join an Exercise of the caller's OWN
                // server-resolved organization, so another customer's enrollment is the same bare 404 as a missing one.
                from e in _dbContext.Enrollments.IgnoreQueryFilters()
                join x in _dbContext.Exercises.AsNoTracking().InOrganization(caller.OrganizationId) on e.ExerciseId equals x.Id
                where e.Id == enrollmentId
                select e).FirstOrDefaultAsync(cancellationToken);
        }
        else
        {
            // A planner: the central exercise filter confines this to the resolved exercise.
            enrollment = await _dbContext.Enrollments.FirstOrDefaultAsync(e => e.Id == enrollmentId, cancellationToken);
        }

        if (enrollment is null)
        {
            return null;
        }

        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(caller.OrganizationId)
            .FirstOrDefaultAsync(x => x.Id == enrollment.ExerciseId, cancellationToken);

        return exercise is null ? null : (enrollment, exercise);
    }

    /// <summary>
    /// Stages the revocation of every live session (access AND refresh: <c>RevokedAt</c> stops both) that the given
    /// people hold on <paramref name="exerciseId"/> — the sessions minted from the grant being changed — and returns their
    /// ids so the caller can cut their live hub connections once the revocation is committed.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> RevokeExerciseSessionsAsync(
        Guid exerciseId,
        IEnumerable<Guid?> personIds,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var people = personIds.OfType<Guid>().Distinct().ToList();
        if (people.Count == 0)
        {
            return [];
        }

        // Session is unscoped (looked up pre-scope); the exercise + person predicates are the confinement. Staff
        // sessions minted before the person column existed carry the person only as StaffUserId (shared key).
        var sessions = await _dbContext.Sessions
            .Where(s => s.ExerciseId == exerciseId
                && s.RevokedAt == null
                && ((s.PersonId != null && people.Contains(s.PersonId.Value))
                    || (s.StaffUserId != null && people.Contains(s.StaffUserId.Value))))
            .ToListAsync(cancellationToken);

        foreach (var session in sessions)
        {
            session.RevokedAt = now;
        }

        return sessions.Select(session => session.Id).ToList();
    }

    /// <summary>
    /// Stages the XC-004 event (exercise) and the org-audit record (organization) for one change, through the shared
    /// <see cref="StaffChangeRecorder"/>.
    /// </summary>
    private void Record(
        StaffCaller caller,
        Exercise exercise,
        Enrollment enrollment,
        string eventType,
        string auditKind,
        string payload,
        DateTimeOffset now,
        DateTimeOffset scenarioTime) =>
        StaffChangeRecorder.Stage(
            _dbContext,
            StaffChangeExercise.From(exercise, scenarioTime),
            new StaffChangeActor(caller.StaffUserId, caller.Role, caller.SessionId),
            new TelemetryTarget { EntityType = EnrollmentEntityType, EntityId = enrollment.Id.ToString() },
            enrollment.PersonId,
            eventType,
            auditKind,
            payload,
            now);
}

/// <summary>The outcome kind of an <see cref="EnrollmentService"/> call.</summary>
public enum EnrollmentOutcome
{
    /// <summary>The change was applied (or was already in place).</summary>
    Ok,

    /// <summary>The request was malformed — 400.</summary>
    Invalid,

    /// <summary>No live staff session or no resolved tenant — 401.</summary>
    Unauthenticated,

    /// <summary>The caller is neither a planner nor an org admin — 403.</summary>
    Forbidden,

    /// <summary>Missing, foreign-exercise or foreign-org target — the bare 404.</summary>
    NotFound,

    /// <summary>A rule refused the change — 409 with an error code.</summary>
    Conflict,
}

/// <summary>The result of an <see cref="EnrollmentService"/> call.</summary>
public sealed class EnrollmentResult
{
    private EnrollmentResult(EnrollmentOutcome outcome, Enrollment? enrollment, string? error)
    {
        Outcome = outcome;
        Enrollment = enrollment;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public EnrollmentOutcome Outcome { get; }

    /// <summary>The affected enrollment on <see cref="EnrollmentOutcome.Ok"/>.</summary>
    public Enrollment? Enrollment { get; }

    /// <summary>The validation message (400) or error code (409).</summary>
    public string? Error { get; }

    /// <summary>A success.</summary>
    /// <param name="enrollment">The affected enrollment.</param>
    /// <returns>The result.</returns>
    public static EnrollmentResult Ok(Enrollment enrollment) => new(EnrollmentOutcome.Ok, enrollment, null);

    /// <summary>A 400.</summary>
    /// <param name="error">The reason.</param>
    /// <returns>The result.</returns>
    public static EnrollmentResult Invalid(string error) => new(EnrollmentOutcome.Invalid, null, error);

    /// <summary>A 401.</summary>
    /// <returns>The result.</returns>
    public static EnrollmentResult Unauthenticated() => new(EnrollmentOutcome.Unauthenticated, null, null);

    /// <summary>A 403.</summary>
    /// <returns>The result.</returns>
    public static EnrollmentResult Forbidden() => new(EnrollmentOutcome.Forbidden, null, null);

    /// <summary>The bare 404.</summary>
    /// <returns>The result.</returns>
    public static EnrollmentResult NotFound() => new(EnrollmentOutcome.NotFound, null, null);

    /// <summary>A 409 carrying <paramref name="error"/>.</summary>
    /// <param name="error">The error code.</param>
    /// <returns>The result.</returns>
    public static EnrollmentResult Conflict(string error) => new(EnrollmentOutcome.Conflict, null, error);
}
