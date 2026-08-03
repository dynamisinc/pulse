namespace Pulse.WebApi.Features.Ops.OrgAdminSeed;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// The idempotent, NON-PRODUCTION startup seeder that guarantees the customer organization has at least one
/// <c>orgAdmin</c> — the role <c>Features/ExerciseLifecycleAdmin</c> gates the whole organization tier on
/// (COR-076) and which, until now, <b>nothing anywhere could provision</b>:
/// <c>BootstrapService.CanonicalStaffRoles</c> accepts only <c>controller</c>/<c>evaluator</c>/<c>planner</c>,
/// staff login requires a pre-existing <see cref="StaffAssignment"/>, and
/// <c>ExerciseCreationService</c> copies the CREATOR's role — so the org-admin surface was reachable only by
/// hand-inserting a database row.
/// </summary>
/// <remarks>
/// <para>
/// <b>A startup seeder, not a migration — deliberately.</b> It re-checks on every boot, so deleting the row
/// self-heals on the next restart, and an operational bootstrap stays out of the schema history (an applied
/// migration can never be edited, and a data seed that belongs to one environment does not belong in a file
/// every environment replays).
/// </para>
/// <para>
/// <b>The production gate is the guard; the credential lookup is the correctness check.</b> (1)
/// <see cref="OrgAdminSeedGate"/> refuses to run in <see cref="Environments.Production"/> at all — and the
/// composition root does not even register the hosted service there. (2) The seeded identity is resolved from
/// the staff allowlist (<c>Authentication:StaffIdentity</c>); with no entry, or an entry with no secret, the
/// seeder writes NOTHING and says so loudly.
/// </para>
/// <para>
/// <b>Zero-config, without a fallback branch in here.</b> Outside production the composition root
/// (<see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/>) appends the published
/// <see cref="DefaultOrgAdminAccount"/> to that allowlist at REGISTRATION time when no entry for the target
/// username was configured — so a freshly-cloned checkout boots and can sign in with no configuration step,
/// while the code below still does nothing but "resolve from the allowlist, refuse if absent". That refusal is
/// still reachable and still load-bearing: an entry that IS configured for this username but carries no secret
/// (or no subject) blocks the default injection deliberately, and lands here.
/// </para>
/// <para>
/// <b>The identity trap this exists to avoid.</b> <c>StaffLoginService</c> resolves a <see cref="StaffUser"/> by
/// <see cref="StaffUser.ExternalSubject"/> and AUTO-PROVISIONS one when absent. A seeder that invented its own
/// subject would therefore produce a second, disconnected <see cref="StaffUser"/> the moment the human actually
/// logged in, leaving the seeded assignment attached to a row nobody can authenticate as — the "built, green,
/// wired to nothing" defect in its purest form. So the subject / display name / username come VERBATIM from the
/// allowlist entry (exactly what <see cref="DynamisIdentityProvider"/> returns on a successful login), and the
/// entry must carry a non-empty secret — the same requirement, for the same reason,
/// <c>BootstrapService.ValidateStaff</c> already enforces.
/// </para>
/// <para>
/// <b>Non-clobbering, like every other seed path here.</b> An existing <see cref="StaffUser"/> is reused and
/// never re-homed onto another tenant; an existing <see cref="StaffAssignment"/> is left exactly as it is — a
/// controller who happens to be this account would silently LOSE cockpit access if the seeder overwrote their
/// role. When every exercise is already assigned, the seeder refuses and logs what a human must do instead.
/// </para>
/// <para>
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work it writes through; the hosted service
/// resolves it inside its own scope at host start.
/// </para>
/// </remarks>
public sealed partial class OrgAdminSeedService
{
    /// <summary>
    /// The staff allowlist handle the seeded org-admin is resolved from. A FIXED value rather than another
    /// configuration key on purpose: the seeder's whole contract is "this named development/UAT operator can
    /// always reach the org tier", and a configurable target would just be a second way to mis-configure the
    /// one thing that has to line up with <c>Authentication:StaffIdentity</c>.
    /// </summary>
    public const string TargetUsername = "tbull@dynamis.com";

