namespace Pulse.WebApi.Features.Identity.Sessions;

using Microsoft.AspNetCore.Http;

/// <summary>
/// Extracts the presented opaque session token from a request's <c>Authorization: Bearer &lt;token&gt;</c>
/// header — the delivery mechanism of the story-03 auth scheme (an opaque bearer token, chosen over a cookie
/// because the frontend is a separate cross-origin SPA and the process-wide CORS policy does not allow
/// credentials; see the feature implementation.md auth-scheme note). Never logs the header value.
/// </summary>
/// <remarks>
/// <para>
/// <b>The SignalR exception (identity-auth-roles/11).</b> A browser cannot set an <c>Authorization</c> header
/// on a WebSocket upgrade or an EventSource request, so the SignalR JS client instead appends
/// <c>?access_token=&lt;token&gt;</c> to those transports' URLs (it does use the header for negotiate and long
/// polling). Once the hub sits behind the default-deny gate, a header-only read would reject every legitimate
/// WebSocket connection. <see cref="TryGetSessionToken"/> therefore accepts the query form — but ONLY under
/// <c>/hubs</c>. A token in a URL is a real leak surface (proxy logs, browser history, <c>Referer</c>), so it
/// stays confined to the transports that cannot avoid it; every REST route remains header-only, and
/// <see cref="TryGetBearerToken"/> is unchanged for callers that must never accept the query form.
/// </para>
/// </remarks>
public static class SessionTokenExtractor
{
    private const string BearerPrefix = "Bearer ";

    /// <summary>
    /// The path prefix under which a query-string token is accepted — every SignalR hub, present and future.
    /// Matched as a path SEGMENT prefix, so an unrelated route merely beginning with the same characters
    /// (e.g. <c>/hubsomething</c>) does not qualify.
    /// </summary>
    private const string HubPathPrefix = "/hubs";

    /// <summary>The query-string parameter the SignalR client delivers the access token in.</summary>
    private const string AccessTokenQueryParameter = "access_token";

    /// <summary>
    /// Attempts to read the bearer token from the request's <c>Authorization</c> header. Header only — never
    /// the query string. Kept for callers whose surface must not accept a token in a URL.
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

    /// <summary>
    /// Attempts to read the presented session token: the <c>Authorization</c> header first, then — for a
    /// SignalR hub request only — the <c>access_token</c> query parameter. The header always wins when both
    /// are present. This is the extraction the request pipeline uses (see
    /// <see cref="SessionAuthenticationMiddleware"/>).
    /// </summary>
    /// <param name="request">The current request.</param>
    /// <param name="token">The extracted raw token when the method returns <c>true</c>; empty otherwise.</param>
    /// <returns><c>true</c> when a non-empty token is present; otherwise <c>false</c> (fail closed).</returns>
    public static bool TryGetSessionToken(HttpRequest request, out string token)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (TryGetBearerToken(request, out token))
        {
            return true;
        }

        token = string.Empty;

        if (!request.Path.StartsWithSegments(HubPathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            // Not a hub transport — a query-string token is never honored here (token-in-URL leak surface).
            return false;
        }

        var queryToken = request.Query[AccessTokenQueryParameter].ToString().Trim();
        if (queryToken.Length == 0)
        {
            return false;
        }

        token = queryToken;
        return true;
    }
}
