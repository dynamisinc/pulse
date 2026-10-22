namespace Pulse.WebApi.Features.Identity.Enrollments;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The enrollment slice's composition seam (identity-auth-roles/16, story 20). Routes:
/// <list type="bullet">
///   <item><description><c>PUT /api/staff/enrollments/{id}/lead</c> (A1) — set the exercise's lead controller (planner
///   only; bare 404 cross-exercise or cross-org; 409 <c>not-a-controller</c>).</description></item>
///   <item><description><c>GET /api/org/exercises/{exerciseId}/enrollments</c> (story 20) — the exercise's active staff
///   enrollments plus the org's not-yet-enrolled people.</description></item>
///   <item><description><c>POST /api/org/exercises/{exerciseId}/enrollments</c> <c>{personId, role}</c> (story 20) —
///   grant a staff role; 409 <c>conflicting-enrollment</c>.</description></item>
///   <item><description><c>PATCH /api/staff/enrollments/{id}</c> <c>{role}</c> and <c>DELETE /api/staff/enrollments/{id}</c>
///   (story 20) — change / remove a staff role; 409 <c>last-planner</c>, 409 <c>lead-changed-retry</c>.</description></item>
/// </list>
/// Grant / change / remove / list admit a planner on THAT exercise (their resolved scope) or an org admin (org-scope
/// session, an exercise of their own organization); the authorization is the service's, judged before any target is
/// looked up. The exercise id in the two org routes is a target selector, never scope: a planner's must equal their
/// resolved exercise and an org admin's must be in their own organization, otherwise the bare 404 (COR-001). The
/// orchestrator wires <see cref="AddEnrollments"/> and <see cref="MapEnrollmentEndpoints"/> in <c>Program.cs</c>.
/// </summary>
public static class EnrollmentEndpoints
{
    /// <summary>The lead-controller route.</summary>
    public const string LeadRoute = "/api/staff/enrollments/{id:guid}/lead";

    /// <summary>The exercise staff-list read and grant route (story 20).</summary>
    public const string ExerciseEnrollmentsRoute = "/api/org/exercises/{exerciseId:guid}/enrollments";

    /// <summary>The role-change (PATCH) and removal (DELETE) route (story 20).</summary>
    public const string EnrollmentByIdRoute = "/api/staff/enrollments/{id:guid}";

    /// <summary>
    /// The org-tier routes that take an EXERCISE id — the allow-list <c>CompositionRootWiringTests</c> pins, each driven by
    /// a foreign-tenant bare-404 test.
    /// </summary>
    public static IReadOnlySet<(string Method, string Route)> ExerciseIdRoutes { get; } =
        new HashSet<(string Method, string Route)>
        {
            ("GET", ExerciseEnrollmentsRoute),
            ("POST", ExerciseEnrollmentsRoute),
        };

    /// <summary>Registers the enrollment service.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddEnrollments(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<EnrollmentService>();

        // The OFF-only swamped-mode seam (a lead lost → swamped mode off). TryAdd on the shared autonomy registry so this
        // slice converges on the SAME singleton AddEngineReview registers, in any order (the EngineContentSeed pattern).
        services.TryAddSingleton<EngineAutonomyRegistry>();
        services.TryAddScoped<ISwampedModeSwitch, EngineSwampedModeSwitch>();

        // The grant-revoke rule also cuts revoked sessions' live hub connections (converges with AddSocialRealtimeHub).
        services.TryAddSingleton<SessionConnectionRegistry>();
        services.TryAddSingleton<ISessionConnectionRevoker, SessionConnectionRevoker>();

