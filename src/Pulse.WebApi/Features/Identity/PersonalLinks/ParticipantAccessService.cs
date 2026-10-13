namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The four staff controls over one participant's access (easy-login/03, EL-8): <b>reissue</b> and <b>revoke</b> the
/// personal link, and <b>disable</b> / <b>enable</b> the person. Reissue, revoke and disable end that participant's
/// live sessions. Each mutation, its session terminations and its one XC-004 event commit in ONE <c>SaveChanges</c>.
/// Scoped, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, XC-001/COR-001).</b> The exercise comes only from <see cref="IExerciseContext"/>. The
/// account and its link are read under the central exercise filter, so an id from another exercise is
/// <see cref="ParticipantAccessOutcome.NotFound"/>, exactly like an unknown id. <see cref="Session"/> is NOT
/// exercise-scoped, so the termination query carries an explicit <c>ExerciseId</c> AND <c>AccountId</c> predicate
/// (gotcha 4): an action in exercise A can never touch a session in exercise B.
/// </para>
/// <para>
/// <b>Staff caller.</b> Resolved as <c>SharedCredentialLifecycleService</c> does: the live staff session from
/// <see cref="ICurrentStaffSessionAccessor"/>, re-checked against its persisted row (owner, <c>staff</c> kind, bound to
/// the resolved exercise). Its role and staff user id become the event's <c>actor.role</c> / <c>actor.actingHumanId</c>.
/// The endpoint filters (<c>EngineCockpitStaffAuthorizationFilter</c>, <c>RosterStaffRoleFilter</c>) have already
/// admitted the caller; this is defence in depth and fails closed (401).
/// </para>
/// <para>
/// <b>Idempotent.</b> Revoking a revoked link (or a person with no link) and enabling an enabled person change nothing,
/// write nothing and emit nothing: <c>200</c> with <c>sessionsEnded: 0</c>. Disabling a disabled person keeps the
/// original <c>DisabledAt</c>; it writes and emits only if a usable session lingers (a join that raced the first disable),
/// which it ends. Otherwise it is the same no-op.
/// </para>
/// <para>
/// <b>What "sessions ended" means.</b> Every session of the account in this exercise that is not revoked and is still
/// usable (access window or refresh window open, the roster's <c>liveSessions</c> definition) is revoked, including one
/// whose access token has lapsed while its refresh window is still open (its refresh then fails). Sessions that already
/// lapsed completely are left as they are, so their audit history stays intact. <c>sessionsEnded</c> counts exactly the
/// sessions stamped, so the number staff see is the drop in <c>liveSessions</c>.
/// </para>
/// </remarks>
public sealed class ParticipantAccessService
{
    private const string StaffSessionKind = "staff";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly ParticipantLinkService _linkService;
    private readonly RosterLinkDtoFactory _linkDtoFactory;
    private readonly ExerciseFactsReader _factsReader;
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClock? _exerciseClock;

