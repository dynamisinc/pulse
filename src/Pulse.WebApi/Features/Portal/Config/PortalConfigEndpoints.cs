namespace Pulse.WebApi.Features.Portal.Config;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.RoleMatrix;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// The portal config routes (exercise-portal story 03, PC-4): <c>GET /api/portal</c> (participant) and
/// <c>GET|PUT /api/portal/config</c> (staff).
/// </summary>
/// <remarks>
/// <para>
/// <b>Participant.</b> <c>GET /api/portal</c> sits behind <c>RequireChannelEnabled('portal')</c> (F08): with the channel
/// disabled a participant gets the same bare 404 as an unknown route. An unresolved scope is <c>401</c>.
/// </para>
/// <para>
/// <b>Staff.</b> On empty-prefix groups, as <c>InjectEndpoints</c>: both routes behind the shipped
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (any staff role assigned to the exercise may read), and the
/// <c>PUT</c> also behind <see cref="ExerciseRoleFilter.PlannerOrController"/> (an evaluator is <c>403</c>). Neither is
/// channel-gated: planners prepare the portal before enabling it, as with F08.
/// </para>
/// <para>
/// No route or body carries an exercise id (XC-001); the scope is the session's.
/// </para>
/// </remarks>
public static class PortalConfigEndpoints
{
    /// <summary>Maps the portal config routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPortalConfig(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/portal", GetPortalAsync).RequireChannelEnabled(ChannelVocabulary.Portal);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var plannerOrController = staff
            .MapGroup(string.Empty)
            .RequireExerciseRole(ExerciseRoleFilter.PlannerOrController);

        staff.MapGet("/api/portal/config", GetConfigAsync);
        plannerOrController.MapPut("/api/portal/config", PutConfigAsync);

        return endpoints;
    }

    private static async Task<IResult> GetPortalAsync(
        [FromServices] IExerciseContext exerciseContext,
        [FromServices] IPortalConfigService service,
        CancellationToken cancellationToken)
    {
        if (exerciseContext.CurrentExerciseId is not { } scope || scope == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        return Results.Json(await service.GetParticipantPortalAsync(cancellationToken));
    }

    private static async Task<IResult> GetConfigAsync(
        [FromServices] IPortalConfigService service,
        CancellationToken cancellationToken) =>
        Results.Json(await service.GetStaffConfigAsync(cancellationToken));

    private static async Task<IResult> PutConfigAsync(
        PortalConfigWriteRequest? request,
        [FromServices] ICurrentStaffSessionAccessor staffSession,
        [FromServices] IPortalConfigService service,
        CancellationToken cancellationToken)
    {
        var staff = await staffSession.GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is null)
        {
            return Results.Unauthorized();
        }

        if (request is null)
        {
            return Results.Problem(detail: "A config body is required.", statusCode: StatusCodes.Status400BadRequest);
        }

        var caller = new PortalStaffCaller { ActingHumanId = staff.StaffUserId.ToString() };
        var result = await service.UpdateConfigAsync(request, caller, cancellationToken);
        return result.Outcome switch
        {
            PortalWriteOutcome.Ok when result.Value is { } value => Results.Json(value),
            PortalWriteOutcome.Invalid => Results.Problem(
                detail: string.Join(" ", result.Errors),
                statusCode: StatusCodes.Status400BadRequest),
            PortalWriteOutcome.Conflict => Results.Problem(
                detail: string.Join(" ", result.Errors),
                statusCode: StatusCodes.Status409Conflict),
            PortalWriteOutcome.NotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
