namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Http;

/// <summary>
/// Extracts the presented opaque session token from a request's <c>Authorization: Bearer &lt;token&gt;</c>
/// header — the delivery mechanism of the story-03 auth scheme (an opaque bearer token, chosen over a cookie
/// because the frontend is a separate cross-origin SPA and the process-wide CORS policy does not allow
/// credentials; see the feature implementation.md auth-scheme note). Never logs the header value.
/// </summary>
public static class SessionTokenExtractor
{
    private const string BearerPrefix = "Bearer ";

    /// <summary>
    /// Attempts to read the bearer token from the request's <c>Authorization</c> header.
    /// </summary>
    /// <param name="request">The current request.</param>
    /// <param name="token">The extracted raw token when the method returns <c>true</c>; empty otherwise.</param>
    /// <returns><c>true</c> when a non-empty <c>Bearer</c> token is present; otherwise <c>false</c> (fail closed).</returns>
    public static bool TryGetBearerToken(HttpRequest request, out string token)
    {
        ArgumentNullException.ThrowIfNull(request);

        token = string.Empty;

        var header = request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(header) ||
            !header.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var value = header[BearerPrefix.Length..].Trim();
        if (value.Length == 0)
        {
            return false;
        }

        token = value;
        return true;
    }
}
