using Microsoft.Extensions.Configuration;

namespace Pulse.WebApi.Features.Identity.RateLimits;

/// <summary>
/// Per-minute permit limits for the authentication rate-limiter policies that used to be hard-coded
/// (identity-auth-roles/18, #480 follow-up). Each policy keeps its historical default; an operator can raise a
/// limit for a large single-venue exercise with an app setting and no deploy, the same way the easy-login
/// <c>JoinPermitPerMinute</c>/<c>WordPermitPerMinute</c> settings already work.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> Every limiter partitions on the client's public IP. Players behind one venue NAT share a
/// bucket, so a 100-person StartEx can exhaust the session limit (every app load calls <c>GET /api/session</c>)
/// or the view-only code limit. See <c>docs/OPERATE.md</c> → "Trusted proxy" for recommended values.
/// </para>
/// <para>
/// <b>Keys</b> (section <c>Authentication:RateLimits</c>; app-setting form uses <c>__</c>):
/// <c>ParticipantLoginPerMinute</c> (default 10), <c>SharedLoginPerMinute</c> (default 5),
/// <c>SessionPerMinute</c> (default 60), <c>StaffLoginPerMinute</c> (default 10).
/// A missing, non-integer or non-positive value falls back to the default — a limiter is never disabled by a typo.
/// The value is read when a partition is created, so a changed app setting (which restarts the App Service
/// worker) takes effect on the next window.
/// </para>
/// </remarks>
public static class AuthRateLimits
{
    /// <summary>The configuration section that holds the limits.</summary>
    public const string SectionName = "Authentication:RateLimits";

    /// <summary>Default for <c>POST /api/auth/login</c> (participant password sign-in).</summary>
    public const int DefaultParticipantLoginPerMinute = 10;

    /// <summary>Default for <c>POST /api/auth/shared</c> (view-only code).</summary>
    public const int DefaultSharedLoginPerMinute = 5;

    /// <summary>Default for <c>GET /api/session</c>, <c>POST /api/auth/refresh</c> and <c>POST /api/auth/logout</c>.</summary>
    public const int DefaultSessionPerMinute = 60;

    /// <summary>Default for <c>POST /api/auth/staff/login</c>.</summary>
    public const int DefaultStaffLoginPerMinute = 10;

    /// <summary>Resolves the participant-login limit.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The configured positive limit, or the default.</returns>
    public static int ParticipantLoginPerMinute(IConfiguration configuration) =>
        Read(configuration, "ParticipantLoginPerMinute", DefaultParticipantLoginPerMinute);

    /// <summary>Resolves the view-only-code limit.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The configured positive limit, or the default.</returns>
    public static int SharedLoginPerMinute(IConfiguration configuration) =>
        Read(configuration, "SharedLoginPerMinute", DefaultSharedLoginPerMinute);

    /// <summary>Resolves the session-endpoints limit.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The configured positive limit, or the default.</returns>
    public static int SessionPerMinute(IConfiguration configuration) =>
        Read(configuration, "SessionPerMinute", DefaultSessionPerMinute);

    /// <summary>Resolves the staff-login limit.</summary>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The configured positive limit, or the default.</returns>
    public static int StaffLoginPerMinute(IConfiguration configuration) =>
        Read(configuration, "StaffLoginPerMinute", DefaultStaffLoginPerMinute);

    /// <summary>The keys (relative to <see cref="SectionName"/>) this class reads.</summary>
    public static readonly IReadOnlyList<string> Keys =
        ["ParticipantLoginPerMinute", "SharedLoginPerMinute", "SessionPerMinute", "StaffLoginPerMinute"];

    /// <summary>
    /// Finds the configured keys whose value is present but refused (non-integer or non-positive), so a typo is
    /// reported at startup instead of silently falling back to the default (orchestrator review L-3).
    /// </summary>
    /// <param name="configuration">The application configuration.</param>
    /// <returns>The full configuration keys whose values were refused.</returns>
    public static IReadOnlyList<string> FindRejectedKeys(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var rejected = new List<string>();
        foreach (var key in Keys)
        {
            var fullKey = $"{SectionName}:{key}";
            var raw = configuration[fullKey];
            if (raw is not null && !(int.TryParse(raw, out var value) && value > 0))
            {
                rejected.Add(fullKey);
            }
        }

        return rejected;
    }

    private static int Read(IConfiguration configuration, string key, int fallback)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var raw = configuration[$"{SectionName}:{key}"];
        return int.TryParse(raw, out var value) && value > 0 ? value : fallback;
    }
}
