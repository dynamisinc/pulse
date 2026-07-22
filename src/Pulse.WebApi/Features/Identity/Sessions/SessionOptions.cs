namespace Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The short-lived session lifetimes (COR-012). Bound from the <c>Authentication:Session</c> configuration
/// section by <c>AddSessions</c>; the defaults keep sessions short-lived (a one-hour access window, matching
/// the frozen frontend mock's <c>SESSION_TTL_MS</c>) with a longer refresh window so an expiring access token
/// can be renewed without a full re-login until the refresh window itself lapses and forces re-auth.
/// </summary>
public sealed class SessionOptions
{
    /// <summary>The configuration section these options bind from (<c>Authentication:Session</c>).</summary>
    public const string SectionName = "Authentication:Session";

    /// <summary>Access-token lifetime in minutes (short-lived, COR-012). Default 60 (one hour).</summary>
    public int SessionLifetimeMinutes { get; set; } = 60;

    /// <summary>Refresh-window lifetime in minutes. Default 720 (twelve hours); past it, re-auth is forced.</summary>
    public int RefreshLifetimeMinutes { get; set; } = 720;

    /// <summary>The access-token lifetime as a <see cref="TimeSpan"/>.</summary>
    public TimeSpan SessionLifetime => TimeSpan.FromMinutes(SessionLifetimeMinutes);

    /// <summary>The refresh-window lifetime as a <see cref="TimeSpan"/>.</summary>
    public TimeSpan RefreshLifetime => TimeSpan.FromMinutes(RefreshLifetimeMinutes);
}
