namespace Pulse.WebApi.Features.ExerciseConfiguration.Readiness;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>The status literals a readiness item carries on the wire.</summary>
public static class ReadinessItemStatuses
{
    /// <summary>The item is satisfied.</summary>
    public const string Ok = "ok";

    /// <summary>The item is not satisfied. On a blocking item this makes the exercise not ready.</summary>
    public const string Open = "open";

    /// <summary>The item cannot be evaluated yet (its backing feature has not landed). Never blocks.</summary>
    public const string NotChecked = "notChecked";
}

/// <summary>One readiness checklist item (ADMIN-IDENTITY-MODEL §5.3).</summary>
/// <param name="Id">The stable kebab-case key the console keys on.</param>
/// <param name="Label">The short staff-facing noun.</param>
/// <param name="Status">One of <see cref="ReadinessItemStatuses"/>.</param>
/// <param name="Detail">A short sentence explaining an open or not-checked item; <c>null</c> when ok.</param>
public sealed record ReadinessItem(string Id, string Label, string Status, string? Detail);

/// <summary>The resolved exercise's readiness checklist.</summary>
/// <param name="ExerciseId">The SERVER-resolved exercise (COR-001), never a client value.</param>
/// <param name="LifecycleState">The canonical COR-032 state (the raw stored value when it does not parse).</param>
/// <param name="Blocking">The eight blocking items, in their fixed order.</param>
/// <param name="Warnings">The seven warnings, in their fixed order.</param>
public sealed record ExerciseReadinessReport(
    Guid ExerciseId,
    string LifecycleState,
    IReadOnlyList<ReadinessItem> Blocking,
    IReadOnlyList<ReadinessItem> Warnings)
{
    /// <summary>Whether no blocking item is <see cref="ReadinessItemStatuses.Open"/> (stage may proceed).</summary>
    public bool Ready => Blocking.All(item => item.Status != ReadinessItemStatuses.Open);

    /// <summary>The blocking items that are open — the list a refused stage returns (story 04).</summary>
    public IReadOnlyList<ReadinessItem> OpenBlocking =>
        Blocking.Where(item => item.Status == ReadinessItemStatuses.Open).ToList();
}

/// <summary>The outcome kind of an <see cref="ExerciseReadinessService"/> read.</summary>
public enum ExerciseReadinessOutcome
{
    /// <summary>The checklist was read: 200.</summary>
    Ok,

    /// <summary>No exercise scope was resolved: 401 (fail closed).</summary>
    ScopeUnresolved,

    /// <summary>The resolved scope has no <c>Exercise</c> row: 404.</summary>
    NotFound,
}

/// <summary>The result of an <see cref="ExerciseReadinessService"/> read.</summary>
public sealed class ExerciseReadinessResult
{
    private ExerciseReadinessResult(ExerciseReadinessOutcome outcome, ExerciseReadinessReport? report)
    {
        Outcome = outcome;
        Report = report;
    }

    /// <summary>Which outcome occurred.</summary>
    public ExerciseReadinessOutcome Outcome { get; }

    /// <summary>The checklist, non-null only for <see cref="ExerciseReadinessOutcome.Ok"/>.</summary>
    public ExerciseReadinessReport? Report { get; }

    /// <summary>A successful read.</summary>
    /// <param name="report">The checklist.</param>
    /// <returns>An OK result.</returns>
    public static ExerciseReadinessResult Ok(ExerciseReadinessReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        return new ExerciseReadinessResult(ExerciseReadinessOutcome.Ok, report);
    }

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ExerciseReadinessResult ScopeUnresolved() => new(ExerciseReadinessOutcome.ScopeUnresolved, null);

    /// <summary>The result for a resolved scope with no backing exercise row.</summary>
    /// <returns>A not-found result.</returns>
    public static ExerciseReadinessResult NotFound() => new(ExerciseReadinessOutcome.NotFound, null);
}

