namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The staff-only lifecycle controls over one exercise's shared, view-only <see cref="SharedCredential"/> (story
/// 07, COR-016 / NFR-009): <b>rotate</b> (set a fresh server-generated password with an announce grace window)
/// and <b>revoke</b> (an immediate kill switch that also terminates every active read-only session for the
/// exercise). Both actions are staff-authz-gated via <see cref="ICurrentStaffSessionAccessor"/> and act ONLY on
/// the caller's active-exercise credential — the scope comes solely from <see cref="IExerciseContext"/> (COR-001),
/// so a rotate/revoke on exercise A can never touch exercise B's credential or sessions. Each emits exactly one
/// XC-004 event in the SAME unit of work as the mutation. Scoped lifetime, matching the <see cref="PulseDbContext"/>
/// unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Server-authoritative &amp; fail-closed.</b> Wall-clock is the server clock (one read per operation, shared
/// by the entity mutation and its telemetry). Scenario time is the exercise's stored
/// <see cref="Exercise.CurrentScenarioTime"/> (a documented B2 placeholder until the COR-050 backend clock lands
/// in B3). Scope comes ONLY from <see cref="IExerciseContext.CurrentExerciseId"/>; a null/empty scope, no staff
/// session, or a staff session whose bound exercise disagrees with the resolved scope all fail closed (the
/// endpoint 401s). The new password is generated server-side, returned to staff exactly ONCE, and only ever
/// persisted hashed (never logged, never stored in the clear — NFR-009).
/// </para>
/// <para>
/// <b>Rotation semantics.</b> A NORMAL rotation (the credential is currently live) retires the current password
/// into <see cref="SharedCredential.PreviousHash"/> with a <see cref="SharedCredentialLifecyclePolicy.GraceWindow"/>
/// so the old password keeps working until the window elapses, then stops. Rotating a DISABLED/REVOKED/never-set
/// credential deliberately does NOT resurrect a killed or absent secret into the grace window — a revoked
/// password must stay dead — the rotation (re)establishes access from scratch. Either way the rotation enables
/// the credential (clears <see cref="SharedCredential.RevokedAt"/>, sets <see cref="SharedCredential.IsEnabled"/>)
/// so the freshly-set password authenticates, and resets any brute-force lockout (a staff rotate is the
/// deliberate, logged recovery path).
/// </para>
/// </remarks>
public sealed class SharedCredentialLifecycleService
{
    private const string StaffSessionKind = "staff";
    private const string ReadOnlySessionKind = "readonly";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SchemaVersion = "v0";
    private const string RotatedEventType = "credential.rotated";
    private const string RevokedEventType = "credential.revoked";
    private const string SharedCredentialEntityType = "sharedCredential";

    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentStaffSessionAccessor _currentStaffSession;
    private readonly ISharedCredentialHasher _hasher;

