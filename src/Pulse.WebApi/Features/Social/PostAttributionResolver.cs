namespace Pulse.WebApi.Features.Social;

using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
// Not dead: this resolves the <see cref="ReadOnlySessionWriteFilter"/> reference in the remarks below. Doc
// warnings are off in this project, so removing it would break that cref SILENTLY rather than at build time.
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// Derives the <see cref="PostAttribution"/> for an HTTP <c>POST /api/posts</c> from the caller's PERSISTED
/// session — the server-side close of the other half of <c>ENDPOINT-AUTH-AUDIT.md</c>'s exploit 1
/// (<c>identity-auth-roles/12</c>, #366). Story 11 (#361) stopped an unauthenticated caller reaching this
/// endpoint at all; until this resolver existed, a perfectly legitimate participant session could still name
/// any persona, any <c>PostOrigin</c> union value, and any <c>actingHumanId</c> in its own request body and have
/// all three believed (COR-018).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the resolution lives at the endpoint, not inside <see cref="PostIngestService"/>.</b> The ingest
/// funnel has two callers: this HTTP boundary (untrusted body) and the engine's in-process publish funnel
/// (<c>EnginePublishService.cs:116</c>), which has no HTTP request and therefore no session at all. Requiring a
/// session inside the funnel would break the engine's publish path (and the review-cockpit approve/edit/batch/
/// auto-send paths that route through it). So attribution is resolved HERE, where an untrusted body actually
/// exists, and handed to the funnel as a parameter.
/// </para>
/// <para>
/// <b>Which session facts are read, and from where.</b> Nothing is invented: the staff arm reuses B2's shipped
/// <see cref="ICurrentStaffSessionAccessor"/> and the participant arm reuses
/// <see cref="ICurrentSessionPersonaAccessor"/> (<c>profiles-social-graph</c>, #372) — both endpoint-time
/// re-resolutions of the presented opaque token against <c>PulseDbContext.Sessions</c>. Deliberately NO new
/// session-lookup seam is added: a fourth parallel mechanism is exactly what story 12's Out of Scope warns
/// against, and consolidating the existing three is its own tracked follow-up.
/// </para>
/// <para>
/// <b>Cases this resolver deliberately does NOT handle.</b> An ANONYMOUS caller never reaches it — story 11's
/// default-deny <c>FallbackPolicy</c> answers 401 in <c>AuthorizationMiddleware</c>, strictly ahead of every
/// endpoint. A live READ-ONLY session never reaches it either: <see cref="ReadOnlySessionWriteFilter"/> denies
/// the write with 403 before the handler runs (COR-015). Adding either check here would duplicate a decision
/// that is already made upstream, in a second place that could drift.
/// </para>
/// </remarks>
public sealed class PostAttributionResolver
{
    /// <summary>
    /// The <c>Session.Kind</c> of a trainee posting as their own bound persona — the ONLY non-staff kind this
    /// resolver will attribute a post to. There is deliberately no <c>staff</c> counterpart constant: staff-ness
    /// is established by <see cref="ICurrentStaffSessionAccessor"/> (which already requires
    /// <c>Kind == "staff"</c> AND a bound <c>StaffUser</c>), never by comparing the kind string here. A second
    /// opinion about who counts as staff is exactly the kind of drift that produces an authorization gap.
    /// </summary>
    private const string ParticipantSessionKind = "participant";

    /// <summary>The <c>PostOrigin</c> value for a participant acting as their own account.</summary>
    private const string ParticipantOrigin = "participant";

    /// <summary>The <c>PostOrigin</c> value for a controller operating a persona on the participants' behalf.</summary>
    private const string ControllerAsPersonaOrigin = "controller-as-persona";

