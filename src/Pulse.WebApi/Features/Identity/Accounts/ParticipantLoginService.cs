namespace Pulse.WebApi.Features.Identity.Accounts;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The participant credential-login funnel behind <c>POST /api/auth/login</c> (COR-011). It verifies a
/// <c>{username, password}</c> against an <see cref="Account"/> IN THE HOST-RESOLVED EXERCISE (story 08 →
/// <see cref="IExerciseContext"/>) and, on success, mints a <c>participant</c>-kind story-03 session through the
/// injected <see cref="ISessionIssuer"/>. Everything fails CLOSED: an unresolved host scope, an unknown handle,
/// a credential-less account, or a wrong password all yield NO session. It emits exactly one XC-004 <c>login</c>
/// event per attempt (success AND failure) in the same unit of work as the account mutation. Scoped lifetime,
/// matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, XC-001/COR-001).</b> The account lookup runs through the B0 GLOBAL query
/// filter, which confines it to <see cref="IExerciseContext.CurrentExerciseId"/> — the host-resolved exercise
/// for this pre-auth request. A handle that exists only in exercise B is therefore INVISIBLE on exercise A's
/// host, so a cross-exercise login can never resolve. The scope is NEVER taken from the request body.
/// </para>
/// <para>
/// <b>No self-registration.</b> This service exposes only login; there is no create-account path here (COR-011 —
/// participants never provision their own accounts; that is the staff-only <see cref="AccountProvisioningService"/>).
/// </para>
/// <para>
/// <b>Server-authoritative &amp; scenario time.</b> Wall-clock is the server clock (one read shared by the
/// account mutation and its telemetry). Scenario time is the exercise's stored
/// <see cref="Exercise.CurrentScenarioTime"/> (a documented B2 placeholder until the COR-050 backend clock lands
/// in B3; falls back to the wall clock when unset). Brute-force lockout is deliberately NOT handled here (it is
/// story 07); per-IP rate limiting is applied at the endpoint (NFR-009). The password is never logged (NFR-009).
/// </para>
/// </remarks>
public sealed class ParticipantLoginService
{
    private const string ParticipantSessionKind = "participant";
    private const string ParticipantActorKind = "participant";

    /// <summary>The v0 actor kind for an identity-less (failed) attempt — see <see cref="BuildLoginTelemetry"/> (#356).</summary>
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string LoginEventType = "login";
    private const string AttemptedHandleTargetType = "accountHandle";
    private const string SuccessOutcomePayload = "{\"outcome\":\"success\"}";
    private const string FailureOutcomePayload = "{\"outcome\":\"failure\"}";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ISessionIssuer _sessionIssuer;
    private readonly ParticipantPasswordHasher _passwordHasher;