    /// <summary>The XC-004 event type emitted once per seeded assignment.</summary>
    public const string SeededEventType = "staff.org_admin_seeded";

    private const string SchemaVersion = "v0";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SeedActorId = "org-admin-seed";
    private const string StaffUserEntityType = "staffUser";

    private readonly PulseDbContext _dbContext;
    private readonly DynamisIdentityProviderOptions _staffAllowlist;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<OrgAdminSeedService> _logger;

    /// <summary>Creates the seeder over its collaborators.</summary>
    /// <param name="dbContext">The persistence context every seeded row is written through in one unit of work.</param>
    /// <param name="staffAllowlist">The configured Phase-1 staff allowlist the seeded identity is resolved from.</param>
    /// <param name="environment">The host environment the non-production gate is evaluated against.</param>
    /// <param name="logger">The logger the refusal / outcome messages are written to (never a secret, NFR-009).</param>
    public OrgAdminSeedService(
        PulseDbContext dbContext,
        IOptions<DynamisIdentityProviderOptions> staffAllowlist,
        IHostEnvironment environment,
        ILogger<OrgAdminSeedService> logger)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffAllowlist);
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(logger);

        _dbContext = dbContext;
        _staffAllowlist = staffAllowlist.Value ?? new DynamisIdentityProviderOptions();
        _environment = environment;
        _logger = logger;
    }

    /// <summary>
    /// Ensures the organization has an <c>orgAdmin</c>, writing nothing at all unless one is genuinely missing
    /// AND a usable credential is configured. Safe to call on every boot; never throws for an ordinary
    /// "nothing to do" outcome.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>What the seeder did (or refused to do), for the hosted service's log and for the tests.</returns>
    public async Task<OrgAdminSeedResult> SeedAsync(CancellationToken cancellationToken = default)
    {
        // 1. THE production gate, re-evaluated here as well as at registration time. Defense in depth: a future
        //    wiring change that registered the hosted service unconditionally must still be unable to seed an
        //    administrator into a customer-facing deployment.
        if (!OrgAdminSeedGate.IsEnabled(_environment))
        {
            LogRefusedInProduction(_environment.EnvironmentName);
            return OrgAdminSeedResult.RefusedInProduction();
        }

        // 2. Resolve the credential BEFORE touching the database. This is a pure configuration read with no
        //    side effects, and doing it first means an un-opted-in host (every CI test host, and any environment
        //    that never configured the allowlist) performs ZERO database work at startup — the seeder is inert
        //    rather than merely harmless. The trade-off is that the "no credential configured" warning also
        //    fires on a host that already HAS an org admin, so the message is worded to be true either way.
        var credential = ResolveAllowlistCredential();
        if (credential is null)
        {
            LogNoCredentialConfigured(TargetUsername, DynamisIdentityProviderOptions.SectionName);
            return OrgAdminSeedResult.NoCredentialConfigured();
        }

        // 3. Resolve the staff human the SAME way staff login does, so a later login binds to THIS row rather
        //    than auto-provisioning a second one.
        // org-scope-exempt(ResolutionRoot): resolve-by-IdP-subject IS the identity resolution — it is how the
        // tenant gets discovered in the first place (the row CARRIES the OrganizationId used below), so a
        // tenant bound here would be a deadlock, exactly as in StaffLoginService and BootstrapService.
        var staffUser = await _dbContext.StaffUsers
            .FirstOrDefaultAsync(u => u.ExternalSubject == credential.ExternalSubject, cancellationToken);

        // 4. The tenant. An EXISTING staff human keeps their own organization — re-homing them would be the
        //    silent cross-customer move exercise-isolation/11 exists to prevent, AND it would break the very
        //    login this seeder unblocks (StaffLoginService refuses when the human's tenant differs from the
        //    exercise's). A first-seen human joins the well-known DEFAULT tenant, the same one BootstrapService
        //    and the OrganizationTenantBoundary migration use. Never a client-supplied value; there is no client.
        var organizationId = staffUser?.OrganizationId ?? Organization.DefaultOrganizationId;

        // 5. "If there is no org admin" — asked of the whole tenant, of ANY staff human, not just this one.
        if (await OrganizationHasAnOrgAdminAsync(organizationId, cancellationToken))
        {
            LogAlreadyProvisioned(organizationId);
            return OrgAdminSeedResult.AlreadyProvisioned(organizationId);
        }

        // 6. Login is PER-EXERCISE and reads Session.Role off the assignment, so an org admin with no
        //    assignment can never sign in as one. Assign across the tenant's existing exercises.
        var exercises = await _dbContext.Exercises
            .AsNoTracking()
            .InOrganization(organizationId)
            .ToListAsync(cancellationToken);

        if (exercises.Count == 0)
        {
            // The known empty-organization gap (a separate story owns the login-model fix). Say so plainly and
            // write NOTHING — a StaffUser with no assignment grants nothing and is exactly the half-seeded state
            // that reads as "provisioned" while being unusable. Startup continues regardless.
            LogNoExercisesInOrganization(organizationId, TargetUsername);
            return OrgAdminSeedResult.NoExercisesInOrganization(organizationId);
        }

        var alreadyAssignedExerciseIds = staffUser is null
            ? new HashSet<Guid>()
            : (await _dbContext.StaffAssignments
                    .Where(a => a.StaffUserId == staffUser.Id)
                    .Select(a => a.ExerciseId)
                    .ToListAsync(cancellationToken))
                .ToHashSet();

        var targets = exercises.Where(e => !alreadyAssignedExerciseIds.Contains(e.Id)).ToList();
        if (targets.Count == 0)
        {
            // Every exercise already carries an assignment for this human, and (step 5) none of them is
            // orgAdmin. The (StaffUserId, ExerciseId) unique index means the only way to grant orgAdmin here
            // would be to OVERWRITE an existing role — which would silently strip, say, a controller of the
            // cockpit. Refuse, loudly, with the two things a human can actually do about it.
            LogEveryExerciseAlreadyAssigned(TargetUsername, organizationId, exercises.Count);
            return OrgAdminSeedResult.NoUnassignedExercise(organizationId);
        }

        // 7. ONE server wall-clock read stamps every row and every telemetry event.
        var now = DateTimeOffset.UtcNow;

        if (staffUser is null)
        {
            staffUser = new StaffUser
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,

                // VERBATIM from the allowlist — the exact values DynamisIdentityProvider resolves on a real
                // login, so that login finds THIS row instead of provisioning a second one.
                ExternalSubject = credential.ExternalSubject,
                DisplayName = credential.DisplayName,
                Username = credential.Username,
                CreatedAt = now,
            };
            _dbContext.StaffUsers.Add(staffUser);
        }

        foreach (var exercise in targets)
        {
            _dbContext.StaffAssignments.Add(new StaffAssignment
            {
                Id = Guid.NewGuid(),
                StaffUserId = staffUser.Id,
                ExerciseId = exercise.Id,
                Role = ExerciseAdminRoles.OrgAdmin,
                CreatedAt = now,
            });

            // Exactly one XC-004 audit event per granted assignment, in the SAME unit of work — minting an
            // administrator is the most privilege-relevant write this codebase performs unattended.
            _dbContext.TelemetryEvents.Add(BuildSeededTelemetry(exercise, staffUser.Id, now));
        }

        // ONE SaveChanges: both write guards run here (the staff user carries a non-empty tenant, every
        // telemetry row a non-empty exercise id), and a failure leaves NO partially-seeded administrator.
        await _dbContext.SaveChangesAsync(cancellationToken);

        LogSeeded(TargetUsername, staffUser.Id, organizationId, targets.Count);
        return OrgAdminSeedResult.Seeded(organizationId, staffUser.Id, targets.Count);
    }

    /// <summary>
    /// Whether ANY staff human in <paramref name="organizationId"/> already holds an <c>orgAdmin</c> assignment
    /// — the "there is already an org admin, do nothing" condition.
    /// </summary>
    /// <remarks>
    /// <see cref="StaffAssignment"/> carries no tenant of its own (it is the cross-exercise access record), so
    /// the tenant bound is applied to the <see cref="StaffUser"/> side of the join and fails closed to zero rows
    /// on an unresolved tenant — which would make the seeder try to seed rather than wrongly stand down.
    /// </remarks>
    private async Task<bool> OrganizationHasAnOrgAdminAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        // No exemption marker: this read carries its tenant bound inline, which is what the sweep asks for.
        var tenantStaffUserIds = _dbContext.StaffUsers.InOrganization(organizationId).Select(u => u.Id);

        // The Role column matches case-insensitively under the CI collation, so a hand-seeded "orgadmin" row
        // still counts as an existing administrator (ExerciseAdminRoles matches case-insensitively too).
        return await _dbContext.StaffAssignments
            .Where(a => a.Role == ExerciseAdminRoles.OrgAdmin && tenantStaffUserIds.Contains(a.StaffUserId))
            .AnyAsync(cancellationToken);
    }

    /// <summary>
    /// Resolves <see cref="TargetUsername"/> in the configured staff allowlist, or <c>null</c> when the entry is
    /// missing, has no external subject, or has no secret.
    /// </summary>
    /// <remarks>
    /// The secret is only ever TESTED for emptiness — its value is never read, copied, logged or persisted
    /// (NFR-004/NFR-009; <see cref="StaffUser"/> has no credential column by design). Requiring it is what stops
    /// this seeder producing an assignment that could never authenticate.
    /// </remarks>
    private ResolvedOrgAdminCredential? ResolveAllowlistCredential()
    {
        var entry = _staffAllowlist.Accounts.FirstOrDefault(account =>
            !string.IsNullOrEmpty(account.ExternalSubject)
            && !string.IsNullOrEmpty(account.Secret)
            && string.Equals(account.Username, TargetUsername, StringComparison.OrdinalIgnoreCase));

        if (entry is null)
        {
            return null;
        }

        return new ResolvedOrgAdminCredential(
            entry.ExternalSubject,
            string.IsNullOrEmpty(entry.DisplayName) ? TargetUsername : entry.DisplayName,
            string.IsNullOrEmpty(entry.Username) ? TargetUsername : entry.Username);
    }

    /// <summary>
    /// Builds the single XC-004 <c>staff.org_admin_seeded</c> audit event for one granted assignment. Follows
    /// the staff-action precedent (<c>exercise.created</c> / <c>exercise.bootstrapped</c>): the v0 envelope has
    /// no staff actor kind, so an unattended server action is <c>actor.kind: 'system'</c> with a fixed acting-id.
    /// The opaque payload records the role granted; it deliberately does NOT record the tenant (XC-002).
    /// </summary>
    private static TelemetryEvent BuildSeededTelemetry(Exercise exercise, Guid staffUserId, DateTimeOffset now) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = exercise.Id,
        EventType = SeededEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = ExerciseAdminRoles.OrgAdmin,
            ActingHumanId = SeedActorId,
        },
        WallClockTime = now,

        // COR-053: no native backend scenario clock until B3, so a server-side event carries the stored
        // scenario instant when there is one and the wall clock otherwise — the same placeholder every other
        // pre-COR-050 staff event uses.
        ScenarioTime = exercise.CurrentScenarioTime ?? now,
        TimeZone = exercise.TimeZone,
        Target = new TelemetryTarget { EntityType = StaffUserEntityType, EntityId = staffUserId.ToString() },
        Payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"role\":{JsonSerializer.Serialize(ExerciseAdminRoles.OrgAdmin)}," +
            $"\"seededBy\":{JsonSerializer.Serialize(SeedActorId)}}}"),
        EmittedAt = now,
    };

    /// <summary>The allowlist-resolved identity a seeded <see cref="StaffUser"/> is built from, verbatim.</summary>
    private sealed record ResolvedOrgAdminCredential(string ExternalSubject, string DisplayName, string Username);

    /// <summary>Source-generated production-refusal log (CA1848) — the gate that must never be crossed.</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "The orgAdmin startup seeder did NOT run: the host environment is '{EnvironmentName}', and "
                + "the seeder is a non-production development/UAT convenience only.")]
    private partial void LogRefusedInProduction(string environmentName);

    /// <summary>Source-generated "no credential, so nothing was seeded" warning (CA1848) — the loud refusal.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The orgAdmin startup seeder is INERT and wrote nothing: no staff-allowlist entry for "
                + "'{TargetUsername}' with a non-empty secret is configured, so it cannot provision an org "
                + "admin if one is missing. Configure {ConfigurationSection}:Accounts:{{i}}:Username = "
                + "'{TargetUsername}' together with that entry's Secret, ExternalSubject and DisplayName "
                + "(user-secrets locally, App Service configuration in UAT). Seeding a staff user or an "
                + "assignment without a credential would create an administrator nobody can authenticate as.")]
    private partial void LogNoCredentialConfigured(string targetUsername, string configurationSection);

    /// <summary>Source-generated no-op log (CA1848) — an org admin already exists.</summary>
    [LoggerMessage(
        Level = LogLevel.Debug,
        Message = "The orgAdmin startup seeder made no changes: organization {OrganizationId} already has at "
                + "least one orgAdmin assignment.")]
    private partial void LogAlreadyProvisioned(Guid organizationId);

    /// <summary>Source-generated empty-organization log (CA1848) — the known gap, named rather than hidden.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The orgAdmin startup seeder wrote nothing: organization {OrganizationId} owns NO exercises, "
                + "and a staff role is granted per exercise — so there is nothing to make '{TargetUsername}' an "
                + "orgAdmin of yet. Create an exercise (POST /api/ops/bootstrap-exercise) and restart; the "
                + "seeder re-checks on every boot.")]
    private partial void LogNoExercisesInOrganization(Guid organizationId, string targetUsername);

    /// <summary>Source-generated "cannot grant without clobbering" warning (CA1848) — refuses rather than overwrites.</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The orgAdmin startup seeder wrote nothing: '{TargetUsername}' already holds a NON-orgAdmin "
                + "assignment on all {ExerciseCount} exercise(s) in organization {OrganizationId}, and one "
                + "staff human may hold only one role per exercise. The seeder will not overwrite an existing "
                + "role (that would strip a controller of the cockpit). Create another exercise, or change one "
                + "assignment's role to 'orgAdmin' by hand.")]
    private partial void LogEveryExerciseAlreadyAssigned(string targetUsername, Guid organizationId, int exerciseCount);

    /// <summary>Source-generated success log (CA1848) — the privilege grant, on the record.</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "The orgAdmin startup seeder granted '{TargetUsername}' (staff user {StaffUserId}) the "
                + "orgAdmin role on {AssignmentCount} exercise(s) in organization {OrganizationId}.")]
    private partial void LogSeeded(string targetUsername, Guid staffUserId, Guid organizationId, int assignmentCount);
}

