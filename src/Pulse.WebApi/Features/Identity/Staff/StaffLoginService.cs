namespace Pulse.WebApi.Features.Identity.Staff;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The staff-login funnel behind <c>POST /api/auth/staff/login</c> (COR-014). It authenticates the presented
/// credential through the provider-agnostic <see cref="IIdentityProvider"/> seam, resolves / provisions the
/// <c>StaffUser</c> from the returned external identity, validates the staff user is assigned to the requested
/// exercise, and mints a story-03 session by calling the injected <see cref="ISessionIssuer"/> — failing
/// CLOSED (no session) on any authentication or authorization failure. It emits exactly one XC-004 telemetry
/// event per login attempt (success and failure), server-stamped. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Active exercise is chosen at login (reconciled with the switcher).</b> The login request carries the
/// exercise the staff human is entering — the "selected active exercise" (AC). It is validated to (a) resolve
/// to a real <see cref="Exercise"/> (Wave-0 deferred DB FKs to the service layer, so a dangling/typo'd id must
/// not persist silently) and (b) be in the caller's <c>StaffAssignment</c> set. The session's role is that
/// assignment's role. Switching later without re-login is <c>POST /api/staff/active-exercise</c>
/// (<see cref="StaffAssignmentService"/>).
/// </para>
/// <para>
/// <b>Server-authoritative &amp; fail-closed.</b> Wall-clock is the server clock (one read shared by the entity
/// mutation and its telemetry). Scenario time is the exercise's stored <see cref="Exercise.CurrentScenarioTime"/>
/// (a documented B2 placeholder until the COR-050 backend clock lands in B3; falls back to the wall clock when
/// unset). A rejected credential yields no session and a failure event that carries NO session identity. The
/// <see cref="IIdentityProvider"/> never logs the secret (NFR-009).
/// </para>
/// </remarks>
public sealed class StaffLoginService
{
    private const string StaffSessionKind = "staff";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string LoginEventType = "login";
    private const string SuccessOutcomePayload = "{\"outcome\":\"success\"}";
    private const string FailureOutcomePayload = "{\"outcome\":\"failure\"}";

    private readonly PulseDbContext _dbContext;
    private readonly IIdentityProvider _identityProvider;
    private readonly ISessionIssuer _sessionIssuer;

    /// <summary>Creates the staff-login funnel over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the StaffUser mutation and telemetry event are written through.</param>
    /// <param name="identityProvider">The provider-agnostic staff authentication seam (Phase-1 Dynamis impl).</param>
    /// <param name="sessionIssuer">The story-03 session-issuance seam this login calls to mint the session.</param>
    public StaffLoginService(
        PulseDbContext dbContext,
        IIdentityProvider identityProvider,
        ISessionIssuer sessionIssuer)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(identityProvider);
        ArgumentNullException.ThrowIfNull(sessionIssuer);

