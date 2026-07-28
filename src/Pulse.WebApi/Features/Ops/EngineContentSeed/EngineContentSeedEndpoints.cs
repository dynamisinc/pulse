namespace Pulse.WebApi.Features.Ops.EngineContentSeed;

using System.Threading;
using System.Threading.RateLimiting;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// The ops-only engine-content-seed slice HTTP surface + composition-root seams (feature engine-content-seed,
/// story 03): the secret-gated, idempotent, re-callable <c>POST /api/ops/seed-engine-content</c> endpoint that
/// activates content generation for an already-bootstrapped exercise. Exposes the extension methods the
/// orchestrator wires into <c>Program.cs</c> (<see cref="AddEngineContentSeed"/> / <see cref="MapEngineContentSeedEndpoints"/>);
/// this feature never edits <c>Program.cs</c> itself. A SIBLING of the bootstrap endpoint (not an extension of
/// it): bootstrap creates exercise IDENTITY (once, per hostname); this activates content GENERATION
/// (re-callable, e.g. after a host restart empties the in-memory registry) — different blast radius, different
/// lifecycle, same <c>Features/Ops/*</c> family.
/// </summary>
/// <remarks>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, documented for the serial edit):</b>
/// <list type="number">
///   <item><description>DI: <c>builder.Services.AddEngineContentSeed(builder.Configuration)</c> — placed
///   AFTER <c>AddReactionLoopHost()</c> / <c>AddEngineReview()</c> (it depends on
///   <see cref="IReactionLoopRegistry"/> being registered; it is tolerant of DI order for
///   <see cref="EngineAutonomyRegistry"/> / <see cref="IReactionLoopRegistry"/> via <c>TryAdd</c>).</description></item>
///   <item><description>Pipeline: NO new middleware and NO ordering constraint (same as
///   <c>MapBootstrapEndpoints</c>) — the header secret is the only gate; the rate limit uses the already-wired
///   <c>app.UseRateLimiter()</c>.</description></item>
///   <item><description>Endpoints: <c>app.MapEngineContentSeedEndpoints()</c> — alongside
///   <c>MapBootstrapEndpoints()</c> / <c>MapEngineRuntime()</c> / <c>MapEngineReview()</c>.</description></item>
/// </list>
/// </para>
/// <para>
/// <b>Secret reuse (user decision 2026-07-24).</b> Gates on the REUSED <c>Authentication:Bootstrap:Secret</c>
/// (<see cref="BootstrapOptions"/>) presented via the same <c>X-Bootstrap-Secret</c> header — no new secret,
/// no bicep/workflow change. <see cref="AddEngineContentSeed"/> binds that section itself (idempotent — same
/// values) so the slice is self-contained regardless of whether <c>AddOpsBootstrap</c> ran first.
/// </para>
/// </remarks>
public static class EngineContentSeedEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name applied to the seed endpoint (NFR-009). Defense-in-depth against a
    /// leaked/guessed secret being brute-forced, even though the endpoint is secret-gated. Mirrors the
    /// <c>ops-bootstrap</c> policy; enforcement needs the already-wired <c>app.UseRateLimiter()</c>.
    /// </summary>
    public const string EngineSeedRateLimitPolicy = "ops-engine-seed";

    /// <summary>
    /// Registers the engine-content-seed slice: the bound <see cref="BootstrapOptions"/> (the reused secret),
    /// the <see cref="PersonaCastSeeder"/> + <see cref="EngineContentSeedService"/> (Scoped, matching the
    /// <see cref="Pulse.WebApi.Data.PulseDbContext"/> unit of work), the shared
    /// <see cref="EngineAutonomyRegistry"/> + <see cref="IReactionLoopRegistry"/> + <see cref="System.TimeProvider"/>
    /// (via <c>TryAdd</c> so the slice is self-contained regardless of wave ordering; when
    /// <c>AddReactionLoopHost</c>/<c>AddEngineReview</c> ran first, those registrations win — the same shared
    /// singleton the host + cockpit use), and the per-IP seed rate-limit policy.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Configuration — the reused bootstrap secret binds from <see cref="BootstrapOptions.SectionName"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddEngineContentSeed(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // Reuse the bootstrap secret (user decision). Binding the same section twice is idempotent (same
        // values), so the slice works whether or not AddOpsBootstrap was wired first.
        services.Configure<BootstrapOptions>(configuration.GetSection(BootstrapOptions.SectionName));

        // Shared singletons: present when AddReactionLoopHost/AddEngineReview ran first (the intended order);
        // TryAdd keeps this slice self-contained and, critically, converges on the SAME EngineAutonomyRegistry
        // + IReactionLoopRegistry the host and cockpit use (the shared-instance correctness point).
        services.TryAddSingleton(System.TimeProvider.System);
        services.TryAddSingleton<EngineAutonomyRegistry>();
        services.TryAddSingleton<IReactionLoopRegistry, ReactionLoopRegistry>();

        // Scoped to match the PulseDbContext unit of work the persona writes + the single audit event commit
        // through together.
        services.AddScoped<PersonaCastSeeder>();
        services.AddScoped<EngineContentSeedService>();

        // Per-IP fixed-window limiter (NFR-009). A rare ops action, so a modest window is ample; this only
        // ADDS a named policy to the shared limiter (AddRateLimiter is additive across features).
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(EngineSeedRateLimitPolicy, httpContext =>
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

    /// <summary>Maps the seed endpoint onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapEngineContentSeedEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): the X-Bootstrap-Secret IS this endpoint's
        // credential and the default-deny AuthorizationMiddleware runs BEFORE the handler's secret check —
        // without this mark the gate would 401 a legitimate secret-bearing seed call (which carries no
        // session) and break the go-live runbook. The secret gate itself is unchanged.
        endpoints.MapPost("/api/ops/seed-engine-content", SeedAsync)
            .RequireRateLimiting(EngineSeedRateLimitPolicy)
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    /// <summary>
    /// Runs the guarded seed. Fails closed: a missing/wrong secret returns <c>404</c> (never confirming the
    /// endpoint's existence to an unauthorized caller); an unknown hostname returns <c>404</c> (without creating
    /// an exercise); an invalid body returns <c>400</c>; success returns <c>200</c> with the ops response.
    /// </summary>
    private static async Task<IResult> SeedAsync(
        EngineContentSeedRequest? request,
        [FromHeader(Name = BootstrapEndpoints.BootstrapSecretHeaderName)] string? bootstrapSecret,
        EngineContentSeedService service,
        CancellationToken cancellationToken)
    {
        var result = await service.SeedAsync(request, bootstrapSecret, cancellationToken);

        return result.Outcome switch
        {
            EngineContentSeedOutcome.Provisioned => Results.Ok(EngineContentSeedResponseDto.From(result)),
            EngineContentSeedOutcome.Invalid => Results.BadRequest(result.Error),
            // 404 (not 401/403): an unauthorized caller must not even learn this endpoint exists.
            EngineContentSeedOutcome.Rejected => Results.NotFound(),
            // 404: a valid caller naming a host with no exercise — never create one here.
            EngineContentSeedOutcome.HostNotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
