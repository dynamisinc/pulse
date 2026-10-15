namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Row actions on the org exercise list (demo-feedback story 22, DF-35): <b>rename</b>
/// (<c>PATCH /api/org/exercises/{exerciseId}</c>) and <b>archive</b>
/// (<c>POST /api/org/exercises/{exerciseId}/archive</c>). The first two org-tier routes that take an exercise id.
/// </summary>
/// <remarks>
/// <para>
/// <b>The id in the route is a REQUEST, never a scope.</b> Every other <c>/api/org/*</c> route takes no
/// identifier at all, so there was no IDOR surface on the org axis. These two do, so each one turns the id into an
/// authorized exercise in exactly one way: <see cref="FindInCallersOrganizationAsync"/>, a read of
/// <c>Exercises</c> bounded by <see cref="OrganizationScope.InOrganization{TEntity}"/> with the caller's
/// SERVER-resolved tenant. An id owned by another customer and an id that does not exist both come back
/// <c>null</c>, and both map to the same bare <c>404</c>: never <c>403</c>, which would confirm the exercise
/// exists. Nothing in this class reads an exercise any other way.
/// </para>
/// <para>
/// <b>Rename</b> reuses the exercise-settings name rule (<see cref="ExerciseSettingsFieldRules.TryNormalizeName"/>:
/// trimmed, markup stripped, 1..200 characters), so a name this route accepts is exactly one
/// <c>PUT /api/staff/exercise-settings</c> would accept.
/// </para>
/// <para>
/// <b>Archive</b> goes through the existing COR-032 state machine (<see cref="ExerciseLifecycleService"/>), bound
/// to the authorized exercise, and is offered from <c>completed</c> only (DF-35, Tom 10/15). Any other state is a
/// <c>409</c> with <c>reason: "not-completed"</c> and nothing is written. The <c>exercise.archived</c> event is
/// staged on the same <see cref="PulseDbContext"/> before the lifecycle service saves, so the status change, the
/// lifecycle's own <c>exercise.lifecycle.transitioned</c> event and <c>exercise.archived</c> commit in one unit of
/// work or not at all.
/// </para>
/// <para>
/// Telemetry carries counts only (WAVE-4 telemetry rule): never the old or new name. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </para>
/// </remarks>
public sealed class ExerciseManagementService
{
    /// <summary>The <c>409</c> reason when archive is asked of an exercise that is not completed.</summary>
    public const string NotCompletedReason = "not-completed";

    private const string RenamedEventType = "exercise.renamed";
    private const string ArchivedEventType = "exercise.archived";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SchemaVersion = "v0";
    private const string ExerciseEntityType = "exercise";

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;

