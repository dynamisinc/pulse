namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The real, role-gated, session-authenticated exercise CREATION path (COR-074) — the thing no requirement,
/// story or endpoint had ever covered. Before this the only code anywhere that could create an
/// <see cref="Exercise"/> was <c>POST /api/ops/bootstrap-exercise</c>, gated entirely by a deployment secret
/// and explicitly documented as "PHASE-1 / UAT-ONLY … MUST NOT be reachable in a real customer-facing
/// deployment".
/// </summary>
/// <remarks>
/// <para>
/// <b>The ops bootstrap seam is untouched.</b> Nothing here calls it, routes through it, deprecates it or
/// relaxes its secret gate, its rate limit or its 404-when-unconfigured posture. The two paths overlap only in
/// that both end up inserting an <see cref="Exercise"/> row, and they deliberately produce DIFFERENT states:
/// bootstrap seeds a <c>live</c> run for UAT, this creates a <c>build</c> one (COR-032) because a
/// customer-created exercise starts in staff-only content development.
/// </para>
/// <para>
/// <b>Server-authoritative, on every axis that matters.</b> The owning tenant is the caller's OWN
/// server-resolved organization (<see cref="StaffCallerContext"/>), never a client-supplied value — the
/// request DTO has no field for one. The lifecycle status is always <c>build</c>. The id, the creation
/// wall-clock and (when the caller proposes none) the hostname are server-generated. ONE wall-clock read
/// stamps the exercise, the assignment and the telemetry event.
/// </para>
/// <para>
/// <b>Hostname uniqueness is enforced by the DATABASE, not by a read (COR-008).</b> A pre-flight "is this host
/// taken" query would have to be unbounded across every customer — a cross-tenant read whose result also races
/// the insert. The filtered unique index on <c>Exercises.Hostname</c> is already the authority
/// (<c>HostExerciseResolver</c> fails closed on an ambiguous host, so a collision is a correctness break, not a
/// cosmetic one), so a collision surfaces as a unique-key violation on the single <c>SaveChangesAsync</c> and
/// is mapped to <c>409</c>. Because everything is staged in ONE unit of work, a refused create leaves NO
/// exercise, NO assignment and NO telemetry behind — never a half-created exercise.
/// </para>
/// <para>
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work.
/// </para>
/// </remarks>
public sealed class ExerciseCreationService
{
    /// <summary>Maximum accepted length of the staff-facing exercise name (DoS + column-fit guard, NFR-004).</summary>
    public const int MaxNameLength = 200;

    /// <summary>Maximum length of the slug portion of a server-generated hostname label.</summary>
    private const int MaxGeneratedSlugLength = 40;

    private const string CreatedEventType = "exercise.created";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string SchemaVersion = "v0";
    private const string ExerciseEntityType = "exercise";

    /// <summary>SQL Server error numbers for a unique-index / unique-constraint violation.</summary>
    private const int DuplicateKeyErrorNumber = 2601;
    private const int UniqueConstraintErrorNumber = 2627;

    private readonly PulseDbContext _dbContext;
    private readonly StaffCallerContext _staffCaller;

    /// <summary>Creates the service over its persistence context and the server-resolved caller seam.</summary>
    /// <param name="dbContext">The persistence context every row is written through in one unit of work.</param>
    /// <param name="staffCaller">Resolves the caller's identity, role and tenant from the server-issued session.</param>
    public ExerciseCreationService(PulseDbContext dbContext, StaffCallerContext staffCaller)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(staffCaller);

