namespace Pulse.WebApi.Features.Identity.EasyLogin;

using Microsoft.Extensions.Configuration;

/// <summary>
/// Builds a participant's personal join URL, <c>{Authentication:FrontendBaseUrl}/join/{token}</c> (EL-6). The base
/// is the SPA origin (the same app setting CORS uses and <c>infrastructure/modules/webapp.bicep</c> provisions),
/// never <c>Exercise.Hostname</c>: in UAT the exercise host is the API host, while participants open the SPA host.
/// </summary>
/// <remarks>
/// <para>
/// <b>Never guessed.</b> When the base is unset, blank, relative, not <c>http</c>/<c>https</c>, or carries a query,
/// fragment or user-info (none of which can prefix a path), <see cref="Build"/> returns <c>null</c> and
/// <see cref="IsAvailable"/> is <c>false</c>: links are unavailable (<c>joinLinksAvailable: false</c>), not pointed
/// at a host someone hoped was right.
/// </para>
/// <para>
/// <b>A join URL is a bearer credential.</b> It is returned to staff only and must never reach a log, a telemetry
/// event, an exception message or an error body. This type does not log.
/// </para>
/// <para>
/// The setting is read on each call (it is one dictionary lookup), so the builder is a stateless singleton that
/// follows configuration reloads.
/// </para>
/// </remarks>
public sealed class JoinUrlBuilder
{
    /// <summary>The configuration key of the SPA origin, verbatim as <c>webapp.bicep</c> provisions it (<c>Authentication__FrontendBaseUrl</c>).</summary>
    public const string FrontendBaseUrlKey = "Authentication:FrontendBaseUrl";

    /// <summary>The SPA route segment the token follows (<c>/join/:token</c>, story 08).</summary>
    public const string JoinPathSegment = "join";

    private readonly IConfiguration _configuration;

    /// <summary>Creates the builder over the host configuration.</summary>
    /// <param name="configuration">The configuration holding <see cref="FrontendBaseUrlKey"/>.</param>
    public JoinUrlBuilder(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        _configuration = configuration;
    }

    /// <summary>Whether a usable join base is configured, i.e. whether <see cref="Build"/> can return a URL at all.</summary>
    public bool IsAvailable => TryGetBase(out _);

    /// <summary>
    /// Builds the join URL for a raw link token: the configured base with any trailing slash removed, then
    /// <c>/join/</c>, then the token (escaped as a path segment; a base64url token needs no escaping).
    /// </summary>
    /// <param name="token">The raw link token (non-empty).</param>
    /// <returns>The absolute join URL, or <c>null</c> when no usable base is configured.</returns>
    public string? Build(string token)
    {
        ArgumentException.ThrowIfNullOrEmpty(token);

        if (!TryGetBase(out var baseUrl))
        {
            return null;
        }

        return $"{baseUrl}/{JoinPathSegment}/{Uri.EscapeDataString(token)}";
    }

    /// <summary>
    /// Reads and validates the configured base: an absolute <c>http</c>/<c>https</c> URL with no query, fragment or
    /// user-info, normalised to <c>scheme://authority/path</c> with every trailing slash trimmed.
    /// </summary>
    private bool TryGetBase(out string baseUrl)
    {
        baseUrl = string.Empty;

        var configured = _configuration[FrontendBaseUrlKey]?.Trim();
        if (string.IsNullOrEmpty(configured)
            || !Uri.TryCreate(configured, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || string.IsNullOrEmpty(uri.Host))
        {
            return false;
        }

        baseUrl = uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
        return true;
    }
}
