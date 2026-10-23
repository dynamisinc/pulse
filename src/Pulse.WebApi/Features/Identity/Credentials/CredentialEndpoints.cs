namespace Pulse.WebApi.Features.Identity.Credentials;

using System.Collections.Generic;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using System.Threading.RateLimiting;
using Microsoft.Extensions.Configuration;
using Pulse.WebApi.Features.Identity.RateLimits;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The credential slice's composition (identity-auth-roles/21): <see cref="AddCredentials"/> registers its services and
/// <see cref="MapCredentialEndpoints"/> maps its two routes. Program.cs calls each once (orchestrator-owned).
/// </summary>
/// <remarks>
/// <para>
/// <b><c>POST /api/auth/password/reset</c> — PRE-AUTH</b> (on <see cref="PreAuthAllowlist"/>): the person has no session
/// to present. Behind its OWN per-IP fixed-window limiter, <see cref="PasswordResetRateLimitPolicy"/> (NFR-009; its own
/// partition, so reset attempts and sign-in attempts do not spend each other's budget), and the login body limit;
/// <c>Cache-Control: no-store</c>.
/// <c>204</c> on success; <c>400 {"error":"invalid-token"}</c> for any bad / expired / used token (uniform);
/// <c>400 {"error":"&lt;policy-code&gt;"}</c> for a <see cref="PasswordPolicy"/> refusal.
/// </para>
/// <para>
/// <b><c>POST /api/org/people/{personId}/password-reset</c> — org admin only</b>
/// (<see cref="OrgAdminAuthorizationFilter.OrgAdminOnly"/>), tenant-bound in the service: <c>200 {"resetUrl":"…"}</c>
/// once; the bare <c>404</c> for a missing or another customer's person; <c>409 {"error":"target-is-org-admin"}</c> for a
/// PEER org admin (self-reset allowed); <c>409 {"error":"person-disabled"}</c>;
/// <c>503 {"error":"reset-link-unavailable"}</c> without a frontend base URL. <c>Cache-Control: no-store</c> on every
/// answer, including the filter's 401/403. It is the org tier's one PERSON-id route, allow-listed in
/// <see cref="PersonIdRoutes"/>.
/// </para>
/// <para>
/// <b>Pipeline dependencies</b> (already in Program.cs): <c>app.UseRateLimiter()</c> enforces the policy this slice
/// registers; <c>AddExerciseLifecycleAdmin</c> registers
/// <see cref="StaffCallerContext"/>; <c>AddEasyLoginFoundation</c> registers <see cref="JoinUrlBuilder"/> (each is also
/// TryAdd-ed here so the slice composes on its own); <c>app.UseOrganizationResolution()</c> must precede the routes,
/// as for every <c>/api/org/*</c> route.
/// </para>
/// </remarks>
public static class CredentialEndpoints
{
    /// <summary>The pre-auth "set a password from a link" route.</summary>
    public const string ResetRoute = "/api/auth/password/reset";

    /// <summary>
    /// The reset route's own per-IP rate-limit policy. Its permit count is the staff-login one
    /// (<c>Authentication:RateLimits:StaffLoginPerMinute</c>, default 10 a minute) — the same internet-facing pre-auth
    /// class — but a separate partition (adversarial review S4 on #665).
    /// </summary>
    public const string PasswordResetRateLimitPolicy = "password-reset";

    /// <summary>The org admin's staff reset route.</summary>
    public const string AdminResetRoute = "/api/org/people/{personId:guid}/password-reset";

    /// <summary>
    /// The org-tier routes that take a PERSON id — the allow-list <c>CompositionRootWiringTests</c> pins, each driven by a
    /// foreign-tenant bare-404 test.
    /// </summary>
    public static IReadOnlySet<(string Method, string Route)> PersonIdRoutes { get; } =
        new HashSet<(string Method, string Route)> { ("POST", AdminResetRoute) };

    /// <summary>Registers the credential services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddCredentials(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);

