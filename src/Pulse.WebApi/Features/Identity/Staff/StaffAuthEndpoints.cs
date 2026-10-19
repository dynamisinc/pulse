namespace Pulse.WebApi.Features.Identity.Staff;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.RateLimits;
using Pulse.WebApi.Features.Identity.RoleMatrix;

/// <summary>
/// The staff-identity slice HTTP surface (story 05): <c>POST /api/auth/staff/login</c>,
/// <c>GET /api/staff/assignments</c>, and <c>POST /api/staff/active-exercise</c>. Exposes the composition-root
/// extension methods the orchestrator wires into <c>Program.cs</c> (<see cref="AddStaffIdentity"/> /
/// <see cref="MapStaffAuthEndpoints"/>); this feature never edits <c>Program.cs</c> itself. Follows the
/// <c>Features/Social/*</c> minimal-API endpoint-extension pattern; route base <c>/api</c>.
/// </summary>
public static class StaffAuthEndpoints
{
    /// <summary>
    /// The per-IP rate-limit policy name applied to the staff login endpoint (NFR-009). The policy is
    /// registered here (DI); the orchestrator must add the <c>UseRateLimiter()</c> middleware to the pipeline
    /// for enforcement — see the <c>Program.cs</c> ordering note in this feature's implementation.md.
    /// </summary>
    public const string StaffLoginRateLimitPolicy = "staff-login";

    /// <summary>The org-choice route (identity-auth-roles/15) — pre-auth, allowlisted.</summary>
    public const string ChooseRoute = "/api/auth/staff/login/choose";

