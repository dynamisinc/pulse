namespace Pulse.WebApi.Features.ExerciseConfiguration.Readiness;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.RoleMatrix;

/// <summary>
/// <c>GET /api/staff/readiness</c> — the go-live readiness checklist (exercise-build-golive/03). Mapped from
/// <c>MapExerciseLifecycleEndpoints()</c>, so it needs no <c>Program.cs</c> line.
/// </summary>
/// <remarks>
/// <para>
/// <b>Gate.</b> The same <see cref="EngineCockpitStaffAuthorizationFilter"/> as the sibling lifecycle read (a live
/// staff session and a resolved scope, else <c>401</c>; assigned to that exercise, else <c>403</c>), then
/// <see cref="ReadinessRoleFilter"/>, which admits exactly planner, controller and evaluator (§8.2 "read everything in
/// the exercise"). Participant, view-only, anonymous and org-scope sessions are refused.
/// </para>
/// <para>
/// <b>No exercise id in the route (COR-001).</b> The checklist is the session's exercise, so a foreign exercise is
/// unreachable by construction.
/// </para>
/// </remarks>
public static class ReadinessEndpoints
{
    /// <summary>The readiness read route.</summary>
    public const string ReadinessRoute = "/api/staff/readiness";

    /// <summary>Maps the readiness read.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapReadinessEndpoint(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(ReadinessRoute, GetReadinessAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<ReadinessRoleFilter>();

        return endpoints;
    }

    /// <summary>Reads the resolved exercise's checklist. The service is <c>[FromServices]</c> explicitly.</summary>
    private static async Task<IResult> GetReadinessAsync(
        [FromServices] ExerciseReadinessService readinessService,
        CancellationToken cancellationToken)
    {
        var result = await readinessService.GetAsync(cancellationToken);
        return result.Outcome switch
        {
            ExerciseReadinessOutcome.Ok => Results.Ok(ExerciseReadinessDto.FromReport(result.Report!)),
            ExerciseReadinessOutcome.ScopeUnresolved => Results.Unauthorized(),
            ExerciseReadinessOutcome.NotFound => Results.NotFound(),

            // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}

/// <summary>
/// The readiness role gate: the caller's live enrollment on the resolved exercise must be planner, controller or
/// evaluator (<see cref="EnrollmentRoles.StaffRoles"/>). Built on the role matrix's <see cref="ExerciseCallerRole"/>,
/// so the refusal statuses are the matrix's (<c>401</c> no staff session or no scope, <c>403</c> otherwise).
/// </summary>
public sealed class ReadinessRoleFilter : IEndpointFilter
{
    /// <inheritdoc />
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var caller = await ExerciseCallerRole.ResolveAsync(context.HttpContext);
        if (!caller.Holds(EnrollmentRoles.StaffRoles))
        {
            return caller.Refusal();
        }

        return await next(context);
    }
}
