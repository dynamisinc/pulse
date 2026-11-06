namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The outlet registry API (channels-foundation story 03, FC-4) on <c>/api/outlets*</c>: the participant registry reads
/// and the staff writes, reorder and "add default outlets".
/// </summary>
/// <remarks>
/// <para>
/// <b>Composition.</b> Services are registered by <c>AddChannels()</c>; these routes are mapped by
/// <c>MapChannels()</c> (<see cref="ChannelsEndpointRouteBuilderExtensions"/>), which <c>Program.cs</c> calls once. A
/// composition-root test on the real <c>Program</c> guards both.
/// </para>
/// <para>
/// <b>Participant reads (no staff gate).</b> <c>GET /api/outlets?channel=</c> and <c>GET /api/outlets/{slug}</c>.
/// Scope comes ONLY from the server-resolved <c>IExerciseContext</c> (no exercise id in any URL or body); an unresolved
/// scope is <c>401</c>. A disabled, soft-deleted, other-exercise or unknown outlet, and a missing, unknown or disabled
/// channel, all answer the ONE identical <c>404</c> ProblemDetails (XC-001).
/// </para>
/// <para>
/// <b>Staff routes.</b> On empty-prefix groups, exactly as <c>InjectEndpoints</c>: every staff route behind the
/// SHIPPED <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or unresolved scope → <c>401</c>; not
/// assigned to the exercise → <c>403</c>) and every MUTATION also behind <see cref="EngineCockpitControllerRoleFilter"/>
/// (controllers only). Participants and anonymous callers never reach a handler. The staff list
/// (<c>GET /api/outlets/staff</c>) is open to any assigned staff role.
/// </para>
/// <para>
/// <b>Route precedence.</b> <c>/api/outlets/staff</c> is a literal segment, which ASP.NET routing ranks above the
/// <c>{slug}</c> parameter, so the slug <c>staff</c> is reserved (<see cref="OutletWriteValidator.ReservedSlug"/>).
/// <c>/reorder</c> and <c>/defaults</c> are POST-only and <c>{slug}</c> is GET-only, so they never collide.
/// </para>
/// <para>
/// <b>Errors are ProblemDetails</b> with a readable <c>detail</c>; a <c>409</c> carries the outlet's current state as
/// the top-level <c>item</c> extension when it exists. A taken slug (live or soft-deleted) is a <c>409</c>.
/// </para>
/// </remarks>
public static class OutletEndpoints
{
    /// <summary>The ProblemDetails extension member carrying the current outlet on a <c>409</c>.</summary>
    public const string ConflictItemExtension = "item";

    /// <summary>Maps the <c>/api/outlets*</c> routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapOutlets(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/outlets", ListAsync);
        endpoints.MapGet("/api/outlets/{slug}", GetBySlugAsync);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        staff.MapGet("/api/outlets/staff", ListStaffAsync);
        controllerOnly.MapPost("/api/outlets", CreateAsync);
        controllerOnly.MapPut("/api/outlets/{id:guid}", UpdateAsync);
        controllerOnly.MapDelete("/api/outlets/{id:guid}", DeleteAsync);
        controllerOnly.MapPost("/api/outlets/reorder", ReorderAsync);
        controllerOnly.MapPost("/api/outlets/defaults", AddDefaultsAsync);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        [FromQuery] string? channel,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListAsync(channel, cancellationToken));

    private static async Task<IResult> GetBySlugAsync(
        string slug,
        [FromQuery] string? channel,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.GetBySlugAsync(slug, channel, cancellationToken));

    private static async Task<IResult> ListStaffAsync(
        [FromQuery] string? channel,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListStaffAsync(channel, cancellationToken));

    private static async Task<IResult> CreateAsync(
        OutletWriteRequest? request,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.CreateAsync(request, cancellationToken));

    private static async Task<IResult> UpdateAsync(
        Guid id,
        OutletWriteRequest? request,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.UpdateAsync(id, request, cancellationToken));

    private static async Task<IResult> DeleteAsync(
        Guid id,
        [FromQuery] int? version,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.DeleteAsync(id, version, cancellationToken));

    private static async Task<IResult> ReorderAsync(
        OutletReorderRequest? request,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ReorderAsync(request, cancellationToken));

    private static async Task<IResult> AddDefaultsAsync(
        OutletDefaultsRequest? request,
        [FromServices] OutletService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.AddDefaultsAsync(request, cancellationToken));

    /// <summary>Maps a service result onto exactly one status: fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult<TValue>(OutletResult<TValue> result)
        where TValue : class => result.Outcome switch
        {
            OutletOutcome.Ok when result.Value is { } value => Results.Json(value),
            OutletOutcome.Created when result.Value is { } created =>
                Results.Json(created, statusCode: StatusCodes.Status201Created),
            OutletOutcome.Deleted => Results.NoContent(),
            OutletOutcome.NotFound => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status404NotFound),
            OutletOutcome.Invalid => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            OutletOutcome.Conflict => Results.Problem(
                detail: result.Message,
                statusCode: StatusCodes.Status409Conflict,
                extensions: result.CurrentItem is null
                    ? null
                    : new Dictionary<string, object?> { [ConflictItemExtension] = result.CurrentItem }),
            OutletOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
