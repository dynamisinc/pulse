namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The guarded, idempotent UAT bootstrap service behind <c>POST /api/ops/bootstrap-exercise</c> (story login/05).
/// It is the ONLY path that can seed a fresh, empty database: it creates the FIRST <see cref="Exercise"/> (host-
/// bound so <c>ExerciseResolutionMiddleware</c> can later resolve it) and — optionally — the first
/// <see cref="StaffAssignment"/> (unblocking staff login for an allowlisted identity), the exercise's first
/// <see cref="SharedCredential"/> (the gap story 06/07 never closed — only rotate/revoke exist), and one
/// participant <see cref="Account"/>. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Secret-gated + fail closed (NFR-009).</b> Every call is gated by <see cref="BootstrapSecretGate"/>: an
/// unconfigured (empty) secret disables the endpoint entirely and a mismatch is rejected — both surface as a 404
/// (the endpoint does not confirm its own existence to an unauthorized caller). The secret is compared in
/// constant time and never logged. There is no session / exercise-scope middleware in front of this endpoint —
/// the header secret is the only gate by design (no session can exist yet in an empty database).
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001).</b> This endpoint has no resolved request scope, so the injected
/// <see cref="PulseDbContext"/> is bound to the fail-closed <see cref="System.Guid.Empty"/> filter. Every scoped
/// row it writes (<see cref="Account"/>, <see cref="SharedCredential"/>, <see cref="TelemetryEvent"/>) is stamped
/// with the NEWLY-CREATED (or resolved-by-hostname) exercise's OWN id — never a client-supplied id for any other
/// exercise — so the write-guard is satisfied (a non-empty <c>ExerciseId</c>). Idempotency reads of scoped
/// entities use <c>IgnoreQueryFilters()</c> and an explicit <c>ExerciseId</c> predicate precisely because the
/// captured scope is empty; the read is still confined to the one target exercise by that explicit predicate.
/// </para>
/// <para>
/// <b>Idempotent &amp; non-clobbering.</b> A hostname that already resolves to an exercise reuses it; an already-
/// provisioned <see cref="StaffAssignment"/> / <see cref="SharedCredential"/> / <see cref="Account"/> is reused,
/// never duplicated or overwritten (so a re-run never rotates a live shared password out from under existing
/// access). Server-authoritative: one wall-clock read stamps every <c>CreatedAt</c> and the telemetry. Reuses —
/// never reimplements — <see cref="AccountFieldRules"/> (sanitization/validation), <see cref="ExerciseHostName"/>
/// via the account path, <see cref="ISharedCredentialHasher"/> + <see cref="SharedCredentialPasswordGenerator"/>,
/// <see cref="ParticipantPasswordHasher"/>, and <c>DynamisIdentityProviderOptions</c> (allowlist resolution).
/// </para>
/// </remarks>
public sealed class BootstrapService
{
    private const string DefaultTimeZone = "UTC";
    private const int MaxTimeZoneLength = 128;
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SchemaVersion = "v0";
    private const string BootstrapActorId = "bootstrap";
    private const string BootstrappedEventType = "exercise.bootstrapped";
    private const string ExerciseEntityType = "exercise";