        return services;
    }

    /// <summary>Maps the enrollment routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapEnrollmentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPut(LeadRoute, SetLeadAsync);
        endpoints.MapGet(ExerciseEnrollmentsRoute, ListStaffAsync);
        endpoints.MapPost(ExerciseEnrollmentsRoute, GrantAsync);
        endpoints.MapPatch(EnrollmentByIdRoute, ChangeRoleAsync);
        endpoints.MapDelete(EnrollmentByIdRoute, RevokeAsync);

        return endpoints;
    }

    /// <summary>Maps a service result to its status: 200 / 400 / 401 / 403 / bare 404 / 409 with an error code.</summary>
    /// <param name="result">The service result.</param>
    /// <returns>The HTTP result.</returns>
    public static IResult ToHttpResult(EnrollmentResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return result.Outcome switch
        {
            EnrollmentOutcome.Ok when result.Enrollment is { } enrollment => Results.Ok(EnrollmentDto.From(enrollment)),
            EnrollmentOutcome.Invalid => Results.BadRequest(result.Error),
            EnrollmentOutcome.Unauthenticated => Results.Unauthorized(),
            EnrollmentOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            EnrollmentOutcome.NotFound => Results.NotFound(),
            EnrollmentOutcome.Conflict => Results.Conflict(new EnrollmentErrorDto { Error = result.Error ?? string.Empty }),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static async Task<IResult> SetLeadAsync(Guid id, EnrollmentService service, CancellationToken cancellationToken)
        => ToHttpResult(await service.SetLeadAsync(id, cancellationToken));

    private static async Task<IResult> ListStaffAsync(Guid exerciseId, EnrollmentService service, CancellationToken cancellationToken)
    {
        var result = await service.ListStaffAsync(exerciseId, cancellationToken);
        return result.Outcome switch
        {
            EnrollmentOutcome.Ok when result.List is { } list => Results.Ok(list),
            EnrollmentOutcome.Unauthenticated => Results.Unauthorized(),
            EnrollmentOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            EnrollmentOutcome.NotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static async Task<IResult> GrantAsync(
        Guid exerciseId,
        [FromBody] GrantEnrollmentRequest? request,
        EnrollmentService service,
        CancellationToken cancellationToken)
        => ToHttpResult(await service.GrantAsync(exerciseId, request?.PersonId, request?.Role, cancellationToken));

    private static async Task<IResult> ChangeRoleAsync(
        Guid id,
        [FromBody] ChangeEnrollmentRoleRequest? request,
        EnrollmentService service,
        CancellationToken cancellationToken)
        => ToHttpResult(await service.ChangeRoleAsync(id, request?.Role, cancellationToken));

    private static async Task<IResult> RevokeAsync(Guid id, EnrollmentService service, CancellationToken cancellationToken)
        => ToHttpResult(await service.RevokeAsync(id, cancellationToken));
}

/// <summary>The grant body (story 20): <c>{ "personId": "…", "role": "planner|controller|evaluator" }</c>.</summary>
public sealed class GrantEnrollmentRequest
{
    /// <summary>The person to enroll (a person of the exercise's organization); missing is a 400.</summary>
    [JsonPropertyName("personId")]
    public Guid? PersonId { get; init; }

    /// <summary>The staff role; anything but planner / controller / evaluator is a 400.</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }
}

/// <summary>The role-change body (story 20): <c>{ "role": "planner|controller|evaluator" }</c>.</summary>
public sealed class ChangeEnrollmentRoleRequest
{
    /// <summary>The new staff role; anything but planner / controller / evaluator is a 400.</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }
}

/// <summary>The planner Staff tab's read (story 20). Staff world only (XC-002) — never on a participant surface.</summary>
public sealed class StaffEnrollmentListDto
{
    /// <summary>The exercise.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The exercise's ACTIVE staff enrollments, planners first, then controllers, then evaluators (by name).</summary>
    [JsonPropertyName("enrollments")]
    public required IReadOnlyList<StaffEnrollmentDto> Enrollments { get; init; }

    /// <summary>The organization's people with no active enrollment (any role) in the exercise, by name — the grant candidates.</summary>
    [JsonPropertyName("candidates")]
    public required IReadOnlyList<StaffCandidateDto> Candidates { get; init; }
}

/// <summary>One active staff enrollment in the Staff tab.</summary>
public sealed class StaffEnrollmentDto
{
    /// <summary>The enrollment id (the PATCH / DELETE / lead route value).</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The enrolled person.</summary>
    [JsonPropertyName("personId")]
    public required string PersonId { get; init; }

    /// <summary>The person's display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The person's email, or <c>null</c> for a legacy person with none.</summary>
    [JsonPropertyName("email")]
    public required string? Email { get; init; }

    /// <summary>The staff role: planner, controller or evaluator.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>Whether this is the exercise's lead controller.</summary>
    [JsonPropertyName("isLead")]
    public required bool IsLead { get; init; }
}

/// <summary>A person of the organization who may be granted a staff role in the exercise.</summary>
public sealed class StaffCandidateDto
{
    /// <summary>The person (the grant body's <c>personId</c>).</summary>
    [JsonPropertyName("personId")]
    public required string PersonId { get; init; }

    /// <summary>The person's display name.</summary>
    [JsonPropertyName("displayName")]
    public required string DisplayName { get; init; }

    /// <summary>The person's email, or <c>null</c> for a legacy person with none.</summary>
    [JsonPropertyName("email")]
    public required string? Email { get; init; }
}

/// <summary>The staff-world projection of an enrollment (identity-auth-roles/16). Never on a participant surface.</summary>
public sealed class EnrollmentDto
{
    /// <summary>The enrollment id.</summary>
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    /// <summary>The exercise.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The enrolled person, or <c>null</c> for a one-off participant.</summary>
    [JsonPropertyName("personId")]
    public required string? PersonId { get; init; }

    /// <summary>The role.</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }

    /// <summary>Whether this is the exercise's lead controller.</summary>
    [JsonPropertyName("isLead")]
    public required bool IsLead { get; init; }

    /// <summary>Projects an enrollment.</summary>
    /// <param name="enrollment">The enrollment.</param>
    /// <returns>The DTO.</returns>
    public static EnrollmentDto From(Enrollment enrollment)
    {
        ArgumentNullException.ThrowIfNull(enrollment);

        return new EnrollmentDto
        {
            Id = enrollment.Id.ToString(),
            ExerciseId = enrollment.ExerciseId.ToString(),
            PersonId = enrollment.PersonId?.ToString(),
            Role = enrollment.Role,
            IsLead = enrollment.IsLead,
        };
    }
}

/// <summary>The 409 body: a machine-readable error code (e.g. <c>conflicting-enrollment</c>, <c>not-a-controller</c>).</summary>
public sealed class EnrollmentErrorDto
{
    /// <summary>The error code.</summary>
    [JsonPropertyName("error")]
    public required string Error { get; init; }
}
