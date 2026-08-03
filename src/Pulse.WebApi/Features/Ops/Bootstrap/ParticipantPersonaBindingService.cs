namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Accounts;

/// <summary>
/// The guarded ops service behind <c>POST /api/ops/bind-participant-persona</c> (story identity-auth-roles/10): binds — or
/// rebinds — one of an exercise's <see cref="Persona"/> rows onto an ALREADY-PROVISIONED participant
/// <see cref="Account"/>, by login handle. This is the half of the story that unblocks a live environment, where
/// the participant account already exists and its <see cref="Account.PersonaId"/> is null, so
/// <c>ParticipantLoginService</c> issues a session with no <c>personaId</c> and the participant composer stays
/// hidden. It replaces the manual <c>UPDATE Accounts SET PersonaId = …</c> that was previously the only fix.
/// Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work it writes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Secret-gated + fail closed (NFR-009).</b> Gated by <see cref="BootstrapSecretGate"/> on the REUSED
/// <c>Authentication:Bootstrap:Secret</c> (<see cref="BootstrapOptions"/>, presented via the same
/// <c>X-Bootstrap-Secret</c> header as its sibling ops endpoints — no new secret, no infra change). An
/// unconfigured (empty) secret disables the endpoint entirely and a mismatch is rejected — both surface as a 404
/// (the endpoint does not confirm its own existence to an unauthorized caller). The comparison is constant-time
/// and the secret is never logged. No session / exercise-scope middleware fronts this endpoint — the header
/// secret is the only gate by design (mirroring <c>BootstrapService</c> / <c>EngineContentSeedService</c>).
/// </para>
/// <para>
/// <b>Isolation (always-Critical, COR-001) — the load-bearing detail.</b> This endpoint has no resolved request
/// scope, so the injected <see cref="PulseDbContext"/> is bound to the fail-closed <see cref="Guid.Empty"/>
/// filter. The target exercise is resolved from the request HOSTNAME (never a client-supplied exercise id), and
/// BOTH scoped lookups — the <see cref="Account"/> and (via <see cref="OpsPersonaResolver"/>) the
/// <see cref="Persona"/> — use <c>IgnoreQueryFilters()</c> PLUS an explicit <c>ExerciseId</c> predicate, the
/// pattern <c>BootstrapService</c> documents. A persona belonging to another exercise is therefore
/// indistinguishable from one that does not exist and can NEVER be bound, so a participant can never post as
/// another exercise's persona.
/// </para>
/// <para>
/// <b>Idempotent + audited.</b> Rebinding to the persona the account already carries is a no-op success
/// (<c>changed: false</c>). Every authorized, resolvable call emits exactly ONE XC-004
/// <c>account.persona_bound</c> event in the same unit of work as the mutation — including the no-op, because the
/// operator action itself is the auditable event. One server wall-clock read stamps the event (never client
/// input); scenario time is the exercise's stored instant, falling back to the wall clock when unset.
/// </para>
/// </remarks>
public sealed class ParticipantPersonaBindingService
{
    /// <summary>The XC-004 audit event type emitted on a successful bind (additive open vocab).</summary>
    private const string PersonaBoundEventType = "account.persona_bound";

    private const string SchemaVersion = "v0";
    private const string SystemActorKind = "system";
    private const string SystemChannel = "system";
    private const string BindActorId = "bind-participant-persona";
    private const string AccountEntityType = "account";
    private const string FallbackTimeZone = "UTC";

    private readonly PulseDbContext _dbContext;
    private readonly BootstrapOptions _options;
    private readonly OpsPersonaResolver _personaResolver;

    /// <summary>Creates the binding service over its collaborators.</summary>
    /// <param name="dbContext">The persistence context the binding + its single audit event commit through (one unit of work).</param>
    /// <param name="options">The bound options carrying the REUSED bootstrap secret (the fail-closed gate).</param>
    /// <param name="personaResolver">The shared, exercise-confined persona resolver (COR-001).</param>
    public ParticipantPersonaBindingService(
        PulseDbContext dbContext,
        IOptions<BootstrapOptions> options,
        OpsPersonaResolver personaResolver)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(personaResolver);

