namespace Pulse.WebApi.Features.Identity.Staff;

using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;

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
        services.AddScoped<IIdentityProvider, DynamisIdentityProvider>();

        services.AddScoped<StaffLoginService>();
        services.AddScoped<StaffAssignmentService>();

        // Fail-closed default until story 03 (Wave 2) provides the real, auth-scheme-backed accessor. TryAdd
        // so story 03's registration (wired later by the orchestrator) takes precedence.
        services.TryAddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();

        // Per-IP fixed-window limiter on the internet-facing staff login (NFR-009). Enforcement needs
        // app.UseRateLimiter() in the pipeline (orchestrator-owned) — documented in implementation.md.
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(StaffLoginRateLimitPolicy, httpContext =>
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

    /// <summary>Maps the three staff-auth endpoints onto the given route builder.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapStaffAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // PRE-AUTH (identity-auth-roles/11, PreAuthAllowlist): establishes the staff session, so it cannot
        // require one; anti-enumeration 401/403s behind the staff-login rate-limiter. The two staff endpoints
        // below stay gated (they already fail closed via ICurrentStaffSessionAccessor, unchanged).
        endpoints.MapPost("/api/auth/staff/login", StaffLoginAsync)
            .RequireRateLimiting(StaffLoginRateLimitPolicy)
            .AllowAnonymousPreAuth();
        endpoints.MapGet("/api/staff/assignments", GetAssignmentsAsync);
        endpoints.MapPost("/api/staff/active-exercise", SetActiveExerciseAsync);

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
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON login body is required.");
        }

        var result = await loginService.LoginAsync(request, cancellationToken);

        return result.Outcome switch
        {
            StaffLoginOutcome.Authenticated when result.Issued is { } issued =>
                Results.Ok(StaffLoginResponseDto.From(issued)),
            StaffLoginOutcome.Invalid => Results.BadRequest(result.ValidationError),
            StaffLoginOutcome.Rejected => Results.Unauthorized(),
            StaffLoginOutcome.NotAssigned => Results.StatusCode(StatusCodes.Status403Forbidden),
            // Unreachable: an Authenticated outcome always carries an issued session. Fail closed.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

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
    /// 403 when the caller is not assigned to the requested exercise.
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