    private readonly ICurrentSessionPersonaAccessor _sessionPersonaAccessor;
    private readonly ICurrentStaffSessionAccessor _staffSessionAccessor;
    private readonly IExerciseContext _exerciseContext;
    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the resolver over the two session-identity seams, the request scope, and persistence.</summary>
    /// <param name="sessionPersonaAccessor">Resolves the caller's session-bound persona (the participant arm).</param>
    /// <param name="staffSessionAccessor">Resolves the caller's live staff session (the console arm).</param>
    /// <param name="exerciseContext">The server-authoritative exercise scope (COR-001) — the sole scoping source.</param>
    /// <param name="dbContext">The request-scoped persistence context the persona existence check runs through.</param>
    public PostAttributionResolver(
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        ICurrentStaffSessionAccessor staffSessionAccessor,
        IExerciseContext exerciseContext,
        PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(staffSessionAccessor);
        ArgumentNullException.ThrowIfNull(exerciseContext);
        ArgumentNullException.ThrowIfNull(dbContext);

        _sessionPersonaAccessor = sessionPersonaAccessor;
        _staffSessionAccessor = staffSessionAccessor;
        _exerciseContext = exerciseContext;
        _dbContext = dbContext;
    }

    /// <summary>
    /// Resolves who is really posting, or rejects the request. The only thing
    /// <paramref name="request"/> contributes is the staff console's persona CHOICE and the <c>origin</c> the
    /// caller CLAIMS — the latter purely so a claim that contradicts the caller's real identity can be refused
    /// rather than silently rewritten.
    /// </summary>
    /// <param name="request">The untrusted create-post body.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A resolved attribution, or a rejection carrying the status the endpoint returns.</returns>
    public async Task<PostAttributionResolution> ResolveAsync(
        CreatePostRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Scope comes ONLY from IExerciseContext (COR-001), and it is needed BEFORE any identity decision
        // because the staff arm's persona check is scoped by it. Guid.Empty is the fail-closed sentinel, which
        // no persisted row can carry — treated identically to unset. 401 matches the ingest funnel's own
        // fail-closed door, so the endpoint's status contract for an unresolved scope is unchanged.
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status401Unauthorized, "No exercise scope is resolved for this request.");
        }

        var exerciseId = scope.Value;

        // A. STAFF console. Checked first, and deliberately so: E7 persona-operation binds a persona to a staff
        //    session too, so a staff caller would otherwise fall into the participant arm below and be
        //    mis-attributed as a participant acting for themselves.
        var staffSession = await _staffSessionAccessor.GetCurrentStaffSessionAsync(cancellationToken);
        if (staffSession is not null)
        {
            return await ResolveForStaffAsync(request, staffSession, exerciseId, cancellationToken);
        }

        // B. A live PARTICIPANT session carrying a persona binding — the participant composer.
        //
        // Matched by a POSITIVE allowlist on the kind, not by "not staff". `Session.Kind` is a free string with
        // no database check constraint, so classifying by negation would silently attribute ANY future kind that
        // carries a persona binding — an observer/evaluator/exercise-control session, or the org-account path
        // deferred to story 09 — as a trainee's own write. That is exactly the harm the staff arm above refuses
        // `participant` to prevent: an operator's write must never be indistinguishable from a trainee's in the
        // evaluation record (COR-018). An unrecognised kind therefore falls through to C's 403 and fails closed.
        var sessionPersona = await _sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (sessionPersona is not null && IsParticipantKind(sessionPersona.Kind))
        {
            return ResolveForParticipant(request, sessionPersona, exerciseId);
        }

        // C. Authenticated (story 11's gate let the request through) but with no persona to post AS, and not
        //    staff either. Same shape and reasoning as FollowService's NoSessionPersona → 403: the caller is
        //    known, there is simply nobody to write as, so fail closed rather than guess an identity.
        return PostAttributionResolution.Rejected(
            StatusCodes.Status403Forbidden, "This session has no persona to post as.");
    }

    /// <summary>
    /// The staff arm: prove the caller's STAFF-ness, take the persona CHOICE from the body (validated to exist
    /// in the resolved exercise), and stamp <c>actingHumanId</c> from the staff session — never the body.
    /// </summary>
    /// <param name="request">The untrusted create-post body.</param>
    /// <param name="staffSession">The resolved live staff session.</param>
    /// <param name="exerciseId">The request's resolved exercise scope.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resolved attribution or a rejection.</returns>
    private async Task<PostAttributionResolution> ResolveForStaffAsync(
        CreatePostRequest request,
        CurrentStaffSession staffSession,
        Guid exerciseId,
        CancellationToken cancellationToken)
    {
        // 'controller-as-persona' is the ONLY origin an HTTP caller of any kind can reach.
        //
        // This is a deliberate TIGHTENING, not an oversight: 'engine' and 'inject' are in-process-only
        // provenances. The engine reaches PostIngestService directly through EnginePublishService (no HTTP
        // request exists), and MSEL inject-fire is Phase 4 and will do the same. Neither has an HTTP caller to
        // authenticate, so accepting either value over HTTP could only ever mean someone is claiming a
        // provenance they cannot possess — which is precisely how the audit's exploit dressed an injected post
        // up as engine-generated content. 'participant' is refused for the mirror-image reason: a staff console
        // is not a participant, and letting it self-report as one would make an operator's write indistinguish-
        // able from a trainee's in the evaluation record (COR-018).
        if (!string.Equals(request.Origin, ControllerAsPersonaOrigin, StringComparison.Ordinal))
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status400BadRequest,
                "A staff session may only post with origin 'controller-as-persona'. 'engine' and 'inject' are "
                + "in-process provenances that no HTTP caller can claim, and 'participant' is not a staff origin.");
        }

        // The persona CHOICE stays body-supplied — the console picks which persona to operate, and what has to
        // be proven is the caller's staff-ness, not the choice.
        if (!Guid.TryParse(request.AuthorPersonaId, out var authorPersonaId) || authorPersonaId == Guid.Empty)
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status400BadRequest, "authorPersonaId must be a non-empty GUID.");
        }

        // Defense in depth (COR-001). The central query filter alone would already confine this read to the
        // resolved scope; the explicit ExerciseId predicate is stated anyway so the isolation is visible at the
        // call site and survives any future IgnoreQueryFilters refactor. A persona from ANOTHER exercise is
        // therefore indistinguishable from one that does not exist — the non-disclosing direction.
        var personaInScope = await _dbContext.Personas
            .AsNoTracking()
            .AnyAsync(persona => persona.Id == authorPersonaId && persona.ExerciseId == exerciseId, cancellationToken);

        if (!personaInScope)
        {
            // 400, not 404: on THIS endpoint a 404 would read as "the route does not exist", and every other
            // body-field failure here is a 400. The message is identical for an unknown persona and for another
            // exercise's persona, so it never confirms that a cross-exercise id is real.
            return PostAttributionResolution.Rejected(
                StatusCodes.Status400BadRequest, "authorPersonaId does not name a persona in this exercise.");
        }

        return PostAttributionResolution.Resolved(new PostAttribution
        {
            AuthorPersonaId = authorPersonaId,
            Origin = ControllerAsPersonaOrigin,

            // COR-018: the operating human is the STAFF USER behind the session, never the body's
            // actingHumanId. A body value that disagrees is ignored SILENTLY rather than rejected — the console
            // sends whatever identity string it happens to hold, and refusing the write over a field the
            // server does not trust anyway would break a legitimate operator for no security gain.
            ActingHumanId = staffSession.StaffUserId.ToString(),
        });
    }

    /// <summary>
    /// The participant arm: persona, origin and acting human all come from the persisted session. The body
    /// contributes nothing but a claim that can be refused.
    /// </summary>
    /// <param name="request">The untrusted create-post body.</param>
    /// <param name="sessionPersona">The caller's session-bound persona.</param>
    /// <param name="exerciseId">The request's resolved exercise scope.</param>
    /// <returns>The resolved attribution or a rejection.</returns>
    private static PostAttributionResolution ResolveForParticipant(
        CreatePostRequest request,
        CurrentSessionPersona sessionPersona,
        Guid exerciseId)
    {
        // A participant's origin is 'participant', full stop. A body that claims a PRIVILEGED origin is refused
        // rather than quietly rewritten: naming 'controller-as-persona' / 'engine' / 'inject' is an attempt to
        // reach a provenance this caller can never hold (the AC's "unreachable from a non-staff session"), and
        // silently downgrading it would let the attempt succeed as an ordinary post and leave no trace that it
        // was made. An ABSENT origin is fine — a client that simply does not send the field is not claiming
        // anything.
        if (request.Origin is not null && !string.Equals(request.Origin, ParticipantOrigin, StringComparison.Ordinal))
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status403Forbidden,
                "A non-staff session may only post with origin 'participant'.");
        }

        // Defense in depth (COR-001): SessionAuthenticationMiddleware already binds a participant session's
        // exercise to the host-resolved one and fails closed on a mismatch, so a disagreement here should be
        // impossible — and if it ever happens it must NOT be resolved in favour of writing a row.
        if (sessionPersona.ExerciseId != exerciseId)
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status403Forbidden,
                "The session's bound exercise disagrees with the request's resolved scope.");
        }

        // COR-018: a blank attribution is not an acceptable outcome. The pre-story behaviour —
        // `request.ActingHumanId ?? string.Empty` — is exactly the bug this refuses: an empty string satisfies
        // no evaluator and is off the locked v0 telemetry envelope, so a session that cannot say WHO is behind
        // it may not write at all.
        if (string.IsNullOrEmpty(sessionPersona.ActingHumanId))
        {
            return PostAttributionResolution.Rejected(
                StatusCodes.Status403Forbidden,
                "This session carries no acting-human attribution (COR-018).");
        }

        return PostAttributionResolution.Resolved(new PostAttribution
        {
            // The body's authorPersonaId is IGNORED, not rejected: a stale client that still sends the persona
            // it thinks it is (or a mid-exercise persona rebinding) is a client bug, not an attack, and the
            // session's own binding is the only answer that can be right.
            AuthorPersonaId = sessionPersona.PersonaId,
            Origin = ParticipantOrigin,
            ActingHumanId = sessionPersona.ActingHumanId,
        });
    }

    /// <summary>
    /// Whether a persisted <c>Session.Kind</c> is the PARTICIPANT kind — the only non-staff kind allowed to post
    /// as its own bound persona. Deliberately an equality test rather than "not staff": see the call site.
    /// </summary>
    /// <param name="sessionKind">The verbatim session kind.</param>
    /// <returns><c>true</c> only for a <c>participant</c>-kind session.</returns>
    private static bool IsParticipantKind(string sessionKind) =>
        string.Equals(sessionKind, ParticipantSessionKind, StringComparison.Ordinal);
}

