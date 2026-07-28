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
/// <b>Read-only observers are corrected, not refused (COR-015).</b> The one place a claim is rewritten rather
/// than either stamped or refused. Every shipped view emitter hardcodes <c>actor.kind: 'participant'</c> with no
/// read-only branch, and a shared observer's session is kind <c>readonly</c> — so refusing that claim would
/// silently delete view/reach telemetry for the largest cohort in an exercise (the client's sink swallows the
/// rejection). The claim IS correctable for this kind, and the correction is not invented: it is the same
/// <c>actor.kind: 'system'</c> attribution <c>SharedReadOnlyLoginService</c> already stamps on the telemetry it
/// writes for the very same session.
/// </para>
/// <para>
/// <b>The reach key differs from that login event's, and here is the correlation path.</b> Precision an AAR/E10
/// reach query will take literally: <c>SharedReadOnlyLoginService</c> puts its freshly-generated EPHEMERAL
/// identity in the login event's <c>actor.sessionId</c> (it has no <c>Session</c> row yet), whereas this stamps
/// the persisted <c>Session.Id</c>. So one observer's login row and view rows carry DIFFERENT
/// <c>actor.sessionId</c> values, and a distinct-observer count over <c>actor.sessionId</c> spanning both event
/// types would double-count. They are 1:1 and joinable: that ephemeral identity is the session's
/// <c>PrincipalId</c> AND <c>ActingHumanId</c>, so the login event's <c>actor.sessionId</c> equals the view rows'
/// <c>actor.actingHumanId</c>. Reach counted over view events alone is unaffected.
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
    /// persona-ownership check below does not apply to it — and the one kind whose events legitimately carry a
    /// privileged <c>origin</c>.
    /// </summary>
    private const string StaffSessionKind = "staff";

    /// <summary>
    /// The <c>Session.Kind</c> of a shared view-only observer (COR-015/COR-016) — see
    /// <c>SharedReadOnlyLoginService</c>, which mints it.
    /// </summary>
    private const string ReadOnlySessionKind = "readonly";

    /// <summary>The v0 <c>actor.kind</c> asserting "a trainee, acting as themselves".</summary>
    private const string ParticipantActorKind = "participant";

    /// <summary>
    /// The v0 <c>actor.kind</c> for an actor with no personal identity — what a read-only observer's events are
    /// attributed to, matching what <c>SharedReadOnlyLoginService</c> already stamps on the telemetry IT writes.
    /// </summary>
    private const string SystemActorKind = "system";

    /// <summary>
    /// The v0 <c>actor.kind</c> asserting "the generation engine did this" — a machine provenance no non-staff
    /// HTTP caller may claim, for the same reason it may not claim <see cref="ParticipantOrigin"/>'s privileged
    /// siblings.
    /// </summary>
    private const string EngineActorKind = "engine";

    /// <summary>The only <c>origin</c> a non-staff HTTP caller may state (an absent origin is always fine).</summary>
    private const string ParticipantOrigin = "participant";

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

        var isStaffSession = string.Equals(identity.Kind, StaffSessionKind, StringComparison.Ordinal);

        // Provenance (`origin`) is the same forgery class as the actor's identity: the evaluator surfaces render
        // 'engine' / 'controller-as-persona' events as machine- or operator-generated, so a trainee who could
        // state either would be writing fabricated provenance into the evaluation record — exactly how the audit's
        // exploit 1 dressed an injected post up as engine-generated content. Only a staff session may state a
        // privileged origin; every shipped emitter agrees. Refused, not rewritten: a claimed provenance the caller
        // cannot hold has no correct value to substitute.
        //
        // Note WHERE that "every shipped emitter agrees" guarantee actually lives. The literal privileged values
        // are all under features/controller/**, but the envelope FIELD is written by two shared services that
        // participant paths also call — postService.ts and amplify.ts pass their `input.origin` straight through.
        // So the guarantee rests on the CALLERS of createPost/repost/quotePost, not on a folder boundary: a future
        // participant-reachable caller passing a non-'participant' origin gets a 403 the client's sink swallows.
        if (request.Origin is not null
            && !isStaffSession
            && !string.Equals(request.Origin, ParticipantOrigin, StringComparison.Ordinal))
        {
            return TelemetryAuthorityResolution.Rejected(
                StatusCodes.Status403Forbidden,
                "A non-staff session may only emit telemetry with origin 'participant'.");
        }

        // An absent actor block is likewise a shape error Validate() reports; there is nothing to stamp onto.
        if (request.Actor is { } actor)
        {
            var isParticipantSession = string.Equals(
                identity.Kind, ParticipantSessionKind, StringComparison.Ordinal);

            // THE audit's forged claim: a session that is not a trainee asserting it is one, which is what makes
            // an operator's event indistinguishable from a trainee's in the evaluation record (COR-018).
            if (string.Equals(actor.Kind, ParticipantActorKind, StringComparison.Ordinal) && !isParticipantSession)
            {
                // A READ-ONLY observer's claim is CORRECTABLE, and correcting it is required rather than merely
                // kind: COR-015 counts a shared observer's views/reach without per-user provisioning ("the hundred
                // passive participants"), and every shipped view emitter hardcodes kind 'participant'
                // (Feed/HashtagFeed/Profile/ThreadView) with no read-only branch. Refusing would silently delete
                // the largest cohort's reach data — mockSink swallows the rejection into one generic log line — so
                // the observer's events are attributed the way SharedReadOnlyLoginService already attributes the
                // telemetry IT writes for the same session: actor.kind 'system', reach counted by the stamped
                // sessionId below. Making the SPA self-report its own privilege level correctly is precisely the
                // "frontend as the security boundary" posture #359 was caused by.
                if (!string.Equals(identity.Kind, ReadOnlySessionKind, StringComparison.Ordinal))
                {
                    return TelemetryAuthorityResolution.Rejected(
                        StatusCodes.Status403Forbidden,
                        "Only a participant session may emit an actor.kind of 'participant'.");
                }

                actor.Kind = SystemActorKind;
            }

            // The sibling of the origin rule above, and refused on the same evidence standard: no
            // participant-reachable emitter states actor.kind 'engine' (every 'engine' literal in the frontend is
            // under features/controller/** or features/staffShell/**), so refusing it breaks nothing shipped —
            // while allowing it would let a trainee write MACHINE-attributed activity into the evaluation record,
            // the identical forgery class. Not correctable: there is no engine to substitute.
            //
            // 'system' is deliberately NOT refused alongside it. It is the neutral "this actor has no personal
            // identity" kind rather than a claim to be something privileged, it is what the read-only correction
            // above produces, and it is what the identity slice's own server-side emitters use for an
            // identity-less event (SharedReadOnlyLoginService, ParticipantLoginService's failed-login event).
            // Refusing it would refuse the honest answer.
            if (string.Equals(actor.Kind, EngineActorKind, StringComparison.Ordinal) && !isStaffSession)
            {
                return TelemetryAuthorityResolution.Rejected(
                    StatusCodes.Status403Forbidden,
                    "Only a staff session may emit an actor.kind of 'engine'.");
            }

            // Persona ownership, for every kind EXCEPT staff. A non-staff caller may only report the persona its
            // own session is bound to; naming another cast member's persona would attribute an action to a
            // trainee who never took it. An absent value is always fine — and is deliberately NOT completed from
            // the session binding the way participantId is: participantId is unambiguous (a participant session
            // has exactly one account), whereas WHICH persona an event concerns is the emitter's knowledge, so
            // inventing one would be guessing rather than stamping.
            //
            // Staff is excluded because operating a persona it is not bound to is the legitimate E7 case. That
            // choice is deliberately NOT validated against the exercise's cast here: doing so would mean a
            // Personas query PER EVENT on the burst-rate path, which is the cost this whole design avoids (see
            // the class remarks). The residual is bounded and non-disclosing — the row's ExerciseId is still the
            // session's, so a bogus value is a dangling reference inside the caller's own exercise, never a
            // cross-exercise read. PostAttributionResolver validates the equivalent choice on POST /api/posts,
            // where one query per post is affordable; it does NOT run on this path.
            var claimedPersona = actor.PersonaId;
            if (!string.IsNullOrEmpty(claimedPersona)
                && !isStaffSession
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
