namespace Pulse.WebApi.Features.Injects;

using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Pulse.WebApi.Features.Media;

/// <summary>
/// The <c>inject-fire</c> rate-limit policy (NFR-009) on the three routes that publish or restart publishing —
/// <c>fire</c>, <c>retry</c> and <c>release</c> (a release can restart a held burst): a token bucket of
/// <see cref="TokenLimit"/> per STAFF USER, refilled at <see cref="TokensPerSecond"/>. A rejection is <c>429</c>
/// ProblemDetails with a readable <c>detail</c> the console shows, plus <c>Retry-After</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sized so a presenter never sees it.</b> A live demo fires scripted posts by hand, in quick runs: 30 presses back to
/// back are admitted at once, and a sustained press every second forever. That is far beyond anything a human at the
/// console does, while still capping a runaway client or script at one publish per second per account. Bursts are not
/// affected: the runner paces their posts server-side, outside any request, so only the press that starts a burst counts.
/// </para>
/// <para>
/// <b>Partitioned by the stable account, never the session, the IP or the body.</b> The key is the staff user id on the
/// principal the session middleware built from the live persisted session (the same derivation as
/// <see cref="MediaUploadRateLimiterPolicy.PartitionKeyFor"/>), so a fresh sign-in cannot reset the bucket and two
/// controllers behind the App Service proxy never share one. A non-staff caller is refused by the staff gate after this
/// anyway; an unauthenticated one never gets here (default-deny answers first) and would share one bounded bucket.
/// </para>
/// </remarks>
public sealed class InjectFireRateLimiterPolicy : IRateLimiterPolicy<string>
{
    /// <summary>The policy name the three routes require.</summary>
    public const string PolicyName = "inject-fire";

    /// <summary>The bucket size: how many fire/retry/release presses one staff user may make back to back.</summary>
    public const int TokenLimit = 30;

    /// <summary>The refill rate: one press per second, sustained, per staff user.</summary>
    public const int TokensPerSecond = 1;

    /// <summary>The readable refusal the console shows on a <c>429</c>.</summary>
    public const string RateLimitedMessage =
        "You're firing faster than the queue allows. Wait a few seconds, then try again.";

    /// <summary>The <c>Retry-After</c> used when the limiter cannot say: one refill period.</summary>
    public const int FallbackRetryAfterSeconds = 1;

    /// <inheritdoc />
    public Func<OnRejectedContext, CancellationToken, ValueTask>? OnRejected => OnRejectedAsync;

    /// <inheritdoc />
    public RateLimitPartition<string> GetPartition(HttpContext httpContext)
    {
        ArgumentNullException.ThrowIfNull(httpContext);

        return RateLimitPartition.GetTokenBucketLimiter(
            MediaUploadRateLimiterPolicy.PartitionKeyFor(httpContext),
            _ => new TokenBucketRateLimiterOptions
            {
                TokenLimit = TokenLimit,
                TokensPerPeriod = TokensPerSecond,
                ReplenishmentPeriod = TimeSpan.FromSeconds(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            });
    }

    private static async ValueTask OnRejectedAsync(OnRejectedContext context, CancellationToken cancellationToken)
    {
        var httpContext = context.HttpContext;

        var retryAfterSeconds = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))
            : FallbackRetryAfterSeconds;
        httpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString(CultureInfo.InvariantCulture);

        // The same ProblemDetails shape every other refusal on /api/injects* uses, so the console reads detail as usual.
        await Results.Problem(detail: RateLimitedMessage, statusCode: StatusCodes.Status429TooManyRequests)
            .ExecuteAsync(httpContext)
            .ConfigureAwait(false);
    }
}
