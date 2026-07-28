namespace Pulse.WebApi.Telemetry;

using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Makes the two facts a <c>POST /api/telemetry</c> envelope must never be believed about — WHICH EXERCISE the
/// event belongs to (COR-001) and WHO produced it (COR-018) — server-authoritative, by stamping them from the
/// caller's own authenticated session and refusing a body that claims otherwise
/// (<c>identity-auth-roles/13</c>, #362).
/// </summary>
/// <remarks>
/// <para>
/// <b>The gap this closes.</b> <c>ENDPOINT-AUTH-AUDIT.md</c> finding 2: two anonymous <c>POST /api/telemetry</c>
/// calls both returned <c>202</c> — one naming the real exercise, one naming
/// <c>deadbeef-0000-4000-8000-000000000001</c>, an exercise that does not exist, with a forged
/// <c>actor.kind: 'participant'</c> and a forged <c>actingHumanId</c>. Story 11 (#361) stopped the ANONYMOUS
/// half by gating the route; this is the BODY-TRUST half, which a perfectly legitimate session could still
/// exploit. XC-004 is not incidental telemetry — it is the evaluation record AAR and evaluator scoring read
/// directly, and the durable attribution story 10 leans on precisely because table columns are mutable.
/// </para>
/// <para>
/// <b>Reject, never silently overwrite — for SCOPE.</b> A body <c>exerciseId</c> that disagrees with the
/// caller's own session is rejected with 400 rather than quietly replaced. A caller whose body disagrees with
/// its own session is either a bug worth surfacing or an attempted forgery, and silently correcting it tells
/// neither apart (mirroring how <c>BootstrapService</c> refuses a client-supplied scope rather than fixing it).
/// </para>
/// <para>
/// <b>Overwrite silently — for the ACTOR's identity fields.</b> The opposite choice, and deliberately, for the
/// same reason <c>PostAttributionResolver</c> made it on the staff arm: <c>actor.sessionId</c> /
/// <c>actor.actingHumanId</c> / <c>actor.participantId</c> are fields the server does not trust the body for AT
/// ALL, so refusing a write over a disagreement would break a legitimate console (which sends whatever identity
/// string it happens to hold) for no security gain. What IS refused is a claim about WHO THE CALLER IS —
/// <c>actor.kind: 'participant'</c> from a session that is not a participant, and an <c>actor.personaId</c> that
/// is not the non-staff caller's own binding — because those cannot be corrected without inventing an identity.
/// </para>
/// <para>
/// <b>What the server does NOT derive.</b> <c>actor.kind</c> itself stays caller-stated beyond the participant
/// check: the v0 actor kinds are FICTION-level descriptors, not session kinds, and real emitters legitimately
/// cross them — a participant session emits <c>kind: 'persona'</c> for a reaction
/// (<c>useReaction.ts</c>), and a staff console emits <c>kind: 'engine'</c> / <c>'system'</c>
/// (<c>useEngineControl.ts</c>, <c>usePauseState.ts</c>). Deriving the kind from the session kind would refuse
/// every one of those. <c>actor.role</c> is likewise left body-supplied — it is a display/filter string, not an
/// authorization or attribution input, and no acceptance criterion covers it.
/// </para>
/// <para>
/// <b>Why a static over a claims-read, not a DI service over a token lookup.</b> Every fact here is already on
/// <c>HttpContext.User</c>, written once per request by <see cref="SessionAuthenticationMiddleware"/> from the
/// session row <see cref="ISessionAuthenticator"/> loaded. Telemetry is a burst-rate path (SOC-071:
/// 120 posts/min, each capable of emitting events), so re-resolving the token per event through one of the
/// endpoint-time accessors would multiply database load on the highest-volume endpoint in the app for facts
/// already in hand. This adds no fourth session-lookup seam — the existing three are untouched.
/// </para>
/// </remarks>
public static class TelemetryEnvelopeAuthority
{
    /// <summary>
    /// The <c>Session.Kind</c> of a trainee acting as themselves — the only kind that may present an
    /// <c>actor.kind: 'participant'</c> event, and the only kind whose <c>actor.participantId</c> is populated.
    /// </summary>
    private const string ParticipantSessionKind = "participant";

