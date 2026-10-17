namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The personal-link sign-in behind <c>POST /api/auth/join { token }</c> (easy-login/03, EL-7): the sibling of
/// <c>ParticipantLoginService</c>. A token whose link is active, in the HOST-RESOLVED exercise, for an enabled account,
/// while the exercise is Staged/Live/Paused, mints exactly the participant session a password sign-in mints
/// (<see cref="ParticipantSessionRequests"/>). Anything else is one uniform refusal. Scoped, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>One code path for every refusal.</b> The lookup is a single equality match on <c>ParticipantLink.TokenHash</c>
/// (with <c>RevokedAt</c> unset) joined to its account, so an unknown, malformed, revoked or superseded token, a token
/// from another exercise, a disabled account, an account outside the participant world (Gate-2 S-6: only
/// <c>participant</c> / <c>pio</c>, the rule the day word applies) and a closed exercise all take the same path: one
/// indexed read, one identity-less failure event, <see cref="JoinLoginOutcome.Rejected"/>. A token is 128 random bits,
/// so there is no slow KDF to equalise: every attempt is the same cheap work.
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> The exercise is ONLY <see cref="IExerciseContext.CurrentExerciseId"/>,
/// which host resolution set for this anonymous request; the body carries a token and nothing else. Links and accounts
/// are read under the central exercise filter, so a token minted in exercise B presented on exercise A's host matches no
/// row: it is an unknown token.
/// </para>
/// <para>
/// <b>A staff action racing the join (Gate-1 W-001).</b> Staff can revoke, reissue or disable between the lookup and
/// the session being minted, and the staff action's session sweep cannot see a session that does not exist yet. So the
/// session is minted FIRST and the link and account are re-read AFTER it exists: a staff change committed before the
/// re-read is caught here (the fresh session is revoked and the attempt is the uniform refusal). A Disable that commits
/// after the re-read reads the sessions to end only AFTER that commit (Gate-2 S-2), when this session already exists, so
/// its own sweep ends it: no window is left for Disable. A revoke or reissue saves its link change and its sweep
/// together, so one that read the sessions just before this one was committed and saves just after the re-read can
/// still miss it: a window of milliseconds, narrowed by the conditional use-counter <c>UPDATE</c> below (which refuses if
/// the link changed before it), and pressing Reissue or Revoke again ends such a lingering session. The use is recorded,
/// and the one <c>login</c> event written, only once the re-read passes, so a raced attempt emits exactly one
/// identity-less failure event and no success event.
/// </para>
/// <para>
/// <b>The use counter (Gate-2 S-4).</b> <c>UseCount</c> and <c>LastUsedAt</c> are bumped with one conditional
/// <c>UPDATE</c> (<c>UseCount = UseCount + 1</c> where the link still carries THIS token's hash and is not revoked), in
/// one transaction with the success event and <c>LastLoginAt</c>. A reissue or revoke that commits after the re-read
/// therefore cannot have its reset overwritten by a stale count: the update matches no row, the transaction rolls back,
/// and the attempt ends as the same raced refusal as above.
/// </para>
/// <para>
/// <b>COR-011.</b> Nothing here creates or edits an account beyond the sign-in bookkeeping (<c>LastLoginAt</c>, and the
/// link's <c>LastUsedAt</c> / <c>UseCount</c>). The link is reusable until revoked or reissued; using it never expires it.
/// </para>
/// <para>
/// <b>Secrets.</b> The token is hashed and dropped. It is never logged, never in telemetry (the failure event has no
/// target), never in any response body.
/// </para>
/// </remarks>
public sealed class JoinLoginService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ISessionIssuer _sessionIssuer;
    private readonly ExerciseFactsReader _factsReader;
    private readonly TimeProvider _timeProvider;
    private readonly IExerciseClock? _exerciseClock;

    /// <summary>Creates the join funnel over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the sign-in bookkeeping and the event are written through.</param>
    /// <param name="exerciseContext">The host-resolved exercise scope (the only scoping source).</param>
    /// <param name="sessionIssuer">Mints the participant session (the same seam <c>/api/auth/login</c> uses).</param>
    /// <param name="factsReader">The exercise's lifecycle state, zone and stored scenario time (EL-17's one read).</param>
    /// <param name="timeProvider">The server clock (one read per attempt).</param>
    /// <param name="exerciseClock">The native exercise clock for scenario time, when the host has one.</param>
    public JoinLoginService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ISessionIssuer sessionIssuer,
        ExerciseFactsReader factsReader,
        TimeProvider timeProvider,
        IExerciseClock? exerciseClock = null)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionIssuer);
        ArgumentNullException.ThrowIfNull(factsReader);
        ArgumentNullException.ThrowIfNull(timeProvider);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionIssuer = sessionIssuer;
        _factsReader = factsReader;
        _timeProvider = timeProvider;
        _exerciseClock = exerciseClock;
    }

    /// <summary>
    /// Exchanges a personal-link token for a participant session in the host-resolved exercise. Emits exactly one
    /// XC-004 <c>login</c> event (<c>method: link</c>) per attempt that reaches a resolved exercise, in the same unit of
    /// work as the sign-in bookkeeping (success) or the revocation of a raced session (failure).
    /// </summary>
    /// <param name="request">The join body. Its token is never logged.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Authenticated (with the session), Invalid (400), or a fail-closed refusal (401).</returns>
    public async Task<JoinLoginResult> JoinAsync(JoinRequestBody? request, CancellationToken cancellationToken = default)
    {
        // 1. Shape (400): a missing body or an empty token. Anything else non-empty is looked up as-is.
        var token = request?.Token;
        if (string.IsNullOrWhiteSpace(token))
        {
            return JoinLoginResult.Invalid("token is required.");
        }

        // 2. Scope from host resolution ONLY. Unresolved, or no such exercise: refuse with no event (nothing valid to
        //    stamp one against).
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return JoinLoginResult.ScopeUnresolved();
        }

        var facts = await _factsReader.GetAsync(scope.Value, cancellationToken);
        if (facts is null)
        {
            return JoinLoginResult.ScopeUnresolved();
        }

        var now = _timeProvider.GetUtcNow();
        var time = EasyLoginEventTime.For(scope.Value, facts, _exerciseClock, now);

        // 3. One hash comparison, under the central filter (both sides are exercise-scoped). Revoked and superseded
        //    tokens fall out of the same predicate as unknown ones. Tracked: success updates both rows.
        var tokenHash = ParticipantLinkTokens.Hash(token);
        var match = await (
                from link in _dbContext.ParticipantLinks
                where link.TokenHash == tokenHash && link.RevokedAt == null
                join account in _dbContext.Accounts on link.AccountId equals account.Id
                join enrollment in _dbContext.Enrollments on account.EnrollmentId equals enrollment.Id
                select new { Link = link, Account = account, Enrollment = enrollment })
            .FirstOrDefaultAsync(cancellationToken);

        // 4. Admit only an enabled participant-world account (participant / pio, as for the day word: Gate-2 S-6) in an
        //    exercise participants may enter (EL-8, EL-11). Every other case is the same refusal and the same
        //    identity-less event: no target, never the token.
        if (match is null
            || match.Account.DisabledAt is not null
            || !ParticipantSessionRequests.IsParticipantWorldRole(match.Enrollment.Role)
            || !ExerciseLifecycleStates.IsParticipantAccessible(facts.Status))
        {
            _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkLoginFailed(scope.Value, time));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return JoinLoginResult.Rejected();
        }

        // 5. Exactly the session /api/auth/login mints (persona, acting human, role, never read-only). The issuer commits
        //    it; nothing about the use is recorded yet.
        var issued = await _sessionIssuer.IssueAsync(
            ParticipantSessionRequests.For(match.Account, scope.Value), cancellationToken);

        // 6. W-001: re-read, untracked, now that the session exists. A revoke, reissue or disable committed before this
        //    read fails the check. A Disable that commits after it sweeps only after committing (Gate-2 S-2), so it ends
        //    this session; a revoke or reissue that commits after it is caught by the conditional use-counter UPDATE in
        //    step 7 when it lands first, and otherwise leaves the narrow window described on the class.
        var linkId = match.Link.Id;
        var accountId = match.Account.Id;
        var stillAdmitted = await (
                from link in _dbContext.ParticipantLinks.AsNoTracking()
                where link.Id == linkId && link.TokenHash == tokenHash && link.RevokedAt == null
                join account in _dbContext.Accounts.AsNoTracking() on link.AccountId equals account.Id
                where account.Id == accountId && account.DisabledAt == null
                select link.Id)
            .AnyAsync(cancellationToken);

        if (!stillAdmitted)
        {
            return await RefuseRacedAsync(issued.Session.Id, scope.Value, time, cancellationToken);
        }

        // 7. Success: the bookkeeping and the success event in ONE transaction. The use counter is one conditional
        //    UPDATE (Gate-2 S-4): it increments in the database, and only while the link still carries THIS token and
        //    is not revoked, so a reissue's or revoke's reset that committed after the re-read is never overwritten by a
        //    stale count. Only the use columns are written, so a concurrent staff change to other columns is not
        //    overwritten either. The link stays usable. The update runs through the scoped set, so the central filter
        //    bounds its WHERE too; it never touches ExerciseId, so the write guard (which it bypasses) has nothing to
        //    check.
        DateTimeOffset? usedAt = now;
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            var bumped = await _dbContext.ParticipantLinks
                .Where(link => link.Id == linkId && link.TokenHash == tokenHash && link.RevokedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(link => link.UseCount, link => link.UseCount + 1)
                        .SetProperty(link => link.LastUsedAt, usedAt),
                    cancellationToken);

            if (bumped == 1)
            {
                match.Account.LastLoginAt = now;
                _dbContext.TelemetryEvents.Add(
                    EasyLoginTelemetry.LoginSucceeded(scope.Value, accountId, EasyLoginMethod.Link, time));
                await _dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                return JoinLoginResult.Authenticated(issued);
            }

            // The link was reissued or revoked after the re-read: nothing was written. Refuse as for any other race.
            await transaction.RollbackAsync(cancellationToken);
        }

        return await RefuseRacedAsync(issued.Session.Id, scope.Value, time, cancellationToken);
    }

    /// <summary>
    /// The refusal for an attempt that lost a race to a staff action after its session was minted: ends that session
    /// (an explicit <c>ExerciseId</c> predicate, since <c>Session</c> is unscoped) and records the attempt as the same
    /// identity-less failure every other refusal records, in one unit of work. No success event was written for it.
    /// </summary>
    private async Task<JoinLoginResult> RefuseRacedAsync(
        Guid issuedSessionId,
        Guid exerciseId,
        EasyLoginEventTime time,
        CancellationToken cancellationToken)
    {
        var raced = await _dbContext.Sessions
            .FirstOrDefaultAsync(s => s.Id == issuedSessionId && s.ExerciseId == exerciseId, cancellationToken);
        if (raced is not null)
        {
            // A fresh read: the issuer stamped IssuedAt after this attempt's first clock read.
            raced.RevokedAt ??= _timeProvider.GetUtcNow();
        }

        _dbContext.TelemetryEvents.Add(EasyLoginTelemetry.LinkLoginFailed(exerciseId, time));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return JoinLoginResult.Rejected();
    }
}

