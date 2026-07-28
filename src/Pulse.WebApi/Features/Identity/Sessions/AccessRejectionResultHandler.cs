namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

/// <summary>
/// Turns a default-deny policy failure into the wire result (identity-auth-roles/11): <c>401</c> when the
/// caller presented no live session, <c>403</c> when an authenticated caller was explicitly forbidden — and
/// emits the XC-004 <c>access.rejected</c> audit event on the way out.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a custom handler rather than the framework default.</b> ASP.NET's
/// <see cref="AuthorizationMiddlewareResultHandler"/> resolves a challenge by calling
/// <c>HttpContext.ChallengeAsync()</c>, which requires a registered default challenge scheme. Pulse registers
/// no authentication scheme at all — its opaque bearer token is resolved by
/// <see cref="SessionAuthenticationMiddleware"/> — so the default handler would throw and surface a 500 where
/// a 401 belongs. Writing the status directly keeps the gate's failure mode honest, and gives the audit event
/// a single home.
/// </para>
/// <para>
/// <b>Telemetry never changes the response.</b> The emit is awaited but fully guarded: any failure is logged
/// and swallowed, because a telemetry problem must never convert a correct 401 into a 500 (which would also
/// hand an attacker a way to distinguish gated routes).
/// </para>
/// </remarks>
public sealed partial class AccessRejectionResultHandler : IAuthorizationMiddlewareResultHandler
{
    /// <summary>
    /// The <c>WWW-Authenticate</c> challenge written alongside the gate's 401 (RFC 6750 — the scheme really is
    /// an opaque bearer token). Beyond being correct HTTP, it makes the gate's rejection DISTINGUISHABLE from
    /// an endpoint's own <c>Results.Unauthorized()</c>: <c>POST /api/auth/refresh</c>, for instance, is
    /// allowlisted yet still 401s a request that presents no refresh token. Without a discriminator, "the
    /// allowlist still works" could not be asserted behaviourally at all — only this header separates
    /// "the gate refused you" from "the handler ran and refused you".
    /// </summary>
    public const string ChallengeScheme = "Bearer";

    private readonly AccessRejectionTelemetry _telemetry;

    /// <summary>Creates the handler over the coalescing audit emitter.</summary>
    /// <param name="telemetry">Records the XC-004 <c>access.rejected</c> event.</param>
    public AccessRejectionResultHandler(AccessRejectionTelemetry telemetry)
    {
        ArgumentNullException.ThrowIfNull(telemetry);
        _telemetry = telemetry;
    }

    /// <inheritdoc />
    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        ArgumentNullException.ThrowIfNull(next);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(authorizeResult);

        if (authorizeResult.Succeeded)
        {
            await next(context);
            return;
        }

        // Do not gate what this host does not serve. A fallback policy is evaluated even when routing matched
        // NOTHING (an unknown path) or matched only ASP.NET's method-mismatch sentinel — neither of which is a
        // RouteEndpoint, and neither of which can serve a byte of data. Turning those into 401 would:
        //   * hand the SPA's shared axios interceptor a 401 for every call to a route the backend does not
        //     serve, which drives its one-shot silent refresh — and for a session with no refresh token (the
        //     shared read-only login's envelope may omit one) that path CLEARS the stored tokens, logging a
        //     read-only observer out mid-exercise. Pulse has shipped "frontend seam, no backend route" twice
        //     (#310/#317, the participant-shell 404s), so this is a live hazard, not a hypothetical one;
        //   * make the rejection telemetry below unbounded — an unmatched request has no route pattern to key
        //     coalescing on, and the HTTP method is caller-supplied (Kestrel accepts any RFC token).
        // Letting these through is safe: the remaining pipeline (lifecycle gating, rate limiter, endpoints)
        // terminates in routing's own 404/405. No handler runs, and every one of the 53 real endpoints —
        // minimal API, MVC controller and hub alike — IS a RouteEndpoint, so gate coverage is unchanged.
        if (context.GetEndpoint() is not RouteEndpoint)
        {
            await next(context);
            return;
        }

        // Forbidden means "authenticated but not permitted"; anything else on this gate means "no live
        // session". Nothing else in the codebase produces a Forbid today — the staff/engine surfaces run
        // their own 403s inside their handlers — but mapping it correctly keeps the handler honest if a
        // future story adds a role requirement to the policy.
        var statusCode = authorizeResult.Forbidden
            ? StatusCodes.Status403Forbidden
            : StatusCodes.Status401Unauthorized;

        await _telemetry.RecordRejectionAsync(context, statusCode);

        context.Response.StatusCode = statusCode;
        if (statusCode == StatusCodes.Status401Unauthorized)
        {
            context.Response.Headers.WWWAuthenticate = ChallengeScheme;
        }
    }
}