    /// <summary>Creates the lifecycle service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the credential mutation, session termination, and telemetry are written through.</param>
    /// <param name="exerciseContext">The server-authoritative active-exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="currentStaffSession">The cross-wave accessor that identifies the authenticated staff caller (staff-only gate).</param>
    /// <param name="hasher">The slow-KDF hasher a rotation hashes the fresh password with (NFR-009).</param>
    public SharedCredentialLifecycleService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentStaffSessionAccessor currentStaffSession,
        ISharedCredentialHasher hasher)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(currentStaffSession);
        ArgumentNullException.ThrowIfNull(hasher);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _currentStaffSession = currentStaffSession;
        _hasher = hasher;
    }

    /// <summary>
    /// Rotates the active exercise's shared password: sets a fresh server-generated password, retires the old one
    /// into a grace window (when the credential was live), (re)enables the credential, clears any lockout, and
    /// emits one XC-004 <c>credential.rotated</c> event in the same unit of work. The new plaintext is returned
    /// ONCE. Fails closed: no staff session / no resolved scope → <see cref="SharedCredentialRotateOutcome.Unauthenticated"/>;
    /// no credential provisioned for the exercise → <see cref="SharedCredentialRotateOutcome.NotProvisioned"/>.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<SharedCredentialRotateResult> RotateAsync(CancellationToken cancellationToken = default)
    {
        var context = await ResolveStaffContextAsync(cancellationToken);
        if (context is null)
        {
            return SharedCredentialRotateResult.Unauthenticated();
        }

        // Load THIS exercise's credential (TRACKED — it is mutated; the B0 global query filter confines it to the
        // resolved scope, so this is never another exercise's credential). Exactly one row per exercise.
        var credential = await _dbContext.SharedCredentials.FirstOrDefaultAsync(cancellationToken);
        if (credential is null)
        {
            return SharedCredentialRotateResult.NotProvisioned();
        }

        var now = DateTimeOffset.UtcNow;

        var wasLive = credential is { IsEnabled: true, RevokedAt: null } && !string.IsNullOrEmpty(credential.CurrentHash);
        if (wasLive)
        {
            // Normal rotation: retire the CURRENT password into the announce grace window so it keeps working
            // until the window elapses, then stops.
            credential.PreviousHash = credential.CurrentHash;
            credential.PreviousHashGraceExpiresAt = now + SharedCredentialLifecyclePolicy.GraceWindow;
        }
        else
        {
            // Rotating a disabled / revoked / never-set credential: never resurrect a killed or absent secret
            // into the grace window (a revoked password must stay dead). Access is re-established from scratch.
            credential.PreviousHash = null;
            credential.PreviousHashGraceExpiresAt = null;
        }

        var newPassword = SharedCredentialPasswordGenerator.Generate();
        credential.CurrentHash = _hasher.Hash(newPassword);

        // A rotation makes shared access live so the freshly-set password authenticates, and clears any
        // brute-force lockout (the deliberate, logged staff recovery path).
        credential.IsEnabled = true;
        credential.RevokedAt = null;
        credential.FailedAttemptCount = 0;
        credential.LockedOutUntil = null;
        credential.UpdatedAt = now;

        var graceExpiresAt = credential.PreviousHashGraceExpiresAt;
        var payload = graceExpiresAt is { } grace
            ? $"{{\"graceExpiresAt\":\"{grace.ToString("O", CultureInfo.InvariantCulture)}\"}}"
            : "{\"graceExpiresAt\":null}";

        _dbContext.TelemetryEvents.Add(BuildLifecycleTelemetry(context, RotatedEventType, credential.Id, now, payload));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return SharedCredentialRotateResult.Rotated(newPassword, graceExpiresAt);
    }

    /// <summary>
    /// Immediately revokes the active exercise's shared credential (no grace): marks it revoked/disabled, clears
    /// any in-flight rotation grace, terminates every ACTIVE read-only session for the exercise, and emits one
    /// XC-004 <c>credential.revoked</c> event in the same unit of work. Idempotent — a re-revoke preserves the
    /// original revoke instant and still terminates any lingering read-only sessions. Fails closed: no staff
    /// session / no resolved scope → <see cref="SharedCredentialRevokeOutcome.Unauthenticated"/>; no credential
    /// provisioned → <see cref="SharedCredentialRevokeOutcome.NotProvisioned"/>.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status; carries the count of terminated read-only sessions.</returns>
    public async Task<SharedCredentialRevokeResult> RevokeAsync(CancellationToken cancellationToken = default)
    {
        var context = await ResolveStaffContextAsync(cancellationToken);
        if (context is null)
        {
            return SharedCredentialRevokeResult.Unauthenticated();
        }

        var credential = await _dbContext.SharedCredentials.FirstOrDefaultAsync(cancellationToken);
        if (credential is null)
        {
            return SharedCredentialRevokeResult.NotProvisioned();
        }

        var now = DateTimeOffset.UtcNow;

        // Immediate kill switch — no grace. Preserve the ORIGINAL revoke instant on a re-revoke (audit truth).
        credential.RevokedAt ??= now;
        credential.IsEnabled = false;
        credential.PreviousHash = null;
        credential.PreviousHashGraceExpiresAt = null;
        credential.UpdatedAt = now;

        // Terminate every ACTIVE read-only session for THIS exercise at once. Session is NOT IExerciseScoped, so
        // the ExerciseId filter is EXPLICIT and load-bearing (COR-001): a revoke on exercise A must NEVER touch
        // exercise B's sessions. Only view-only (Kind == "readonly") sessions are terminated — staff/participant
        // sessions are unaffected — and only those still live (RevokedAt == null).
        var readOnlySessions = await _dbContext.Sessions
            .Where(s => s.ExerciseId == context.ExerciseId
                && s.Kind == ReadOnlySessionKind
                && s.RevokedAt == null)
            .ToListAsync(cancellationToken);

        foreach (var session in readOnlySessions)
        {
            session.RevokedAt = now;
        }

        var payload = $"{{\"terminatedSessions\":{readOnlySessions.Count.ToString(CultureInfo.InvariantCulture)}}}";

        _dbContext.TelemetryEvents.Add(BuildLifecycleTelemetry(context, RevokedEventType, credential.Id, now, payload));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return SharedCredentialRevokeResult.Revoked(readOnlySessions.Count);
    }

    /// <summary>
    /// Resolves the authenticated staff caller AND the active exercise, or <c>null</c> when the action must fail
    /// closed. Requires: a live staff session (via <see cref="ICurrentStaffSessionAccessor"/>); a non-empty
    /// resolved scope; a persisted staff session row whose owner, kind, AND bound exercise all agree with the
    /// accessor and the resolved scope (defense-in-depth so a staff caller only ever acts on THEIR OWN active
    /// exercise's credential); and a real backing <see cref="Exercise"/> for the telemetry envelope.
    /// </summary>
    private async Task<LifecycleContext?> ResolveStaffContextAsync(CancellationToken cancellationToken)
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

        // Load the staff session (unscoped → findable regardless of scope) for its per-exercise role and to
        // re-assert ownership + kind + that its bound exercise IS the resolved scope. This makes the isolation
        // property locally provable rather than dependent on the session middleware alone.
        var session = await _dbContext.Sessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == current.SessionId, cancellationToken);

        if (session is null ||
            session.StaffUserId != current.StaffUserId ||
            !string.Equals(session.Kind, StaffSessionKind, StringComparison.Ordinal) ||
            session.ExerciseId != exerciseId)
        {
            return null;
        }

        // The exercise (scope root, never IExerciseScoped → unfiltered) for the telemetry envelope. A resolved
        // scope with no backing exercise cannot carry valid scoped telemetry — fail closed.
        // org-scope-exempt(ResolvedScope): exerciseId is the server-resolved scope passed in by the caller
        // above, never a request field; it only supplies the telemetry envelope's scenario time + time zone.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == exerciseId, cancellationToken);

        if (exercise is null)
        {
            return null;
        }

        return new LifecycleContext(current.StaffUserId, session.Role, exerciseId, exercise);
    }

    /// <summary>
    /// Builds one XC-004 lifecycle event against the locked v0 envelope: <c>actor.kind: 'system'</c> with the
    /// acting staff role and <c>actingHumanId</c> = the <see cref="StaffUser"/> id (staff-initiated),
    /// <c>channel: 'system'</c>, target = the shared credential. Off-envelope empty strings are null-omitted.
    /// </summary>
    private static TelemetryEvent BuildLifecycleTelemetry(
        LifecycleContext context,
        string eventType,
        Guid credentialId,
        DateTimeOffset now,
        string payload) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = context.ExerciseId,
        EventType = eventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = string.IsNullOrEmpty(context.Role) ? null : context.Role,
            ActingHumanId = context.StaffUserId.ToString(),
        },
        WallClockTime = now,
        ScenarioTime = context.Exercise.CurrentScenarioTime ?? now,
        TimeZone = context.Exercise.TimeZone,
        Target = new TelemetryTarget { EntityType = SharedCredentialEntityType, EntityId = credentialId.ToString() },
        Payload = payload,
        EmittedAt = now,
    };

    /// <summary>The resolved staff caller + active exercise a lifecycle action acts within.</summary>
    private sealed record LifecycleContext(Guid StaffUserId, string Role, Guid ExerciseId, Exercise Exercise);
}