    /// <summary>Creates the service over its persistence context and the server-resolved caller seams.</summary>
    /// <param name="dbContext">The request-scoped unit of work every write goes through.</param>
    /// <param name="staffCaller">Resolves the caller's identity, role and tenant from the server-issued session.</param>
    /// <param name="currentStaffSession">The staff-session seam the lifecycle service attributes its event with.</param>
    public ExerciseManagementService(
        PulseDbContext dbContext,
        StaffCallerContext staffCaller,
        ICurrentStaffSessionAccessor currentStaffSession)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);
        ArgumentNullException.ThrowIfNull(currentStaffSession);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
        _currentStaffSession = currentStaffSession;
    }

    /// <summary>
    /// Renames one of the caller's organization's exercises and emits one <c>exercise.renamed</c> event in the same
    /// unit of work.
    /// </summary>
    /// <param name="exerciseId">The route id (a request, authorized against the caller's tenant).</param>
    /// <param name="request">The body (a <c>null</c> body is a 400).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseManagementResult> RenameAsync(
        Guid exerciseId,
        RenameExerciseRequest? request,
        CancellationToken cancellationToken = default)
    {
        var (caller, refusal) = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return refusal!;
        }

        // Authorize the id BEFORE looking at the body, so a foreign id answers 404 whatever the body says.
        var exercise = await FindInCallersOrganizationAsync(caller, exerciseId, tracked: true, cancellationToken);
        if (exercise is null)
        {
            return ExerciseManagementResult.NotFound();
        }

        if (request is null)
        {
            return ExerciseManagementResult.Invalid("A JSON body with the exercise's new name is required.");
        }

        if (!ExerciseSettingsFieldRules.TryNormalizeName(request.Name, out var name, out var error))
        {
            return ExerciseManagementResult.Invalid(error);
        }

        var previousLength = exercise.Name.Length;
        exercise.Name = name;

        var now = DateTimeOffset.UtcNow;
        _dbContext.TelemetryEvents.Add(BuildTelemetry(
            exercise,
            caller,
            RenamedEventType,
            JsonSerializer.Serialize(new RenamedPayload { PreviousLength = previousLength, NewLength = name.Length }),
            now));

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ExerciseManagementResult.Ok(ToDto(exercise));
    }

    /// <summary>
    /// Archives one of the caller's organization's exercises (<c>completed → archived</c> only) through the
    /// COR-032 lifecycle service, emitting <c>exercise.archived</c> in the same unit of work.
    /// </summary>
    /// <param name="exerciseId">The route id (a request, authorized against the caller's tenant).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseManagementResult> ArchiveAsync(Guid exerciseId, CancellationToken cancellationToken = default)
    {
        var (caller, refusal) = await ResolveCallerAsync(cancellationToken);
        if (caller is null)
        {
            return refusal!;
        }

        var exercise = await FindInCallersOrganizationAsync(caller, exerciseId, tracked: false, cancellationToken);
        if (exercise is null)
        {
            return ExerciseManagementResult.NotFound();
        }

        // DF-35: archive is offered from completed ONLY. The state machine would also refuse every other edge
        // into archived today, but the contract is a stable reason, not the machine's prose.
        if (!ExerciseLifecycleStates.TryParse(exercise.Status, out var state)
            || state != ExerciseLifecycleStates.Completed)
        {
            return ExerciseManagementResult.NotCompleted();
        }

        var now = DateTimeOffset.UtcNow;
        _dbContext.TelemetryEvents.Add(BuildTelemetry(
            exercise,
            caller,
            ArchivedEventType,
            JsonSerializer.Serialize(new ArchivedPayload { From = state }),
            now));

        // The existing lifecycle service, bound to THIS authorized exercise rather than to the caller's active
        // one. Its scope comes from the tenant-checked row above (never from the route value directly), and it
        // shares this request's PulseDbContext so its one SaveChanges commits the status, its own transition
        // event and the exercise.archived event staged above together.
        var lifecycle = new ExerciseLifecycleService(
            _dbContext,
            new ExerciseContext { CurrentExerciseId = exercise.Id },
            _currentStaffSession);

        var transition = await lifecycle.TransitionAsync(
            new ExerciseLifecycleTransitionRequest { To = ExerciseLifecycleStates.Archived },
            cancellationToken);

        if (transition.Outcome != ExerciseLifecycleOutcome.Ok)
        {
            // A concurrent transition moved the exercise off completed between the read and the write (or it
            // vanished). Nothing was saved; drop the staged event so the request's unit of work is left clean.
            _dbContext.ChangeTracker.Clear();
            return transition.Outcome == ExerciseLifecycleOutcome.NotFound
                ? ExerciseManagementResult.NotFound()
                : ExerciseManagementResult.NotCompleted();
        }

        exercise.Status = ExerciseLifecycleStates.Archived;
        return ExerciseManagementResult.Ok(ToDto(exercise));
    }

    /// <summary>
    /// The ONE way this class turns a route id into an exercise: bounded by the caller's server-resolved tenant.
    /// Another customer's exercise and a nonexistent id are indistinguishable here (both <c>null</c>).
    /// </summary>
    private async Task<Exercise?> FindInCallersOrganizationAsync(
        StaffCaller caller,
        Guid exerciseId,
        bool tracked,
        CancellationToken cancellationToken)
    {
        if (exerciseId == Guid.Empty)
        {
            return null;
        }

        var query = tracked
            ? _dbContext.Exercises.InOrganization(caller.OrganizationId)
            : _dbContext.Exercises.AsNoTracking().InOrganization(caller.OrganizationId);

        return await query.FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);
    }

    /// <summary>Resolves the caller and re-checks the role (defense in depth over the endpoint filter).</summary>
    private async Task<(StaffCaller? Caller, ExerciseManagementResult? Refusal)> ResolveCallerAsync(
        CancellationToken cancellationToken)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            return (null, ExerciseManagementResult.Unauthenticated());
        }

        return ExerciseAdminRoles.IsExerciseAdministrator(caller.Role)
            ? (caller, null)
            : (null, ExerciseManagementResult.Forbidden());
    }

    /// <summary>Projects an exercise onto the shared org-admin row shape, status canonicalized like the list.</summary>
    internal static OrgExerciseDto ToDto(Exercise exercise) => new()
    {
        ExerciseId = exercise.Id.ToString(),
        Name = exercise.Name,
        Status = ExerciseLifecycleStates.TryParse(exercise.Status, out var canonical) ? canonical : exercise.Status,
        Hostname = exercise.Hostname,
        CreatedAt = exercise.CreatedAt?.ToString("O", CultureInfo.InvariantCulture),
    };

    /// <summary>
    /// One XC-004 staff-action event in the house shape (<c>actor.kind: 'system'</c> carrying the acting human,
    /// as <c>exercise.created</c> does). The payload is counts and literals only: no name, no tenant (XC-002).
    /// </summary>
    private static TelemetryEvent BuildTelemetry(
        Exercise exercise,
        StaffCaller caller,
        string eventType,
        string payload,
        DateTimeOffset now) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = exercise.Id,
        EventType = eventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = caller.Role,
            ActingHumanId = caller.StaffUserId.ToString(),
            SessionId = caller.SessionId.ToString(),
        },
        WallClockTime = now,
        ScenarioTime = exercise.CurrentScenarioTime ?? now,
        TimeZone = exercise.TimeZone,
        Target = new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exercise.Id.ToString() },
        Payload = payload,
        EmittedAt = now,
    };

    /// <summary>The <c>exercise.renamed</c> payload: lengths only, never the text.</summary>
    private sealed class RenamedPayload
    {
        [JsonPropertyName("previousLength")]
        public required int PreviousLength { get; init; }

        [JsonPropertyName("newLength")]
        public required int NewLength { get; init; }
    }

    /// <summary>The <c>exercise.archived</c> payload: the state it left.</summary>
    private sealed class ArchivedPayload
    {
        [JsonPropertyName("from")]
        public required string From { get; init; }
    }
}