        _dbContext = dbContext;
        _options = options.Value ?? new BootstrapOptions();
        _personaResolver = personaResolver;
    }

    /// <summary>
    /// Binds (or rebinds) a persona to the named participant account in the exercise resolved by the request's
    /// hostname. Fails closed: an unauthorized secret → <see cref="ParticipantPersonaBindingOutcome.Rejected"/>
    /// (404); an invalid body → <see cref="ParticipantPersonaBindingOutcome.Invalid"/> (400); an unknown hostname,
    /// username, or persona → the matching not-found outcome (404), writing nothing. On success, emits exactly one
    /// XC-004 <c>account.persona_bound</c> event in the same unit of work as the binding.
    /// </summary>
    /// <param name="request">The bind request (may be <c>null</c> — a missing body is a 400).</param>
    /// <param name="presentedSecret">The secret from the <c>X-Bootstrap-Secret</c> header (never logged).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A result the endpoint maps to a status.</returns>
    /// <remarks>
    /// Named <c>BindPersonaAsync</c>, NOT <c>BindAsync</c>, deliberately: minimal APIs' parameter binding treats a
    /// <c>BindAsync</c> member on an injected parameter's type as the custom-binding convention and throws while
    /// building the endpoint data source ("BindAsync method found … with incorrect format"), which would take the
    /// WHOLE route table down, not just this endpoint.
    /// </remarks>
    public async Task<ParticipantPersonaBindingResult> BindPersonaAsync(
        BindParticipantPersonaRequest? request,
        string? presentedSecret,
        CancellationToken cancellationToken = default)
    {
        // 1. The gate runs FIRST, before any body inspection: an unauthorized caller learns nothing (404).
        if (!BootstrapSecretGate.IsAuthorized(_options.Secret, presentedSecret))
        {
            return ParticipantPersonaBindingResult.Rejected();
        }

        if (request is null)
        {
            return ParticipantPersonaBindingResult.Invalid("A JSON bind body is required.");
        }

        // 2. Validate the host via the SAME normalizer the resolution path uses (COR-008 / NFR-004).
        if (!ExerciseHostName.TryNormalize(request.Hostname, out var host))
        {
            return ParticipantPersonaBindingResult.Invalid("hostname is required and must be a valid DNS hostname.");
        }

        // 3. Normalize the account handle through the SAME rules it was provisioned with, so the stored value
        //    round-trips (sanitize-then-trim, bounded).
        if (!AccountFieldRules.TryNormalizeUsername(request.Username, out var username, out var usernameError))
        {
            return ParticipantPersonaBindingResult.Invalid(usernameError);
        }

        // 4. Syntactic validation of the persona identifiers. At least one is required — this endpoint exists to
        //    bind, so a body with neither is a caller error, not a silent no-op.
        if (!OpsPersonaResolver.TryNormalizeHandle(request.PersonaHandle, out var personaHandle, out var handleError))
        {
            return ParticipantPersonaBindingResult.Invalid(handleError);
        }

        if (!OpsPersonaResolver.TryParsePersonaId(request.PersonaId, out var personaId, out var personaIdError))
        {
            return ParticipantPersonaBindingResult.Invalid(personaIdError);
        }

        if (personaId is null && string.IsNullOrEmpty(personaHandle))
        {
            return ParticipantPersonaBindingResult.Invalid("personaHandle (or personaId) is required.");
        }

        // 5. RESOLVE (never create) the exercise for this host. Exercise is unscoped → this by-host read is
        //    unfiltered; it is never written.
        // org-scope-exempt(ResolutionRoot): the by-HOSTNAME read that resolves which exercise this binding is
        // for; the tenant is derived FROM the result, so it cannot be a precondition of the query.
        var exercise = await _dbContext.Exercises
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Hostname == host, cancellationToken);
        if (exercise is null)
        {
            return ParticipantPersonaBindingResult.HostNotFound();
        }

        var exerciseId = exercise.Id;

        // 6. Resolve the account WITHIN that exercise. Account is IExerciseScoped and the captured scope is empty
        //    here, so bypass the fail-closed filter and confine the read with an EXPLICIT ExerciseId predicate
        //    (COR-001). Tracked — this is the row being mutated.
        var account = await _dbContext.Accounts
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.ExerciseId == exerciseId && a.Username == username, cancellationToken);
        if (account is null)
        {
            return ParticipantPersonaBindingResult.AccountNotFound();
        }

        // 7. Resolve the persona WITHIN the same exercise (COR-001). A cross-exercise handle/id is NotFound —
        //    identical to a nonexistent one, so nothing about another exercise's cast is revealed and no
        //    cross-exercise binding is possible.
        var resolution = await _personaResolver.ResolveAsync(exerciseId, personaId, personaHandle, cancellationToken);
        switch (resolution.Outcome)
        {
            case PersonaBindingOutcome.Invalid:
                return ParticipantPersonaBindingResult.Invalid(resolution.Error!);
            case PersonaBindingOutcome.NotFound:
            case PersonaBindingOutcome.NotRequested:
                // NotRequested is unreachable (step 4 required an identifier); treat it as fail-closed anyway.
                return ParticipantPersonaBindingResult.PersonaNotFound();
            default:
                break;
        }

        var resolvedPersonaId = resolution.PersonaId!.Value;
        var previousPersonaId = account.PersonaId;
        var changed = previousPersonaId != resolvedPersonaId;

        // 8. Bind (assignment is idempotent — an unchanged value leaves the row unmodified) and emit exactly one
        //    XC-004 event in the SAME unit of work. One server wall-clock read stamps the event.
        var now = DateTimeOffset.UtcNow;
        account.PersonaId = resolvedPersonaId;

        _dbContext.TelemetryEvents.Add(BuildBoundTelemetry(
            exercise, account, resolvedPersonaId, resolution.Handle!, previousPersonaId, changed, now));

        // One SaveChanges — the write-guard runs here; every scoped row carries the non-empty exercise id.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ParticipantPersonaBindingResult.Bound(
            exerciseId, host, account.Id, account.Username, resolvedPersonaId, resolution.Handle!,
            previousPersonaId, changed);
    }

    /// <summary>
    /// Builds the single XC-004 <c>account.persona_bound</c> event: <c>actor.kind: 'system'</c> with the fixed
    /// <c>bind-participant-persona</c> acting-human id, <c>channel: 'system'</c>, target = the bound account. The
    /// opaque payload records the new/previous persona + whether the binding actually changed (audit trail, never
    /// parsed server-side).
    /// </summary>
    private static TelemetryEvent BuildBoundTelemetry(
        Exercise exercise,
        Account account,
        Guid personaId,
        string personaHandle,
        Guid? previousPersonaId,
        bool changed,
        DateTimeOffset now)
    {
        var payload = string.Create(
            CultureInfo.InvariantCulture,
            $"{{\"personaId\":\"{personaId}\"," +
            $"\"personaHandle\":{JsonString(personaHandle)}," +
            $"\"previousPersonaId\":{(previousPersonaId is { } previous ? $"\"{previous}\"" : "null")}," +
            $"\"changed\":{(changed ? "true" : "false")}}}");

        return new TelemetryEvent
        {
            EventId = Guid.NewGuid().ToString(),
            SchemaVersion = SchemaVersion,
            ExerciseId = exercise.Id,
            EventType = PersonaBoundEventType,
            Channel = SystemChannel,
            Actor = new TelemetryActor
            {
                Kind = SystemActorKind,
                ActingHumanId = BindActorId,
            },
            WallClockTime = now,
            ScenarioTime = exercise.CurrentScenarioTime ?? now,
            TimeZone = string.IsNullOrWhiteSpace(exercise.TimeZone) ? FallbackTimeZone : exercise.TimeZone,
            Target = new TelemetryTarget { EntityType = AccountEntityType, EntityId = account.Id.ToString() },
            Payload = payload,
            EmittedAt = now,
        };
    }

    /// <summary>
    /// Renders a value as a JSON string literal for the opaque telemetry payload. The handle is already
    /// markup-stripped on ingest, but it is operator input, so quotes/backslashes/control characters are escaped
    /// here rather than trusted — a payload must always be well-formed JSON.
    /// </summary>
    private static string JsonString(string value) => JsonSerializer.Serialize(value);
}

