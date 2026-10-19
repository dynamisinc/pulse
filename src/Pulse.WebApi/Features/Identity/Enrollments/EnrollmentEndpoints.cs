namespace Pulse.WebApi.Features.Identity.Enrollments;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The enrollment slice's composition seam (identity-auth-roles/16). A1 maps one route:
/// <c>PUT /api/staff/enrollments/{id}/lead</c> — set the exercise's lead controller (planner or org admin; bare 404
/// cross-exercise or cross-org; 409 <c>not-a-controller</c>). The orchestrator wires <see cref="AddEnrollments"/> and
/// <see cref="MapEnrollmentEndpoints"/> in <c>Program.cs</c>.
/// </summary>
public static class EnrollmentEndpoints
{
    /// <summary>The lead-controller route.</summary>
    public const string LeadRoute = "/api/staff/enrollments/{id:guid}/lead";

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