    /// <summary>Creates the participant-login funnel over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the account mutation and telemetry event are written through.</param>
    /// <param name="exerciseContext">The host-resolved exercise scope the login matches an account against.</param>
    /// <param name="sessionIssuer">The story-03 session-issuance seam this login calls to mint the participant session.</param>
    /// <param name="passwordHasher">The slow-KDF credential verifier (constant-time, enumeration-resistant).</param>
    public ParticipantLoginService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ISessionIssuer sessionIssuer,
        ParticipantPasswordHasher passwordHasher)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionIssuer);
        ArgumentNullException.ThrowIfNull(passwordHasher);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionIssuer = sessionIssuer;
        _passwordHasher = passwordHasher;
    }

    /// <summary>
    /// Authenticates a participant login attempt in the host-resolved exercise and, on success, mints a
    /// participant session. Emits exactly one XC-004 <c>login</c> event (success or failure) in the same unit of
    /// work as the account mutation.
    /// </summary>
    /// <param name="request">The login request (username, password). The password is never logged.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status: authenticated (session), invalid input (400), rejected credential (401), or unresolved scope (401).</returns>
    public async Task<ParticipantLoginResult> LoginAsync(ParticipantLoginRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Validate the request shape (400). Sanitize the handle identically to how it is sanitized on ingest,
        //    so a legitimate (markup-free) handle round-trips to the stored value. The password is bounded (a DoS
        //    guard on the slow KDF) but never trimmed / normalized / logged.
        var rawUsername = request.Username?.Trim();
        if (string.IsNullOrEmpty(rawUsername))
        {
            return ParticipantLoginResult.Invalid("username is required.");
        }

        if (string.IsNullOrEmpty(request.Password) || request.Password.Length > AccountFieldRules.MaxPasswordLength)
        {
            return ParticipantLoginResult.Invalid($"password is required (1-{AccountFieldRules.MaxPasswordLength} characters).");
        }

        var username = PostSanitizer.Sanitize(rawUsername).Trim();
        if (username.Length == 0)
        {
            return ParticipantLoginResult.Invalid("username is required.");
        }

        // 2. Scope comes ONLY from the resolved exercise context (host-resolved for this pre-auth request), never
        //    the body. An unresolved scope fails closed (401) with no telemetry — there is no valid exercise to
        //    stamp an event against.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return ParticipantLoginResult.ScopeUnresolved();
        }

        // 3. R6: the resolved scope must be a live Exercise before anything is stamped with it. Exercise is the
        //    unscoped scope root, so this read is unfiltered.
        // org-scope-exempt(ResolvedScope): scope.Value is the host-resolved exercise from IExerciseContext,
        // never a login-body field, so this read is confined to the exercise the participant reached.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == scope.Value, cancellationToken);

        if (exercise is null)
        {
            return ParticipantLoginResult.ScopeUnresolved();
        }

        var now = DateTimeOffset.UtcNow;
        var scenarioTime = exercise.CurrentScenarioTime ?? now;

        // 4. Resolve the account within the host-resolved scope. The GLOBAL query filter confines this to the
        //    resolved exercise — a handle from another exercise is simply invisible (the isolation guarantee).
        //    Tracked (not AsNoTracking): a successful login updates LastLoginAt.
        var account = await _dbContext.Accounts
            .FirstOrDefaultAsync(a => a.Username == username, cancellationToken);

        // 5. Verify the credential. Verify() runs an equivalent PBKDF2 derivation even when the account is unknown
        //    or credential-less, so timing does not distinguish those cases from a wrong password (enumeration
        //    resistance). A null/empty stored hash can never authenticate.
        var authenticated = _passwordHasher.Verify(account?.CredentialHash, request.Password);

        if (account is null || !authenticated)
        {
            // Fail closed: no session, and a failure event with NO session identity (target = the sanitized
            // attempted handle for audit). One SaveChanges — the write-guard runs here against the valid scope.
            _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
                scope.Value, participantId: null, outcome: FailureOutcomePayload, now: now,
                scenarioTime: scenarioTime, timeZone: exercise.TimeZone, attemptedHandle: username));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return ParticipantLoginResult.RejectedCredential();
        }

        // 6. Success: record the last successful login and emit one success event in ONE unit of work with the
        //    mutation (the write-guard validates the scoped telemetry row carries the non-empty ExerciseId).
        account.LastLoginAt = now;
        _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
            scope.Value, participantId: account.Id.ToString(), outcome: SuccessOutcomePayload, now: now,
            scenarioTime: scenarioTime, timeZone: exercise.TimeZone, attemptedHandle: null));
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 7. Mint the participant session through the story-03 issuer (it owns Session persistence + the raw
        //    token). Bound exercise = the host-resolved scope; principal/persona/acting-human come from the
        //    account. ActingHumanId derives from the account id when the account carries none (COR-018 1:1 case).
        var issued = await _sessionIssuer.IssueAsync(
            new SessionIssueRequest
            {
                ExerciseId = scope.Value,
                Kind = ParticipantSessionKind,
                Role = account.Role,
                PrincipalId = account.Id.ToString(),
                ActingHumanId = string.IsNullOrEmpty(account.ActingHumanId) ? account.Id.ToString() : account.ActingHumanId,
                IsReadOnly = false,
                AccountId = account.Id,
                StaffUserId = null,
                PersonaId = account.PersonaId,
            },
            cancellationToken);

        return ParticipantLoginResult.Authenticated(issued);
    }

    /// <summary>
    /// Builds one XC-004 participant-login event against the locked v0 envelope: <c>channel: 'system'</c>, event
    /// type <c>login</c>. On SUCCESS the actor is the participant (<c>actor.kind: 'participant'</c> +
    /// <c>participantId</c> = the account id); on FAILURE no account was resolved, so the actor is the SYSTEM
    /// recording an identity-less attempt (<c>actor.kind: 'system'</c>) and <c>target</c> carries the sanitized
    /// attempted handle instead. All off-envelope empty strings are null-omitted (the v0 schema types optional
    /// ids as <c>min(1).optional()</c>).
    /// </summary>
    /// <remarks>
    /// The actor kind is DERIVED from whether an identity was resolved, never hardcoded (#356). The v0 envelope
    /// conditionally requires <c>actor.participantId</c> whenever <c>actor.kind</c> is <c>'participant'</c>
    /// (<c>telemetryEventV0Schema.superRefine</c> / <see cref="TelemetryEnvelopeRules"/>), so claiming the
    /// participant kind for an attempt that resolved NO participant emits a row the <c>POST /api/telemetry</c>
    /// ingest mirror rejects with a 400 — and which the <c>PulseDbContext</c> write-guard now blocks outright.
    /// <c>'system'</c> is the correct kind for an identity-less auth attempt and matches what the sibling
    /// <c>StaffLoginService</c> and <c>SharedReadOnlyLoginService</c> already stamp.
    /// </remarks>
    private static TelemetryEvent BuildLoginTelemetry(
        Guid exerciseId,
        string? participantId,
        string outcome,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone,
        string? attemptedHandle) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = "v0",
        ExerciseId = exerciseId,
        EventType = LoginEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            // Derived, not hardcoded: an identity-less (failed) attempt is a SYSTEM actor, because the v0
            // envelope requires participantId whenever kind is 'participant' (#356).
            Kind = string.IsNullOrEmpty(participantId) ? SystemActorKind : ParticipantActorKind,
            ParticipantId = string.IsNullOrEmpty(participantId) ? null : participantId,
        },
        WallClockTime = now,
        ScenarioTime = scenarioTime,
        TimeZone = string.IsNullOrEmpty(timeZone) ? FallbackTimeZone : timeZone,
        Target = string.IsNullOrEmpty(attemptedHandle)
            ? null
            : new TelemetryTarget { EntityType = AttemptedHandleTargetType, EntityId = attemptedHandle },
        Payload = outcome,
        EmittedAt = now,
    };
}

