namespace Pulse.WebApi.Features.ExerciseConfiguration;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The staff HTTP surface for the COR-030 per-exercise settings: <c>GET /api/staff/exercise-settings</c> and
/// <c>PUT /api/staff/exercise-settings</c>. Mirrors the <c>Features/Social/FeedEndpoints.cs</c> minimal-API
/// slice shape — thin handlers that parse, call the service, and map the result to a status; route base
/// <c>/api</c>. The orchestrator wires the single <see cref="ExerciseConfigurationExtensions.MapExerciseConfigurationEndpoints"/>
/// call into <c>Program.cs</c>; this feature never edits it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff-gated (XC-002/COR-005), reusing the shipped gate rather than inventing one.</b> Both routes carry
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> — the existing endpoint filter that requires a live
/// STAFF session (401 otherwise), a resolved exercise scope (401), and an explicit
/// <c>StaffAssignment</c> to that resolved exercise (403). Its name is engine-historical; its behaviour is
/// exactly the staff-session gate every <c>/api/staff/...</c> endpoint in this feature needs, and reusing the
/// one implementation means a future hardening of the gate covers this surface too. It has no constructor
/// dependencies, but it resolves <c>StaffAssignmentService</c> + <c>ICurrentStaffSessionAccessor</c> per
/// request, so the host must have B2's <c>AddStaffIdentity()</c> wired (it does, ahead of this feature).
/// </para>
/// <para>
/// <b>No exercise id anywhere in the surface.</b> Neither route takes an exercise from a route value, a query
/// string or the body — the target is the server-resolved scope (COR-001). That is why there is no
/// <c>/api/staff/exercises/{id}/settings</c> shape here: it would be the exact cross-exercise vector
/// XC-001/XC-002 forbid.
/// </para>
/// </remarks>
public static class ExerciseSettingsEndpoints
{
    /// <summary>The route both verbs share.</summary>
    public const string SettingsRoute = "/api/staff/exercise-settings";

    /// <summary>
    /// Maps the two staff settings endpoints. Status contract, both routes: <c>200</c> with the settings body;
    /// <c>400</c> with a reason on an invalid write (nothing persisted); <c>401</c> with no staff session or
    /// an unresolved scope (fail closed); <c>403</c> when the staff caller is not assigned to the resolved
    /// exercise; <c>404</c> when the resolved scope has no exercise row.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseSettingsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(SettingsRoute, GetSettingsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        endpoints.MapPut(SettingsRoute, UpdateSettingsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        return endpoints;
    }

    /// <summary>
    /// Reads the resolved exercise's COR-030 settings for the staff editor. The service parameter is marked
    /// <c>[FromServices]</c> explicitly so route building never mistakes it for a request body when the
    /// composition root is missing <c>AddExerciseConfiguration()</c>.
    /// </summary>
    private static async Task<IResult> GetSettingsAsync(
        [FromServices] ExerciseSettingsService settingsService,
        CancellationToken cancellationToken)
    {
        var result = await settingsService.GetAsync(cancellationToken);
        return MapResult(result);
    }

    /// <summary>Replaces the resolved exercise's COR-030 settings block.</summary>
    private static async Task<IResult> UpdateSettingsAsync(
        [FromBody] UpdateExerciseSettingsRequest? request,
        [FromServices] ExerciseSettingsService settingsService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON settings body is required.");
        }

        var result = await settingsService.UpdateAsync(request, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Maps a service result onto its HTTP status — fail closed, never a default/empty 200.</summary>
    private static IResult MapResult(ExerciseSettingsResult result) => result.Outcome switch
    {
        ExerciseSettingsOutcome.Ok => Results.Ok(result.Settings),
        ExerciseSettingsOutcome.Invalid => Results.BadRequest(result.ValidationError),
        ExerciseSettingsOutcome.ScopeUnresolved => Results.Unauthorized(),
        ExerciseSettingsOutcome.NotFound => Results.NotFound(),

        // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