        // Its own per-IP partition (S4); AddRateLimiter accumulates option callbacks, so this adds one named policy
        // beside the others and needs no Program.cs change (app.UseRateLimiter() is already in the pipeline).
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(PasswordResetRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = AuthRateLimits.StaffLoginPerMinute(
                            httpContext.RequestServices.GetRequiredService<IConfiguration>()),
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        services.AddScoped<CredentialTokenService>();
        services.AddScoped<PasswordResetService>();
        services.AddScoped<AdminPasswordResetService>();

        // Email is OFF until ACS is deployed: the no-op mailer is the default; a configured host replaces it.
        services.TryAddSingleton<IPulseMailer, NullPulseMailer>();

        // Converge with the slices that already register these (TryAdd: same singletons / scoped services, any order).
        services.TryAddSingleton<JoinUrlBuilder>();
        services.TryAddScoped<StaffCallerContext>();
        services.TryAddSingleton<SessionConnectionRegistry>();
        services.TryAddSingleton<ISessionConnectionRevoker, SessionConnectionRevoker>();

        return services;
    }

    /// <summary>Maps the two credential routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapCredentialEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // no-store first, so it is on every answer (the filters run outermost-first).
        endpoints.MapPost(ResetRoute, ResetAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .RequireRateLimiting(PasswordResetRateLimitPolicy)
            .WithLoginBodyLimit()
            .AllowAnonymousPreAuth();

        endpoints.MapPost(AdminResetRoute, AdminResetAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        return endpoints;
    }

    private static async Task<IResult> ResetAsync(
        [FromBody] PasswordResetRequest? request,
        [FromServices] PasswordResetService service,
        CancellationToken cancellationToken)
    {
        var result = await service.ResetAsync(request, cancellationToken);

        return result.Outcome switch
        {
            PasswordResetOutcome.Ok => Results.NoContent(),
            PasswordResetOutcome.Invalid => Results.BadRequest(new CredentialErrorDto { Error = result.Error ?? PasswordResetService.InvalidTokenError }),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static async Task<IResult> AdminResetAsync(
        Guid personId,
        [FromServices] AdminPasswordResetService service,
        CancellationToken cancellationToken)
    {
        var result = await service.IssueAsync(personId, cancellationToken);

        return result.Outcome switch
        {
            AdminPasswordResetOutcome.Ok when result.ResetUrl is { } resetUrl => Results.Ok(new PasswordResetLinkDto { ResetUrl = resetUrl }),
            AdminPasswordResetOutcome.Unauthenticated => Results.Unauthorized(),
            AdminPasswordResetOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            AdminPasswordResetOutcome.NotFound => Results.NotFound(),
            AdminPasswordResetOutcome.Conflict => Results.Conflict(new CredentialErrorDto { Error = result.Error ?? string.Empty }),
            AdminPasswordResetOutcome.Unavailable => Results.Json(
                new CredentialErrorDto { Error = result.Error ?? AdminPasswordResetService.LinkUnavailableError },
                statusCode: StatusCodes.Status503ServiceUnavailable),

            // Unreachable: an Ok outcome always carries a link. Fail closed rather than 200 an empty body.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}

/// <summary>
/// The body of <c>POST /api/auth/password/reset</c>. Nullable members, so a missing field is the uniform
/// <c>invalid-token</c> / a policy <c>400</c>, never a deserialization failure. <see cref="ToString"/> withholds both.
/// </summary>
public sealed class PasswordResetRequest
{
    /// <summary>The raw single-use token (from the link's fragment).</summary>
    [JsonPropertyName("token")]
    public string? Token { get; init; }

    /// <summary>The new password, exactly as typed.</summary>
    [JsonPropertyName("newPassword")]
    public string? NewPassword { get; init; }

    /// <inheritdoc />
    public override string ToString() => "PasswordResetRequest (contents withheld: a token and a password)";
}

/// <summary>The admin reset's one-time answer: the link to hand to the person.</summary>
public sealed class PasswordResetLinkDto
{
    /// <summary>The single-use reset link (<c>{FrontendBaseUrl}/staff/reset#token=…</c>).</summary>
    [JsonPropertyName("resetUrl")]
    public required string ResetUrl { get; init; }
}

/// <summary>The error body of the credential routes.</summary>
public sealed class CredentialErrorDto
{
    /// <summary>The error code.</summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }
}
