namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.AspNetCore.Http;

/// <summary>
/// Marks every response of the routes it wraps <c>Cache-Control: no-store</c>. The one copy for the whole easy-login
/// feature (Gate-2 S-3): the two anonymous sign-ins (<c>POST /api/auth/join</c> and <c>POST /api/auth/word</c>, whose
/// 200 carries the session and refresh tokens) and every staff route (the roster, the per-participant link and access
/// actions, the card sheet and the day word), whose bodies can carry join URLs, a day word or bearer credentials.
/// </summary>
/// <remarks>
/// Add it FIRST in a route's filter chain: it sets the header before the next filter runs, so a staff gate's 401/403
/// and a handler's 400/409/413 carry it too. It cannot reach a 429, which the rate limiter writes before any endpoint
/// filter runs, and that response carries no credential. No dependencies; created by the filter factory.
/// </remarks>
internal sealed class NoStoreEndpointFilter : IEndpointFilter
{
    /// <summary>The header value written.</summary>
    public const string NoStore = "no-store";

    /// <inheritdoc />
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        context.HttpContext.Response.Headers.CacheControl = NoStore;
        return next(context);
    }
}
