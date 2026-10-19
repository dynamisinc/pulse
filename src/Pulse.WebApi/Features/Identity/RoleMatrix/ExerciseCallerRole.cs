namespace Pulse.WebApi.Features.Identity.RoleMatrix;

using System.Globalization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Enrollments;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>How far <see cref="ExerciseCallerRole.ResolveAsync"/> got in resolving the caller's exercise role.</summary>
public enum ExerciseCallerOutcome
{
    /// <summary>No live staff-kind session (participant, shared read-only and anonymous callers): 401.</summary>
    NoStaffSession,

    /// <summary>A staff session, but no resolved exercise scope (e.g. an org-scope session): 401, fail closed.</summary>
    ScopeUnresolved,

    /// <summary>A staff session holding no staff enrollment on the resolved exercise: 403.</summary>
    NotEnrolled,

    /// <summary>A staff session holding a staff enrollment on the resolved exercise; the role is known.</summary>
    Enrolled,
}

/// <summary>
/// The ONE live read behind every role-matrix gate (identity-auth-roles/17, ADMIN-IDENTITY-MODEL §8.2): who the staff
/// caller is, which exercise the server resolved, and the role (plus lead flag) of the caller's OWN staff
/// <see cref="Enrollment"/> on that exercise — read from the database on every request, never from the session row
/// and never from a request value.
/// </summary>
/// <remarks>
/// <para>
/// <b>Live, keyed on the session person.</b> The person is the <see cref="CurrentStaffSession.StaffUserId"/> the
/// server-issued session carries (the staff facet shares the <c>Person</c> key), never a body <c>actingHumanId</c>. The
/// enrollment is read through the central exercise filter AND an explicit <c>ExerciseId</c> predicate, so a role on any
/// other exercise is invisible. Because the read is live, a lead change (which revokes no session) takes effect on the
/// very next request (§1.1).
/// </para>
/// <para>
/// <b>No DI registration.</b> The resolver pulls its collaborators from the request scope (exactly as the engine-cockpit
/// filters do) and memoizes its answer in <see cref="HttpContext.Items"/>, so stacked gates on one request share one
/// read and the composition root needs no new line.
/// </para>
/// </remarks>
public sealed class ExerciseCallerRole
{
    private static readonly object ItemsKey = new();

    private ExerciseCallerRole(ExerciseCallerOutcome outcome)
    {
        Outcome = outcome;
    }

    /// <summary>How far resolution got.</summary>
    public ExerciseCallerOutcome Outcome { get; }

    /// <summary>The caller's person id (the staff facet id), or <see cref="Guid.Empty"/> when there is no staff session.</summary>
    public Guid PersonId { get; private init; }

    /// <summary>The caller's live session id, or <see cref="Guid.Empty"/> when there is no staff session.</summary>
    public Guid SessionId { get; private init; }

    /// <summary>The server-resolved exercise, or <see cref="Guid.Empty"/> when unresolved.</summary>
    public Guid ExerciseId { get; private init; }

    /// <summary>The caller's enrollment role on the resolved exercise (<c>planner</c> | <c>controller</c> | <c>evaluator</c>), or <c>null</c>.</summary>
    public string? Role { get; private init; }

    /// <summary>Whether the caller's enrollment is the exercise's lead controller (read live).</summary>
    public bool IsLead { get; private init; }

    /// <summary>
    /// The resolved exercise's canonical lifecycle state (<see cref="ExerciseLifecycleStates"/>), or <c>null</c> when it
    /// could not be read. Consumers that gate on the state fail closed on <c>null</c>.
    /// </summary>
    public string? LifecycleState { get; private init; }

    /// <summary>Whether the caller holds one of <paramref name="roles"/> on the resolved exercise.</summary>
    /// <param name="roles">The admitted roles (case-insensitive set).</param>
    /// <returns><c>true</c> only for an enrolled caller whose role is admitted.</returns>
    public bool Holds(IReadOnlySet<string> roles)
    {
        ArgumentNullException.ThrowIfNull(roles);
        return Outcome == ExerciseCallerOutcome.Enrolled && Role is not null && roles.Contains(Role);
    }

    /// <summary>
    /// Maps a refusal outcome to its fail-closed status: <c>401</c> with no staff session or no resolved scope,
    /// <c>403</c> otherwise (not enrolled, or enrolled in a role the gate does not admit).
    /// </summary>
    /// <returns>The refusal result.</returns>
    public IResult Refusal() => Outcome is ExerciseCallerOutcome.NoStaffSession or ExerciseCallerOutcome.ScopeUnresolved
        ? Results.Unauthorized()
        : Results.StatusCode(StatusCodes.Status403Forbidden);

