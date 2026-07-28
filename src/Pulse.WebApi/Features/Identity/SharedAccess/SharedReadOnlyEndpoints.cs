namespace Pulse.WebApi.Features.Identity.SharedAccess;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The shared read-only slice HTTP surface + composition-root seams (story 06, COR-015 / NFR-009):
/// <c>POST /api/auth/shared</c> (shared-credential → view-only session), the slow-KDF credential hasher, the
/// read-only-session write-denial guard, and the per-IP shared-login rate-limit policy. Exposes the extension
/// methods the orchestrator wires into <c>Program.cs</c> (<see cref="AddSharedReadOnly"/> /
/// <see cref="MapSharedReadOnlyEndpoints"/>); this feature never edits <c>Program.cs</c> itself. Follows the
/// <c>Features/Identity/Staff/*</c> + <c>Features/Social/*</c> minimal-API endpoint-extension pattern; route
/// base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddSharedReadOnly()</c> — registers the login service, the
///   singleton <see cref="ISharedCredentialHasher"/>, the Scoped <see cref="IReadOnlySessionProbe"/>, and the
///   <c>shared-login</c> rate-limit policy (which accumulates alongside the existing <c>staff-login</c> /
///   <c>session-endpoints</c> policies under the single <c>app.UseRateLimiter()</c>).</description></item>
///   <item><description>Pipeline: no NEW middleware. Enforcement of the shared-login rate limit needs the
///   already-present <c>app.UseRateLimiter()</c>; the read-only write guard is an endpoint filter, not
///   middleware.</description></item>
///   <item><description>Endpoints: <c>app.MapSharedReadOnlyEndpoints()</c> for the login endpoint, AND — the
///   load-bearing part — guard the pre-existing sim-write endpoint(s) with the read-only write filter WITHOUT
///   editing the Social slice, by mapping them through a guarded group:
///   <c>app.MapGroup(string.Empty).DenyReadOnlySessions().MapSocialPostEndpoints();</c> (replacing the bare
///   <c>app.MapSocialPostEndpoints();</c>). Every current sim write is <c>POST /api/posts</c>; future E2 sim
///   writes (reply / react / follow / DM) call <see cref="ReadOnlyWriteDenialExtensions.DenyReadOnlySessions{TBuilder}"/>
///   on their own endpoints at map time.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class SharedReadOnlyEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name applied to the shared-login endpoint (NFR-009). DISTINCT from
    /// <c>staff-login</c> (story 05) and <c>session-endpoints</c> (story 03) — the internet-facing shared secret
    /// is the most brute-forceable of the three (a low-entropy human-shared password), so it gets its own tight
    /// window. The policy is registered here (DI); enforcement needs the already-wired <c>app.UseRateLimiter()</c>
    /// in the pipeline (orchestrator-owned). Full brute-force lockout is story 07.
    /// </summary>
    public const string SharedLoginRateLimitPolicy = "shared-login";

    /// <summary>
    /// Registers the shared read-only slice: the <see cref="SharedReadOnlyLoginService"/> funnel, the singleton
    /// slow-KDF <see cref="ISharedCredentialHasher"/>, the Scoped <see cref="IReadOnlySessionProbe"/> the
    /// read-only write guard consults, and the per-IP shared-login rate-limit policy. The orchestrator wires the
    /// single call into <c>Program.cs</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSharedReadOnly(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The slow-KDF hasher is stateless + thread-safe → singleton. The login funnel + the read-only probe
        // are Scoped, matching the PulseDbContext unit of work they write/read through.
        services.AddSingleton<ISharedCredentialHasher, SharedCredentialHasher>();
        services.AddScoped<SharedReadOnlyLoginService>();
        services.AddScoped<IReadOnlySessionProbe, ReadOnlySessionProbe>();

        // Per-IP fixed-window limiter on the internet-facing shared login (NFR-009). Tight (5/minute) because a
        // shared password is a low-entropy human-shared secret — the most brute-forceable of the auth endpoints.
        // Enforcement needs app.UseRateLimiter() (orchestrator-owned); full lockout is story 07.
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(SharedLoginRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 5,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        return services;
    }

    /// <summary>Maps the shared read-only login endpoint onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSharedReadOnlyEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): establishes the view-only session, so it cannot
        // require one; fails closed on its own behind the shared-login rate-limiter + brute-force lockout.
        endpoints.MapPost("/api/auth/shared", SharedLoginAsync)
            .RequireRateLimiting(SharedLoginRateLimitPolicy)
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    /// <summary>
    /// Authenticates a shared read-only login and, on success, returns the issued session token + frozen session
    /// projection. Fails closed: 400 on invalid input, 401 on a rejected credential or an unresolved host scope
    /// (never a default session).
    /// </summary>
    private static async Task<IResult> SharedLoginAsync(
        SharedReadOnlyLoginRequest? request,
        SharedReadOnlyLoginService loginService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON login body is required.");
        }

        var result = await loginService.LoginAsync(request, cancellationToken);

        return result.Outcome switch
        {
            SharedReadOnlyLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(SharedReadOnlyLoginResponseDto.From(issued)),
            SharedReadOnlyLoginOutcome.Invalid => Results.BadRequest(result.ValidationError),
            // A bad/absent/disabled/revoked credential, a wrong password, and an unresolved host scope all fail
            // closed to 401 — the response never distinguishes them (no credential-existence oracle).
            SharedReadOnlyLoginOutcome.Rejected => Results.Unauthorized(),
            SharedReadOnlyLoginOutcome.ScopeUnresolved => Results.Unauthorized(),
            // Unreachable: an Authenticated outcome always carries an issued session. Fail closed.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
