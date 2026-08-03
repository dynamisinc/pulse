namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The shared read-only login funnel behind <c>POST /api/auth/shared</c> (COR-015): it validates the submitted
/// shared password against the <see cref="SharedCredential"/> of the CURRENT host-resolved exercise and, on
/// success, mints a VIEW-ONLY story-03 session with an EPHEMERAL telemetry identity (no named
/// <see cref="Account"/>). It emits exactly one XC-004 <c>login</c> event per attempt — success AND failure —
/// server-stamped, in the same unit of work. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of
/// work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope is the host, never the client (COR-001).</b> The exercise the credential is checked against comes
/// ONLY from <see cref="IExerciseContext.CurrentExerciseId"/> — set by <c>UseExerciseResolution()</c> from the
/// request Host for this anonymous, pre-session request — never from anything in the body. A null/empty scope
/// fails closed (<see cref="SharedReadOnlyLoginOutcome.ScopeUnresolved"/> → 401), so the shared password of
/// exercise A presented on exercise B's host is checked against B's credential (and never A's), and an
/// unprovisioned host authenticates nothing. Because <see cref="SharedCredential"/> is
/// <see cref="IExerciseScoped"/>, the credential lookup is confined to the resolved exercise by the B0 global
/// query filter — the isolation guarantee is inherited, not re-implemented here.
/// </para>
/// <para>
/// <b>View-only + ephemeral identity (COR-015).</b> On success the session is issued with
/// <c>Kind = "readonly"</c>, <c>IsReadOnly = true</c>, and a freshly-generated ephemeral identity used as BOTH
/// the principal id and the acting-human id (there is no named account). That same ephemeral id is carried in
/// <c>actor.sessionId</c> on the login telemetry so views/reach are counted without per-user provisioning. The
/// session's role is <c>participant</c> — a read-only session lands on the participant world (All-Posts, story
/// app-shell/01); its inability to WRITE is enforced separately and server-side by the read-only write guard
/// (<see cref="ReadOnlySessionWriteFilter"/>), keyed off <c>Session.IsReadOnly</c>, not off the role.
/// </para>
/// <para>
/// <b>Grace + lockout + decoy (story 07 integration — the correct home for grace/lockout-aware verification).</b>
/// This login is now the credential-verification arm of the story-07 lifecycle: it accepts the CURRENT password,
/// OR the PREVIOUS password while its rotation grace window (<see cref="SharedCredential.PreviousHashGraceExpiresAt"/>)
/// is still open; it enforces a brute-force LOCKOUT (incrementing <see cref="SharedCredential.FailedAttemptCount"/>
/// on a failed attempt against an otherwise-usable credential, tripping <see cref="SharedCredential.LockedOutUntil"/>
/// at <see cref="SharedCredentialLifecyclePolicy.MaxFailedAttempts"/> and rejecting EVERY attempt — even a correct
/// password — while locked, resetting the counter on success); and, on any NEGATIVE path (absent / disabled /
/// revoked / locked / passwordless credential), it runs a fixed-cost DECOY verify so the PBKDF2 cost is paid
/// regardless of credential state — closing the enabled-state timing oracle. It therefore now MUTATES the tracked
/// credential row within the same unit of work as its telemetry. Server-authoritative: one wall-clock read is
/// shared by the telemetry timestamps; scenario time is the exercise's stored
/// <see cref="Exercise.CurrentScenarioTime"/> (a documented B2 placeholder until the COR-050 backend clock lands
/// in B3). The password is never logged (NFR-009). Rotation and immediate revoke themselves live in
/// <see cref="SharedCredentialLifecycleService"/>.
/// </para>
/// </remarks>
public sealed class SharedReadOnlyLoginService
{
    private const string ReadOnlySessionKind = "readonly";
    private const string ReadOnlySessionRole = "participant";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string LoginEventType = "login";
    private const string LockoutEventType = "auth.lockout";
    private const string SharedCredentialEntityType = "sharedCredential";
    private const string SchemaVersion = "v0";
    private const string SuccessOutcomePayload = "{\"outcome\":\"success\"}";
    private const string FailureOutcomePayload = "{\"outcome\":\"failure\"}";
    private const int MaxPasswordLength = 1024;

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ISharedCredentialHasher _hasher;
    private readonly ISessionIssuer _sessionIssuer;