    /// <summary>
    /// The <c>Session.Kind</c> of a staff console. Staff is the one kind allowed to name a persona OTHER than
    /// its own session binding (E7 persona-operation lets a controller act AS a cast persona), so the
    /// persona-ownership check below does not apply to it.
    /// </summary>
    private const string StaffSessionKind = "staff";

    /// <summary>The v0 <c>actor.kind</c> asserting "a trainee, acting as themselves".</summary>
    private const string ParticipantActorKind = "participant";

    /// <summary>
    /// Stamps <paramref name="request"/>'s scope and actor identity from <paramref name="identity"/>, or rejects
    /// the ingest. MUTATES the request's <c>actor</c> block in place so that what is subsequently validated (and
    /// therefore what is persisted) is the sanitized envelope, not the caller's — a field the server drops must
    /// be able to surface as a clean <c>400</c> from
    /// <see cref="TelemetryEventRequest.Validate"/> rather than as a <c>500</c> from
    /// <c>PulseDbContext</c>'s write-time envelope guard.
    /// </summary>
    /// <param name="request">The untrusted, deserialized envelope. Its <c>actor</c> block is rewritten in place.</param>
    /// <param name="identity">The caller's authenticated session identity (never <c>null</c> — the route is gated).</param>
    /// <param name="resolvedScope">
    /// The request's resolved <see cref="Data.IExerciseContext.CurrentExerciseId"/>, for a defense-in-depth
    /// cross-check only. <c>null</c> means no scope was resolved independently of the session, which is not by
    /// itself a rejection: the session's own binding IS the authority here, and the middleware already fails
    /// closed on a host/session disagreement for the kinds where that binding is host-bound.
    /// </param>
    /// <returns>The authoritative scope to persist, or a rejection carrying the status the endpoint returns.</returns>
    public static TelemetryAuthorityResolution Apply(
        TelemetryEventRequest request,
        SessionIdentity identity,
        Guid? resolvedScope)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(identity);

        // The session's own bound exercise is the authority (COR-012): SessionAuthenticationMiddleware writes it
        // into the request scope with precedence over host resolution, so for an authenticated request the two
        // agree by construction. Cross-checked anyway (COR-001) — a disagreement must never be resolved in
        // favour of writing a row, exactly as PostAttributionResolver's participant arm refuses one.
        if (resolvedScope is { } scope && scope != Guid.Empty && scope != identity.ExerciseId)
        {
            return TelemetryAuthorityResolution.Rejected(
                StatusCodes.Status403Forbidden,
                "The session's bound exercise disagrees with the request's resolved scope.");
        }

        // A body exerciseId that is absent or empty is a SHAPE error, reported by Validate() with every other
        // v0 shape error — not a forgery, and not this type's business. Anything present must AGREE: a non-Guid
        // string cannot name the caller's exercise any more than another exercise's id can.
        if (!string.IsNullOrEmpty(request.ExerciseId)
            && (!Guid.TryParse(request.ExerciseId, out var claimedScope) || claimedScope != identity.ExerciseId))
        {
            return TelemetryAuthorityResolution.Rejected(
                StatusCodes.Status400BadRequest,
                "The envelope's exerciseId disagrees with the session's own exercise scope.");
        }

