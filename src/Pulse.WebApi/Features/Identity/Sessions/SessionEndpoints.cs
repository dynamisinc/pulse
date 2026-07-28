namespace Pulse.WebApi.Features.Identity.Sessions;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// The session slice HTTP surface + composition-root seams (story 03, the hinge): <c>GET /api/session</c>,
/// <c>POST /api/auth/refresh</c>, <c>POST /api/auth/logout</c>, the opaque-bearer auth scheme services, and the
/// request-scope session middleware. Exposes the extension methods the orchestrator wires into <c>Program.cs</c>
/// (<see cref="AddSessions"/> / <see cref="MapSessionEndpoints"/> / <see cref="UseSessionAuthentication"/>);
/// this feature never edits <c>Program.cs</c> itself. Follows the <c>Features/Social/*</c> minimal-API
/// endpoint-extension pattern; route base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring + ordering (orchestrator-owned, documented for the serial edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddStaffIdentity(builder.Configuration)</c> THEN
///   <c>builder.Services.AddSessions(builder.Configuration)</c> — <see cref="AddSessions"/> <c>Replace</c>s
///   story 05's fail-closed <c>NullCurrentStaffSessionAccessor</c> with the real
///   <see cref="CurrentStaffSessionAccessor"/> (order-independent, but this is the intended order that finally
///   unblocks story 05's endpoints).</description></item>
///   <item><description>Pipeline: <c>app.UseExerciseResolution()</c> (exercise-isolation/08) MUST run BEFORE
///   <c>app.UseSessionAuthentication()</c> so the session's scope write takes precedence over the host's
///   provisional one, then <c>app.UseRateLimiter()</c>, then the endpoint maps.</description></item>
///   <item><description>Endpoints: <c>app.MapSessionEndpoints()</c> AND (now unblocked)
///   <c>app.MapStaffAuthEndpoints()</c>.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class SessionEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name applied to the session/refresh/logout endpoints (NFR-004 / NFR-009).
    /// The policy is registered here (DI); enforcement needs <c>app.UseRateLimiter()</c> in the pipeline
    /// (orchestrator-owned — see the required ordering in this type's remarks).
    /// </summary>
    public const string SessionRateLimitPolicy = "session-endpoints";

    /// <summary>
    /// Registers the session slice: the <see cref="ISessionIssuer"/> implementation, the <see cref="SessionService"/>
    /// endpoint funnel, the throwaway-scope <see cref="ISessionAuthenticator"/>, the bound
    /// <see cref="SessionOptions"/>, the real <see cref="ICurrentStaffSessionAccessor"/> (replacing story 05's
    /// fail-closed default), <see cref="IHttpContextAccessor"/>, and the per-IP rate-limit policy. The
    /// orchestrator wires the single call into <c>Program.cs</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Configuration — the session lifetimes bind from <see cref="SessionOptions.SectionName"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSessions(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<SessionOptions>(configuration.GetSection(SessionOptions.SectionName));

        // The frozen issuance seam every login method (02/05/06) mints a session through.
        services.AddScoped<ISessionIssuer, SessionIssuer>();

        // The endpoint funnel behind /api/session, /api/auth/refresh, /api/auth/logout.
        services.AddScoped<SessionService>();

        // The stateless, throwaway-scope live-session resolver the request-scope middleware uses (singleton,
        // like HostExerciseResolver).
        services.AddSingleton<ISessionAuthenticator, SessionAuthenticator>();

        // The staff accessor + the /api/session token extractor need the current request.
        services.AddHttpContextAccessor();

        // The real staff-session accessor WINS over story 05's fail-closed NullCurrentStaffSessionAccessor.
        // Replace is order-independent: it removes any prior registration (the TryAdd'd Null) and adds the real
        // one, so a live staff session finally resolves the staff endpoints (which stay fail-closed for a
        // participant / read-only / absent session — XC-002).
        services.Replace(ServiceDescriptor.Scoped<ICurrentStaffSessionAccessor, CurrentStaffSessionAccessor>());

        // Per-IP fixed-window limiter on the session endpoints (NFR-009). Generous (60/min) because these
        // require an EXISTING valid token/refresh token (not credential guessing — that lockout is the login
        // stories' concern). Enforcement needs app.UseRateLimiter() (orchestrator-owned).
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(SessionRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        return services;
    }

    /// <summary>
    /// Adds the request-scope session middleware (<see cref="SessionAuthenticationMiddleware"/>) to the
    /// pipeline. MUST run AFTER <c>UseExerciseResolution()</c> so the session's scope write takes precedence
    /// over the host's (the precedence model: session &gt; host &gt; unset) — see this type's remarks.
    /// </summary>
    /// <param name="app">The application pipeline builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IApplicationBuilder UseSessionAuthentication(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseMiddleware<SessionAuthenticationMiddleware>();
    }

    /// <summary>Maps the three session endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSessionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/session", GetSessionAsync)
            .RequireRateLimiting(SessionRateLimitPolicy);
        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): self-gating — the REFRESH token, read from the
        // request body, IS the credential, and the expired access token by definition no longer authenticates.
        endpoints.MapPost("/api/auth/refresh", RefreshAsync)
            .RequireRateLimiting(SessionRateLimitPolicy)
            .AllowAnonymousPreAuth();

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): deliberately a no-op 204 with no session. A
        // client whose token already expired must still be able to complete logout idempotently — 401-ing it
        // would strand the SPA on a dead session with no clean way to clear local state. It invalidates
        // nothing when there is nothing to invalidate and discloses nothing either way. GET /api/session
        // above stays gated.
        endpoints.MapPost("/api/auth/logout", LogoutAsync)
            .RequireRateLimiting(SessionRateLimitPolicy)
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    /// <summary>
    /// Returns the frozen <see cref="SessionDto"/> for the one bound session, or 401 for an absent/expired/revoked
    /// session (never a default/stale session — fail closed).
    /// </summary>
    private static async Task<IResult> GetSessionAsync(
        HttpContext context,
        SessionService sessionService,
        CancellationToken cancellationToken)
    {
        var rawToken = SessionTokenExtractor.TryGetBearerToken(context.Request, out var token) ? token : null;
        var result = await sessionService.GetCurrentAsync(rawToken, cancellationToken);

        return result.Outcome == SessionQueryOutcome.Live
            ? Results.Ok(SessionDto.FromSession(result.Session!))
            : Results.Unauthorized();
    }

    /// <summary>
    /// Renews a short-lived session from its refresh token, returning the rotated tokens + frozen session
    /// projection; 401 when the refresh token is absent/unknown/revoked/lapsed (fail closed → full re-auth).
    /// </summary>
    private static async Task<IResult> RefreshAsync(
        RefreshRequest? request,
        SessionService sessionService,
        CancellationToken cancellationToken)
    {
        var result = await sessionService.RefreshAsync(request?.RefreshToken, cancellationToken);

        return result.Outcome == RefreshOutcome.Refreshed
            ? Results.Ok(SessionRefreshResponseDto.From(result))
            : Results.Unauthorized();
    }

    /// <summary>
    /// Invalidates the current session server-side (so a stolen reference cannot be replayed). Always returns
    /// 204 — idempotent, and never reveals whether the presented token was valid.
    /// </summary>
    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        SessionService sessionService,
        CancellationToken cancellationToken)
    {
        var rawToken = SessionTokenExtractor.TryGetBearerToken(context.Request, out var token) ? token : null;
        await sessionService.LogoutAsync(rawToken, cancellationToken);

        return Results.NoContent();
    }
}
