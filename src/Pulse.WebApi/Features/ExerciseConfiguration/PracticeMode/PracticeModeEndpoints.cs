namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The staff HTTP surface for the COR-033 practice/sandbox flag: <c>GET /api/staff/practice-mode</c> and
/// <c>PUT /api/staff/practice-mode</c>. Mirrors the sibling <c>ExerciseSettingsEndpoints</c> minimal-API shape
/// — thin handlers that parse, call the service, and map the result to a status; route base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff-gated (XC-002/COR-005), reusing the shipped gate rather than inventing one.</b> Both routes carry
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> — the same endpoint filter the settings surface uses,
/// requiring a live STAFF session (401), a resolved exercise scope (401), and an explicit
/// <c>StaffAssignment</c> to that resolved exercise (403). Practice state is staff-world only and appears on
/// no participant surface (XC-002).
/// </para>
/// <para>
/// <b>No exercise id anywhere in the surface.</b> Neither route takes an exercise from a route value, a query
/// string or the body — the target is the server-resolved scope (COR-001). A
/// <c>/api/staff/exercises/{id}/practice-mode</c> shape would be exactly the cross-exercise vector XC-001/002
/// forbid.
/// </para>
/// <para>
/// This surface exists ONLY to set and read the flag. It is not a lifecycle control and not an export: the
/// flag's one consumer is <see cref="IEvaluationEligibility"/>, which E10's export filtering reads.
/// </para>
/// </remarks>
public static class PracticeModeEndpoints
{
    /// <summary>The route both verbs share.</summary>
    public const string PracticeModeRoute = "/api/staff/practice-mode";

    /// <summary>
    /// Maps the two staff practice-mode endpoints. Status contract, both routes: <c>200</c> with the
    /// practice-mode body; <c>400</c> with a reason on a write missing <c>isPracticeMode</c> (nothing
    /// persisted); <c>401</c> with no staff session or an unresolved scope (fail closed); <c>403</c> when the
    /// staff caller is not assigned to the resolved exercise; <c>404</c> when the resolved scope has no
    /// exercise row.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    internal static IEndpointRouteBuilder MapPracticeModeStaffEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(PracticeModeRoute, GetPracticeModeAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        endpoints.MapPut(PracticeModeRoute, UpdatePracticeModeAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        return endpoints;
    }

    /// <summary>
    /// Reads the resolved exercise's practice/sandbox state. The service parameter is marked
    /// <c>[FromServices]</c> explicitly so route building never mistakes it for a request body when the
    /// composition root is missing <c>AddPracticeMode()</c>.
    /// </summary>
    private static async Task<IResult> GetPracticeModeAsync(
        [FromServices] PracticeModeService practiceModeService,
        CancellationToken cancellationToken)
    {
        var result = await practiceModeService.GetAsync(cancellationToken);
        return MapResult(result);
    }

    /// <summary>Sets or clears the resolved exercise's practice/sandbox flag.</summary>
    private static async Task<IResult> UpdatePracticeModeAsync(
        [FromBody] UpdatePracticeModeRequest? request,
        [FromServices] PracticeModeService practiceModeService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON body with isPracticeMode is required.");
        }

        var result = await practiceModeService.UpdateAsync(request, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Maps a service result onto its HTTP status — fail closed, never a default/empty 200.</summary>
    private static IResult MapResult(PracticeModeResult result) => result.Outcome switch
    {
        PracticeModeOutcome.Ok => Results.Ok(result.State),
        PracticeModeOutcome.Invalid => Results.BadRequest(result.ValidationError),
        PracticeModeOutcome.ScopeUnresolved => Results.Unauthorized(),
        PracticeModeOutcome.NotFound => Results.NotFound(),

        // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
