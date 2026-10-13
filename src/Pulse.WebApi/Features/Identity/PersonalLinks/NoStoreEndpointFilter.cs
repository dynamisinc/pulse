namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.AspNetCore.Http;

/// <summary>
/// Marks every response of the routes it wraps <c>Cache-Control: no-store</c>: the staff routes (the frozen contract's
/// rule for staff responses, since a <c>RosterActionResultDto</c> can carry a join URL) and <c>POST /api/auth/join</c>
/// (its 200 carries the session and refresh tokens). Set before the next filter runs, so a gate's 401/403 carries it
/// too. No dependencies; created by the filter factory.
/// </summary>
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
