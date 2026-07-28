namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Linq;
using System.Security.Claims;

/// <summary>
/// Projects an <see cref="AuthenticatedSession"/> onto the <see cref="ClaimsPrincipal"/> that
/// <see cref="SessionAuthenticationMiddleware"/> assigns to <c>HttpContext.User</c> — the single fact ASP.NET's
/// <c>AuthorizationMiddleware</c> reads when it evaluates the default-deny fallback policy
/// (identity-auth-roles/11, COR-012).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a principal at all, when the codebase has no authentication scheme.</b> Pulse authenticates with an
/// opaque bearer token resolved by its own middleware, not by an <c>IAuthenticationHandler</c>. The fallback
/// policy this story registers carries NO authentication schemes, so ASP.NET's <c>PolicyEvaluator</c> reads
/// <c>HttpContext.User</c> directly rather than challenging a scheme that does not exist. Populating the
/// principal here is therefore the whole integration: one additive write in the existing middleware buys a
/// default-deny gate that covers minimal APIs, MVC controllers and SignalR hubs uniformly.
/// </para>
/// <para>
/// <b>The identity must be "authenticated".</b> <see cref="ClaimsIdentity.IsAuthenticated"/> is true only when
/// the identity carries a non-null <c>authenticationType</c> — hence <see cref="AuthenticationType"/>. An
/// identity built without it is anonymous no matter how many claims it holds, and every request would 401.
/// </para>
/// <para>
/// <b>No token material.</b> The claims carry ids only (NFR-009) — never the raw or hashed session token.
/// </para>
/// </remarks>
public static class SessionPrincipal
{
    /// <summary>The identity's authentication type — non-null so <c>IsAuthenticated</c> is true.</summary>
    public const string AuthenticationType = "PulseSession";

    /// <summary>Claim type carrying the persisted <c>Session.Id</c>.</summary>
    public const string SessionIdClaimType = "pulse:session-id";

    /// <summary>Claim type carrying the session kind (<c>participant</c> / <c>staff</c> / <c>readonly</c>).</summary>
    public const string SessionKindClaimType = "pulse:session-kind";

    /// <summary>Claim type carrying the session's bound exercise (COR-012).</summary>
    public const string ExerciseIdClaimType = "pulse:exercise-id";

    /// <summary>Claim type carrying the bound <c>StaffUser</c> id; absent for participant / read-only sessions.</summary>
    public const string StaffUserIdClaimType = "pulse:staff-user-id";

    /// <summary>Claim type carrying the session's <c>PrincipalId</c> (identity-auth-roles/13).</summary>
    public const string PrincipalIdClaimType = "pulse:principal-id";

    /// <summary>Claim type carrying the individual human behind the session (COR-018, identity-auth-roles/13).</summary>
    public const string ActingHumanIdClaimType = "pulse:acting-human-id";

    /// <summary>Claim type carrying the session's persona binding; absent for a session with none.</summary>
    public const string PersonaIdClaimType = "pulse:persona-id";

