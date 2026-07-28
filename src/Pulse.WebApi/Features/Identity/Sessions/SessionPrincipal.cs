namespace Pulse.WebApi.Features.Identity.Sessions;

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

        var claims = new List<Claim>(4)
        {
            new(SessionIdClaimType, session.SessionId.ToString()),
            new(SessionKindClaimType, session.Kind),
            new(ExerciseIdClaimType, session.ExerciseId.ToString()),
        };

        if (session.StaffUserId is { } staffUserId)
        {
            claims.Add(new Claim(StaffUserIdClaimType, staffUserId.ToString()));
        }

        return new ClaimsPrincipal(new ClaimsIdentity(claims, AuthenticationType));
    }
}