/// <summary>
/// The outcome of a <see cref="PostAttributionResolver.ResolveAsync"/> call: either a server-derived
/// <see cref="PostAttribution"/>, or a rejection carrying the HTTP status the endpoint returns. Exactly one of
/// the two applies — there is no "resolved but unknown" state, because a write with an unknown author is the
/// thing this type exists to prevent.
/// </summary>
public sealed class PostAttributionResolution
{
    private PostAttributionResolution(PostAttribution? attribution, int rejectionStatusCode, string? rejectionReason)
    {
        Attribution = attribution;
        RejectionStatusCode = rejectionStatusCode;
        RejectionReason = rejectionReason;
    }

    /// <summary>The server-derived attribution — non-null only when <see cref="IsResolved"/>.</summary>
    public PostAttribution? Attribution { get; }

    /// <summary>The HTTP status for a rejection (400 / 401 / 403); <c>0</c> when resolved.</summary>
    public int RejectionStatusCode { get; }

    /// <summary>The human-readable rejection reason; <c>null</c> when resolved.</summary>
    public string? RejectionReason { get; }

    /// <summary>Whether the caller's identity was established.</summary>
    public bool IsResolved => Attribution is not null;

    /// <summary>A resolved attribution.</summary>
    /// <param name="attribution">The server-derived attribution.</param>
    /// <returns>The resolved outcome.</returns>
    public static PostAttributionResolution Resolved(PostAttribution attribution)
    {
        ArgumentNullException.ThrowIfNull(attribution);
        return new PostAttributionResolution(attribution, 0, null);
    }

    /// <summary>A rejection — nothing is written and no telemetry is emitted.</summary>
    /// <param name="statusCode">The HTTP status the endpoint returns.</param>
    /// <param name="reason">The human-readable reason.</param>
    /// <returns>The rejected outcome.</returns>
    public static PostAttributionResolution Rejected(int statusCode, string reason)
    {
        ArgumentException.ThrowIfNullOrEmpty(reason);
        return new PostAttributionResolution(null, statusCode, reason);
    }
}