    /// <summary>
    /// Builds the authenticated principal for a live session. Callers must only invoke this for a session
    /// <see cref="ISessionAuthenticator"/> has already resolved as live — this method performs no validation of
    /// its own and asserting an identity for an expired or unknown token would defeat the gate.
    /// </summary>
    /// <param name="session">The live session resolved from the presented bearer token.</param>
    /// <returns>An authenticated <see cref="ClaimsPrincipal"/> describing that session.</returns>
    public static ClaimsPrincipal Create(AuthenticatedSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        var claims = new List<Claim>(7)
        {
            new(SessionIdClaimType, session.SessionId.ToString()),
            new(SessionKindClaimType, session.Kind),
            new(ExerciseIdClaimType, session.ExerciseId.ToString()),
            new(PrincipalIdClaimType, session.PrincipalId),
            new(ActingHumanIdClaimType, session.ActingHumanId),
        };

        if (session.StaffUserId is { } staffUserId)
        {
            claims.Add(new Claim(StaffUserIdClaimType, staffUserId.ToString()));
        }

        if (session.PersonaId is { } personaId)
        {
            claims.Add(new Claim(PersonaIdClaimType, personaId.ToString()));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, AuthenticationType));
    }

    /// <summary>
    /// Reads the session identity back off a principal this class created, or <c>null</c> when the principal is
    /// not an authenticated Pulse session — so a consumer never hand-parses claim strings and can never mistake
    /// an anonymous request for an identified one (identity-auth-roles/13).
    /// </summary>
    /// <remarks>
    /// FAILS CLOSED. A principal with no authenticated identity, a non-<see cref="AuthenticationType"/> identity,
    /// or a missing/unparseable required claim yields <c>null</c> — never a partially-populated identity, because
    /// a caller that believed a half-empty identity would stamp a telemetry row it could not attribute.
    /// </remarks>
    /// <param name="principal">The current request's <c>HttpContext.User</c>.</param>
    /// <returns>The session identity, or <c>null</c>.</returns>
    public static SessionIdentity? Read(ClaimsPrincipal? principal)
    {
        var identity = principal?.Identities.FirstOrDefault(
            candidate => candidate.IsAuthenticated
                && string.Equals(candidate.AuthenticationType, AuthenticationType, StringComparison.Ordinal));

        if (identity is null)
        {
            return null;
        }

        var kind = identity.FindFirst(SessionKindClaimType)?.Value;
        var principalId = identity.FindFirst(PrincipalIdClaimType)?.Value;
        var actingHumanId = identity.FindFirst(ActingHumanIdClaimType)?.Value;

        if (!Guid.TryParse(identity.FindFirst(SessionIdClaimType)?.Value, out var sessionId)
            || !Guid.TryParse(identity.FindFirst(ExerciseIdClaimType)?.Value, out var exerciseId)
            || sessionId == Guid.Empty
            || exerciseId == Guid.Empty
            || string.IsNullOrEmpty(kind)
            || string.IsNullOrEmpty(principalId)
            || string.IsNullOrEmpty(actingHumanId))
        {
            return null;
        }

        return new SessionIdentity
        {
            SessionId = sessionId,
            ExerciseId = exerciseId,
            Kind = kind,
            PrincipalId = principalId,
            ActingHumanId = actingHumanId,
            StaffUserId = ParseOptionalGuid(identity.FindFirst(StaffUserIdClaimType)?.Value),
            PersonaId = ParseOptionalGuid(identity.FindFirst(PersonaIdClaimType)?.Value),
        };
    }

    /// <summary>Parses an optional Guid claim value; <c>null</c> for an absent, unparseable or empty value.</summary>
    private static Guid? ParseOptionalGuid(string? value)
        => Guid.TryParse(value, out var parsed) && parsed != Guid.Empty ? parsed : null;
}

/// <summary>
/// The current request's session identity, read back off <c>HttpContext.User</c> by
/// <see cref="SessionPrincipal.Read"/>. The server-authoritative answer to "who is this request", used by
/// <c>POST /api/telemetry</c> to stamp an event's scope and actor instead of believing the envelope
/// (identity-auth-roles/13, #362).
/// </summary>
/// <remarks>
/// Shape-identical to the resolved half of <see cref="AuthenticatedSession"/> and deliberately a SEPARATE type:
/// <see cref="AuthenticatedSession"/> is what a resolver PRODUCES (and may be constructed by a test double),
/// while this is what a consumer READS from an already-authenticated request. Nothing here is ever serialized to
/// a client — <see cref="ActingHumanId"/> in particular is telemetry-only attribution (COR-018), never projected
/// onto a participant-facing response (XC-002).
/// </remarks>
public sealed class SessionIdentity
{
    /// <summary>The persisted <c>Session.Id</c>.</summary>
    public required Guid SessionId { get; init; }

    /// <summary>The session's bound exercise (COR-001/COR-012).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The session kind — <c>participant</c> / <c>staff</c> / <c>readonly</c>.</summary>
    public required string Kind { get; init; }

    /// <summary>The session's <c>PrincipalId</c> — a participant session's <c>Account</c> id.</summary>
    public required string PrincipalId { get; init; }

    /// <summary>The individual human behind the session (COR-018).</summary>
    public required string ActingHumanId { get; init; }

    /// <summary>The bound <c>StaffUser</c> id, or <c>null</c> for a non-staff session.</summary>
    public Guid? StaffUserId { get; init; }

    /// <summary>The session's persona binding, or <c>null</c> for a session with none.</summary>
    public Guid? PersonaId { get; init; }
}