        _dbContext = dbContext;
        _staffCaller = staffCaller;
    }

    /// <summary>
    /// Creates one exercise owned by the caller's own organization, in lifecycle state <c>build</c>, with a
    /// unique hostname and a <see cref="StaffAssignment"/> for the creator — plus exactly one XC-004
    /// <c>exercise.created</c> event, all in a single unit of work.
    /// </summary>
    /// <param name="request">The request body (a <c>null</c> body is a 400).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    public async Task<CreateExerciseResult> CreateAsync(
        CreateExerciseRequest? request,
        CancellationToken cancellationToken = default)
    {
        var caller = await _staffCaller.ResolveAsync(cancellationToken);
        if (caller is null)
        {
            // No live staff session, or no server-resolved tenant. Fail closed BEFORE inspecting the body, so
            // an unauthenticated caller learns nothing about validation either.
            return CreateExerciseResult.Unauthenticated();
        }

        // Defense in depth over the endpoint filter: a service must fail closed on its own, so a future
        // mapping that forgot the filter cannot turn every staff session into an exercise administrator.
        if (!ExerciseAdminRoles.IsExerciseAdministrator(caller.Role))
        {
            return CreateExerciseResult.Forbidden();
        }

        if (request is null)
        {
            return CreateExerciseResult.Invalid("A JSON body with the new exercise's name is required.");
        }

        if (!TryNormalizeName(request.Name, out var name, out var nameError))
        {
            return CreateExerciseResult.Invalid(nameError);
        }

        string hostname;
        if (string.IsNullOrWhiteSpace(request.Hostname))
        {
            hostname = GenerateHostname(name);
        }
        else if (!ExerciseHostName.TryNormalize(request.Hostname, out hostname))
        {
            // The SAME normalizer the host → exercise resolution path uses (COR-008 / NFR-004), so a hostname
            // this endpoint accepts is exactly one that middleware could later resolve.
            return CreateExerciseResult.Invalid(
                "hostname must be a valid DNS hostname (lower-case letters, digits, hyphens and dots).");
        }

        var now = DateTimeOffset.UtcNow;

        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),

            // COR-074 AC: the owning tenant is ALWAYS the caller's own server-resolved organization. There is
            // no client-supplied alternative anywhere in this method — the request DTO has no such field.
            OrganizationId = caller.OrganizationId,

            Name = name,
            Hostname = hostname,

            // COR-032: a newly created exercise is in staff-only content development. Never any other state.
            Status = ExerciseLifecycleStates.Build,

            CreatedAt = now,

            // Everything else is left to Exercise's own documented defaults (TimeZone "UTC",
            // ComplianceChromeEnabled true, WatermarkEnabled true, IsPracticeMode false), so a created
            // exercise is indistinguishable from any other un-configured one.
        };

        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(),
            StaffUserId = caller.StaffUserId,
            ExerciseId = exercise.Id,

            // COR-074 AC3: the creator's OWN role (planner or orgAdmin) — so they reach the new run through
            // the exercise switcher with no separate provisioning step.
            Role = caller.Role,
            CreatedAt = now,
        };

        _dbContext.Exercises.Add(exercise);
        _dbContext.StaffAssignments.Add(assignment);
        _dbContext.TelemetryEvents.Add(BuildCreatedTelemetry(exercise, caller, now));

        try
        {
            // ONE SaveChanges: both write guards run here (the exercise carries a non-empty tenant; the
            // telemetry row carries the new, non-empty exercise id), and a failure rolls back all three rows.
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueKeyViolation(exception))
        {
            // The only unique index this insert can trip is Exercises.Hostname: the exercise id and the
            // telemetry event id are freshly generated GUIDs, and the (StaffUserId, ExerciseId) assignment
            // index cannot collide against an exercise that did not exist a moment ago. Discard the staged,
            // rolled-back rows so the request-scoped context is not left dirty, and report the conflict.
            _dbContext.ChangeTracker.Clear();
            return CreateExerciseResult.HostnameTaken(hostname);
        }

        return CreateExerciseResult.Created(
            new CreateExerciseResponseDto
            {
                Exercise = ToDto(exercise),
                AssignedRole = assignment.Role,
            });
    }

    /// <summary>Projects a freshly created exercise onto the shared org-admin row shape.</summary>
    private static OrgExerciseDto ToDto(Exercise exercise) => new()
    {
        ExerciseId = exercise.Id.ToString(),
        Name = exercise.Name,
        Status = exercise.Status,
        Hostname = exercise.Hostname,
        CreatedAt = exercise.CreatedAt?.ToString("O", CultureInfo.InvariantCulture),
    };

    /// <summary>
    /// Trims, STRIPS markup (NFR-004 — the same <see cref="PostSanitizer"/> the post-ingest path uses, because
    /// an exercise name renders on staff surfaces) and length-bounds the staff-facing exercise name.
    /// </summary>
    private static bool TryNormalizeName(string? raw, out string name, out string error)
    {
        name = string.Empty;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            error = "name is required.";
            return false;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.Length == 0)
        {
            error = "name is required (it contained only markup, which is stripped on ingest).";
            return false;
        }

        if (sanitized.Length > MaxNameLength)
        {
            error = $"name must be at most {MaxNameLength} characters.";
            return false;
        }

        name = sanitized;
        error = string.Empty;
        return true;
    }

    /// <summary>
    /// Allocates a hostname label for an exercise whose creator proposed none (COR-008): a slug of the name
    /// plus an 8-hex-character suffix. The suffix is what makes it unique in practice; the database's unique
    /// index is what makes it unique in fact.
    /// </summary>
    /// <remarks>
    /// The result is always a valid RFC-1123 label by construction — the slug is stripped to
    /// <c>[a-z0-9-]</c>, cannot start or end with a hyphen, is capped well under the 63-character label limit,
    /// and the hex suffix guarantees a trailing alphanumeric — so it round-trips through
    /// <see cref="ExerciseHostName.TryNormalize"/> unchanged. It is a LABEL, not a provisioned FQDN: actually
    /// pointing DNS at it (and any branded domain, COR-008/COR-009) is a deployment step this story does not
    /// own, which is why the value is also editable by re-proposing one on a later run.
    /// </remarks>
    private static string GenerateHostname(string name)
    {
        var slug = Slugify(name);
        var suffix = Guid.NewGuid().ToString("N")[..8];

        return slug.Length == 0 ? $"exercise-{suffix}" : $"{slug}-{suffix}";
    }

    /// <summary>Reduces a display name to a lower-case <c>[a-z0-9-]</c> slug with no leading/trailing hyphen.</summary>
    private static string Slugify(string name)
    {
        var builder = new StringBuilder(MaxGeneratedSlugLength);
        var lastWasHyphen = false;

        foreach (var character in name)
        {
            if (builder.Length >= MaxGeneratedSlugLength)
            {
                break;
            }

            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
                lastWasHyphen = false;
            }
            else if (!lastWasHyphen && builder.Length > 0)
            {
                builder.Append('-');
                lastWasHyphen = true;
            }
        }

        // A trailing hyphen would make the label invalid (and a leading one is impossible above).
        while (builder.Length > 0 && builder[^1] == '-')
        {
            builder.Length--;
        }

        return builder.ToString();
    }

    /// <summary>
    /// Whether a failed save was a SQL Server unique-index / unique-constraint violation, rather than some
    /// other database error that must NOT be reported to the caller as a hostname conflict.
    /// </summary>
    private static bool IsUniqueKeyViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException
        {
            Number: DuplicateKeyErrorNumber or UniqueConstraintErrorNumber,
        };

    /// <summary>
    /// Builds the single XC-004 <c>exercise.created</c> audit event. Following the staff-action precedent, the
    /// v0 envelope has no dedicated staff <c>actor.kind</c>, so a genuine staff action is
    /// <c>actor.kind: 'system'</c> carrying the acting human's id — the same shape
    /// <c>exercise.switched</c> and <c>exercise.bootstrapped</c> already use. The opaque payload records the
    /// allocated host and the role granted; it deliberately does NOT record the tenant (XC-002).
    /// </summary>
    private static TelemetryEvent BuildCreatedTelemetry(Exercise exercise, StaffCaller caller, DateTimeOffset now) => new()
    {
        EventId = Guid.NewGuid().ToString(),
        SchemaVersion = SchemaVersion,
        ExerciseId = exercise.Id,
        EventType = CreatedEventType,
        Channel = SystemChannel,
        Actor = new TelemetryActor
        {
            Kind = SystemActorKind,
            Role = caller.Role,
            ActingHumanId = caller.StaffUserId.ToString(),
            SessionId = caller.SessionId.ToString(),
        },
        WallClockTime = now,

        // COR-053: a brand-new exercise has no stored scenario instant yet, so the created event carries the
        // wall clock as its scenario time — the same placeholder every other pre-COR-050 staff event uses.
        ScenarioTime = exercise.CurrentScenarioTime ?? now,
        TimeZone = exercise.TimeZone,
        Target = new TelemetryTarget { EntityType = ExerciseEntityType, EntityId = exercise.Id.ToString() },
        Payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"status\":{JsonSerializer.Serialize(exercise.Status)}," +
            $"\"hostname\":{JsonSerializer.Serialize(exercise.Hostname)}," +
            $"\"creatorAssignmentRole\":{JsonSerializer.Serialize(caller.Role)}}}"),
        EmittedAt = now,
    };
}

