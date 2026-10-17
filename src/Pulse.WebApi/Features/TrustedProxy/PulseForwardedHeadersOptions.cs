namespace Pulse.WebApi.Features.TrustedProxy;

/// <summary>
/// The trusted-proxy configuration (identity-auth-roles/18, #480), bound from the <c>ForwardedHeaders</c>
/// configuration section (<c>ForwardedHeaders__KnownProxies__0</c>, <c>ForwardedHeaders__KnownNetworks__0</c>,
/// <c>ForwardedHeaders__ForwardLimit</c> as App Service app settings).
/// </summary>
/// <remarks>
/// <b>Safe by default.</b> With no configuration, NO proxy is trusted — not even loopback — so an
/// <c>X-Forwarded-For</c>/<c>X-Forwarded-Proto</c> header is ignored and every per-IP rate limiter keeps
/// partitioning on the TCP peer. A forwarded header is honored only when the connecting peer is one of
/// <see cref="KnownProxies"/> or falls inside one of <see cref="KnownNetworks"/>.
/// </remarks>
public sealed class PulseForwardedHeadersOptions
{
    /// <summary>The configuration section the options bind from.</summary>
    public const string SectionName = "ForwardedHeaders";

    /// <summary>The default number of proxy hops honored: the single App Service front end.</summary>
    public const int DefaultForwardLimit = 1;

    /// <summary>
    /// Individual proxy addresses whose forwarded headers are trusted (e.g. <c>10.0.0.4</c>). Each entry must
    /// parse as an IP address or startup fails.
    /// </summary>
    public IList<string> KnownProxies { get; } = new List<string>();

    /// <summary>
    /// Proxy networks in CIDR notation whose forwarded headers are trusted (e.g. <c>10.0.0.0/8</c>). Each entry
    /// must parse as a CIDR network or startup fails.
    /// </summary>
    public IList<string> KnownNetworks { get; } = new List<string>();

    /// <summary>
    /// How many <c>X-Forwarded-For</c> entries are consumed, right to left. The default of <c>1</c> takes only
    /// the entry the trusted front end appended, so a client-prepended (spoofed) entry to its left is never
    /// used. Must be at least <c>1</c>.
    /// </summary>
    public int ForwardLimit { get; set; } = DefaultForwardLimit;
}
