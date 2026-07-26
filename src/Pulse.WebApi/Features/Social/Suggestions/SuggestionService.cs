namespace Pulse.WebApi.Features.Social.Suggestions;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The read seam behind <c>GET /api/personas/suggestions</c> (SOC-053, <c>profiles-social-graph/08</c>) — the
/// exercise-scoped "Who to follow" suggestion order the participant module (<c>whoToFollowService.ts</c> →
/// <c>useWhoToFollow</c> → <c>&lt;WhoToFollow&gt;</c>) renders. Scoped lifetime, matching the
/// <see cref="PulseDbContext"/> unit of work.
/// </summary>
/// <remarks>
/// <para>
/// <b>NO RANKING IS COMPUTED HERE — and none may be added.</b> There is no relevance score, popularity weight,
/// engagement signal, or "recommended for you" heuristic in this file. SOC-053 defines suggested follows as
/// <i>planner-seeded and controller-adjustable</i> (E7 CTL-021), and the docs define no formula — so the order
/// is a stable, content-independent one (<see cref="Data.Entities.Persona.Handle"/> ascending, the per-exercise
/// unique key backed by <c>IX_Personas_ExerciseId_Handle</c>) rather than an invented semantic a later pass
/// would have to strip back out. When CTL-021 lands a persisted planner order, THIS is the one method that
/// changes: the <c>OrderBy</c> becomes the seeded position and everything else stands.
/// </para>
/// <para>
/// <b>Why the order is not by <c>JoinedAt</c> (a trap worth naming).</b> Seeded join instants are
/// ARCHETYPE-derived — <c>PersonaCastSeeder.DeriveJoinedAt</c> backdates a <c>bad-actor</c> persona by only 3-6
/// days and everyone else by 90-730 — so ordering on that column would place the SOC-052 lookalike at a
/// predictable end of every suggestion list. That is a machine-readable positional tell, the same class of leak
/// story 06 closed by dropping <c>personaType</c> from the participant wire (D1-008). Handle order carries no
/// archetype, verification, or credibility signal at all.
/// </para>
/// <para>
/// <b>The impersonator is ELIGIBLE, deliberately (D1-R1 / D1-008 / SOC-052).</b> This query does not filter on
/// <see cref="Data.Entities.Persona.Verified"/>, does not sort by it, and does not filter on
/// <see cref="Data.Entities.Persona.Castable"/> — see <see cref="BuildSuggestionQuery"/> for why the latter is
/// the easier mistake to make. Steering attention onto an unverified lookalike is a legitimate planner /
/// controller lever; the platform never vouches for, nor warns against, anything it suggests.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> Scope comes ONLY from <see cref="IExerciseContext"/>; no route, body, or query
/// parameter can name an exercise. Every read runs through <see cref="PulseDbContext"/>'s central query filter,
/// so a suggestion set can only ever contain personas from the caller's own exercise.
/// </para>
/// </remarks>
public sealed class SuggestionService
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;
    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly FollowService _followService;

    /// <summary>Creates the service over its persistence, scope, session-identity, and follow-graph collaborators.</summary>
    /// <param name="dbContext">The request-scoped persistence context (already bound to the exercise scope).</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (the viewer to exclude).</param>
    /// <param name="followService">
    /// The follow graph (<c>profiles-social-graph/07</c>) whose outbound read supplies the already-followed
    /// exclusion set. Reused rather than re-queried here: story 07 built that read explicitly as "the set
    /// 04-who-to-follow needs to exclude already-followed accounts from its suggestions".
    /// </param>
    public SuggestionService(
        PulseDbContext dbContext,
        IExerciseContext exerciseContext,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        FollowService followService)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(followService);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
        _sessionPersonaAccessor = sessionPersonaAccessor;
        _followService = followService;
    }

    /// <summary>
    /// Resolves the caller's "Who to follow" suggestion order — persona ids only, in a deterministic, stable
    /// order, excluding the caller's own persona and every account it already follows.
    /// </summary>
    /// <param name="limit">
    /// Optional display cap. <c>null</c> means "the whole eligible set"; a value below 1 is a validation
    /// failure, never silently coerced (a client asking for zero rows is asking for something it can do
    /// itself, and coercing it would hide a bug).
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The outcome the endpoint maps to an HTTP status.</returns>
    public async Task<SuggestionResult> GetSuggestionsAsync(int? limit, CancellationToken cancellationToken = default)
    {
        // 1. Scope comes ONLY from IExerciseContext, and an unset/Guid.Empty scope fails closed (COR-001) —
        //    never a default or unscoped set. THIS is the fail-closed boundary; the viewer identity below is
        //    not one, and must not be treated as one.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return SuggestionResult.ScopeUnresolved();
        }

        if (limit is < 1)
        {
            return SuggestionResult.Invalid("limit must be a positive integer when supplied.");
        }

        // 2. The VIEWER is the caller's session-bound persona, never a client-supplied id.
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);

        // 3. Defense in depth (COR-001): a session bound to a DIFFERENT exercise than the one resolved for this
        //    request must never be served this exercise's content. Refuse rather than reconcile. (Distinct from
        //    the unbound case below: this caller HAS an identity, and it belongs somewhere else.)
        if (sessionPersona is not null && sessionPersona.ExerciseId != scope.Value)
        {
            return SuggestionResult.ForeignSessionPersona();
        }

        // 4. AN UNBOUND VIEWER IS SERVED, NOT REFUSED (resolved by the coordinator; see
        //    docs/features/profiles-social-graph/08-suggestions-api.md). A participant whose session carries no
        //    persona binding yet still reaches the participant shell and the mounted module, and refusing here
        //    would hand exactly that population the permanent "Suggestions aren't available right now." panel
        //    this story exists to remove — CR-001 again, merely narrowed. So they get the un-personalized list:
        //    still exercise-scoped from IExerciseContext (the isolation boundary is untouched), simply with the
        //    two viewer-relative exclusions not applying, because there is no viewer to exclude against. The
        //    frontend already encodes this contract (WhoToFollow.noPersona.test.tsx asserts the module renders
        //    rows for such a session), and nothing here is more exposed than GET /api/personas, which already
        //    serves the whole in-scope cast to the same caller.
        var viewerPersonaId = sessionPersona?.PersonaId;
        var alreadyFollowing = viewerPersonaId is { } viewer

            // The exclusion set: the caller's REAL outbound edges, read through story 07's scoped seam. Excluded
            // SERVER-side — the client used to filter these itself, which both shipped rows it would never
            // render and raced its own follow writes (a just-followed account could reappear as a suggestion).
            ? await _followService.GetFollowingAsync(viewer, cancellationToken)
            : [];

        var ids = await BuildSuggestionQuery(viewerPersonaId, alreadyFollowing, limit)
            .ToListAsync(cancellationToken);

        // Guid.ToString() runs HERE, in C#, deliberately: SQL Server renders a uniqueidentifier in UPPERCASE,
        // so translating the conversion into the query would emit ids that no longer string-match the lowercase
        // ids GET /api/personas serves — and useWhoToFollow resolves these against exactly that map, silently
        // dropping every row.
        return SuggestionResult.Ok(ids.ConvertAll(id => id.ToString()));
    }

    /// <summary>
    /// Builds the eligible-persona query: everything in scope except the viewer and the accounts they already
    /// follow, ordered by handle, optionally capped.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b><see cref="Data.Entities.Persona.Castable"/> IS NOT A FILTER HERE — do not add one.</b> That column
    /// gates whether the ENGINE may voice a persona (see <c>PersonaCastSeeder</c>); it says nothing about
    /// whether a HUMAN may follow one. The seeded SOC-052 lookalike (<c>@FairhavenWaterUpd</c>) and the
    /// low-credibility outlet (<c>@TheScoopHQ</c>) both ship <c>Castable = false</c>, so quietly reusing it as
    /// an eligibility filter would remove the impersonator from the suggestion module — deleting the exact
    /// attention-steering placement D1-R1 calls a legitimate controller lever, and the training material
    /// SOC-052 exists for. It reads like a safety flag; it is not one for this purpose.
    /// </para>
    /// <para>
    /// <b><see cref="Data.Entities.Persona.Verified"/> is likewise neither a filter nor a sort key.</b> An
    /// unverified account is not less suggestible; the absent seal is the only signal a participant gets, and
    /// the platform never adds a second one by ordering around it (D1-008).
    /// </para>
    /// </remarks>
    /// <param name="viewerPersonaId">
    /// The caller's own persona — never suggested to itself. <c>null</c> for an UNBOUND viewer, whose list has
    /// no "self" to exclude; the exercise scope still applies either way (it comes from the query filter, not
    /// from this parameter).
    /// </param>
    /// <param name="alreadyFollowing">The caller's existing outbound edges — never re-suggested. Empty for an unbound viewer.</param>
    /// <param name="limit">The optional display cap.</param>
    /// <returns>The composed, still-unexecuted query.</returns>
    private IQueryable<Guid> BuildSuggestionQuery(
        Guid? viewerPersonaId,
        IReadOnlyList<Guid> alreadyFollowing,
        int? limit)
    {
        // Guid.Empty is not a real persona id (the write-guard guarantees no row carries it), so an unbound
        // viewer's predicate below excludes nothing rather than needing a second query shape.
        var viewer = viewerPersonaId ?? Guid.Empty;

        // Materialized as an array so the exclusion translates to a parameterized SQL IN rather than depending
        // on how EF handles an arbitrary IReadOnlyList closure.
        var excluded = alreadyFollowing as Guid[] ?? [.. alreadyFollowing];

        // No explicit ExerciseId predicate: the central global query filter supplies it (COR-001). Adding one
        // here would duplicate the guarantee in a place a future edit could get wrong.
        var query = _dbContext.Personas
            .AsNoTracking()
            .Where(persona => persona.Id != viewer)
            .Where(persona => !excluded.Contains(persona.Id))

            // Deterministic and stable, NOT a ranking — see the type-level remarks. Handle is unique per
            // exercise (IX_Personas_ExerciseId_Handle), so this is a TOTAL order needing no tiebreak: the same
            // exercise returns the same sequence on every read, which is what makes a `limit` meaningful.
            .OrderBy(persona => persona.Handle)
            .Select(persona => persona.Id);

        return limit is { } cap ? query.Take(cap) : query;
    }
}

