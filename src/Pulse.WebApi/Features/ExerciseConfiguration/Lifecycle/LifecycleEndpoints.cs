namespace Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The STAFF HTTP surface for the COR-032 lifecycle: <c>GET /api/staff/exercise-lifecycle</c> (the current
/// state, its allowed transitions and its behaviour hooks) and
/// <c>POST /api/staff/exercise-lifecycle/transition</c> (apply one). Mirrors the sibling
/// <c>ExerciseSettingsEndpoints</c> slice shape — thin handlers that parse, call the service, and map the
/// result to a status.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff-gated (XC-002 / COR-005), reusing the shipped gate rather than inventing one.</b> Both routes
/// carry <see cref="EngineCockpitStaffAuthorizationFilter"/>: a live STAFF session (<c>401</c> otherwise), a
/// resolved exercise scope (<c>401</c>), and an explicit <c>StaffAssignment</c> to that resolved exercise
/// (<c>403</c>). A lifecycle transition is a Director/controller action, so nothing weaker would do.
/// </para>
/// <para>
/// <b>No exercise id anywhere in the surface (COR-001, the isolation AC).</b> Neither route takes an exercise
/// from a route value, a query string or the body — the target is the server-resolved scope. There is
/// deliberately no <c>/api/staff/exercises/{id}/lifecycle</c> shape: that would be the exact cross-exercise
/// vector XC-001/XC-002 forbid. A staff caller whose resolved scope is an exercise they are not assigned to
/// gets <c>403</c> from the shared filter and nothing is written.
/// </para>
/// <para>
/// <b>Status contract:</b> <c>200</c> with the lifecycle body; <c>400</c> when <c>to</c> is missing or is not
/// a COR-032 literal; <c>401</c> with no staff session or an unresolved scope; <c>403</c> when the staff
/// caller is not assigned to the resolved exercise; <c>404</c> when the resolved scope has no exercise row;
/// <c>409</c> when the state machine refuses the transition — and in every non-200 case NOTHING is persisted.
/// </para>
/// </remarks>
public static class LifecycleEndpoints
{
    /// <summary>The lifecycle read route.</summary>
    public const string LifecycleRoute = "/api/staff/exercise-lifecycle";

    /// <summary>The transition route.</summary>
    public const string TransitionRoute = "/api/staff/exercise-lifecycle/transition";

    /// <summary>Maps the two staff lifecycle endpoints.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseLifecycleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(LifecycleRoute, GetLifecycleAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        endpoints.MapPost(TransitionRoute, TransitionAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        return endpoints;
    }

    /// <summary>
    /// Reads the resolved exercise's lifecycle state. The service parameter is marked <c>[FromServices]</c>
    /// explicitly so route building never mistakes it for a request body when the composition root is missing
    /// <c>AddExerciseLifecycle()</c>.
    /// </summary>
    private static async Task<IResult> GetLifecycleAsync(
        [FromServices] ExerciseLifecycleService lifecycleService,
        CancellationToken cancellationToken)
    {
        var result = await lifecycleService.GetAsync(cancellationToken);
        return MapResult(result);
    }

    /// <summary>Applies one COR-032 lifecycle transition to the resolved exercise.</summary>
    private static async Task<IResult> TransitionAsync(
        [FromBody] ExerciseLifecycleTransitionRequest? request,
        [FromServices] ExerciseLifecycleService lifecycleService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON body with the target lifecycle state is required.");
        }

        var result = await lifecycleService.TransitionAsync(request, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Maps a service result onto its HTTP status — fail closed, never a default/empty 200.</summary>
    private static IResult MapResult(ExerciseLifecycleResult result) => result.Outcome switch
    {
        ExerciseLifecycleOutcome.Ok => Results.Ok(ExerciseLifecycleDto.FromSnapshot(result.Snapshot!)),
        ExerciseLifecycleOutcome.Invalid => Results.BadRequest(result.Error),
        ExerciseLifecycleOutcome.TransitionNotAllowed => Results.Conflict(result.Error),
        ExerciseLifecycleOutcome.ScopeUnresolved => Results.Unauthorized(),
        ExerciseLifecycleOutcome.NotFound => Results.NotFound(),

        // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