/// <summary>The outcome kind of a <see cref="JoinLoginService.JoinAsync"/> call.</summary>
public enum JoinLoginOutcome
{
    /// <summary>The token signed the participant in; a session was issued (<c>200</c>).</summary>
    Authenticated,

    /// <summary>A missing body or an empty token (<c>400</c>).</summary>
    Invalid,

    /// <summary>
    /// Any other refusal: unknown, malformed, revoked, superseded or another exercise's token, a disabled account, an
    /// account role outside the participant world, or an exercise outside Staged/Live/Paused (<c>401</c>, bodyless). One
    /// failure event was emitted.
    /// </summary>
    Rejected,

    /// <summary>No exercise resolved from the host, or no such exercise (<c>401</c>, bodyless, no event).</summary>
    ScopeUnresolved,
}

/// <summary>The result of a join attempt: the outcome, plus the issued session or the validation reason.</summary>
public sealed class JoinLoginResult
{
    private JoinLoginResult(JoinLoginOutcome outcome, SessionIssueResult? issued, string? validationError)
    {
        Outcome = outcome;
        Issued = issued;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public JoinLoginOutcome Outcome { get; }

    /// <summary>The issued session and raw tokens; non-null only when <see cref="Outcome"/> is <see cref="JoinLoginOutcome.Authenticated"/>.</summary>
    public SessionIssueResult? Issued { get; }

    /// <summary>The readable reason; non-null only when <see cref="Outcome"/> is <see cref="JoinLoginOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful join.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <returns>An authenticated result.</returns>
    public static JoinLoginResult Authenticated(SessionIssueResult issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new JoinLoginResult(JoinLoginOutcome.Authenticated, issued, null);
    }

    /// <summary>A malformed request.</summary>
    /// <param name="validationError">The readable reason (never echoes the token).</param>
    /// <returns>An invalid result.</returns>
    public static JoinLoginResult Invalid(string validationError) => new(JoinLoginOutcome.Invalid, null, validationError);

    /// <summary>The uniform refusal.</summary>
    /// <returns>A rejected result.</returns>
    public static JoinLoginResult Rejected() => new(JoinLoginOutcome.Rejected, null, null);

    /// <summary>The refusal for an unresolved host scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static JoinLoginResult ScopeUnresolved() => new(JoinLoginOutcome.ScopeUnresolved, null, null);
}