/// <summary>The outcome kind of a <see cref="SharedCredentialLifecycleService.RotateAsync"/> call.</summary>
public enum SharedCredentialRotateOutcome
{
    /// <summary>The credential was rotated; the fresh plaintext is returned once.</summary>
    Rotated,

    /// <summary>No authenticated staff session / no resolved active-exercise scope — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>The active exercise has no shared credential provisioned — the endpoint returns 404.</summary>
    NotProvisioned,
}

/// <summary>
/// The result of a rotation. <see cref="SharedCredentialRotateOutcome.Rotated"/> carries the freshly-generated
/// plaintext password (shown ONCE) and the grace-window expiry (or <c>null</c> when no old password was retired).
/// </summary>
public sealed class SharedCredentialRotateResult
{
    private SharedCredentialRotateResult(SharedCredentialRotateOutcome outcome, string? newPassword, DateTimeOffset? graceExpiresAt)
    {
        Outcome = outcome;
        NewPassword = newPassword;
        GraceExpiresAt = graceExpiresAt;
    }

    /// <summary>Which outcome occurred.</summary>
    public SharedCredentialRotateOutcome Outcome { get; }

    /// <summary>The fresh plaintext password — non-null only when <see cref="Outcome"/> is <see cref="SharedCredentialRotateOutcome.Rotated"/>. Returned to staff once; never persisted in the clear.</summary>
    public string? NewPassword { get; }

