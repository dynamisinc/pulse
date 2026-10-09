namespace Pulse.WebApi.Features.Identity;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;

/// <summary>
/// The request-body bound shared by the three ANONYMOUS login routes (<c>/api/auth/login</c>,
/// <c>/api/auth/staff/login</c>, <c>/api/auth/shared</c>) — Wave 1b Gate-2 M-1. Without it they inherit Kestrel's
/// ~30 MB default, so one unauthenticated request could make the server buffer and parse megabytes of JSON (and,
/// for the participant login, sanitize a megabyte username). A login body is a handle and a secret: the largest
/// legitimate one (a 1,024-character username or secret, JSON-escaped) is far below 16 KiB.
/// </summary>
public static class LoginRequestLimits
{
    /// <summary>The largest login request body accepted, in bytes (16 KiB). A larger body is refused (413) while it is read.</summary>
    public const long MaxLoginRequestBodyBytes = 16 * 1024;

    /// <summary>
    /// Puts the login body limit on a route as <see cref="Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata"/>,
    /// which endpoint routing applies to the server's request-body-size feature before the body is bound.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type.</typeparam>
    /// <param name="builder">The route's convention builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static TBuilder WithLoginBodyLimit<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);

        return builder.WithMetadata(new RequestSizeLimitAttribute(MaxLoginRequestBodyBytes));
    }
}
