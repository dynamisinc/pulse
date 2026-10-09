namespace Pulse.WebApi.Features.Media;

using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The <c>media-upload</c> rate-limit policy (NFR-009): a fixed one-minute window of
/// <c>Media:Upload:PermitPerMinute</c> uploads (default 30) per ACCOUNT, answering 429 with <c>Retry-After</c> and
/// <c>{"error":"rate-limited"}</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Partitioned by the stable account, never the session or the IP.</b> The key is the authenticated principal's
/// <c>StaffUserId</c> for a staff session, otherwise its <c>PrincipalId</c> — which for a participant session IS the
/// <c>Account</c> id (identity-auth-roles/13). Keying on the session id would let a fresh sign-in reset the quota;
/// keying on the IP would collapse every user behind the App Service proxy into one bucket. The identity is read
/// from <c>HttpContext.User</c>, which the session middleware populated before <c>UseRateLimiter()</c> runs.
/// </para>
/// <para>
/// An unauthenticated request never reaches here (the default-deny gate 401s it first); should one, it shares one
/// bounded <c>anonymous</c> bucket rather than being unlimited.
/// </para>
/// </remarks>
public sealed class MediaUploadRateLimiterPolicy : IRateLimiterPolicy<string>
{
    /// <summary>The <c>Retry-After</c> value used when the limiter cannot say (the window length).</summary>
    public const int FallbackRetryAfterSeconds = 60;

    private readonly MediaUploadOptions _options;

    /// <summary>Creates the policy.</summary>
    /// <param name="options">The upload options (<c>PermitPerMinute</c>).</param>
    public MediaUploadRateLimiterPolicy(IOptions<MediaUploadOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
    }

    /// <inheritdoc />
    public Func<OnRejectedContext, CancellationToken, ValueTask>? OnRejected => OnRejectedAsync;

    /// <summary>The partition key for a request — the stable account id, prefixed by its kind.</summary>
    /// <param name="httpContext">The request.</param>
    /// <returns>The partition key.</returns>
    public static string PartitionKeyFor(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        var identity = SessionPrincipal.Read(httpContext.User);
        if (identity is null)
        {
            return "anonymous";
        }

        return identity.StaffUserId is { } staffUserId
            ? $"staff:{staffUserId:D}"
            : $"{identity.Kind}:{identity.PrincipalId}";
    }

    /// <inheritdoc />
    public RateLimitPartition<string> GetPartition(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        var permits = Math.Max(1, _options.PermitPerMinute);
        return RateLimitPartition.GetFixedWindowLimiter(
            PartitionKeyFor(httpContext),
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permits,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            });
    }

    private static async ValueTask OnRejectedAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var response = context.HttpContext.Response;
        response.StatusCode = StatusCodes.Status429TooManyRequests;

        var retryAfterSeconds = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))
            : FallbackRetryAfterSeconds;
        response.Headers.RetryAfter = retryAfterSeconds.ToString(CultureInfo.InvariantCulture);

        await response.WriteAsJsonAsync(new MediaErrorDto("rate-limited"), cancellationToken).ConfigureAwait(false);
    }
}
