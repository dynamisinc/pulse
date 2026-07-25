namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Diagnostics.CodeAnalysis;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Resolves ONE exercise's <see cref="Persona"/> from an operator-supplied handle (or id) for the ops/bootstrap
/// context (story identity-auth-roles/10). Shared by BOTH persona-binding paths — the <c>bootstrap-exercise</c> participant
/// sub-request and <c>POST /api/ops/bind-participant-persona</c> — so the isolation rule lives in exactly one
/// reviewable place. Scoped lifetime, matching the <see cref="PulseDbContext"/> unit of work its callers write
/// through.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001) — the load-bearing detail.</b> The ops endpoints run with NO ambient
/// exercise scope (the header secret is their only gate; there is no exercise-scope/session middleware in front
/// of them), so the injected <see cref="PulseDbContext"/> is bound to the fail-closed
/// <see cref="System.Guid.Empty"/> filter. Every lookup here therefore uses <c>IgnoreQueryFilters()</c> PLUS an
/// EXPLICIT <see cref="Persona.ExerciseId"/> predicate — the pattern <c>BootstrapService</c> documents and
/// <see cref="PersonaCastSeeder"/> already follows. It deliberately does NOT copy
/// <c>EngineReviewService.ResolvePersonaHandlesAsync</c>, which relies on the central query filter: that is
/// correct inside a session-scoped request but would resolve NOTHING (or, with a differently-populated scope,
/// the WRONG exercise's persona) here. A persona that belongs to another exercise is indistinguishable from one
/// that does not exist (<see cref="PersonaBindingOutcome.NotFound"/>) — a cross-exercise binding is impossible
/// by construction, not by a caller remembering to check.
/// </para>
/// <para>
/// <b>Handle matching.</b> Handles are matched case-insensitively (the model-wide
/// <c>SQL_Latin1_General_CP1_CI_AS</c> collation makes <c>==</c> case-insensitive on the server, the same
/// property <see cref="PersonaCastSeeder"/>'s idempotency read relies on) and a leading <c>@</c> is normalized
/// away, so <c>@mvega_fh</c>, <c>mvega_fh</c> and <c>MVega_FH</c> all resolve to the same seeded persona. Free
/// text runs through the shared <see cref="PostSanitizer"/> funnel (NFR-004) so a lookup value can never carry
/// an executable payload, exactly as the stored handle was sanitized on seed.
/// </para>
/// </remarks>
public sealed class OpsPersonaResolver
{
    /// <summary>
    /// Maximum accepted persona-handle length for a lookup — a bounds/DoS guard on operator input, matching
    /// <see cref="Pulse.WebApi.Features.Identity.Accounts.AccountFieldRules.MaxUsernameLength"/>. It also matches
    /// the <c>nvarchar(256)</c> width <c>backend-host/03</c>'s migration gives the <see cref="Persona.Handle"/>
    /// column (narrowed from <c>nvarchar(max)</c> so it can carry the unique index) — keep the two in lockstep, so
    /// an ops caller can never send a handle that is valid here but too long to have been stored.
    /// </summary>
    public const int MaxHandleLength = 256;

    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the resolver over the persistence context it reads the exercise's cast through.</summary>
    /// <param name="dbContext">The persistence context (shared with the composing caller's unit of work).</param>
    public OpsPersonaResolver(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <summary>
    /// Normalizes an operator-supplied persona handle: trims, strips markup (NFR-004), removes a single leading
    /// <c>@</c>, re-trims, and bounds the length. A <c>null</c>/blank input is NOT an error — it yields
    /// <c>true</c> with a <c>null</c> handle, meaning "no handle supplied" (the caller decides whether that is
    /// acceptable).
    /// </summary>
    /// <param name="raw">The raw handle from the request body.</param>
    /// <param name="handle">The normalized handle, or <c>null</c> when none was supplied.</param>
    /// <param name="error">A human-readable reason when the supplied handle is unusable.</param>
    /// <returns><c>true</c> when absent or valid; <c>false</c> only when present but unusable.</returns>
    public static bool TryNormalizeHandle(string? raw, out string? handle, [NotNullWhen(false)] out string? error)
    {
        handle = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        var sanitized = PostSanitizer.Sanitize(trimmed).Trim();
        if (sanitized.StartsWith('@'))
        {
            sanitized = sanitized[1..].Trim();
        }

        if (sanitized.Length == 0)
        {
            error = "personaHandle is not a usable persona handle.";
            return false;
        }

        if (sanitized.Length > MaxHandleLength)
        {
            error = $"personaHandle must be at most {MaxHandleLength} characters.";
            return false;
        }

        handle = sanitized;
        return true;
    }

    /// <summary>
    /// Parses an optional persona id. A <c>null</c>/blank input is NOT an error — it yields <c>true</c> with a
    /// <c>null</c> id, meaning "no id supplied"; a present but unparseable or empty GUID is rejected (an empty
    /// GUID could never be a real persona id).
    /// </summary>
    /// <param name="raw">The raw id from the request body.</param>
    /// <param name="personaId">The parsed id, or <c>null</c> when none was supplied.</param>
    /// <param name="error">A human-readable reason when the supplied id is unusable.</param>
    /// <returns><c>true</c> when absent or valid; <c>false</c> only when present but unusable.</returns>
    public static bool TryParsePersonaId(string? raw, out Guid? personaId, [NotNullWhen(false)] out string? error)
    {
        personaId = null;
        error = null;

        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return true;
        }

        if (!Guid.TryParse(trimmed, out var parsed) || parsed == Guid.Empty)
        {
            error = "personaId must be a persona GUID.";
            return false;
        }

        personaId = parsed;
        return true;
    }

