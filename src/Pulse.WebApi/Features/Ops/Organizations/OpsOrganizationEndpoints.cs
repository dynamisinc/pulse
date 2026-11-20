namespace Pulse.WebApi.Features.Ops.Organizations;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// The ops organization slice's composition (#575b): <see cref="AddOpsOrganizations"/> registers its service and
/// <see cref="MapOpsOrganizationEndpoints"/> maps <c>POST /api/ops/organizations</c>. Program.cs calls each once.
/// </summary>
/// <remarks>
/// <b><c>POST /api/ops/organizations</c> — PRE-AUTH</b> (on <see cref="PreAuthAllowlist"/>, exactly like
/// <c>/api/ops/bootstrap-exercise</c>): the <c>X-Bootstrap-Secret</c> header IS the credential, and Dynamis has no session
/// in a customer tenant to present. Behind its own per-IP limiter (<see cref="RateLimitPolicy"/>) and
/// <c>Cache-Control: no-store</c> (a 201 carries a bearer invite link).
/// <c>201</c> <see cref="CreatedOrganizationDto"/>; the bare <c>404</c> for a wrong or unconfigured secret (checked before
/// the body is VALIDATED — but, as for <c>/api/ops/bootstrap-exercise</c>, a body the framework cannot bind at all, such as
/// malformed JSON or a wrong content type, is the framework's 400/415 before the handler runs); <c>400 {"error":…}</c>; <c>409 {"error":"organization-exists"}</c>;
/// <c>503 {"error":"invite-link-unavailable"}</c> without a frontend base URL.
/// <para>
/// <b><c>POST /api/ops/organizations/{slug}/admin-invite {adminEmail}</c> — PRE-AUTH</b> (#847), the same gate, limiter
/// and no-store: re-issues the named org admin's invite (an expired or undelivered one), voiding the earlier one.
/// <c>200</c> <see cref="ReissuedAdminInviteDto"/> (<c>inviteUrl</c> only while no mailer is configured, CR-001); the bare
/// <c>404</c> for a wrong secret, an unknown slug or an email that is not an org admin of that organization;
/// <c>400 invalid-admin-email</c>; <c>409 already-active | person-disabled</c>; <c>503 invite-link-unavailable</c>.
/// </para>
/// </remarks>
public static class OpsOrganizationEndpoints
{
    /// <summary>The provisioning route.</summary>
    public const string Route = "/api/ops/organizations";

    /// <summary>The first-admin invite re-issue route (#847); the organization is addressed by its slug.</summary>
    public const string AdminInviteRoute = "/api/ops/organizations/{slug}/admin-invite";

    /// <summary>The routes' own per-IP rate-limit policy (10 a minute, shared by both — a rare ops action).</summary>
    public const string RateLimitPolicy = "ops-organizations";

    /// <summary>Registers the provisioning service.</summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">The app configuration (the bootstrap secret section).</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddOpsOrganizations(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // The same secret section AddOpsBootstrap binds (binding it twice is idempotent — same values).
        services.Configure<BootstrapOptions>(configuration.GetSection(BootstrapOptions.SectionName));

        services.AddScoped<OpsOrganizationService>();

        // Converge with the slices that already register these (TryAdd: same singletons / scoped services, any order).
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<CredentialTokenService>();
        services.TryAddSingleton<IPulseMailer, NullPulseMailer>();
        services.TryAddSingleton<JoinUrlBuilder>();

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(RateLimitPolicy, httpContext =>
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

    /// <summary>Maps the provisioning route.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapOpsOrganizationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // no-store first, so it is on every answer (the filters run outermost-first).
        endpoints.MapPost(Route, CreateAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .RequireRateLimiting(RateLimitPolicy)
            .AllowAnonymousPreAuth();

        // #847: the same secret gate, limiter, no-store and pre-auth allowlisting as the provisioning route.
        endpoints.MapPost(AdminInviteRoute, ReissueAdminInviteAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .RequireRateLimiting(RateLimitPolicy)
            .AllowAnonymousPreAuth();

        return endpoints;
    }

    private static async Task<IResult> ReissueAdminInviteAsync(
        string slug,
        [FromBody] ReissueAdminInviteRequest? request,
        [FromHeader(Name = BootstrapEndpoints.BootstrapSecretHeaderName)] string? bootstrapSecret,
        [FromServices] OpsOrganizationService service,
        CancellationToken cancellationToken)
    {
        var result = await service.ReissueAdminInviteAsync(slug, request, bootstrapSecret, cancellationToken);

        return result.Outcome switch
        {
            OpsOrganizationOutcome.Reissued when result.AdminInvite is { } invite => Results.Ok(invite),
            OpsOrganizationOutcome.Invalid => Results.BadRequest(new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty }),

            // One bare 404 for a wrong secret, an unknown slug and an unknown admin: nothing is disclosed either way.
            OpsOrganizationOutcome.Rejected or OpsOrganizationOutcome.NotFound => Results.NotFound(),
            OpsOrganizationOutcome.Conflict => Results.Conflict(new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty }),
            OpsOrganizationOutcome.Unavailable => Results.Json(
                new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty },
                statusCode: StatusCodes.Status503ServiceUnavailable),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static async Task<IResult> CreateAsync(
        [FromBody] CreateOrganizationRequest? request,
        [FromHeader(Name = BootstrapEndpoints.BootstrapSecretHeaderName)] string? bootstrapSecret,
        [FromServices] OpsOrganizationService service,
        CancellationToken cancellationToken)
    {
        var result = await service.CreateAsync(request, bootstrapSecret, cancellationToken);

        return result.Outcome switch
        {
            OpsOrganizationOutcome.Created when result.Organization is { } organization =>
                Results.Json(organization, statusCode: StatusCodes.Status201Created),
            OpsOrganizationOutcome.Invalid => Results.BadRequest(new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty }),

            // 404 (not 401/403): an unauthorized caller must not even learn this endpoint exists.
            OpsOrganizationOutcome.Rejected => Results.NotFound(),
            OpsOrganizationOutcome.Conflict => Results.Conflict(new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty }),
            OpsOrganizationOutcome.Unavailable => Results.Json(
                new OpsOrganizationErrorDto { Error = result.Error ?? string.Empty },
                statusCode: StatusCodes.Status503ServiceUnavailable),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