    /// <summary>Creates the access service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context every mutation, termination and event is written through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope (the only scoping source).</param>
    /// <param name="currentStaffSession">Identifies the authenticated staff caller.</param>
    /// <param name="linkService">The link mechanics (reissue, revoke).</param>
    /// <param name="linkDtoFactory">Projects the link to the frozen <see cref="RosterLinkDto"/>.</param>
    /// <param name="factsReader">The exercise facts for the event envelope (EL-17's one <c>Exercises</c> read).</param>
    /// <param name="timeProvider">The server clock (one read per action).</param>
    /// <param name="exerciseClock">The native exercise clock for scenario time, when the host has one.</param>
    public ParticipantAccessService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        ParticipantLinkService linkService,
        RosterLinkDtoFactory linkDtoFactory,
        ExerciseFactsReader factsReader,
        TimeProvider timeProvider,
        IExerciseClock? exerciseClock = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(linkService);
        ArgumentNullException.ThrowIfNull(linkDtoFactory);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _linkService = linkService;
        _linkDtoFactory = linkDtoFactory;
        _factsReader = factsReader;
        _timeProvider = timeProvider;
        _exerciseClock = exerciseClock;
    }

    /// <summary>
    /// Reissues the participant's link (a new token; the old URL stops working at once, or a first link when there is
    /// none) and ends their live sessions. Emits <c>participant.link.reissued</c>.
    /// </summary>
    /// <param name="accountId">The participant's account id (route value), resolved under the central filter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The action result.</returns>
    public async Task<ParticipantAccessResult> ReissueAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(accountId, cancellationToken);
        if (target.Outcome is not null)
        {
            return target.Outcome;
        }

        var staff = target.Staff!;
        var account = target.Account!;
        var now = staff.Now;

        var link = await _linkService.ReissueAsync(account, staff.StaffUserId, now, cancellationToken);
        var sessionsEnded = await EndSessionsAsync(staff.ExerciseId, account.Id, now, cancellationToken);

        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkReissued(
            staff.ExerciseId, staff.Actor, link.Id, account.Id, sessionsEnded, staff.Time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Done(account, link, sessionsEnded);
    }

    /// <summary>
    /// Revokes the participant's link (it stops working and can no longer be copied or printed) and ends their live
    /// sessions. Emits <c>participant.link.revoked</c>. A link that is already revoked, or no link at all, is a no-op.
    /// The person can still sign in with the day word unless disabled (EL-8: revoke is not disable).
    /// </summary>
    /// <param name="accountId">The participant's account id (route value), resolved under the central filter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The action result.</returns>
    public async Task<ParticipantAccessResult> RevokeAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(accountId, cancellationToken);
        if (target.Outcome is not null)
        {
            return target.Outcome;
        }

        var staff = target.Staff!;
        var account = target.Account!;
        var link = target.Link;
        var now = staff.Now;

        if (link is null || !ParticipantLinkService.Revoke(link, staff.StaffUserId, now))
        {
            // Idempotent: nothing to revoke, so nothing ended, written or emitted.
            return Done(account, link, sessionsEnded: 0);
        }

        var sessionsEnded = await EndSessionsAsync(staff.ExerciseId, account.Id, now, cancellationToken);

        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkRevoked(
            staff.ExerciseId, staff.Actor, link.Id, account.Id, sessionsEnded, staff.Time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Done(account, link, sessionsEnded);
    }

    /// <summary>
    /// Disables the person (EL-8): <c>DisabledAt</c> is set and their live sessions end; from then on the link, the day
    /// word and the password sign-in all refuse them. Emits <c>participant.disabled</c>. Disabling again keeps the first
    /// <c>DisabledAt</c> and writes only if a session had to be ended.
    /// </summary>
    /// <param name="accountId">The participant's account id (route value), resolved under the central filter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The action result.</returns>
    public async Task<ParticipantAccessResult> DisableAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(accountId, cancellationToken);
        if (target.Outcome is not null)
        {
            return target.Outcome;
        }

        var staff = target.Staff!;
        var account = target.Account!;
        var now = staff.Now;

        // Keep the ORIGINAL instant on a repeat disable (audit truth).
        account.DisabledAt ??= now;

        var sessionsEnded = await EndSessionsAsync(staff.ExerciseId, account.Id, now, cancellationToken);

        // A first disable always changes the account; a repeat one writes (and emits) only if it found a lingering
        // usable session to end. Otherwise it is a no-op: nothing written, nothing emitted.
        if (_dbContext.ChangeTracker.HasChanges())
        {
            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.ParticipantDisabled(
                staff.ExerciseId, staff.Actor, account.Id, sessionsEnded, staff.Time));
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Done(account, target.Link, sessionsEnded);
    }

    /// <summary>
    /// Enables the person again: clears <c>DisabledAt</c> and changes nothing else (the link, sessions and password are
    /// untouched). Emits <c>participant.enabled</c>. Enabling an enabled person is a no-op.
    /// </summary>
    /// <param name="accountId">The participant's account id (route value), resolved under the central filter.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The action result.</returns>
    public async Task<ParticipantAccessResult> EnableAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var target = await ResolveAsync(accountId, cancellationToken);
        if (target.Outcome is not null)
        {
            return target.Outcome;
        }

        var staff = target.Staff!;
        var account = target.Account!;

        if (account.DisabledAt is not null)
        {
            account.DisabledAt = null;

            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.ParticipantEnabled(
                staff.ExerciseId, staff.Actor, account.Id, sessionsEnded: 0, staff.Time));
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Done(account, target.Link, sessionsEnded: 0);
    }

    /// <summary>
    /// The shared front half of every action: the staff caller and resolved exercise (fail closed: 401), then the account
    /// and its link under the central filter (unknown or another exercise's: 404, indistinguishable).
    /// </summary>
    private async Task<ResolvedTarget> ResolveAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var staff = await ResolveStaffAsync(cancellationToken);
        if (staff is null)
        {
            return new ResolvedTarget(null, null, null, ParticipantAccessResult.Unauthenticated());
        }

        // Tracked: every action may mutate the account. The global filter confines this to the resolved exercise.
        var account = accountId == Guid.Empty
            ? null
            : await _dbContext.Accounts.FirstOrDefaultAsync(a => a.Id == accountId, cancellationToken);
        if (account is null)
        {
            return new ResolvedTarget(null, null, null, ParticipantAccessResult.NotFound());
        }

        var link = await _dbContext.ParticipantLinks.FirstOrDefaultAsync(l => l.AccountId == account.Id, cancellationToken);
        return new ResolvedTarget(staff, account, link, null);
    }

    /// <summary>
    /// The authenticated staff caller on the resolved exercise, or <c>null</c> (fail closed): a live staff session whose
    /// persisted row agrees on owner, kind and bound exercise, on an exercise that exists.
    /// </summary>
    private async Task<StaffCaller?> ResolveStaffAsync(CancellationToken cancellationToken)
    {
        var current = await _currentStaffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (current is null)
        {
            return null;
        }

        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return null;
        }

        var exerciseId = scope.Value;

        // Session is unscoped: looked up by its own id, then re-checked against the accessor and the resolved scope.
        var session = await _dbContext.Sessions
            .AsNoTracking()
            .Where(s => s.Id == current.SessionId)
            .Select(s => new { s.StaffUserId, s.Kind, s.ExerciseId, s.Role })
            .FirstOrDefaultAsync(cancellationToken);

        if (session is null
            || session.StaffUserId != current.StaffUserId
            || !string.Equals(session.Kind, StaffSessionKind, StringComparison.Ordinal)
            || session.ExerciseId != exerciseId)
        {
            return null;
        }

        var facts = await _factsReader.GetAsync(exerciseId, cancellationToken);
        if (facts is null)
        {
            return null;
        }

        var now = _timeProvider.GetUtcNow();
        return new StaffCaller(
            current.StaffUserId,
            exerciseId,
            new EasyLoginStaffActor(current.StaffUserId, session.Role),
            now,
            EasyLoginEventTime.For(exerciseId, facts, _exerciseClock, now));
    }

    /// <summary>
    /// Revokes every still-usable session of <paramref name="accountId"/> in <paramref name="exerciseId"/> (not revoked,
    /// and its access window or refresh window still open) and returns how many it revoked. The <c>ExerciseId</c> and
    /// <c>AccountId</c> predicates are explicit and load-bearing: <see cref="Session"/> has no global query filter
    /// (gotcha 4).
    /// </summary>
    private async Task<int> EndSessionsAsync(Guid exerciseId, Guid accountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var live = await _dbContext.Sessions
            .Where(s => s.ExerciseId == exerciseId
                && s.AccountId == accountId
                && s.RevokedAt == null
                && (s.ExpiresAt > now || s.RefreshExpiresAt > now))
            .ToListAsync(cancellationToken);

        foreach (var session in live)
        {
            session.RevokedAt = now;
        }

        return live.Count;
    }

    private ParticipantAccessResult Done(Account account, ParticipantLink? link, int sessionsEnded) =>
        ParticipantAccessResult.Ok(new RosterActionResultDto
        {
            ParticipantId = account.Id.ToString(),
            Link = _linkDtoFactory.Create(link),
            Access = account.DisabledAt is null ? RosterAccessStates.Enabled : RosterAccessStates.Disabled,
            SessionsEnded = sessionsEnded,
        });

    /// <summary>The resolved staff caller: identity, exercise, the event actor and the action's one clock read.</summary>
    private sealed record StaffCaller(
        Guid StaffUserId,
        Guid ExerciseId,
        EasyLoginStaffActor Actor,
        DateTimeOffset Now,
        EasyLoginEventTime Time);

    /// <summary>Either the resolved caller, account and link, or the fail-closed outcome to return.</summary>
    private sealed record ResolvedTarget(
        StaffCaller? Staff,
        Account? Account,
        ParticipantLink? Link,
        ParticipantAccessResult? Outcome);
}