/// <summary>What a single <see cref="OrgAdminSeedService.SeedAsync"/> pass did — or refused to do.</summary>
public enum OrgAdminSeedOutcome
{
    /// <summary>The host is production; the seeder is disabled and wrote nothing.</summary>
    RefusedInProduction,

    /// <summary>No usable staff-allowlist entry for the target account; the seeder wrote nothing and logged loudly.</summary>
    NoCredentialConfigured,

    /// <summary>The organization already has an <c>orgAdmin</c>; nothing to do.</summary>
    AlreadyProvisioned,

    /// <summary>The organization owns no exercises, so no per-exercise role could be granted; nothing was written.</summary>
    NoExercisesInOrganization,

    /// <summary>The target already holds a different role on every exercise; the seeder refused to overwrite one.</summary>
    NoUnassignedExercise,

    /// <summary>The <c>orgAdmin</c> assignment(s) were created.</summary>
    Seeded,
}

/// <summary>
/// The outcome of one seeding pass. Only <see cref="OrgAdminSeedOutcome.Seeded"/> implies anything was written;
/// every other outcome guarantees the database is untouched.
/// </summary>
public sealed class OrgAdminSeedResult
{
    private OrgAdminSeedResult(
        OrgAdminSeedOutcome outcome,
        Guid? organizationId,
        Guid? staffUserId,
        int assignmentsCreated)
    {
        Outcome = outcome;
        OrganizationId = organizationId;
        StaffUserId = staffUserId;
        AssignmentsCreated = assignmentsCreated;
    }

