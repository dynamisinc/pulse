namespace Pulse.WebApi.Features.ExerciseConfiguration.Chrome;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The staff HTTP surface for the COR-031 compliance-chrome configuration:
/// <c>GET /api/staff/chrome-settings</c> and <c>PUT /api/staff/chrome-settings</c>. Mirrors story 01b's
/// <see cref="ExerciseSettingsEndpoints"/> slice shape — thin handlers that parse, call the service, and map
/// the result to a status; route base <c>/api</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff-gated (XC-002/COR-005), reusing the shipped gate rather than inventing one.</b> Both routes carry
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> — the same endpoint filter the settings endpoints use,
/// which requires a live STAFF session (401 otherwise), a resolved exercise scope (401), and an explicit
/// <c>StaffAssignment</c> to that resolved exercise (403). Its name is engine-historical; its behaviour is
/// exactly the staff-session gate every <c>/api/staff/...</c> endpoint in this feature needs.
/// </para>
/// <para>
/// <b>No exercise id anywhere in the surface.</b> Neither route takes an exercise from a route value, a query
/// string or the body — the target is the server-resolved scope (COR-001). A cross-exercise chrome read or
/// write is therefore structurally impossible: it is refused by the gate (403) rather than parameterised.
/// </para>
/// <para>
/// <b>This is the STAFF shape, not the participant one.</b> Participants read chrome from the FROZEN
/// <c>GET /api/chrome-config</c> body, which this story fills through <see cref="ChromeConfigProjection"/> and
/// never reshapes. Nothing here changes that route or its DTO.
/// </para>
/// </remarks>
public static class ChromeSettingsEndpoints
{
    /// <summary>The route both verbs share.</summary>
    public const string ChromeSettingsRoute = "/api/staff/chrome-settings";

    /// <summary>
    /// Maps the two staff chrome endpoints. Status contract, both routes: <c>200</c> with the chrome block;
    /// <c>400</c> with a reason on an invalid write — including the NFR-008 both-off attempt — with nothing
    /// persisted; <c>401</c> with no staff session or an unresolved scope (fail closed); <c>403</c> when the
    /// staff caller is not assigned to the resolved exercise; <c>404</c> when the resolved scope has no
    /// exercise row.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapChromeSettingsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(ChromeSettingsRoute, GetChromeSettingsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        endpoints.MapPut(ChromeSettingsRoute, UpdateChromeSettingsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        return endpoints;
    }

    /// <summary>
    /// Reads the resolved exercise's compliance-chrome config for the staff editor. The service parameter is
    /// marked <c>[FromServices]</c> explicitly so route building never mistakes it for a request body when the
    /// composition root is missing <c>AddComplianceChromeConfig()</c>.
    /// </summary>
    private static async Task<IResult> GetChromeSettingsAsync(
        [FromServices] ChromeSettingsService chromeSettingsService,
        CancellationToken cancellationToken)
    {
        var result = await chromeSettingsService.GetAsync(cancellationToken);
        return MapResult(result);
    }

    /// <summary>Replaces the resolved exercise's compliance-chrome block (NFR-008 guarded).</summary>
    private static async Task<IResult> UpdateChromeSettingsAsync(
        [FromBody] UpdateChromeSettingsRequest? request,
        [FromServices] ChromeSettingsService chromeSettingsService,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON compliance-chrome body is required.");
        }

        var result = await chromeSettingsService.UpdateAsync(request, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Maps a service result onto its HTTP status — fail closed, never a default/empty 200.</summary>
    private static IResult MapResult(ChromeSettingsResult result) => result.Outcome switch
    {
        ChromeSettingsOutcome.Ok => Results.Ok(result.Settings),
        ChromeSettingsOutcome.Invalid => Results.BadRequest(result.ValidationError),
        ChromeSettingsOutcome.ScopeUnresolved => Results.Unauthorized(),
        ChromeSettingsOutcome.NotFound => Results.NotFound(),

        // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
