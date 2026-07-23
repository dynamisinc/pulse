namespace Pulse.WebApi.Features.Ops.Bootstrap;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// The ops-only bootstrap slice HTTP surface + composition-root seams (story login/05): the secret-gated,
/// idempotent <c>POST /api/ops/bootstrap-exercise</c> seed endpoint. Exposes the extension methods the
/// orchestrator wires into <c>Program.cs</c> (<see cref="AddOpsBootstrap"/> / <see cref="MapBootstrapEndpoints"/>);
/// this feature never edits <c>Program.cs</c> itself. Follows the <c>Features/Identity/Staff/*</c> minimal-API
/// endpoint-extension pattern; route base <c>/api</c>, namespaced <c>/api/ops/*</c> to read distinctly from
/// <c>/api/staff/*</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddOpsBootstrap(builder.Configuration)</c> — binds
///   <see cref="BootstrapOptions"/> and registers the <see cref="BootstrapService"/> + the <c>ops-bootstrap</c>
///   rate-limit policy (which accumulates alongside the existing login policies under the single
///   <c>app.UseRateLimiter()</c>). It <c>TryAdd</c>s the shared hashers + the staff-allowlist options binding so
///   the slice is self-contained regardless of wave ordering.</description></item>
///   <item><description>Pipeline: NO new middleware and NO ordering constraint. This endpoint needs neither
///   exercise-scope nor session middleware — the header secret is the ONLY gate by design (no session can exist
///   yet in an empty database). Enforcement of the rate limit uses the already-wired
///   <c>app.UseRateLimiter()</c>.</description></item>
///   <item><description>Endpoints: <c>app.MapBootstrapEndpoints()</c>.</description></item>
/// </list>
/// </para>
/// </remarks>
public static class BootstrapEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name applied to the bootstrap endpoint (NFR-009). Defense-in-depth against a
    /// leaked/guessed secret being brute-forced, even though the endpoint is secret-gated. Enforcement needs the
    /// already-wired <c>app.UseRateLimiter()</c> (orchestrator-owned).
    /// </summary>
    public const string BootstrapRateLimitPolicy = "ops-bootstrap";

    /// <summary>The header the caller presents the configured bootstrap secret in.</summary>
    public const string BootstrapSecretHeaderName = "X-Bootstrap-Secret";

    /// <summary>
    /// Registers the ops bootstrap slice: the bound <see cref="BootstrapOptions"/>, the
    /// <see cref="BootstrapService"/>, the reused hashers + staff-allowlist options binding (via <c>TryAdd</c> so
    /// they never conflict with the identity slices' registrations), and the per-IP bootstrap rate-limit policy.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Configuration — the secret binds from <see cref="BootstrapOptions.SectionName"/>; the staff allowlist from <see cref="DynamisIdentityProviderOptions.SectionName"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddOpsBootstrap(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<BootstrapOptions>(configuration.GetSection(BootstrapOptions.SectionName));

        // The bootstrap resolves an allowlisted staff identity's external subject from the SAME options the staff
        // login binds. Bind it here too so the slice is self-contained if wired before AddStaffIdentity (binding
        // the same section twice is idempotent — same values).
        services.Configure<DynamisIdentityProviderOptions>(
            configuration.GetSection(DynamisIdentityProviderOptions.SectionName));

        // Reused hashers (stateless, thread-safe singletons in their owning slices). TryAdd so if AddSharedReadOnly
        // / AddParticipantAccounts already registered them, those registrations win; otherwise this slice supplies
        // them so it works standalone.
        services.TryAddSingleton<ISharedCredentialHasher, SharedCredentialHasher>();
        services.TryAddSingleton<ParticipantPasswordHasher>();

        // Scoped to match the PulseDbContext unit of work it writes through.
        services.AddScoped<BootstrapService>();

        // Per-IP fixed-window limiter (NFR-009). Bootstrap is a rare ops action, so a modest window is ample; this
        // only ADDS a named policy to the shared limiter (AddRateLimiter is additive across features).
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(BootstrapRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        return services;
    }

    /// <summary>Maps the bootstrap endpoint onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost("/api/ops/bootstrap-exercise", BootstrapAsync)
            .RequireRateLimiting(BootstrapRateLimitPolicy);

        return endpoints;
    }

    /// <summary>
    /// Runs the guarded bootstrap. Fails closed: a missing/wrong secret returns <c>404</c> (never confirming the
    /// endpoint's existence to an unauthorized caller); an invalid body returns <c>400</c>; success returns
    /// <c>200</c> with the ops response (the one-time shared password, when created).
    /// </summary>
    private static async Task<IResult> BootstrapAsync(
        BootstrapExerciseRequest? request,
        [FromHeader(Name = BootstrapSecretHeaderName)] string? bootstrapSecret,
        BootstrapService service,
        CancellationToken cancellationToken)
    {
        var result = await service.BootstrapAsync(request, bootstrapSecret, cancellationToken);

        return result.Outcome switch
        {
            BootstrapOutcome.Provisioned => Results.Ok(BootstrapExerciseResponseDto.From(result)),
            BootstrapOutcome.Invalid => Results.BadRequest(result.Error),
            // 404 (not 401/403): an unauthorized caller must not even learn this endpoint exists.
            BootstrapOutcome.Rejected => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