    /// <summary>
    /// The staff roles a bootstrapped <see cref="StaffAssignment"/> may carry, keyed case-insensitively to their
    /// canonical frozen lowercase value so a request that says <c>Controller</c> stores <c>controller</c> (the
    /// exact <c>Session.role</c> vocabulary), mirroring <see cref="AccountFieldRules"/>'s participant-role map.
    /// </summary>
    private static readonly Dictionary<string, string> CanonicalStaffRoles =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["controller"] = "controller",
            ["evaluator"] = "evaluator",
            ["planner"] = "planner",
        };

    private readonly PulseDbContext _dbContext;
    private readonly BootstrapOptions _options;
    private readonly DynamisIdentityProviderOptions _staffAllowlist;
    private readonly ISharedCredentialHasher _sharedCredentialHasher;
    private readonly ParticipantPasswordHasher _participantPasswordHasher;

    /// <summary>Creates the bootstrap service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context every seed row is written through in one unit of work.</param>
    /// <param name="options">The bound bootstrap options (the fail-closed secret gate).</param>
    /// <param name="staffAllowlist">The Phase-1 staff allowlist a named staff identity's external subject is resolved from.</param>
    /// <param name="sharedCredentialHasher">The slow-KDF hasher the shared password is hashed with (NFR-009).</param>
    /// <param name="participantPasswordHasher">The slow-KDF hasher an optional participant password is hashed with (NFR-009).</param>
    public BootstrapService(
        PulseDbContext dbContext,
        IOptions<BootstrapOptions> options,
        IOptions<DynamisIdentityProviderOptions> staffAllowlist,
        ISharedCredentialHasher sharedCredentialHasher,
        ParticipantPasswordHasher participantPasswordHasher)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(staffAllowlist);
        ArgumentNullException.ThrowIfNull(sharedCredentialHasher);
        ArgumentNullException.ThrowIfNull(participantPasswordHasher);

        _dbContext = dbContext;
        _options = options.Value ?? new BootstrapOptions();
        _staffAllowlist = staffAllowlist.Value ?? new DynamisIdentityProviderOptions();
        _sharedCredentialHasher = sharedCredentialHasher;
        _participantPasswordHasher = participantPasswordHasher;
    }

    /// <summary>
    /// Bootstraps (or idempotently re-resolves) an exercise and its optional seed rows. Fails closed: an
    /// unauthorized secret → <see cref="BootstrapOutcome.Rejected"/> (the endpoint returns 404); an invalid body
    /// → <see cref="BootstrapOutcome.Invalid"/> (400). On success, emits exactly one XC-004
    /// <c>exercise.bootstrapped</c> event in the same unit of work as the seed rows.
    /// </summary>
    /// <param name="request">The bootstrap request (may be <c>null</c> — a missing body is a 400).</param>
    /// <param name="presentedSecret">The secret from the <c>X-Bootstrap-Secret</c> header (never logged).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<BootstrapResult> BootstrapAsync(
        BootstrapExerciseRequest? request,
        string? presentedSecret,
        CancellationToken cancellationToken = default)
    {
        // 1. The gate runs FIRST, before any body inspection: an unauthorized caller learns nothing (404),
        //    including whether a body was well-formed. Fail closed on an unconfigured/wrong secret.
        if (!BootstrapSecretGate.IsAuthorized(_options.Secret, presentedSecret))
        {
            return BootstrapResult.Rejected();
        }

        if (request is null)
        {
            return BootstrapResult.Invalid("A JSON bootstrap body is required.");
        }

        // 2. Validate the host (required) via the SAME normalizer the resolution path uses (COR-008 / NFR-004).
        if (!ExerciseHostName.TryNormalize(request.Hostname, out var host))
        {
            return BootstrapResult.Invalid("hostname is required and must be a valid DNS hostname.");
        }

        // 3. Resolve any existing exercise for this host (Exercise is unscoped → this by-host read is unfiltered).
        //    Tracked so it can be reused as-is; it is never mutated (idempotent, non-clobbering).
        var exercise = await _dbContext.Exercises
            .FirstOrDefaultAsync(e => e.Hostname == host, cancellationToken);
        var exerciseCreated = exercise is null;

        // 4. Validate the remaining inputs BEFORE any write, so an invalid request never partially seeds. The
        //    exercise name is required only when creating the exercise (a re-run ignores it, never clobbers).
        string? exerciseName = null;
        var timeZone = NormalizeTimeZone(request.TimeZone);
        if (exerciseCreated)
        {
            if (!AccountFieldRules.TryNormalizeDisplayName(request.ExerciseName, out exerciseName, out var nameError))
            {
                return BootstrapResult.Invalid($"exerciseName {nameError}");
            }
        }

        var staffValidation = ValidateStaff(request.Staff);
        if (staffValidation.Error is { } staffError)
        {
            return BootstrapResult.Invalid(staffError);
        }

        var accountValidation = ValidateAccount(request.ParticipantAccount);
        if (accountValidation.Error is { } accountError)
        {
            return BootstrapResult.Invalid(accountError);
        }

        var provisionSharedCredential = request.SharedCredential is not null && request.SharedCredential.Enabled != false;

        // 5. All inputs valid — perform every write in ONE unit of work. One wall-clock read is shared across all
        //    rows and the telemetry (server-authoritative stamping).
        var now = DateTimeOffset.UtcNow;

        if (exercise is null)
        {
            exercise = new Exercise
            {
                Id = Guid.NewGuid(),
                Name = exerciseName!,
                Hostname = host,
                TimeZone = timeZone,
                Status = "active",
            };
            _dbContext.Exercises.Add(exercise);
        }

        var exerciseId = exercise.Id;

        var staffResult = staffValidation.Resolved is { } staff
            ? await ProvisionStaffAsync(exerciseId, staff, now, cancellationToken)
            : null;

        var sharedCredentialResult = provisionSharedCredential
            ? await ProvisionSharedCredentialAsync(exerciseId, now, cancellationToken)
            : null;

        var accountResult = accountValidation.Resolved is { } account
            ? await ProvisionAccountAsync(exerciseId, account, now, cancellationToken)
            : null;

        // Exactly one XC-004 audit event per successful call (COR-001-stamped with the exercise's own id).
        _dbContext.TelemetryEvents.Add(BuildBootstrapTelemetry(
            exercise, now, exerciseCreated, staffResult, sharedCredentialResult, accountResult));

        // One SaveChanges — the write-guard runs here; every scoped row carries the non-empty exercise id.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return BootstrapResult.Provisioned(
            exerciseId, host, exerciseCreated, staffResult, sharedCredentialResult, accountResult);
    }

    /// <summary>Normalizes the requested time zone: trimmed, bounded, defaulting to <c>UTC</c> when blank.</summary>
    private static string NormalizeTimeZone(string? raw)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxTimeZoneLength)
        {
            return DefaultTimeZone;
        }

        return trimmed;
    }

    /// <summary>Validates the optional staff sub-request, resolving the allowlisted identity's external subject.</summary>
    private StaffValidation ValidateStaff(BootstrapStaffRequest? staff)
    {
        if (staff is null)
        {
            return StaffValidation.Absent;
        }

        var username = staff.Username?.Trim();
        if (string.IsNullOrEmpty(username) || username.Length > 256)
        {
            return StaffValidation.Invalid("staff.username is required (1-256 characters).");
        }

        if (string.IsNullOrEmpty(staff.Role) || !CanonicalStaffRoles.TryGetValue(staff.Role.Trim(), out var role))
        {
            return StaffValidation.Invalid("staff.role must be a staff role (controller, evaluator, or planner).");
        }

        // Resolve against the SAME Phase-1 allowlist staff login authenticates against — only an entry with a
        // non-empty external subject (something to map a StaffUser to) can be bootstrapped.
        var allowlistEntry = _staffAllowlist.Accounts.FirstOrDefault(a =>
            !string.IsNullOrEmpty(a.ExternalSubject)
            && string.Equals(a.Username, username, StringComparison.OrdinalIgnoreCase));

        if (allowlistEntry is null)
        {
            return StaffValidation.Invalid(
                $"staff.username '{username}' is not in the configured staff allowlist (Authentication:StaffIdentity).");
        }

        return StaffValidation.Ok(new ResolvedStaff(
            allowlistEntry.ExternalSubject,
            string.IsNullOrEmpty(allowlistEntry.DisplayName) ? username : allowlistEntry.DisplayName,
            string.IsNullOrEmpty(allowlistEntry.Username) ? username : allowlistEntry.Username,
            role));
    }

    /// <summary>Validates the optional participant-account sub-request via the shared account-field rules.</summary>
    private static AccountValidation ValidateAccount(BootstrapParticipantAccountRequest? account)
    {
        if (account is null)
        {
            return AccountValidation.Absent;
        }

        if (!AccountFieldRules.TryNormalizeUsername(account.Username, out var username, out var usernameError))
        {
            return AccountValidation.Invalid($"participantAccount.username {usernameError}");
        }

        if (!AccountFieldRules.TryNormalizeDisplayName(account.DisplayName, out var displayName, out var displayNameError))
        {
            return AccountValidation.Invalid($"participantAccount.displayName {displayNameError}");
        }

        if (!AccountFieldRules.TryNormalizeRole(account.Role, out var role, out var roleError))
        {
            return AccountValidation.Invalid($"participantAccount.role {roleError}");
        }

        if (!AccountFieldRules.TryValidatePassword(account.Password, out var password, out var passwordError))
        {
            return AccountValidation.Invalid($"participantAccount.password {passwordError}");
        }

        return AccountValidation.Ok(new ResolvedAccount(username, displayName, role, password));
    }

    /// <summary>Provisions (or reuses) the <see cref="StaffUser"/> + <see cref="StaffAssignment"/> for the exercise.</summary>
    private async Task<BootstrapStaffResult> ProvisionStaffAsync(
        Guid exerciseId, ResolvedStaff staff, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // StaffUser is unscoped (spans exercises) — resolve/create by external subject, reusing a row a prior
        // failed login may already have auto-provisioned (never overwritten).
        var staffUser = await _dbContext.StaffUsers
            .FirstOrDefaultAsync(u => u.ExternalSubject == staff.ExternalSubject, cancellationToken);

        if (staffUser is null)
        {
            staffUser = new StaffUser
            {
                Id = Guid.NewGuid(),
                ExternalSubject = staff.ExternalSubject,
                DisplayName = staff.DisplayName,
                Username = staff.Username,
                CreatedAt = now,
            };
            _dbContext.StaffUsers.Add(staffUser);
        }

        // StaffAssignment is unscoped (cross-exercise by design) — resolve/create by (staffUserId, exerciseId);
        // an existing assignment is reused as-is (role never clobbered).
        var assignment = await _dbContext.StaffAssignments
            .FirstOrDefaultAsync(a => a.StaffUserId == staffUser.Id && a.ExerciseId == exerciseId, cancellationToken);
        var assignmentCreated = assignment is null;

        if (assignment is null)
        {
            assignment = new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUser.Id,
                ExerciseId = exerciseId,
                Role = staff.Role,
                CreatedAt = now,
            };
            _dbContext.StaffAssignments.Add(assignment);
        }

        return new BootstrapStaffResult(staffUser.Id, assignment.Role, assignmentCreated);
    }

    /// <summary>Provisions the exercise's FIRST shared credential, or reuses an existing one (never clobbered).</summary>
    private async Task<BootstrapSharedCredentialResult> ProvisionSharedCredentialAsync(
        Guid exerciseId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // SharedCredential is IExerciseScoped and the captured scope is empty here, so ignore the global filter
        // and confine the idempotency read with an EXPLICIT ExerciseId predicate (still one exercise only).
        var existing = await _dbContext.SharedCredentials
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.ExerciseId == exerciseId, cancellationToken);

        if (existing is not null)
        {
            // Idempotent re-run: never clobber a live shared password (the plaintext is unrecoverable anyway).
            return new BootstrapSharedCredentialResult(Created: false, Password: null);
        }

        var password = SharedCredentialPasswordGenerator.Generate();
        _dbContext.SharedCredentials.Add(new SharedCredential
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            CurrentHash = _sharedCredentialHasher.Hash(password),
            IsEnabled = true,
            CreatedAt = now,
        });

        // The plaintext is returned to the caller exactly ONCE; only the hash is persisted (NFR-009).
        return new BootstrapSharedCredentialResult(Created: true, Password: password);
    }

    /// <summary>Provisions one participant account, or reuses an existing same-handle account (never duplicated).</summary>
    private async Task<BootstrapAccountResult> ProvisionAccountAsync(
        Guid exerciseId, ResolvedAccount account, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // Account is IExerciseScoped and the captured scope is empty here — ignore the global filter and confine
        // the duplicate-handle read with an EXPLICIT ExerciseId predicate (CI collation makes the handle match
        // case-insensitively, matching the (ExerciseId, Username) unique index).
        var existing = await _dbContext.Accounts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.ExerciseId == exerciseId && a.Username == account.Username, cancellationToken);

        if (existing is not null)
        {
            return new BootstrapAccountResult(existing.Id, existing.Username, Created: false);
        }

        var entity = new Account
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            Username = account.Username,
            DisplayName = account.DisplayName,
            Role = account.Role,
            CredentialHash = account.Password is null ? null : _participantPasswordHasher.Hash(account.Password),
            CreatedAt = now,
        };
        _dbContext.Accounts.Add(entity);

        return new BootstrapAccountResult(entity.Id, entity.Username, Created: true);
    }

    /// <summary>
    /// Builds the single XC-004 <c>exercise.bootstrapped</c> event: <c>actor.kind: 'system'</c> with the fixed
    /// <c>bootstrap</c> acting-human id, <c>channel: 'system'</c>, target = the exercise. The opaque payload
    /// records what was created vs reused (audit trail, never parsed server-side).
    /// </summary>
    private static TelemetryEvent BuildBootstrapTelemetry(
        Exercise exercise,
        DateTimeOffset now,
        bool exerciseCreated,
        BootstrapStaffResult? staff,
        BootstrapSharedCredentialResult? sharedCredential,
        BootstrapAccountResult? account)
    {
        var payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"exerciseCreated\":{Bool(exerciseCreated)}," +
            $"\"staffAssignmentCreated\":{Bool(staff?.Created == true)}," +
            $"\"sharedCredentialCreated\":{Bool(sharedCredential?.Created == true)}," +
            $"\"participantAccountCreated\":{Bool(account?.Created == true)}}}");

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = exercise.Id,
            EventType = BootstrappedEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                ActingHumanId = BootstrapActorId,
            },
            WallClockTime = now,
            ScenarioTime = exercise.CurrentScenarioTime ?? now,
            TimeZone = exercise.TimeZone,
            Target = new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exercise.Id.ToString() },
            Payload = payload,
            EmittedAt = now,
        };
    }

    /// <summary>Renders a bool as its lowercase JSON literal for the opaque telemetry payload.</summary>
    private static string Bool(bool value) => value ? "true" : "false";

    /// <summary>The resolved allowlist staff identity + canonical role a bootstrap staff sub-request maps to.</summary>
    private sealed record ResolvedStaff(string ExternalSubject, string DisplayName, string Username, string Role);

    /// <summary>The validated participant-account fields a bootstrap account sub-request maps to.</summary>
    private sealed record ResolvedAccount(string Username, string DisplayName, string Role, string? Password);

    /// <summary>Internal carrier for the staff-validation step: either a resolved identity, a terminal error, or absent.</summary>
    private readonly struct StaffValidation
    {
        private StaffValidation(ResolvedStaff? resolved, string? error)
        {
            Resolved = resolved;
            Error = error;
        }

        public ResolvedStaff? Resolved { get; }

        public string? Error { get; }

        public static StaffValidation Absent => new(null, null);

        public static StaffValidation Ok(ResolvedStaff resolved) => new(resolved, null);

        public static StaffValidation Invalid(string error) => new(null, error);
    }

    /// <summary>Internal carrier for the account-validation step: either resolved fields, a terminal error, or absent.</summary>
    private readonly struct AccountValidation
    {
        private AccountValidation(ResolvedAccount? resolved, string? error)
        {
            Resolved = resolved;
            Error = error;
        }

        public ResolvedAccount? Resolved { get; }

        public string? Error { get; }

        public static AccountValidation Absent => new(null, null);

        public static AccountValidation Ok(ResolvedAccount resolved) => new(resolved, null);

        public static AccountValidation Invalid(string error) => new(null, error);
    }
}