    /// <summary>Creates the shared read-only login funnel over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the login telemetry is written through (credential lookup is scope-filtered).</param>
    /// <param name="exerciseContext">The server-authoritative host-resolved exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="hasher">The slow-KDF verifier the submitted password is checked against (NFR-009).</param>
    /// <param name="sessionIssuer">The story-03 session-issuance seam this login calls to mint the view-only session.</param>
    public SharedReadOnlyLoginService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ISharedCredentialHasher hasher,
        ISessionIssuer sessionIssuer)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(hasher);
        ArgumentNullException.ThrowIfNull(sessionIssuer);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _hasher = hasher;
        _sessionIssuer = sessionIssuer;
    }

    /// <summary>
    /// Authenticates a shared read-only login attempt and, on success, mints a view-only session with an
    /// ephemeral identity. Emits exactly one XC-004 <c>login</c> event (success or failure) in one unit of work,
    /// then issues the session through the story-03 issuer.
    /// </summary>
    /// <param name="request">The login request (the shared password). The password is never logged.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status: authenticated (session), invalid (400), rejected (401), or scope-unresolved (401).</returns>
    public async Task<SharedReadOnlyLoginResult> LoginAsync(
        SharedReadOnlyLoginRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Validate the request shape (400). The password is bounded (DoS guard) but never trimmed / logged.
        if (string.IsNullOrEmpty(request.Password) || request.Password.Length > MaxPasswordLength)
        {
            return SharedReadOnlyLoginResult.Invalid("password is required (1-1024 characters).");
        }

        // 2. Scope comes ONLY from the host-resolved IExerciseContext (COR-001). Fail closed on an unresolved
        //    scope: no exercise resolved for this host → no credential to check → 401 (never a default session).
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return SharedReadOnlyLoginResult.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // 3. Load the resolved exercise for the telemetry envelope (scenario time + time zone). Exercise is the
        //    scope root (never IExerciseScoped), so this by-id read is unfiltered. A resolved scope with no
        //    backing exercise cannot carry valid scoped telemetry — fail closed with no event.
        // org-scope-exempt(ResolvedScope): exerciseId is scope.Value from IExerciseContext (host-resolved),
        // never a login-body field, so this read is confined to the exercise the caller actually reached.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return SharedReadOnlyLoginResult.ScopeUnresolved();
        }

        var now = DateTimeOffset.UtcNow;
        var scenarioTime = exercise.CurrentScenarioTime ?? now;

        // 4. Load THIS exercise's shared credential (TRACKED — story 07 mutates it: failed-attempt counting on a
        //    failure, and the counter reset on success). The B0 global query filter confines SharedCredential to
        //    the resolved scope, so this returns the one credential for the host's exercise (or null) — never
        //    another exercise's.
        var credential = await _dbContext.SharedCredentials
            .FirstOrDefaultAsync(cancellationToken);

        // 5. Brute-force lockout gate (story 07): while locked, EVERY attempt is rejected — even a correct
        //    password — until the window elapses.
        var locked = credential?.LockedOutUntil is { } lockedUntil && lockedUntil > now;

        // A credential can authenticate only when it is enabled, not revoked, not locked, and actually holds a
        // current password. Anything else takes the NEGATIVE path (which still fails closed identically to a
        // wrong password — the response never distinguishes "no credential" from "wrong password").
        var canAuthenticate =
            credential is { IsEnabled: true, RevokedAt: null } &&
            !locked &&
            !string.IsNullOrEmpty(credential.CurrentHash);

        bool authenticated;
        if (canAuthenticate)
        {
            // The CURRENT password, OR the PREVIOUS password while its rotation grace window is still open
            // (story 07 rotation-with-grace: valid until PreviousHashGraceExpiresAt, then rejected).
            authenticated =
                _hasher.Verify(credential!.CurrentHash, request.Password) ||
                (!string.IsNullOrEmpty(credential.PreviousHash) &&
                 credential.PreviousHashGraceExpiresAt is { } graceExpiry &&
                 graceExpiry > now &&
                 _hasher.Verify(credential.PreviousHash, request.Password));
        }
        else
        {
            // NEGATIVE path (absent / disabled / revoked / locked / passwordless credential): run a DECOY verify
            // against a fixed dummy hash so the PBKDF2 cost is paid regardless of credential state — no
            // enabled-state timing oracle (story-07 fold of the story-06 Gate-1 Minor). Always returns false.
            authenticated = _hasher.VerifyDecoy(request.Password);
        }

        if (!authenticated)
        {
            // Brute-force accounting: only a wrong password against an OTHERWISE-USABLE credential counts toward
            // lockout (an absent/disabled/revoked/already-locked credential accrues nothing — the per-IP rate
            // limit and, once locked, the existing lockout already throttle those). Crossing the threshold trips
            // a fixed lockout window, resets the counter, and emits an additive-vocab auth.lockout event.
            if (canAuthenticate && credential is not null)
            {
                // Non-atomic read-modify-write with no concurrency token: under parallel failures an increment
                // can be lost, so the lockout may trip a little later than the threshold. Accepted backstop
                // weakening bounded by the per-IP rate limit — see SharedCredentialLifecyclePolicy remarks (Gate-1).
                credential.FailedAttemptCount++;
                if (credential.FailedAttemptCount >= SharedCredentialLifecyclePolicy.MaxFailedAttempts)
                {
                    credential.LockedOutUntil = now + SharedCredentialLifecyclePolicy.LockoutDuration;
                    credential.FailedAttemptCount = 0;
                    _dbContext.TelemetryEvents.Add(BuildLockoutTelemetry(
                        exerciseId, credential.Id, now, scenarioTime, exercise.TimeZone));
                }
            }

            // Failure: one XC-004 login event with NO session identity (no session was minted). The failed-attempt
            // mutation (and any lockout-trip event) share this SINGLE unit of work.
            _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
                exerciseId, sessionId: null, outcome: FailureOutcomePayload,
                now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return SharedReadOnlyLoginResult.Rejected();
        }

        // 6. Success. The ephemeral identity (COR-015) is a fresh id used as BOTH principal + acting-human and
        //    carried in actor.sessionId so reach is counted without a named account. Emit the one success event
        //    in its own unit of work, THEN mint the session through the story-03 issuer (which owns Session
        //    persistence + the raw token in a separate SaveChanges — mirroring StaffLoginService, so a single
        //    login is never double-counted).
        var ephemeralIdentity = Guid.NewGuid().ToString();

        // Success resets the brute-force counter and clears any residual lockout (story 07: "reset the counter on
        // success"). The credential is tracked and non-null on this path (canAuthenticate required it), so this
        // persists in the SAME single unit of work as the success telemetry below.
        credential!.FailedAttemptCount = 0;
        credential.LockedOutUntil = null;

        _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
            exerciseId, sessionId: ephemeralIdentity, outcome: SuccessOutcomePayload,
            now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone));
        await _dbContext.SaveChangesAsync(cancellationToken);

        var issued = await _sessionIssuer.IssueAsync(
            new SessionIssueRequest
            {
                ExerciseId = exerciseId,
                Kind = ReadOnlySessionKind,
                Role = ReadOnlySessionRole,
                PrincipalId = ephemeralIdentity,
                ActingHumanId = ephemeralIdentity,
                IsReadOnly = true,
                AccountId = null,
                StaffUserId = null,
                PersonaId = null,
            },
            cancellationToken);

        return SharedReadOnlyLoginResult.Authenticated(issued);
    }

    /// <summary>
    /// Builds one XC-004 shared read-only login event against the locked v0 envelope: <c>actor.kind: 'system'</c>
    /// with <c>actor.sessionId</c> = the ephemeral identity on success (COR-015 reach counting) and NO
    /// <c>participantId</c> — which satisfies the frozen v0 <c>superRefine</c> (a <c>participantId</c> is
    /// required only when <c>kind === 'participant'</c>). <c>channel: 'system'</c>, event type <c>login</c>. The
    /// off-envelope empty <c>sessionId</c> on a failure is null-omitted (the v0 schema types the optional actor
    /// ids as <c>min(1).optional()</c>).
    /// </summary>
    private static TelemetryEvent BuildLoginTelemetry(
        Guid exerciseId,
        string? sessionId,
        string outcome,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = exerciseId,
        EventType = LoginEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            SessionId = string.IsNullOrEmpty(sessionId) ? null : sessionId,
        },
        WallClockTime = now,
        ScenarioTime = scenarioTime,
        TimeZone = timeZone,
        Payload = outcome,
        EmittedAt = now,
    };

    /// <summary>
    /// Builds the XC-004 <c>auth.lockout</c> event emitted when a failed attempt trips the brute-force lockout
    /// (additive vocab). <c>actor.kind: 'system'</c> with NO acting human or role — the lockout is a SYSTEM
    /// defence reacting to anonymous shared-login brute force, not a staff action — <c>channel: 'system'</c>,
    /// target = the shared credential.
    /// </summary>
    private static TelemetryEvent BuildLockoutTelemetry(
        Guid exerciseId,
        Guid credentialId,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = exerciseId,
        EventType = LockoutEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor { Kind = SystemActorKind },
        WallClockTime = now,
        ScenarioTime = scenarioTime,
        TimeZone = timeZone,
        Target = new TelemetryTarget { EntityType = SharedCredentialEntityType, EntityId = credentialId.ToString() },
        Payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"lockoutMinutes\":{(int)SharedCredentialLifecyclePolicy.LockoutDuration.TotalMinutes}}}"),
        EmittedAt = now,
    };
}