    /// <summary>
    /// Resolves the persona to bind WITHIN <paramref name="exerciseId"/> only. When both an id and a handle are
    /// supplied the id wins and the handle must agree (a mismatch is a caller error, never a silent ignore).
    /// A persona from another exercise resolves to <see cref="PersonaBindingOutcome.NotFound"/>, identically to
    /// one that does not exist at all (COR-001 — no cross-exercise binding, and no existence hint about another
    /// exercise's cast).
    /// </summary>
    /// <param name="exerciseId">The target exercise (must not be <see cref="Guid.Empty"/>).</param>
    /// <param name="personaId">The optional pre-parsed persona id.</param>
    /// <param name="handle">The optional pre-normalized persona handle.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resolution the caller maps to a binding, a 400, or a fail-closed 404.</returns>
    public async Task<PersonaBindingResolution> ResolveAsync(
        Guid exerciseId,
        Guid? personaId,
        string? handle,
        CancellationToken cancellationToken = default)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("A persona binding is exercise-scoped (COR-001).", nameof(exerciseId));
        }

        if (personaId is null && string.IsNullOrEmpty(handle))
        {
            return PersonaBindingResolution.NotRequested();
        }

        // COR-001: IgnoreQueryFilters() + an EXPLICIT ExerciseId predicate. The ops context has no resolved
        // scope, so the central filter would match zero rows; the explicit predicate is what confines the read
        // to the ONE target exercise. Never remove either half.
        if (personaId is { } id)
        {
            var byId = await _dbContext.Personas
                .IgnoreQueryFilters()
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.ExerciseId == exerciseId && p.Id == id, cancellationToken);

            if (byId is null)
            {
                return PersonaBindingResolution.NotFound();
            }

            if (!string.IsNullOrEmpty(handle) && !string.Equals(byId.Handle, handle, StringComparison.OrdinalIgnoreCase))
            {
                return PersonaBindingResolution.Invalid(
                    "personaId and personaHandle refer to different personas — supply one, or two that agree.");
            }

            return PersonaBindingResolution.Resolved(byId.Id, byId.Handle);
        }

        // Handle path: the CI collation makes this match case-insensitively. Ordered by Id so a duplicate-handle
        // cast resolves DETERMINISTICALLY — a re-bind of the same handle must always pick the same persona, or
        // "idempotent" would not be true.
        //
        // KEPT DELIBERATELY, as a fail-safe rather than a live path. `backend-host/03` adds
        // IX_Personas_ExerciseId_Handle — (ExerciseId, Handle) unique, case-insensitive under the same collation
        // this query relies on — which makes the duplicate UNREACHABLE for this lookup: we query the single
        // normalized spelling, so the index guarantees at most one candidate and the OrderBy becomes a no-op that
        // costs nothing (the index turns this into a one-row seek regardless). Note this resolver does NOT share
        // EngineReviewService.ResolvePersonaHandlesAsync's residual ambiguity: that one fetches both the '@' and
        // no-'@' spellings and folds them client-side, and the index treats those as two distinct legal keys.
        // Here, TryNormalizeHandle strips the '@' from the INPUT and we match the stored handle exactly, so a
        // persona stored WITH a leading '@' is simply not findable by this path — a normalization quirk, not a
        // uniqueness one, and not something the OrderBy affects either way. Retained so that dropping or
        // reverting the index degrades this to "deterministic" rather than to "arbitrary".
        var byHandle = await _dbContext.Personas
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.ExerciseId == exerciseId && p.Handle == handle)
            .OrderBy(p => p.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return byHandle is null
            ? PersonaBindingResolution.NotFound()
            : PersonaBindingResolution.Resolved(byHandle.Id, byHandle.Handle);
    }
}