/// <summary>The outcome kind of a <see cref="BootstrapService.BootstrapAsync"/> call.</summary>
public enum BootstrapOutcome
{
    /// <summary>The exercise (and any requested seed rows) were provisioned — the endpoint returns 200 with the result.</summary>
    Provisioned,

    /// <summary>The request failed validation — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The bootstrap secret was unconfigured or wrong — the endpoint returns 404 (fail closed, no existence hint).</summary>
    Rejected,
}

/// <summary>The staff-assignment portion of a successful bootstrap result.</summary>
/// <param name="StaffUserId">The (created or reused) staff user id.</param>
/// <param name="Role">The assigned per-exercise role.</param>
/// <param name="Created">Whether the assignment was created (vs reused) on this call.</param>
public sealed record BootstrapStaffResult(Guid StaffUserId, string Role, bool Created);

/// <summary>The shared-credential portion of a successful bootstrap result.</summary>
/// <param name="Created">Whether the credential was created (vs reused) on this call.</param>
/// <param name="Password">The one-time plaintext when created; <c>null</c> on an idempotent re-run.</param>
public sealed record BootstrapSharedCredentialResult(bool Created, string? Password);

/// <summary>The participant-account portion of a successful bootstrap result.</summary>
/// <param name="AccountId">The (created or reused) account id.</param>
/// <param name="Username">The account login handle.</param>
/// <param name="Created">Whether the account was created (vs reused) on this call.</param>
public sealed record BootstrapAccountResult(Guid AccountId, string Username, bool Created);