/// <summary>The outcome kind of a <see cref="ParticipantAccessService"/> action.</summary>
public enum ParticipantAccessOutcome
{
    /// <summary>The action ran (or was an idempotent no-op): <c>200</c> with the result body.</summary>
    Ok,

    /// <summary>No account with that id in the resolved exercise (unknown or another exercise's): <c>404</c>.</summary>
    NotFound,

    /// <summary>No staff caller on the resolved exercise: <c>401</c>, fail closed.</summary>
    Unauthenticated,
}

/// <summary>The result of a staff access action: the outcome and, on success, the frozen result body.</summary>
public sealed class ParticipantAccessResult
{
    private ParticipantAccessResult(ParticipantAccessOutcome outcome, RosterActionResultDto? body)
    {
        Outcome = outcome;
        Body = body;
    }

    /// <summary>Which outcome occurred.</summary>
    public ParticipantAccessOutcome Outcome { get; }

    /// <summary>The <c>RosterActionResultDto</c>; non-null only when <see cref="Outcome"/> is <see cref="ParticipantAccessOutcome.Ok"/>.</summary>
    public RosterActionResultDto? Body { get; }

    /// <summary>A completed action.</summary>
    /// <param name="body">The result body.</param>
    /// <returns>An ok result.</returns>
    public static ParticipantAccessResult Ok(RosterActionResultDto body)
    {
        ArgumentNullException.ThrowIfNull(body);
        return new ParticipantAccessResult(ParticipantAccessOutcome.Ok, body);
    }

    /// <summary>The account was not found in the resolved exercise.</summary>
    /// <returns>A not-found result.</returns>
    public static ParticipantAccessResult NotFound() => new(ParticipantAccessOutcome.NotFound, null);

    /// <summary>No staff caller on the resolved exercise.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static ParticipantAccessResult Unauthenticated() => new(ParticipantAccessOutcome.Unauthenticated, null);
}