/// <summary>The outcome kind of an <see cref="OpsPersonaResolver.ResolveAsync"/> call.</summary>
public enum PersonaBindingOutcome
{
    /// <summary>Neither a handle nor an id was supplied — the caller requested no binding at all.</summary>
    NotRequested,

    /// <summary>A persona in the target exercise was resolved.</summary>
    Resolved,

    /// <summary>The supplied identifiers are unusable or contradictory — the caller maps this to a 400.</summary>
    Invalid,

    /// <summary>
    /// No persona in the TARGET exercise matches. Deliberately indistinguishable from "belongs to another
    /// exercise" (COR-001) — the caller fails closed and never binds.
    /// </summary>
    NotFound,
}

/// <summary>
/// The result of resolving a persona binding. <see cref="PersonaBindingOutcome.Resolved"/> carries the persona's
/// id + stored handle; <see cref="PersonaBindingOutcome.Invalid"/> carries a reason; the other outcomes carry
/// neither.
/// </summary>
public sealed class PersonaBindingResolution
{
    private PersonaBindingResolution(PersonaBindingOutcome outcome, Guid? personaId, string? handle, string? error)
    {
        Outcome = outcome;
        PersonaId = personaId;
        Handle = handle;
        Error = error;
    }

    /// <summary>Which outcome occurred.</summary>
    public PersonaBindingOutcome Outcome { get; }

    /// <summary>The resolved persona id — non-null only on <see cref="PersonaBindingOutcome.Resolved"/>.</summary>
    public Guid? PersonaId { get; }

    /// <summary>The resolved persona's STORED handle — non-null only on <see cref="PersonaBindingOutcome.Resolved"/>.</summary>
    public string? Handle { get; }

    /// <summary>The reason — non-null only on <see cref="PersonaBindingOutcome.Invalid"/>.</summary>
    public string? Error { get; }

    /// <summary>No binding was requested.</summary>
    /// <returns>A not-requested resolution.</returns>
    public static PersonaBindingResolution NotRequested() =>
        new(PersonaBindingOutcome.NotRequested, null, null, null);

    /// <summary>A persona in the target exercise was resolved.</summary>
    /// <param name="personaId">The persona id.</param>
    /// <param name="handle">The persona's stored handle.</param>
    /// <returns>A resolved resolution.</returns>
    public static PersonaBindingResolution Resolved(Guid personaId, string handle)
    {
        ArgumentException.ThrowIfNullOrEmpty(handle);
        return new PersonaBindingResolution(PersonaBindingOutcome.Resolved, personaId, handle, null);
    }

    /// <summary>The supplied identifiers are unusable or contradictory.</summary>
    /// <param name="error">The human-readable reason.</param>
    /// <returns>An invalid resolution.</returns>
    public static PersonaBindingResolution Invalid(string error) =>
        new(PersonaBindingOutcome.Invalid, null, null, error);

    /// <summary>No persona in the target exercise matches (fail closed — including a cross-exercise persona).</summary>
    /// <returns>A not-found resolution.</returns>
    public static PersonaBindingResolution NotFound() =>
        new(PersonaBindingOutcome.NotFound, null, null, null);
}