/// <summary>
/// The result of a bootstrap attempt. <see cref="BootstrapOutcome.Provisioned"/> carries the exercise id/host +
/// the per-section results; <see cref="BootstrapOutcome.Invalid"/> carries a reason; <see cref="BootstrapOutcome.Rejected"/>
/// carries neither (an unauthorized caller learns nothing).
/// </summary>
public sealed class BootstrapResult
{
    private BootstrapResult(
        BootstrapOutcome outcome,
        string? error,
        Guid? exerciseId,
        string? hostname,
        bool exerciseCreated,
        BootstrapStaffResult? staff,
        BootstrapSharedCredentialResult? sharedCredential,
        BootstrapAccountResult? participantAccount)
    {
        Outcome = outcome;
        Error = error;
        ExerciseId = exerciseId;
        Hostname = hostname;
        ExerciseCreated = exerciseCreated;
        Staff = staff;
        SharedCredential = sharedCredential;
        ParticipantAccount = participantAccount;
    }

    /// <summary>Which outcome occurred.</summary>
    public BootstrapOutcome Outcome { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="BootstrapOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>The bootstrapped exercise id — non-null only on <see cref="BootstrapOutcome.Provisioned"/>.</summary>
    public Guid? ExerciseId { get; }

    /// <summary>The host the exercise is bound to — non-null only on <see cref="BootstrapOutcome.Provisioned"/>.</summary>
    public string? Hostname { get; }

    /// <summary><c>true</c> when this call created the exercise; <c>false</c> on an idempotent re-run.</summary>
    public bool ExerciseCreated { get; }

    /// <summary>The staff-assignment result, or <c>null</c> when no staff sub-request was included.</summary>
    public BootstrapStaffResult? Staff { get; }

    /// <summary>The shared-credential result, or <c>null</c> when no shared-credential sub-request was included.</summary>
    public BootstrapSharedCredentialResult? SharedCredential { get; }

    /// <summary>The participant-account result, or <c>null</c> when no participant-account sub-request was included.</summary>
    public BootstrapAccountResult? ParticipantAccount { get; }

    /// <summary>A successful bootstrap.</summary>
    /// <param name="exerciseId">The bootstrapped exercise id.</param>
    /// <param name="hostname">The bound host.</param>
    /// <param name="exerciseCreated">Whether the exercise was created on this call.</param>
    /// <param name="staff">The staff-assignment result, or <c>null</c>.</param>
    /// <param name="sharedCredential">The shared-credential result, or <c>null</c>.</param>
    /// <param name="participantAccount">The participant-account result, or <c>null</c>.</param>
    /// <returns>A provisioned result.</returns>
    public static BootstrapResult Provisioned(
        Guid exerciseId,
        string hostname,
        bool exerciseCreated,
        BootstrapStaffResult? staff,
        BootstrapSharedCredentialResult? sharedCredential,
        BootstrapAccountResult? participantAccount)
    {
        ArgumentException.ThrowIfNullOrEmpty(hostname);
        return new BootstrapResult(
            BootstrapOutcome.Provisioned, null, exerciseId, hostname, exerciseCreated,
            staff, sharedCredential, participantAccount);
    }

    /// <summary>A validation failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static BootstrapResult Invalid(string error) =>
        new(BootstrapOutcome.Invalid, error, null, null, false, null, null, null);

    /// <summary>The fail-closed result for an unconfigured/wrong bootstrap secret.</summary>
    /// <returns>A rejected result.</returns>
    public static BootstrapResult Rejected() =>
        new(BootstrapOutcome.Rejected, null, null, null, false, null, null, null);
}