/// <summary>The outcome kind of a <see cref="ParticipantPersonaBindingService.BindPersonaAsync"/> call.</summary>
public enum ParticipantPersonaBindingOutcome
{
    /// <summary>The persona is bound to the account (possibly an idempotent no-op) — the endpoint returns 200.</summary>
    Bound,

    /// <summary>The request failed validation — the endpoint returns 400.</summary>
    Invalid,

    /// <summary>The secret was unconfigured or wrong — the endpoint returns 404 (fail closed, no existence hint).</summary>
    Rejected,

    /// <summary>No exercise resolves to the requested hostname — the endpoint returns 404 (never creating one).</summary>
    HostNotFound,

    /// <summary>No account with that handle exists in the resolved exercise — 404 (never creating one).</summary>
    AccountNotFound,

    /// <summary>
    /// No persona with that handle/id exists in the resolved exercise — 404, fail closed. Deliberately
    /// indistinguishable from a persona that belongs to ANOTHER exercise (COR-001).
    /// </summary>
    PersonaNotFound,
}

/// <summary>
/// The result of a persona-binding attempt. <see cref="ParticipantPersonaBindingOutcome.Bound"/> carries the
/// resolved exercise/account/persona identity plus the previous binding and whether it changed;
/// <see cref="ParticipantPersonaBindingOutcome.Invalid"/> carries a reason; the fail-closed outcomes carry neither
/// (an unauthorized caller, or one naming an unknown host/account/persona, learns nothing beyond the 404).
/// </summary>
public sealed class ParticipantPersonaBindingResult
{
    private ParticipantPersonaBindingResult(
        ParticipantPersonaBindingOutcome outcome,
        string? error,
        Guid? exerciseId,
        string? hostname,
        Guid? accountId,
        string? username,
        Guid? personaId,
        string? personaHandle,
        Guid? previousPersonaId,
        bool changed)
    {
        Outcome = outcome;
        Error = error;
        ExerciseId = exerciseId;
        Hostname = hostname;
        AccountId = accountId;
        Username = username;
        PersonaId = personaId;
        PersonaHandle = personaHandle;
        PreviousPersonaId = previousPersonaId;
        Changed = changed;
    }