/// <summary>The outcome kind of a <see cref="SuggestionService"/> read.</summary>
public enum SuggestionOutcome
{
    /// <summary>The suggestion order was resolved (possibly empty — an exercise whose cast the caller already follows).</summary>
    Resolved,

    /// <summary>No exercise scope was resolved for the request — fail closed (the endpoint returns 401).</summary>
    ScopeUnresolved,

    /// <summary>
    /// The caller's session is bound to a DIFFERENT exercise than the one resolved for this request (the
    /// endpoint returns 403). Note what this is NOT: a caller with no persona binding at all is served the
    /// un-personalized in-scope list, not refused — see <see cref="SuggestionService.GetSuggestionsAsync"/>.
    /// </summary>
    ForeignSessionPersona,

    /// <summary>The request failed validation (the endpoint returns 400).</summary>
    Invalid,
}

/// <summary>
/// The result of a suggestion read. <see cref="PersonaIds"/> is ORDER-SIGNIFICANT: it is the contract the
/// frontend relays unmodified (<c>whoToFollowService.ts</c>: "the order this module returns IS the contract").
/// </summary>
public sealed class SuggestionResult
{
    private SuggestionResult(SuggestionOutcome outcome, IReadOnlyList<string> personaIds, string? validationError)
    {
        Outcome = outcome;
        PersonaIds = personaIds;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public SuggestionOutcome Outcome { get; }

    /// <summary>The suggested persona ids, in order. Empty for every non-<see cref="SuggestionOutcome.Resolved"/> outcome.</summary>
    public IReadOnlyList<string> PersonaIds { get; }

    /// <summary>The validation message — non-null only for <see cref="SuggestionOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A resolved suggestion order.</summary>
    /// <param name="personaIds">The suggested persona ids, in order.</param>
    /// <returns>A <see cref="SuggestionOutcome.Resolved"/> result.</returns>
    public static SuggestionResult Ok(IReadOnlyList<string> personaIds)
    {
        ArgumentNullException.ThrowIfNull(personaIds);
        return new SuggestionResult(SuggestionOutcome.Resolved, personaIds, null);
    }

    /// <summary>The fail-closed result for an unresolved exercise scope.</summary>
    /// <returns>A <see cref="SuggestionOutcome.ScopeUnresolved"/> result.</returns>
    public static SuggestionResult ScopeUnresolved() =>
        new(SuggestionOutcome.ScopeUnresolved, Array.Empty<string>(), null);

    /// <summary>The fail-closed result for a caller whose session belongs to another exercise.</summary>
    /// <returns>A <see cref="SuggestionOutcome.ForeignSessionPersona"/> result.</returns>
    public static SuggestionResult ForeignSessionPersona() =>
        new(SuggestionOutcome.ForeignSessionPersona, Array.Empty<string>(), null);

    /// <summary>A rejected request.</summary>
    /// <param name="validationError">The human-readable reason.</param>
    /// <returns>A <see cref="SuggestionOutcome.Invalid"/> result.</returns>
    public static SuggestionResult Invalid(string validationError) =>
        new(SuggestionOutcome.Invalid, Array.Empty<string>(), validationError);
}