/// <summary>The outcome kind of an <see cref="ExerciseCreationService.CreateAsync"/> call.</summary>
public enum CreateExerciseOutcome
{
    /// <summary>The exercise, its creator assignment and its audit event were persisted — the endpoint returns 201.</summary>
    Created,

    /// <summary>The request failed validation — the endpoint returns 400 and nothing was written.</summary>
    Invalid,

    /// <summary>No live staff session, or no server-resolved tenant — the endpoint returns 401 (fail closed).</summary>
    Unauthenticated,

    /// <summary>A live staff caller whose role may not create exercises — the endpoint returns 403.</summary>
    Forbidden,

    /// <summary>The hostname is already held by another exercise — the endpoint returns 409 and nothing was written.</summary>
    HostnameTaken,
}

/// <summary>
/// The result of a creation attempt. Only <see cref="CreateExerciseOutcome.Created"/> carries a body; the
/// fail-closed outcomes carry nothing an unauthorized caller could learn from.
/// </summary>
public sealed class CreateExerciseResult
{
    private CreateExerciseResult(CreateExerciseOutcome outcome, CreateExerciseResponseDto? created, string? error)
    {
        Outcome = outcome;
        Response = created;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public CreateExerciseOutcome Outcome { get; }

    /// <summary>The created exercise — non-null only on <see cref="CreateExerciseOutcome.Created"/>.</summary>
    public CreateExerciseResponseDto? Response { get; }

    /// <summary>The human-readable reason — non-null on <see cref="CreateExerciseOutcome.Invalid"/> and <see cref="CreateExerciseOutcome.HostnameTaken"/>.</summary>
    public string? Error { get; }

    /// <summary>A successful creation.</summary>
    /// <param name="created">The created exercise + the creator's assignment role.</param>
    /// <returns>A created result.</returns>
    public static CreateExerciseResult Created(CreateExerciseResponseDto created)
    {
        ArgumentNullException.ThrowIfNull(created);
        return new CreateExerciseResult(CreateExerciseOutcome.Created, created, null);
    }

    /// <summary>A rejected request.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static CreateExerciseResult Invalid(string error) =>
        new(CreateExerciseOutcome.Invalid, null, error);

    /// <summary>The fail-closed result for a caller with no live staff session or no resolved tenant.</summary>
    /// <returns>An unauthenticated result.</returns>
    public static CreateExerciseResult Unauthenticated() =>
        new(CreateExerciseOutcome.Unauthenticated, null, null);

    /// <summary>The fail-closed result for a staff role that may not create exercises.</summary>
    /// <returns>A forbidden result.</returns>
    public static CreateExerciseResult Forbidden() =>
        new(CreateExerciseOutcome.Forbidden, null, null);

    /// <summary>The conflict result for a hostname another exercise already holds.</summary>
    /// <param name="hostname">The colliding hostname.</param>
    /// <returns>A hostname-taken result.</returns>
    public static CreateExerciseResult HostnameTaken(string hostname) =>
        new(
            CreateExerciseOutcome.HostnameTaken,
            null,
            $"hostname '{hostname}' is already in use by another exercise; no exercise was created.");
}