/// <summary>The outcome kind of a <see cref="ParticipantLoginService.LoginAsync"/> call.</summary>
public enum ParticipantLoginOutcome
{
    /// <summary>Credentials verified against an in-exercise account and a participant session was issued.</summary>
    Authenticated,

    /// <summary>The request failed validation (missing/oversized field) — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The credential was rejected (unknown handle / credential-less / wrong password) — 401, fail closed.</summary>
    RejectedCredential,

    /// <summary>No exercise scope resolved from the host — the endpoint returns 401 (fail closed, no telemetry).</summary>
    ScopeUnresolved,
}

/// <summary>
/// The result of a participant-login attempt. <see cref="ParticipantLoginOutcome.Authenticated"/> carries the
/// issued session; <see cref="ParticipantLoginOutcome.Invalid"/> carries a reason; the fail-closed outcomes carry
/// neither.
/// </summary>
public sealed class ParticipantLoginResult
{
    private ParticipantLoginResult(ParticipantLoginOutcome outcome, SessionIssueResult? issued, string? validationError)
    {
        Outcome = outcome;
        Issued = issued;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public ParticipantLoginOutcome Outcome { get; }

    /// <summary>The issued session + raw token(s) — non-null only when <see cref="Outcome"/> is <see cref="ParticipantLoginOutcome.Authenticated"/>.</summary>
    public SessionIssueResult? Issued { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="ParticipantLoginOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful login carrying the issued session.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <returns>An authenticated result.</returns>
    public static ParticipantLoginResult Authenticated(SessionIssueResult issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new ParticipantLoginResult(ParticipantLoginOutcome.Authenticated, issued, null);
    }

    /// <summary>A rejected request (bad body).</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ParticipantLoginResult Invalid(string validationError) =>
        new(ParticipantLoginOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for a rejected credential.</summary>
    /// <returns>A rejected-credential result.</returns>
    public static ParticipantLoginResult RejectedCredential() =>
        new(ParticipantLoginOutcome.RejectedCredential, null, null);

    /// <summary>The fail-closed result for an unresolved host scope.</summary>
    /// <returns>A scope-unresolved result.</returns>
    public static ParticipantLoginResult ScopeUnresolved() =>
        new(ParticipantLoginOutcome.ScopeUnresolved, null, null);
}