    /// <summary>
    /// Registers the staff-identity slice: the provider-agnostic <see cref="IIdentityProvider"/> (Phase-1
    /// <see cref="DynamisIdentityProvider"/>) and its bound options, the login + assignment services, the
    /// fail-closed default <see cref="ICurrentStaffSessionAccessor"/>, and the per-IP staff-login rate-limit
    /// policy. The orchestrator wires the single call into <c>Program.cs</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">Configuration — the Phase-1 allowlist binds from <see cref="DynamisIdentityProviderOptions.SectionName"/>.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddStaffIdentity(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<DynamisIdentityProviderOptions>(
            configuration.GetSection(DynamisIdentityProviderOptions.SectionName));

        // The seam: a future Entra/AD/SSO/Cadence-federation provider replaces this concrete registration with
        // no call-site change (login depends on IIdentityProvider, never DynamisIdentityProvider).
        //
        // identity-auth-roles/16 (ADMIN-IDENTITY-MODEL §1.3): the Pulse password provider is the default, chained in
        // front of the Dynamis allowlist (registered concretely as its fallback) for the A1→A2 interim.
        services.AddScoped<DynamisIdentityProvider>();
        services.AddScoped<IIdentityProvider, PulsePasswordIdentityProvider>();

        // #602 M-2 / M-5: the counted slow-hash seam, ONE per request, shared by the Pulse password provider and both login
        // funnels so every attempt pads to a fixed PBKDF2 count. The hasher is the default PBKDF2 PasswordHasher — the
        // format every stored Person.PasswordHash is written in.
        services.TryAddSingleton<IPasswordHasher<Person>>(_ => new PasswordHasher<Person>());
        services.AddScoped<StaffPasswordVerifier>();

        services.AddScoped<StaffLoginService>();

        // identity-auth-roles/15: the org sign-in ({orgSlug?, email, password}) and the org choice.
        services.AddScoped<OrgStaffLoginService>();
        services.AddScoped<StaffAssignmentService>();

        // Fail-closed default until story 03 (Wave 2) provides the real, auth-scheme-backed accessor. TryAdd
        // so story 03's registration (wired later by the orchestrator) takes precedence.
        services.TryAddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();

        // Per-IP fixed-window limiter on the internet-facing staff login (NFR-009). Enforcement needs
        // app.UseRateLimiter() in the pipeline (orchestrator-owned) — documented in implementation.md.
        AuthRateLimitsStartupCheck.Register(services);
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(StaffLoginRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        // Configurable (Authentication:RateLimits:StaffLoginPerMinute); default 10 — see AuthRateLimits.
                        PermitLimit = AuthRateLimits.StaffLoginPerMinute(
                            httpContext.RequestServices.GetRequiredService<IConfiguration>()),
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                    }));
        });

        return services;
    }

    /// <summary>Maps the three staff-auth endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapStaffAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): establishes the staff session, so it cannot
        // require one; anti-enumeration 401/403s behind the staff-login rate-limiter. The two staff endpoints
        // below stay gated (they already fail closed via ICurrentStaffSessionAccessor, unchanged).
        //
        // identity-auth-roles/15: both sign-in routes answer Cache-Control: no-store (the 200s carry session tokens or a
        // choice token), and the org choice shares the login's per-IP limiter and body limit.
        endpoints.MapPost("/api/auth/staff/login", StaffLoginAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .RequireRateLimiting(StaffLoginRateLimitPolicy)
            .WithLoginBodyLimit()
            .AllowAnonymousPreAuth();
        endpoints.MapPost(ChooseRoute, StaffLoginChooseAsync)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .RequireRateLimiting(StaffLoginRateLimitPolicy)
            .WithLoginBodyLimit()
            .AllowAnonymousPreAuth();
        endpoints.MapGet("/api/staff/assignments", GetAssignmentsAsync);
        // identity-auth-roles/17: staff-world sessions only (evaluators and org admins included), refused before the
        // body is validated for a participant or read-only session.
        endpoints.MapPost("/api/staff/active-exercise", SetActiveExerciseAsync)
            .AddEndpointFilter<StaffWorldSessionFilter>();

        return endpoints;
    }

    /// <summary>
    /// Authenticates a staff login and, on success, returns the issued session token + frozen session
    /// projection. Fails closed: 400 on invalid input, 401 on rejected credentials (never a default session),
    /// 403 when authenticated but not assigned to the requested exercise.
    /// </summary>
    private static async Task<IResult> StaffLoginAsync(
        StaffLoginRequest? request,
        StaffLoginService loginService,
        OrgStaffLoginService orgLoginService,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON login body is required.");
        }

        // identity-auth-roles/15: a body naming no exercise but an email / password / slug is the ORG sign-in. Every
        // other body takes the exercise-bound path below, unchanged.
        if (OrgStaffLoginService.IsOrgShape(request))
        {
            var orgResult = await orgLoginService.LoginAsync(
                request, httpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken);
            return ToResult(orgResult);
        }

        var result = await loginService.LoginAsync(request, cancellationToken);

        return result.Outcome switch
        {
            StaffLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(StaffLoginResponseDto.From(issued, result.IsLead)),
            StaffLoginOutcome.Invalid => Results.BadRequest(result.ValidationError),
            StaffLoginOutcome.Rejected => Results.Unauthorized(),
            StaffLoginOutcome.NotAssigned => Results.StatusCode(StatusCodes.Status403Forbidden),
            // Unreachable: an Authenticated outcome always carries an issued session. Fail closed.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Redeems an org choice (identity-auth-roles/15). 400 on a malformed body; the uniform empty 401 on every refusal.
    /// </summary>
    private static async Task<IResult> StaffLoginChooseAsync(
        StaffLoginChooseRequest? request,
        OrgStaffLoginService orgLoginService,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON choice body is required.");
        }

        // #602 L-3: the same (forwarded-headers resolved) remote address the choice's IP hash was created from.
        return ToResult(await orgLoginService.ChooseAsync(
            request, httpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken));
    }

    private static IResult ToResult(OrgStaffLoginResult result) => result.Outcome switch
    {
        OrgStaffLoginOutcome.Authenticated when result.Issued is { } issued =>
            Results.Ok(StaffLoginResponseDto.From(issued, result.IsLead)),
        OrgStaffLoginOutcome.ChoiceRequired when result.Choice is { } choice => Results.Ok(choice),
        OrgStaffLoginOutcome.Invalid => Results.BadRequest(result.ValidationError),
        OrgStaffLoginOutcome.Rejected => Results.Unauthorized(),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>
    /// Returns the authenticated staff user's own assignments across exercises (staff-only). Fails closed with
    /// 401 when there is no authenticated staff session.
    /// </summary>
    private static async Task<IResult> GetAssignmentsAsync(
        StaffAssignmentService assignmentService,
        CancellationToken cancellationToken)
    {
        var assignments = await assignmentService.GetAssignmentsAsync(cancellationToken);
        return assignments is null ? Results.Unauthorized() : Results.Ok(assignments);
    }

    /// <summary>
    /// Sets the staff session's active exercise. Fails closed: 400 on invalid input, 401 when unauthenticated,
    /// the bare 404 for a missing or foreign-organization target (and, from org scope, an unenrolled one), and 403
    /// when an exercise-bound caller is not assigned to a same-organization exercise.
    /// </summary>
    private static async Task<IResult> SetActiveExerciseAsync(
        SetActiveExerciseRequest? request,
        StaffAssignmentService assignmentService,
        CancellationToken cancellationToken)
    {
        if (request is null || !Guid.TryParse(request.ExerciseId, out var exerciseId))
        {
            return Results.BadRequest("exerciseId must be a GUID.");
        }

        var result = await assignmentService.SetActiveExerciseAsync(exerciseId, cancellationToken);

        return result.Outcome switch
        {
            SetActiveExerciseOutcome.Ok => Results.Ok(result.Active),
            SetActiveExerciseOutcome.Invalid => Results.BadRequest(result.ValidationError),
            SetActiveExerciseOutcome.Unauthenticated => Results.Unauthorized(),
            SetActiveExerciseOutcome.NotAssigned => Results.StatusCode(StatusCodes.Status403Forbidden),
            // identity-auth-roles/16: the bare 404 (no body) for an org-scope caller's foreign or missing target.
            SetActiveExerciseOutcome.NotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}

/// <summary>
/// The <c>POST /api/staff/active-exercise</c> request body. The <see cref="ExerciseId"/> is nullable so a
/// missing field is a validation concern (a 400). Scope comes ONLY from the caller's session + assignments —
/// this body selects among the caller's OWN assignments, it does not grant access.
/// </summary>
public sealed class SetActiveExerciseRequest
{
    /// <summary>The exercise to make active — must be a GUID in the caller's assignment set.</summary>
    public string? ExerciseId { get; init; }
}