    /// <summary>Which outcome occurred.</summary>
    public OrgAdminSeedOutcome Outcome { get; }

    /// <summary>The tenant the pass was about, when one was resolved.</summary>
    public Guid? OrganizationId { get; }

    /// <summary>The (created or reused) staff user — non-null only on <see cref="OrgAdminSeedOutcome.Seeded"/>.</summary>
    public Guid? StaffUserId { get; }

    /// <summary>How many <c>orgAdmin</c> assignments this pass created; zero for every non-seeding outcome.</summary>
    public int AssignmentsCreated { get; }

    /// <summary>The production refusal — the seeder is disabled outside development/UAT.</summary>
    /// <returns>A refused result.</returns>
    public static OrgAdminSeedResult RefusedInProduction() =>
        new(OrgAdminSeedOutcome.RefusedInProduction, null, null, 0);

    /// <summary>The loud refusal for a missing / secret-less allowlist entry.</summary>
    /// <returns>An unconfigured result.</returns>
    public static OrgAdminSeedResult NoCredentialConfigured() =>
        new(OrgAdminSeedOutcome.NoCredentialConfigured, null, null, 0);

    /// <summary>The idempotent no-op: an org admin already exists.</summary>
    /// <param name="organizationId">The tenant checked.</param>
    /// <returns>An already-provisioned result.</returns>
    public static OrgAdminSeedResult AlreadyProvisioned(Guid organizationId) =>
        new(OrgAdminSeedOutcome.AlreadyProvisioned, organizationId, null, 0);