/// <summary>The outcome kind of an <see cref="ExerciseManagementService"/> row action.</summary>
public enum ExerciseManagementOutcome
{
    /// <summary>Applied; the endpoint returns 200 with the updated row.</summary>
    Ok,

    /// <summary>The body failed validation; 400 and nothing was written.</summary>
    Invalid,

    /// <summary>No live staff session or no resolved tenant; 401.</summary>
    Unauthenticated,

    /// <summary>A staff role that may not administer exercises; 403.</summary>
    Forbidden,

    /// <summary>No such exercise in the caller's organization (including another customer's); a bare 404.</summary>
    NotFound,

    /// <summary>Archive asked of an exercise that is not completed; 409 <c>{ reason: "not-completed" }</c>.</summary>
    NotCompleted,
}

/// <summary>The result of a rename or archive. Only <see cref="ExerciseManagementOutcome.Ok"/> carries a row.</summary>
public sealed class ExerciseManagementResult
{
    private ExerciseManagementResult(ExerciseManagementOutcome outcome, OrgExerciseDto? exercise, string? error)
    {
        Outcome = outcome;
        Exercise = exercise;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseManagementOutcome Outcome { get; }

    /// <summary>The updated row; non-null only on <see cref="ExerciseManagementOutcome.Ok"/>.</summary>
    public OrgExerciseDto? Exercise { get; }

    /// <summary>The human-readable reason on <see cref="ExerciseManagementOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>An applied action.</summary>
    /// <param name="exercise">The updated row.</param>
    /// <returns>An ok result.</returns>
    public static ExerciseManagementResult Ok(OrgExerciseDto exercise)
    {
        ArgumentNullException.ThrowIfNull(exercise);
        return new ExerciseManagementResult(ExerciseManagementOutcome.Ok, exercise, null);
    }

    /// <summary>A rejected body.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ExerciseManagementResult Invalid(string error) =>
        new(ExerciseManagementOutcome.Invalid, null, error);

    /// <summary>The fail-closed result for no live staff session or no resolved tenant.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static ExerciseManagementResult Unauthenticated() =>
        new(ExerciseManagementOutcome.Unauthenticated, null, null);

    /// <summary>The fail-closed result for a role that may not administer exercises.</summary>
    /// <returns>A forbidden result.</returns>
    public static ExerciseManagementResult Forbidden() =>
        new(ExerciseManagementOutcome.Forbidden, null, null);

    /// <summary>The indistinguishable not-found result (missing, or another customer's).</summary>
    /// <returns>A not-found result.</returns>
    public static ExerciseManagementResult NotFound() =>
        new(ExerciseManagementOutcome.NotFound, null, null);

    /// <summary>The archive refusal for an exercise that is not completed.</summary>
    /// <returns>A not-completed result.</returns>
    public static ExerciseManagementResult NotCompleted() =>
        new(ExerciseManagementOutcome.NotCompleted, null, null);
}
