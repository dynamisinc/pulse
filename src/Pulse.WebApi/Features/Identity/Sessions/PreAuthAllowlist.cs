namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

/// <summary>
/// The complete, closed list of routes reachable WITHOUT a live session (identity-auth-roles/11). Every other
/// mapped endpoint — minimal API, MVC controller, and SignalR hub alike — is denied by the default-deny
/// fallback policy <see cref="SessionAuthorizationExtensions.AddSessionAuthorization"/> registers.
/// </summary>
/// <remarks>
/// <para>
/// <b>This list is the ONLY hand-maintained artifact in the gate.</b> Adding to it must be a deliberate,
/// reviewed diff — never an accidental omission. It is single-sourced here so the runtime marks
/// (<see cref="SessionAuthorizationExtensions.AllowAnonymousPreAuth{TBuilder}"/> at each allowlisted mapping
/// call site) and the anonymous-access regression suite (identity-auth-roles/14, which enumerates the LIVE
/// <see cref="EndpointDataSource"/> rather than a static list) cannot drift apart.
/// </para>
/// <para>
/// <b>Why each entry is here.</b>
/// <list type="bullet">
///   <item><description><c>/api/exercise-context</c> — exercise-isolation/08: the login pages need a resolved
///   scope before a session exists.</description></item>
///   <item><description>The three login endpoints — they ESTABLISH the session; each fails closed on its own
///   with anti-enumeration 401s and its own rate-limiter policy.</description></item>
///   <item><description><c>/api/auth/refresh</c> — self-gating: the refresh token IS the credential, read from
///   the request body.</description></item>
///   <item><description><c>/api/auth/logout</c> — deliberately a no-op 204 with no session. A client whose
///   token already expired must still be able to complete logout idempotently; 401-ing it would strand the SPA
///   on a dead session. It invalidates nothing when there is nothing to invalidate, discloses nothing either
///   way, and is not a write path.</description></item>
///   <item><description><c>/health</c>, <c>/health/ready</c> — platform liveness/readiness probes, which
///   present no credential by construction.</description></item>
///   <item><description>The three <c>/api/ops/*</c> endpoints — secret-gated by <c>X-Bootstrap-Secret</c>
///   (404 when unconfigured). That secret IS their credential, exactly as the refresh token is
///   <c>/api/auth/refresh</c>'s. They MUST be allowlisted rather than left to the fallback policy:
///   <c>AuthorizationMiddleware</c> runs BEFORE the handler's secret check, and bootstrap by definition runs
///   against an empty database with no session to present — so default-deny would 401 a legitimate,
///   secret-bearing call and break the UAT go-live runbook. (The 2026-07-25 endpoint audit classified these
///   "correctly gated" and omitted them from its 8-route allowlist; this is that list's one correction.)
///   </description></item>
/// </list>
/// </para>
/// <para>
/// <b>Deliberately NOT here:</b> both <c>/hubs/exercise</c> endpoints (the connection and its
/// <c>/negotiate</c> sibling) — an unauthenticated client provably received a live <c>PostReceived</c> frame
/// (#359, exploit 3), so the hub is gated like everything else.
/// </para>
/// </remarks>
public static class PreAuthAllowlist
{
    /// <summary>
    /// The key used for an endpoint that declares no HTTP method constraint (the health-check endpoints).
    /// </summary>
    public const string AnyMethod = "*";

    /// <summary>
    /// The allowlist, as <c>"{METHOD} {routePattern}"</c> keys matching
    /// <see cref="RoutePattern.RawText"/>. Exactly eleven routes.
    /// </summary>
    public static IReadOnlySet<string> Routes { get; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "GET /api/exercise-context",
        "POST /api/auth/login",
        "POST /api/auth/staff/login",
        "POST /api/auth/shared",
        "POST /api/auth/refresh",
        "POST /api/auth/logout",
        $"{AnyMethod} /health",
        $"{AnyMethod} /health/ready",
        "POST /api/ops/bootstrap-exercise",
        "POST /api/ops/seed-engine-content",
        "POST /api/ops/bind-participant-persona",
    };

    /// <summary>
    /// The allowlist keys an endpoint would match — one per declared HTTP method, or a single
    /// <see cref="AnyMethod"/> key when the endpoint constrains no method.
    /// </summary>
    /// <param name="endpoint">A mapped route endpoint from the live <see cref="EndpointDataSource"/>.</param>
    /// <returns>The candidate keys for <paramref name="endpoint"/>.</returns>
    public static IEnumerable<string> KeysFor(RouteEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        var pattern = endpoint.RoutePattern.RawText ?? string.Empty;
        var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods;

        return methods is null || methods.Count == 0
            ? [$"{AnyMethod} {Normalize(pattern)}"]
            : methods.Select(method => $"{method} {Normalize(pattern)}");
    }

    /// <summary>Whether <paramref name="endpoint"/> is reachable without a live session.</summary>
    /// <param name="endpoint">A mapped route endpoint from the live <see cref="EndpointDataSource"/>.</param>
    /// <returns><c>true</c> when every one of its keys is allowlisted; otherwise <c>false</c> (fail closed).</returns>
    public static bool Contains(RouteEndpoint endpoint) => KeysFor(endpoint).All(Routes.Contains);

    /// <summary>Leading-slash-normalizes a raw route pattern so the keys compare consistently.</summary>
    private static string Normalize(string pattern)
        => pattern.StartsWith('/') ? pattern : "/" + pattern;
}