    /// <summary>
    /// Resolves (once per request) the staff caller's live role on the server-resolved exercise.
    /// </summary>
    /// <param name="httpContext">The current request.</param>
    /// <returns>The resolution.</returns>
    public static async Task<ExerciseCallerRole> ResolveAsync(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        if (httpContext.Items.TryGetValue(ItemsKey, out var cached) && cached is ExerciseCallerRole memo)
        {
            return memo;
        }

        var resolved = await ResolveUncachedAsync(httpContext);
        httpContext.Items[ItemsKey] = resolved;
        return resolved;
    }

    /// <summary>
    /// The post-write lead re-check (Tier-2 M-1): whether <paramref name="personId"/> holds the LEAD controller enrollment
    /// on <paramref name="exerciseId"/> right now — an enrollment flagged lead AND in the <c>controller</c> role, the same
    /// rule as <see cref="IsLead"/>. Read live (never the per-request memo <see cref="ResolveAsync"/> keeps), so a raise
    /// gated on a lead flag read BEFORE its write can be re-judged AFTER it, and reverted if a demotion committed between.
    /// </summary>
    /// <remarks>
    /// The read goes through the caller's request-scoped context, so the central exercise filter confines it to the
    /// server-resolved scope; the explicit <c>ExerciseId</c> predicate keeps that visible at the call site. Pass the
    /// SESSION person (<see cref="PersonId"/>) and the server-resolved exercise only — never a request value. Fails closed
    /// (<c>false</c>) for an empty exercise or person.
    /// </remarks>
    /// <param name="dbContext">The request's scoped context.</param>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <param name="personId">The session's person.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> only while the person is still the exercise's lead controller.</returns>
    public static async Task<bool> IsStillLeadAsync(
        PulseDbContext dbContext,
        Guid exerciseId,
        Guid personId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        if (exerciseId == Guid.Empty || personId == Guid.Empty)
        {
            return false;
        }

        return await dbContext.Enrollments
            .Active()
            .AsNoTracking()
            .AnyAsync(
                e => e.ExerciseId == exerciseId && e.PersonId == personId && e.IsLead && e.Role == EnrollmentRoles.Controller,
                cancellationToken);
    }

    /// <summary>
    /// The "no lead ⇒ swamped off" re-check (identity-auth-roles/16 M-002): swamped mode is in-memory, and the
    /// post-commit OFF flip a lead removal stages could in principle fail. Every gated staff request on the exercise
    /// therefore re-checks — cheaply, only while swamped mode is on — that the exercise still has a lead (an enrollment
    /// flagged lead AND in the <c>controller</c> role, the same rule as <see cref="IsLead"/>, SG-002), and turns swamped
    /// mode off (idempotently) when it has none.
    /// </summary>
    /// <remarks>
    /// The flip goes through the same OFF-only <see cref="ISwampedModeSwitch"/> the enrollment change uses (stamped with
    /// the clock's CURRENT scenario minute), and when it really turned swamped mode off (<c>wasOn</c>) it is recorded
    /// exactly like <see cref="EnrollmentService"/>'s flip — one <see cref="EnrollmentService.SwampedModeOffEventType"/>
    /// XC-004 event and one <see cref="EnrollmentService.SwampedModeOffAuditKind"/> org audit, through the shared
    /// <see cref="StaffChangeRecorder"/>, with <c>reason: "no-lead-recheck"</c> (Gate-1 WR-003). The record is a system
    /// action (no acting human) saved in its OWN unit of work, so it never flushes whatever the request has tracked; a
    /// failed save is logged and never fails the request — the flip has already happened.
    /// </remarks>
    private static async Task EnsureSwampedOffWithoutLeadAsync(
        IServiceProvider services,
        PulseDbContext dbContext,
        StaffChangeExercise exercise,
        CancellationToken cancellationToken)
    {
        var exerciseId = exercise.ExerciseId;
        var registry = services.GetService<EngineAutonomyRegistry>();
        if (registry is null || !registry.GetOrCreate(exerciseId).SwampedModeEnabled)
        {
            return;
        }

        var hasLead = await dbContext.Enrollments
            .Active()
            .AsNoTracking()
            .AnyAsync(
                e => e.ExerciseId == exerciseId && e.IsLead && e.Role == EnrollmentRoles.Controller,
                cancellationToken);
        if (hasLead)
        {
            return;
        }

        var clock = services.GetService<IExerciseClock>();
        var swampedSwitch = services.GetService<ISwampedModeSwitch>() ?? new EngineSwampedModeSwitch(registry, clock);
        if (!swampedSwitch.TurnOff(exerciseId, NoLeadActor))
        {
            return;
        }

        var scenarioMinute = clock?.CurrentScenarioMinute(exerciseId) ?? 0;
        var now = (services.GetService<TimeProvider>() ?? TimeProvider.System).GetUtcNow();
        var payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"reason\":\"{NoLeadRecheckReason}\",\"wasOn\":true,\"scenarioMinute\":{scenarioMinute}}}");