    /// <summary>The empty-organization case: nothing to grant a per-exercise role on.</summary>
    /// <param name="organizationId">The tenant checked.</param>
    /// <returns>An empty-organization result.</returns>
    public static OrgAdminSeedResult NoExercisesInOrganization(Guid organizationId) =>
        new(OrgAdminSeedOutcome.NoExercisesInOrganization, organizationId, null, 0);

    /// <summary>The non-clobbering refusal: every exercise already carries a different role for this human.</summary>
    /// <param name="organizationId">The tenant checked.</param>
    /// <returns>A no-unassigned-exercise result.</returns>
    public static OrgAdminSeedResult NoUnassignedExercise(Guid organizationId) =>
        new(OrgAdminSeedOutcome.NoUnassignedExercise, organizationId, null, 0);

    /// <summary>A successful seed.</summary>
    /// <param name="organizationId">The tenant seeded into.</param>
    /// <param name="staffUserId">The created or reused staff human.</param>
    /// <param name="assignmentsCreated">How many assignments were granted.</param>
    /// <returns>A seeded result.</returns>
    public static OrgAdminSeedResult Seeded(Guid organizationId, Guid staffUserId, int assignmentsCreated) =>
        new(OrgAdminSeedOutcome.Seeded, organizationId, staffUserId, assignmentsCreated);
}