/// <summary>
/// The go-live readiness checklist (exercise-build-golive/03, COR-042, ADMIN-IDENTITY-MODEL §5.3): eight blocking
/// items and seven warnings, evaluated live against the resolved exercise. Read-only, so it emits no telemetry.
/// Scoped, matching the request-scoped <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-001).</b> The exercise comes ONLY from <see cref="IExerciseContext"/>; no
/// method takes an exercise id. Every count runs through <see cref="PulseDbContext"/>'s central exercise filter AND an
/// explicit <c>ExerciseId</c> predicate, never <c>IgnoreQueryFilters</c>, so another exercise's rows can never be
/// counted. An unresolved scope fails closed before any query runs.
/// </para>
/// <para>
/// <b>Reuse.</b> Story 04 (PR-3) calls <see cref="GetAsync"/> from the stage transition and refuses with
/// <see cref="ExerciseReadinessReport.OpenBlocking"/> while <see cref="ExerciseReadinessReport.Ready"/> is false. The
/// time-zone rule is <see cref="ExerciseSettingsFieldRules.TryNormalizeTimeZone"/> and the chrome rule is
/// <see cref="ComplianceChromeGuard.TryValidate"/>, exactly as the settings and chrome write paths apply them.
/// </para>
/// <para>
/// <b>Accounts.</b> A participant account is an <see cref="Account"/> whose enrollment is a participant-world role and
/// which is not disabled; a disabled account cannot sign in, so it neither grants access nor needs a persona.
/// </para>
/// </remarks>
public sealed class ExerciseReadinessService
{
    /// <summary>
    /// The run-sheet status the §5.4a repair flow will introduce. Read as a literal on purpose: widening the frozen
    /// inject vocabulary is story 07's change, so until it lands no item carries it and the check is always ok.
    /// </summary>
    private const string NeedsRepairStatus = "needs-repair";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the service over persistence and the resolved scope.</summary>
    /// <param name="dbContext">The persistence context every count runs through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope, the ONLY source of "which exercise".</param>
    public ExerciseReadinessService(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <summary>Evaluates the resolved exercise's readiness checklist. Fails closed on an unresolved scope.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<ExerciseReadinessResult> GetAsync(CancellationToken cancellationToken = default)
    {
        if (_exerciseContext.CurrentExerciseId is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return ExerciseReadinessResult.ScopeUnresolved();
        }

        // org-scope-exempt(ResolvedScope): the SERVER-resolved exercise id, never a client value.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => new
            {
                e.Status,
                e.ScheduledStartAt,
                e.TimeZone,
                e.ComplianceChromeEnabled,
                e.WatermarkEnabled,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (exercise is null)
        {
            return ExerciseReadinessResult.NotFound();
        }

        var staff = await _dbContext.Enrollments
            .AsNoTracking()
            .Where(e => e.ExerciseId == exerciseId)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Controllers = g.Count(e => e.Role == EnrollmentRoles.Controller),
                Evaluators = g.Count(e => e.Role == EnrollmentRoles.Evaluator),

                // The lead rule is the role matrix's (SG-002): a lead flag on a controller enrollment.
                Leads = g.Count(e => e.IsLead && e.Role == EnrollmentRoles.Controller),
            })
            .FirstOrDefaultAsync(cancellationToken);

        var participantAccounts = _dbContext.Accounts
            .AsNoTracking()
            .Where(a => a.ExerciseId == exerciseId
                && a.DisabledAt == null
                && (a.Enrollment.Role == EnrollmentRoles.Participant || a.Enrollment.Role == EnrollmentRoles.Pio));

        var accounts = await participantAccounts
            .Select(a => new { Unbound = a.Enrollment.PersonaId == null })
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), Unbound = g.Count(a => a.Unbound) })
            .FirstOrDefaultAsync(cancellationToken);

        var withoutSignIn = await participantAccounts
            .CountAsync(
                a => a.CredentialHash == null
                    && !_dbContext.ParticipantLinks.Any(
                        l => l.ExerciseId == exerciseId && l.AccountId == a.Id && l.RevokedAt == null),
                cancellationToken);

        var viewOnlyCodeOn = await _dbContext.SharedCredentials
            .AsNoTracking()
            // "Usable" exactly as SharedCredentialLifecycleService reads it: enabled, not revoked, and holding a hash
            // (an enabled row with no hash admits nobody).
            .AnyAsync(
                c => c.ExerciseId == exerciseId && c.IsEnabled && c.RevokedAt == null && c.CurrentHash != null,
                cancellationToken);

        var injects = await _dbContext.InjectItems
            .AsNoTracking()
            .Where(i => i.ExerciseId == exerciseId && i.DeletedAt == null)
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), NeedsRepair = g.Count(i => i.Status == NeedsRepairStatus) })
            .FirstOrDefaultAsync(cancellationToken);

        var hasFeed = await _dbContext.Posts
            .AsNoTracking()
            // "Visible at scenario start": a live top-level post dated at or before the scheduled start (any live
            // top-level post when no start is set yet; the schedule item flags that separately).
            .AnyAsync(
                p => p.ExerciseId == exerciseId
                    && p.DeletedAt == null
                    && p.ParentPostId == null
                    && (exercise.ScheduledStartAt == null || p.CreatedScenarioTime <= exercise.ScheduledStartAt),
                cancellationToken);

        var hasNoise = await _dbContext.NoisePosts
            .AsNoTracking()
            .AnyAsync(n => n.ExerciseId == exerciseId, cancellationToken);

        var personasWithoutAvatar = await _dbContext.Personas
            .AsNoTracking()
            .CountAsync(p => p.ExerciseId == exerciseId && p.AvatarMediaId == null, cancellationToken);

        var controllers = staff?.Controllers ?? 0;
        var evaluators = staff?.Evaluators ?? 0;
        var leads = staff?.Leads ?? 0;
        var accountCount = accounts?.Total ?? 0;
        var unbound = accounts?.Unbound ?? 0;
        var injectCount = injects?.Total ?? 0;
        var needsRepair = injects?.NeedsRepair ?? 0;

        var blocking = new List<ReadinessItem>
        {
            Check("controller-enrolled", "Controller enrolled", controllers > 0, "No controller is enrolled."),
            NotChecked(
                "participant-name",
                "Participant-facing name",
                "Not checked yet — arrives with story 09 (participant-facing name)."),
            Check(
                "participant-access",
                "Participant access",
                accountCount > 0 || viewOnlyCodeOn,
                "There are no participant accounts and the view-only code is off."),
            Check(
                "personas-bound",
                "Participants bound to personas",
                unbound == 0,
                Counted(unbound, "participant account has no persona.", "participant accounts have no persona.")),
            NotChecked(
                "sign-in-methods",
                "Participant sign-in methods",
                "Not checked yet — needs identity-auth-roles 22 (sign-in methods)."),
            ScheduleItem(exercise.ScheduledStartAt, exercise.TimeZone),
            Check(
                "chrome-valid",
                "Compliance chrome and watermark",
                ComplianceChromeGuard.TryValidate(exercise.ComplianceChromeEnabled, exercise.WatermarkEnabled, out _),
                "Compliance chrome and the EXERCISE watermark are both off. Turn one of them on."),
            Check(
                "run-sheet-repair",
                "Run sheet repairs",
                needsRepair == 0,
                Counted(needsRepair, "run sheet item needs repair.", "run sheet items need repair.")),
        };

        var warnings = new List<ReadinessItem>
        {
            Check("run-sheet-items", "Run sheet items", injectCount > 0, "The run sheet has no items."),
            Check("opening-feed", "Opening feed", hasFeed, "No top-level post is visible at the scenario start time."),
            Check("noise-pool", "Noise pool", hasNoise, "The noise pool is empty."),
            Check(
                "persona-avatars",
                "Persona avatars",
                personasWithoutAvatar == 0,
                Counted(personasWithoutAvatar, "persona has no avatar.", "personas have no avatar.")),
            Check(
                "sign-in-issued",
                "Participant sign-in issued",
                withoutSignIn == 0,
                Counted(
                    withoutSignIn,
                    "participant account has no sign-in link or password yet.",
                    "participant accounts have no sign-in link or password yet.")),
            Check("evaluator-enrolled", "Evaluator enrolled", evaluators > 0, "No evaluator is enrolled."),
            Check(
                "lead-controller",
                "Lead controller",
                leads > 0,
                "No lead controller — swamped mode and autonomy raises are unavailable until a planner sets one."),
        };

        var state = ExerciseLifecycleStates.TryParse(exercise.Status, out var canonical) ? canonical : exercise.Status;
        return ExerciseReadinessResult.Ok(new ExerciseReadinessReport(exerciseId, state, blocking, warnings));
    }

    /// <summary>Item 6: a scenario start time is set and the time zone is a valid IANA id (UTC counts).</summary>
    private static ReadinessItem ScheduleItem(DateTimeOffset? scheduledStartAt, string? timeZone)
    {
        var zoneValid = ExerciseSettingsFieldRules.TryNormalizeTimeZone(timeZone, out _, out _);
        string? detail = (scheduledStartAt is null, zoneValid) switch
        {
            (true, false) => "No scenario start time is set, and the time zone is not a valid IANA zone.",
            (true, true) => "No scenario start time is set.",
            (false, false) => "The time zone is not a valid IANA zone.",
            _ => null,
        };

        return detail is null
            ? new ReadinessItem("schedule-set", "Time zone and start time", ReadinessItemStatuses.Ok, null)
            : new ReadinessItem("schedule-set", "Time zone and start time", ReadinessItemStatuses.Open, detail);
    }

    private static ReadinessItem Check(string id, string label, bool satisfied, string openDetail) =>
        satisfied
            ? new ReadinessItem(id, label, ReadinessItemStatuses.Ok, null)
            : new ReadinessItem(id, label, ReadinessItemStatuses.Open, openDetail);

    private static ReadinessItem NotChecked(string id, string label, string detail) =>
        new(id, label, ReadinessItemStatuses.NotChecked, detail);

    private static string Counted(int count, string singular, string plural) =>
        string.Create(CultureInfo.InvariantCulture, $"{count} {(count == 1 ? singular : plural)}");
}