        _dbContext = dbContext;
        _identityProvider = identityProvider;
        _sessionIssuer = sessionIssuer;
    }

    /// <summary>
    /// Authenticates a staff login attempt and, on success, mints a session bound to the selected active
    /// exercise. Emits exactly one XC-004 <c>login</c> event (success or failure) in the same unit of work as
    /// the StaffUser mutation, then issues the session through the story-03 issuer.
    /// </summary>
    /// <param name="request">The login request (username, secret, target exercise). The secret is never logged.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status: authenticated (session), invalid (400), rejected (401), or not-assigned (403).</returns>
    public async Task<StaffLoginResult> LoginAsync(StaffLoginRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // 1. Validate the request shape (400). Nullable scalars → a missing field is a validation concern.
        var username = request.Username?.Trim();
        if (string.IsNullOrEmpty(username) || username.Length > 256)
        {
            return StaffLoginResult.Invalid("username is required (1-256 characters).");
        }

        // The secret is bounded (DoS guard) but never trimmed / normalized / logged.
        if (string.IsNullOrEmpty(request.Secret) || request.Secret.Length > 1024)
        {
            return StaffLoginResult.Invalid("secret is required (1-1024 characters).");
        }

        if (!Guid.TryParse(request.ExerciseId, out var exerciseId) || exerciseId == Guid.Empty)
        {
            return StaffLoginResult.Invalid("exerciseId must be a non-empty GUID.");
        }

        // 2. Validate the exercise resolves to a real Exercise BEFORE anything is stamped with it (Wave-0
        //    deferred FKs → service-layer validation), and load its scenario-time placeholder + time zone for
        //    the telemetry envelope. Exercise is the scope root (never IExerciseScoped), so this is unfiltered.
        // org-scope-exempt(TenantChecked): exerciseId here IS client-supplied (the login body names the
        // exercise), so this read is deliberately unbounded — a tenant bound would need a tenant that does
        // not exist yet. The cross-customer case is refused below by the explicit
        // `staffUser.OrganizationId != exercise.OrganizationId` check, before any session is issued.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            // No valid exercise → no valid telemetry scope; reject as a client error without a scoped event.
            return StaffLoginResult.Invalid("exerciseId does not resolve to a known exercise.");
        }

        var now = DateTimeOffset.UtcNow;
        var scenarioTime = exercise.CurrentScenarioTime ?? now;

        // 3. Authenticate through the provider-agnostic seam. Never logs the secret.
        var authentication = await _identityProvider.AuthenticateAsync(
            new StaffCredentials { Username = username, Secret = request.Secret },
            cancellationToken);

        if (authentication.Outcome != StaffAuthenticationOutcome.Authenticated || authentication.Identity is null)
        {
            // Fail closed: rejected credentials get NO session and a failure event with no session identity.
            _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
                exerciseId, role: null, actingHumanId: null, outcome: FailureOutcomePayload,
                now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone, targetStaffUserId: null));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return StaffLoginResult.Rejected();
        }

        var identity = authentication.Identity;

        // 4. Resolve / provision the StaffUser by external subject (unscoped — findable regardless of scope).
        // org-scope-exempt(ResolutionRoot): this read IS the identity resolution — an IdP subject mapped to a
        // staff human before any session or tenant exists. A tenant bound here would lock every human out.
        var staffUser = await _dbContext.StaffUsers
            .FirstOrDefaultAsync(u => u.ExternalSubject == identity.ExternalSubject, cancellationToken);

        if (staffUser is null)
        {
            staffUser = new StaffUser
            {
                Id = Guid.NewGuid(),
                // exercise-isolation/11 (COR-010): a first-seen staff human joins the CUSTOMER that owns the
                // exercise they are logging in to — the only tenant the server can attribute them to here,
                // and never a client-supplied value. (A multi-customer IdP that carries an org claim plugs in
                // exactly here.) The write-guard rejects an empty tenant, so this is not optional.
                OrganizationId = exercise.OrganizationId,
                ExternalSubject = identity.ExternalSubject,
                DisplayName = identity.DisplayName,
                Username = identity.Username,
                CreatedAt = now,
            };
            _dbContext.StaffUsers.Add(staffUser);
        }
        else
        {
            // Keep the recorded identity fresh from the authoritative provider on each login. The
            // OrganizationId is deliberately NOT refreshed: re-homing a staff human across a customer
            // boundary on a routine login is exactly the silent cross-tenant move story 11 exists to prevent.
            staffUser.DisplayName = identity.DisplayName;
            staffUser.Username = identity.Username;
        }

        // exercise-isolation/11 AC3 — reachability is bounded by the tenant. An assignment alone is no longer
        // sufficient: the staff human and the exercise must belong to the SAME customer. This fails closed
        // (403, no session) and is checked BEFORE the assignment lookup below so a cross-tenant attempt never
        // reveals whether an assignment exists. In the single-customer deployment this can only ever be true;
        // it is the guard that keeps it true once there are two.
        if (staffUser.OrganizationId != exercise.OrganizationId)
        {
            _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
                exerciseId, role: null, actingHumanId: staffUser.Id.ToString(), outcome: FailureOutcomePayload,
                now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone, targetStaffUserId: staffUser.Id));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return StaffLoginResult.NotAssigned();
        }

        // 5. Authorization: the staff user must be assigned to the selected exercise. StaffAssignment is the
        //    cross-exercise access record (COR-005, unscoped) — the role is per-exercise.
        var assignment = await _dbContext.StaffAssignments
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.StaffUserId == staffUser.Id && a.ExerciseId == exerciseId, cancellationToken);

        if (assignment is null)
        {
            // Authenticated but not assigned to this exercise → fail closed (403), no session. We DO know the
            // human here, so the failure event carries actingHumanId for audit (but still no issued session).
            _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
                exerciseId, role: null, actingHumanId: staffUser.Id.ToString(), outcome: FailureOutcomePayload,
                now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone, targetStaffUserId: staffUser.Id));
            await _dbContext.SaveChangesAsync(cancellationToken);

            return StaffLoginResult.NotAssigned();
        }

        var role = assignment.Role;

        // LastLoginAt records the last SUCCESSFUL entry — set only now that auth AND assignment both passed
        // (a rejected credential or an unassigned user never updates it).
        staffUser.LastLoginAt = now;

        // 6. Success: persist the StaffUser mutation AND the single success telemetry event in ONE unit of work
        //    (the write-guard runs here — the scoped telemetry row carries the validated, non-empty ExerciseId).
        _dbContext.TelemetryEvents.Add(BuildLoginTelemetry(
            exerciseId, role: role, actingHumanId: staffUser.Id.ToString(), outcome: SuccessOutcomePayload,
            now: now, scenarioTime: scenarioTime, timeZone: exercise.TimeZone, targetStaffUserId: staffUser.Id));
        await _dbContext.SaveChangesAsync(cancellationToken);

        // 7. Mint the session through the story-03 issuer (it owns Session persistence + the raw token). Staff
        //    sessions bind the StaffUser as both principal and acting-human; no account / persona.
        var issued = await _sessionIssuer.IssueAsync(
            new SessionIssueRequest
            {
                ExerciseId = exerciseId,
                Kind = StaffSessionKind,
                Role = role,
                PrincipalId = staffUser.Id.ToString(),
                ActingHumanId = staffUser.Id.ToString(),
                IsReadOnly = false,
                AccountId = null,
                StaffUserId = staffUser.Id,
                PersonaId = null,
            },
            cancellationToken);

        return StaffLoginResult.Authenticated(issued);
    }

    /// <summary>
    /// Builds one XC-004 staff-auth telemetry event against the locked v0 envelope: <c>actor.kind: 'system'</c>,
    /// <c>channel: 'system'</c>, event type <c>login</c>. Off-envelope empty strings are null-omitted (the v0
    /// schema types the optional actor ids as <c>min(1).optional()</c>).
    /// </summary>
    private static TelemetryEvent BuildLoginTelemetry(
        Guid exerciseId,
        string? role,
        string? actingHumanId,
        string outcome,
        DateTimeOffset now,
        DateTimeOffset scenarioTime,
        string timeZone,
        Guid? targetStaffUserId) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = "v0",
        ExerciseId = exerciseId,
        EventType = LoginEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = string.IsNullOrEmpty(role) ? null : role,
            ActingHumanId = string.IsNullOrEmpty(actingHumanId) ? null : actingHumanId,
        },
        WallClockTime = now,
        ScenarioTime = scenarioTime,
        TimeZone = timeZone,
        Target = targetStaffUserId is null
            ? null
            : new TelemetryTarget { EntityType = "staffUser", EntityId = targetStaffUserId.Value.ToString() },
        Payload = outcome,
        EmittedAt = now,
    };
}

