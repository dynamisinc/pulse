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
/// idempotent <c>POST /api/ops/bootstrap-exercise</c> seed endpoint, plus story identity-auth-roles/10's secret-gated
/// <c>POST /api/ops/bind-participant-persona</c> (persona binding for an already-provisioned account). Exposes
/// the extension methods the orchestrator wires into <c>Program.cs</c> (<see cref="AddOpsBootstrap"/> /
/// <see cref="MapBootstrapEndpoints"/>); this feature never edits <c>Program.cs</c> itself. Follows the
/// <c>Features/Identity/Staff/*</c> minimal-API endpoint-extension pattern; route base <c>/api</c>, namespaced
/// <c>/api/ops/*</c> to read distinctly from <c>/api/staff/*</c>.
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
/// <para>
/// <b>Story identity-auth-roles/10 adds NO new composition-root line, deliberately.</b> The persona-binding endpoint is mapped
/// INSIDE the existing <see cref="MapBootstrapEndpoints"/> and its services are registered INSIDE the existing
/// <see cref="AddOpsBootstrap"/> (the option <c>login/implementation.md</c>'s integration seam explicitly
/// prefers). So the already-wired <c>Program.cs</c> calls light it up with zero further edits — structurally
/// removing the "merged green but never wired, dead at 404" failure mode that hit story 05 itself (PR #310 →
/// fix #317). <c>Features/Ops/Bootstrap/CompositionRootWiringTests</c> asserts BOTH routes are mapped exactly
/// once on the REAL host, not just on a self-mapped <c>TestServer</c>.
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

    /// <summary>
    /// The per-IP rate-limit policy name applied to the persona-binding endpoint (story identity-auth-roles/10, NFR-009). Its
    /// OWN policy (not the bootstrap one) so neither ops endpoint can exhaust the other's window; enforcement
    /// needs the already-wired <c>app.UseRateLimiter()</c>.
    /// </summary>
    public const string BindParticipantPersonaRateLimitPolicy = "ops-bind-persona";

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

        // Scoped to match the PulseDbContext unit of work they write through. Story identity-auth-roles/10 adds the shared,
        // exercise-confined persona resolver (COR-001) + the persona-binding service HERE rather than behind a new
        // Add* call, so no further Program.cs wiring is required.
        services.AddScoped<BootstrapService>();
        services.AddScoped<OpsPersonaResolver>();
        services.AddScoped<ParticipantPersonaBindingService>();

        // Per-IP fixed-window limiters (NFR-009). Both are rare ops actions, so a modest window is ample; this
        // only ADDS named policies to the shared limiter (AddRateLimiter is additive across features).
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
            options.AddPolicy(BindParticipantPersonaRateLimitPolicy, httpContext =>
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

    /// <summary>Maps the bootstrap + persona-binding endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapBootstrapEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost("/api/ops/bootstrap-exercise", BootstrapAsync)
            .RequireRateLimiting(BootstrapRateLimitPolicy);

        // Story identity-auth-roles/10 — mapped in the EXISTING extension so the already-wired Program.cs call reaches it with
        // no new composition-root edit (see the class remarks).
        endpoints.MapPost("/api/ops/bind-participant-persona", BindParticipantPersonaAsync)
            .RequireRateLimiting(BindParticipantPersonaRateLimitPolicy);

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

    /// <summary>
    /// Binds (or rebinds) a persona to an already-provisioned participant account (story identity-auth-roles/10). Fails closed:
    /// a missing/wrong secret returns <c>404</c>; an unknown hostname, account handle, or persona (including a
    /// persona belonging to ANOTHER exercise — COR-001) likewise returns <c>404</c> without writing anything; an
    /// invalid body returns <c>400</c>; success returns <c>200</c> with the ops response (an idempotent rebind to
    /// the same persona is a <c>200</c> with <c>changed: false</c>).
    /// </summary>
    private static async Task<IResult> BindParticipantPersonaAsync(
        BindParticipantPersonaRequest? request,
        [FromHeader(Name = BootstrapSecretHeaderName)] string? bootstrapSecret,
        ParticipantPersonaBindingService service,
        CancellationToken cancellationToken)
    {
        var result = await service.BindPersonaAsync(request, bootstrapSecret, cancellationToken);

        return result.Outcome switch
        {
            ParticipantPersonaBindingOutcome.Bound => Results.Ok(BindParticipantPersonaResponseDto.From(result)),
            ParticipantPersonaBindingOutcome.Invalid => Results.BadRequest(result.Error),
            // 404 (not 401/403): an unauthorized caller must not even learn this endpoint exists.
            ParticipantPersonaBindingOutcome.Rejected => Results.NotFound(),
            // 404: a valid caller naming a host/account/persona that does not exist in the target exercise. The
            // persona case is deliberately identical for a cross-exercise persona — no existence hint, no binding.
            ParticipantPersonaBindingOutcome.HostNotFound => Results.NotFound(),
            ParticipantPersonaBindingOutcome.AccountNotFound => Results.NotFound(),
            ParticipantPersonaBindingOutcome.PersonaNotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