        // An absent actor block is likewise a shape error Validate() reports; there is nothing to stamp onto.
        if (request.Actor is { } actor)
        {
            var isParticipantSession = string.Equals(
                identity.Kind, ParticipantSessionKind, StringComparison.Ordinal);

            // THE audit's forged claim. A staff / read-only / any-future-kind session asserting it is a trainee
            // acting as themselves is the one actor claim that makes an operator's (or an observer's) event
            // indistinguishable from a trainee's in the evaluation record (COR-018). It cannot be "corrected" —
            // there is no participant to substitute — so it is refused.
            if (string.Equals(actor.Kind, ParticipantActorKind, StringComparison.Ordinal) && !isParticipantSession)
            {
                return TelemetryAuthorityResolution.Rejected(
                    StatusCodes.Status403Forbidden,
                    "Only a participant session may emit an actor.kind of 'participant'.");
            }

            // Persona ownership, for every kind EXCEPT staff. A non-staff caller may only report the persona its
            // own session is bound to; naming another cast member's persona would attribute an action to a
            // trainee who never took it. Staff is excluded because operating a persona it is not bound to is the
            // legitimate E7 case (and PostAttributionResolver already owns validating that choice on the write
            // path); an absent value is always fine.
            var claimedPersona = actor.PersonaId;
            if (!string.IsNullOrEmpty(claimedPersona)
                && !string.Equals(identity.Kind, StaffSessionKind, StringComparison.Ordinal)
                && !(Guid.TryParse(claimedPersona, out var parsedPersona)
                    && identity.PersonaId is { } boundPersona
                    && parsedPersona == boundPersona))
            {
                return TelemetryAuthorityResolution.Rejected(
                    StatusCodes.Status403Forbidden,
                    "This session may only emit telemetry for the persona it is bound to.");
            }

            // Stamped, not believed. sessionId is the COR-015 reach-counting key and actingHumanId is the COR-018
            // attribution the audit forged; both are now the session's own, whatever the body said.
            actor.SessionId = identity.SessionId.ToString();
            actor.ActingHumanId = identity.ActingHumanId;

            // participantId is the caller's own account for a participant session and NOTHING for any other kind
            // — a staff console or a shared read-only observer has no participant to be, and a body value
            // claiming one is dropped rather than stored. (A read-only session's view events still satisfy the
            // COR-015 conditional rule through the stamped sessionId.)
            actor.ParticipantId = isParticipantSession ? identity.PrincipalId : null;
        }

        return TelemetryAuthorityResolution.Resolved(identity.ExerciseId);
    }
}

/// <summary>
/// The outcome of <see cref="TelemetryEnvelopeAuthority.Apply"/>: either the server-authoritative exercise scope
/// to persist, or a rejection carrying the HTTP status the endpoint returns. Exactly one of the two applies —
/// there is deliberately no "resolved but unknown scope" state, because a telemetry row whose exercise nobody
/// vouched for is the thing this type exists to prevent (COR-001).
/// </summary>
public sealed class TelemetryAuthorityResolution
{
    private TelemetryAuthorityResolution(Guid? exerciseId, int rejectionStatusCode, string? rejectionReason)
    {
        ExerciseId = exerciseId;
        RejectionStatusCode = rejectionStatusCode;
        RejectionReason = rejectionReason;
    }

    /// <summary>The scope to stamp on the persisted row — non-null only when <see cref="IsResolved"/>.</summary>
    public Guid? ExerciseId { get; }

    /// <summary>The HTTP status for a rejection (400 / 403); <c>0</c> when resolved.</summary>
    public int RejectionStatusCode { get; }

    /// <summary>The human-readable rejection reason; <c>null</c> when resolved.</summary>
    public string? RejectionReason { get; }

    /// <summary>Whether the envelope's scope and actor were established.</summary>
    public bool IsResolved => ExerciseId is not null;

    /// <summary>A resolved scope.</summary>
    /// <param name="exerciseId">The session's own bound exercise — the scope the row is stamped with.</param>
    /// <returns>The resolved outcome.</returns>
    public static TelemetryAuthorityResolution Resolved(Guid exerciseId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentOutOfRangeException(
                nameof(exerciseId), "An empty exercise scope is never a resolved outcome (COR-001).");
        }

        return new TelemetryAuthorityResolution(exerciseId, 0, null);
    }

    /// <summary>A rejection — nothing is stamped, nothing is persisted.</summary>
    /// <param name="statusCode">The HTTP status the endpoint returns.</param>
    /// <param name="reason">The human-readable reason.</param>
    /// <returns>The rejected outcome.</returns>
    public static TelemetryAuthorityResolution Rejected(int statusCode, string reason)
    {
        ArgumentException.ThrowIfNullOrEmpty(reason);
        return new TelemetryAuthorityResolution(null, statusCode, reason);
    }
}
