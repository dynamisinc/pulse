namespace Pulse.WebApi.Features.Channels.Content.Staff;

using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Media;

/// <summary>
/// The <c>content-publish</c> rate-limit policy (NFR-009, channels-foundation story 07): ONE token bucket per staff user
/// shared by the four routes that put content in front of participants — <c>publish</c>, <c>schedule</c>, <c>revise</c>
/// and <c>retract</c>. Reads and draft edits are unlimited. Sized and partitioned exactly like
/// <see cref="InjectFireRateLimiterPolicy"/> (<see cref="TokenLimit"/> at once, <see cref="TokensPerSecond"/> sustained,
/// keyed by the stable staff user id), but its own bucket, so firing injects and publishing articles do not starve each
/// other. A rejection is <c>429</c> ProblemDetails with a readable <c>detail</c>, plus <c>Retry-After</c>.
/// </summary>
public sealed class ContentPublishRateLimiterPolicy : IRateLimiterPolicy<string>
{
    /// <summary>The policy name the four routes require.</summary>
    public const string PolicyName = "content-publish";

    /// <summary>Requests admitted back to back.</summary>
    public const int TokenLimit = InjectFireRateLimiterPolicy.TokenLimit;

    /// <summary>Tokens restored per second.</summary>
    public const int TokensPerSecond = InjectFireRateLimiterPolicy.TokensPerSecond;

    /// <summary>The readable 429 detail.</summary>
    public const string RateLimitedMessage =
        "You're publishing faster than the console allows. Wait a few seconds, then try again.";

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
            : InjectFireRateLimiterPolicy.FallbackRetryAfterSeconds;
        httpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString(CultureInfo.InvariantCulture);

        await Results.Problem(detail: RateLimitedMessage, statusCode: StatusCodes.Status429TooManyRequests)
            .ExecuteAsync(httpContext)
            .ConfigureAwait(false);
    }
}