/// <summary>The outcome kind of a <see cref="SharedReadOnlyLoginService.LoginAsync"/> call.</summary>
public enum SharedReadOnlyLoginOutcome
{
    /// <summary>The shared password matched an enabled, non-revoked credential and a view-only session was issued.</summary>
    Authenticated,

    /// <summary>The request failed validation (missing / oversized password) — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The credential was bad / absent / disabled / revoked, or the password was wrong — the endpoint returns 401 (fail closed, no session).</summary>
    Rejected,

    /// <summary>No exercise scope was resolved from the host — the endpoint returns 401 (fail closed, no session, no telemetry).</summary>
    ScopeUnresolved,
}

/// <summary>
/// The result of a shared read-only login attempt. <see cref="SharedReadOnlyLoginOutcome.Authenticated"/>
/// carries the issued session; <see cref="SharedReadOnlyLoginOutcome.Invalid"/> carries a human-readable reason;
/// the fail-closed outcomes carry neither.
/// </summary>
public sealed class SharedReadOnlyLoginResult
{
    private SharedReadOnlyLoginResult(SharedReadOnlyLoginOutcome outcome, SessionIssueResult? issued, string? validationError)
    {
        Outcome = outcome;
        Issued = issued;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public SharedReadOnlyLoginOutcome Outcome { get; }

    /// <summary>The issued session + raw token(s) — non-null only when <see cref="Outcome"/> is <see cref="SharedReadOnlyLoginOutcome.Authenticated"/>.</summary>
    public SessionIssueResult? Issued { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="SharedReadOnlyLoginOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful login carrying the issued view-only session.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <returns>An authenticated result.</returns>
    public static SharedReadOnlyLoginResult Authenticated(SessionIssueResult issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new SharedReadOnlyLoginResult(SharedReadOnlyLoginOutcome.Authenticated, issued, null);
    }

    /// <summary>A rejected request (missing / oversized password).</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static SharedReadOnlyLoginResult Invalid(string validationError) =>
        new(SharedReadOnlyLoginOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for a bad / absent / disabled / revoked credential or a wrong password.</summary>
    /// <returns>A rejected result.</returns>
    public static SharedReadOnlyLoginResult Rejected() => new(SharedReadOnlyLoginOutcome.Rejected, null, null);

    /// <summary>The fail-closed result for an unresolved host exercise scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static SharedReadOnlyLoginResult ScopeUnresolved() => new(SharedReadOnlyLoginOutcome.ScopeUnresolved, null, null);
}

/// <summary>
/// The <c>POST /api/auth/shared</c> request body (camelCase JSON). The <see cref="Password"/> is nullable so a
/// missing field is a validation concern (a 400), never a deserialization failure; it is never logged or
/// persisted in the clear (NFR-009). No <c>exerciseId</c> is accepted — the exercise is the host-resolved scope
/// (COR-001), never client-supplied.
/// </summary>
public sealed class SharedReadOnlyLoginRequest
{
    /// <summary>The shared, view-only password for the exercise — validated, never logged or persisted.</summary>
    public string? Password { get; init; }
}