    /// <summary>When the retired previous password stops authenticating, or <c>null</c> when no old password was carried into a grace window.</summary>
    public DateTimeOffset? GraceExpiresAt { get; }

    /// <summary>A successful rotation.</summary>
    /// <param name="newPassword">The freshly-generated plaintext (shown once).</param>
    /// <param name="graceExpiresAt">The grace-window expiry, or <c>null</c>.</param>
    /// <returns>A rotated result.</returns>
    public static SharedCredentialRotateResult Rotated(string newPassword, DateTimeOffset? graceExpiresAt)
    {
        ArgumentException.ThrowIfNullOrEmpty(newPassword);
        return new SharedCredentialRotateResult(SharedCredentialRotateOutcome.Rotated, newPassword, graceExpiresAt);
    }

    /// <summary>The fail-closed result for an unauthenticated caller / unresolved scope.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static SharedCredentialRotateResult Unauthenticated() =>
        new(SharedCredentialRotateOutcome.Unauthenticated, null, null);

    /// <summary>The result for an exercise with no shared credential provisioned.</summary>
    /// <returns>A not-provisioned result.</returns>
    public static SharedCredentialRotateResult NotProvisioned() =>
        new(SharedCredentialRotateOutcome.NotProvisioned, null, null);
}

/// <summary>The outcome kind of a <see cref="SharedCredentialLifecycleService.RevokeAsync"/> call.</summary>
public enum SharedCredentialRevokeOutcome
{
    /// <summary>The credential was revoked and all active read-only sessions terminated.</summary>
    Revoked,

    /// <summary>No authenticated staff session / no resolved active-exercise scope — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>The active exercise has no shared credential provisioned — the endpoint returns 404.</summary>
    NotProvisioned,
}

/// <summary>
/// The result of a revocation. <see cref="SharedCredentialRevokeOutcome.Revoked"/> carries the number of active
/// read-only sessions that were terminated by the revoke.
/// </summary>
public sealed class SharedCredentialRevokeResult
{
    private SharedCredentialRevokeResult(SharedCredentialRevokeOutcome outcome, int terminatedSessionCount)
    {
        Outcome = outcome;
        TerminatedSessionCount = terminatedSessionCount;
    }

    /// <summary>Which outcome occurred.</summary>
    public SharedCredentialRevokeOutcome Outcome { get; }

    /// <summary>The count of read-only sessions terminated by the revoke — meaningful only when <see cref="Outcome"/> is <see cref="SharedCredentialRevokeOutcome.Revoked"/>.</summary>
    public int TerminatedSessionCount { get; }

    /// <summary>A successful revocation.</summary>
    /// <param name="terminatedSessionCount">How many active read-only sessions were terminated.</param>
    /// <returns>A revoked result.</returns>
    public static SharedCredentialRevokeResult Revoked(int terminatedSessionCount) =>
        new(SharedCredentialRevokeOutcome.Revoked, terminatedSessionCount);

    /// <summary>The fail-closed result for an unauthenticated caller / unresolved scope.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static SharedCredentialRevokeResult Unauthenticated() =>
        new(SharedCredentialRevokeOutcome.Unauthenticated, 0);

    /// <summary>The result for an exercise with no shared credential provisioned.</summary>
    /// <returns>A not-provisioned result.</returns>
    public static SharedCredentialRevokeResult NotProvisioned() =>
        new(SharedCredentialRevokeOutcome.NotProvisioned, 0);
}