/// <summary>The outcome kind of a <see cref="StaffLoginService.LoginAsync"/> call.</summary>
public enum StaffLoginOutcome
{
    /// <summary>Credentials authenticated, the user is assigned, and a session was issued.</summary>
    Authenticated,

    /// <summary>The request failed validation (missing field / unknown exercise) — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The credentials were rejected — the endpoint returns 401 (fail closed, no session).</summary>
    Rejected,

    /// <summary>Authenticated but not assigned to the requested exercise — the endpoint returns 403 (no session).</summary>
    NotAssigned,
}

/// <summary>
/// The result of a staff-login attempt. <see cref="StaffLoginOutcome.Authenticated"/> carries the issued
/// session; <see cref="StaffLoginOutcome.Invalid"/> carries a human-readable reason; the fail-closed outcomes
/// carry neither.
/// </summary>
public sealed class StaffLoginResult
{
    private StaffLoginResult(StaffLoginOutcome outcome, SessionIssueResult? issued, string? validationError)
    {
        Outcome = outcome;
        Issued = issued;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public StaffLoginOutcome Outcome { get; }

    /// <summary>The issued session + raw token(s) — non-null only when <see cref="Outcome"/> is <see cref="StaffLoginOutcome.Authenticated"/>.</summary>
    public SessionIssueResult? Issued { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="StaffLoginOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful login carrying the issued session.</summary>
    /// <param name="issued">The issuer result.</param>
    /// <returns>An authenticated result.</returns>
    public static StaffLoginResult Authenticated(SessionIssueResult issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        return new StaffLoginResult(StaffLoginOutcome.Authenticated, issued, null);
    }

    /// <summary>A rejected request (bad body / unknown exercise).</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static StaffLoginResult Invalid(string validationError) =>
        new(StaffLoginOutcome.Invalid, null, validationError);

    /// <summary>The fail-closed result for rejected credentials.</summary>
    /// <returns>A rejected result.</returns>
    public static StaffLoginResult Rejected() => new(StaffLoginOutcome.Rejected, null, null);

    /// <summary>The fail-closed result for an authenticated-but-unassigned staff user.</summary>
    /// <returns>A not-assigned result.</returns>
    public static StaffLoginResult NotAssigned() => new(StaffLoginOutcome.NotAssigned, null, null);
}

/// <summary>
/// The <c>POST /api/auth/staff/login</c> request body (camelCase JSON). Every scalar is nullable so a missing
/// field is a validation concern (a 400), never a deserialization failure. The <see cref="Secret"/> is never
/// logged / persisted (NFR-009).
/// </summary>
public sealed class StaffLoginRequest
{
    /// <summary>The staff login handle.</summary>
    public string? Username { get; init; }

    /// <summary>The presented secret — validated, never logged or persisted.</summary>
    public string? Secret { get; init; }

    /// <summary>The exercise being entered — the selected active exercise; validated against the caller's assignments.</summary>
    public string? ExerciseId { get; init; }
}