    /// <summary>Which outcome occurred.</summary>
    public ParticipantPersonaBindingOutcome Outcome { get; }

    /// <summary>The validation message — non-null only when <see cref="Outcome"/> is <see cref="ParticipantPersonaBindingOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>The resolved exercise id — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public Guid? ExerciseId { get; }

    /// <summary>The host the exercise is bound to — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public string? Hostname { get; }

    /// <summary>The bound account's id — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public Guid? AccountId { get; }

    /// <summary>The bound account's stored handle — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public string? Username { get; }

    /// <summary>The newly-bound persona id — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public Guid? PersonaId { get; }

    /// <summary>The bound persona's stored handle — non-null only on <see cref="ParticipantPersonaBindingOutcome.Bound"/>.</summary>
    public string? PersonaHandle { get; }

    /// <summary>The binding this call replaced, or <c>null</c> when the account had none.</summary>
    public Guid? PreviousPersonaId { get; }

    /// <summary><c>true</c> when the binding actually changed; <c>false</c> on the idempotent no-op.</summary>
    public bool Changed { get; }

    /// <summary>A successful bind (or idempotent no-op).</summary>
    /// <param name="exerciseId">The resolved exercise id.</param>
    /// <param name="hostname">The bound host.</param>
    /// <param name="accountId">The bound account id.</param>
    /// <param name="username">The bound account's stored handle.</param>
    /// <param name="personaId">The newly-bound persona id.</param>
    /// <param name="personaHandle">The bound persona's stored handle.</param>
    /// <param name="previousPersonaId">The replaced binding, or <c>null</c>.</param>
    /// <param name="changed">Whether the binding actually changed.</param>
    /// <returns>A bound result.</returns>
    public static ParticipantPersonaBindingResult Bound(
        Guid exerciseId,
        string hostname,
        Guid accountId,
        string username,
        Guid personaId,
        string personaHandle,
        Guid? previousPersonaId,
        bool changed)
    {
        ArgumentException.ThrowIfNullOrEmpty(hostname);
        ArgumentException.ThrowIfNullOrEmpty(username);
        ArgumentException.ThrowIfNullOrEmpty(personaHandle);

        return new ParticipantPersonaBindingResult(
            ParticipantPersonaBindingOutcome.Bound, null, exerciseId, hostname, accountId, username,
            personaId, personaHandle, previousPersonaId, changed);
    }

    /// <summary>A validation failure.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid result.</returns>
    public static ParticipantPersonaBindingResult Invalid(string error) =>
        new(ParticipantPersonaBindingOutcome.Invalid, error, null, null, null, null, null, null, null, false);

    /// <summary>The fail-closed result for an unconfigured/wrong secret.</summary>
    /// <returns>A rejected result.</returns>
    public static ParticipantPersonaBindingResult Rejected() =>
        new(ParticipantPersonaBindingOutcome.Rejected, null, null, null, null, null, null, null, null, false);

    /// <summary>The result for a hostname that resolves to no exercise (never creating one).</summary>
    /// <returns>A host-not-found result.</returns>
    public static ParticipantPersonaBindingResult HostNotFound() =>
        new(ParticipantPersonaBindingOutcome.HostNotFound, null, null, null, null, null, null, null, null, false);

    /// <summary>The result for a handle that matches no account in the resolved exercise.</summary>
    /// <returns>An account-not-found result.</returns>
    public static ParticipantPersonaBindingResult AccountNotFound() =>
        new(ParticipantPersonaBindingOutcome.AccountNotFound, null, null, null, null, null, null, null, null, false);

    /// <summary>The fail-closed result for a persona that does not exist in the resolved exercise (incl. cross-exercise).</summary>
    /// <returns>A persona-not-found result.</returns>
    public static ParticipantPersonaBindingResult PersonaNotFound() =>
        new(ParticipantPersonaBindingOutcome.PersonaNotFound, null, null, null, null, null, null, null, null, false);
}
