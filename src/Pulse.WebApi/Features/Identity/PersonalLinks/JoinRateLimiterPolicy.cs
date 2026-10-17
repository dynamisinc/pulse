namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The <c>easy-login-join</c> rate-limit policy on <c>POST /api/auth/join</c> (EL-16, NFR-009): a fixed one-minute
/// window of <see cref="EasyLoginOptions.JoinPermitPerMinute"/> requests (default 30) per client IP, with no queue.
/// Beyond it the request is refused with <c>429</c> before the handler runs. Its own bucket, separate from the
/// <c>participant-login</c> password policy.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sized for load, not brute force.</b> A link token is 128 random bits, so guessing is not a threat; the limit only
/// bounds the work (and the failure events) one client can cause. Operators raise it with
/// <c>Authentication__EasyLogin__JoinPermitPerMinute</c>, no deploy.
/// </para>
/// <para>
/// <b>Partitioning.</b> On <c>Connection.RemoteIpAddress</c>, which is the real client's public IP since the trusted-proxy
/// forwarded-headers handling (identity-auth-roles/18, #480). Clients behind one NAT still share a bucket.
/// </para>
/// </remarks>
public sealed class JoinRateLimiterPolicy : IRateLimiterPolicy<string>
{
    /// <summary>The policy name <c>POST /api/auth/join</c> requires.</summary>
    public const string PolicyName = "easy-login-join";

    /// <summary>The partition used when the connection has no remote address.</summary>
    public const string UnknownPartition = "unknown";

    private readonly int _permitPerMinute;

    /// <summary>Creates the policy from the validated easy-login options.</summary>
    /// <param name="options">The easy-login options (<c>Authentication:EasyLogin</c>).</param>
    public JoinRateLimiterPolicy(IOptions<EasyLoginOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _permitPerMinute = options.Value.JoinPermitPerMinute;
    }

    /// <inheritdoc />
    /// <remarks><c>null</c>: the limiter's <c>RejectionStatusCode</c> (<c>429</c>, set by <c>AddPersonalLinks</c>) answers, with no body.</remarks>
    public Func<OnRejectedContext, CancellationToken, ValueTask>? OnRejected => null;

    /// <inheritdoc />
    public RateLimitPartition<string> GetPartition(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? UnknownPartition,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = _permitPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            });
    }
}