        try
        {
            await using var scope = services.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();
            var recordContext = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
            StaffChangeRecorder.Stage(
                recordContext,
                exercise,
                actor: null,
                new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exerciseId.ToString() },
                subjectPersonId: null,
                EnrollmentService.SwampedModeOffEventType,
                EnrollmentService.SwampedModeOffAuditKind,
                payload,
                now);
            await recordContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            if (services.GetService<ILoggerFactory>()?.CreateLogger<ExerciseCallerRole>() is { } logger)
            {
                LogNoLeadRecordFailed(logger, exerciseId, exception);
            }
        }
    }

    /// <summary>The swamped-mode-off payload <c>reason</c> when the per-request re-check found no lead (Gate-1 WR-003).</summary>
    public const string NoLeadRecheckReason = "no-lead-recheck";

    private const string ExerciseEntityType = "exercise";

    private static readonly Action<ILogger, Guid, Exception?> LogNoLeadRecordFailed = LoggerMessage.Define<Guid>(
        LogLevel.Error,
        new EventId(1, nameof(LogNoLeadRecordFailed)),
        "Swamped mode was turned off for exercise {ExerciseId} (no lead), but its telemetry/audit record could not be saved.");

    /// <summary>The actor recorded when the re-check turns swamped mode off for an exercise with no lead.</summary>
    public const string NoLeadActor = "system:no-lead";

    private static async Task<ExerciseCallerRole> ResolveUncachedAsync(HttpContext httpContext)
    {
        var services = httpContext.RequestServices;
        var cancellationToken = httpContext.RequestAborted;

        var staff = await services.GetRequiredService<ICurrentStaffSessionAccessor>()
            .GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is null)
        {
            return new ExerciseCallerRole(ExerciseCallerOutcome.NoStaffSession);
        }

        // COR-001: the scope is the server-resolved one (an org-scope session leaves it unset), never a request value.
        var scope = services.GetRequiredService<IExerciseContext>().CurrentExerciseId;
        if (scope is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return new ExerciseCallerRole(ExerciseCallerOutcome.ScopeUnresolved)
            {
                PersonId = staff.StaffUserId,
                SessionId = staff.SessionId,
            };
        }

        var dbContext = services.GetRequiredService<PulseDbContext>();

        // The caller's OWN staff enrollment on the resolved exercise, read live. The central exercise filter confines the
        // read to the scope; the explicit ExerciseId predicate keeps that visible at the call site.
        var enrollment = await dbContext.Enrollments
            .Active()
            .AsNoTracking()
            .Where(EnrollmentRoles.IsStaffEnrollment)
            .Where(e => e.ExerciseId == exerciseId && e.PersonId == staff.StaffUserId)
            .Select(e => new { e.Role, e.IsLead })
            .FirstOrDefaultAsync(cancellationToken);

        if (enrollment is null)
        {
            return new ExerciseCallerRole(ExerciseCallerOutcome.NotEnrolled)
            {
                PersonId = staff.StaffUserId,
                SessionId = staff.SessionId,
                ExerciseId = exerciseId,
            };
        }

        // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope the caller is enrolled in (just
        // proven above), never a request value.
        var facts = await dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => new { e.Status, e.OrganizationId, e.CurrentScenarioTime, e.TimeZone })
            .FirstOrDefaultAsync(cancellationToken);
        var status = facts?.Status;

        if (facts is not null)
        {
            await EnsureSwampedOffWithoutLeadAsync(
                services,
                dbContext,
                new StaffChangeExercise(exerciseId, facts.OrganizationId, facts.CurrentScenarioTime, facts.TimeZone),
                cancellationToken);
        }

        return new ExerciseCallerRole(ExerciseCallerOutcome.Enrolled)
        {
            PersonId = staff.StaffUserId,
            SessionId = staff.SessionId,
            ExerciseId = exerciseId,
            Role = enrollment.Role,
            IsLead = enrollment.IsLead && string.Equals(enrollment.Role, EnrollmentRoles.Controller, StringComparison.Ordinal),
            LifecycleState = ExerciseLifecycleStates.TryParse(status, out var canonical) ? canonical : null,
        };
    }
}
