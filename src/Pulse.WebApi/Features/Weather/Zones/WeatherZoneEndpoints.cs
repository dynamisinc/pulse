namespace Pulse.WebApi.Features.Weather.Zones;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The weather zone API (weather-source story 02, WX-004) on <c>/api/weather/zones*</c>: the participant zone list and the
/// staff list, create, edit and soft delete.
/// </summary>
/// <remarks>
/// <para>
/// <b>Composition.</b> Services are registered by <c>AddWeather()</c>; these routes are mapped by <c>MapWeather()</c>
/// (<see cref="WeatherEndpointRouteBuilderExtensions"/>), which <c>Program.cs</c> calls once.
/// </para>
/// <para>
/// <b>Participant read.</b> <c>GET /api/weather/zones</c> behind <c>RequireChannelEnabled("weather")</c> (story F08): a
/// disabled weather channel is the same 404 as an unknown route. Scope comes ONLY from the server-resolved
/// <c>IExerciseContext</c>; an unresolved scope is <c>401</c>.
/// </para>
/// <para>
/// <b>Staff routes.</b> On empty-prefix groups, exactly as <c>OutletEndpoints</c>: every staff route behind the SHIPPED
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or unresolved scope → <c>401</c>; not assigned to
/// the exercise → <c>403</c>) and every MUTATION also behind <see cref="EngineCockpitControllerRoleFilter"/> (controllers
/// only). The staff list (<c>GET /api/weather/zones/staff</c>) is open to any assigned staff role and is not channel-gated,
/// so zones can be prepared before the channel is switched on. <c>/staff</c> is GET-only and <c>{id:guid}</c> is
/// PUT/DELETE-only, so they never collide.
/// </para>
/// <para>
/// <b>Errors are ProblemDetails</b> with a readable <c>detail</c>; a <c>409</c> carries the zone's current state as the
/// top-level <c>item</c> extension when it exists. A taken slug (live or soft-deleted) is a <c>409</c>.
/// </para>
/// </remarks>
public static class WeatherZoneEndpoints
{
    /// <summary>The ProblemDetails extension member carrying the current zone on a <c>409</c>.</summary>
    public const string ConflictItemExtension = "item";

    /// <summary>Maps the <c>/api/weather/zones*</c> routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapWeatherZones(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/weather/zones", ListAsync).RequireChannelEnabled(ChannelVocabulary.Weather);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        staff.MapGet("/api/weather/zones/staff", ListStaffAsync);
        controllerOnly.MapPost("/api/weather/zones", CreateAsync);
        controllerOnly.MapPut("/api/weather/zones/{id:guid}", UpdateAsync);
        controllerOnly.MapDelete("/api/weather/zones/{id:guid}", DeleteAsync);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        [FromServices] WeatherZoneService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListAsync(cancellationToken));

    private static async Task<IResult> ListStaffAsync(
        [FromServices] WeatherZoneService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListStaffAsync(cancellationToken));

    private static async Task<IResult> CreateAsync(
        WeatherZoneWriteRequest? request,
        [FromServices] WeatherZoneService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.CreateAsync(request, cancellationToken));

    private static async Task<IResult> UpdateAsync(
        Guid id,
        WeatherZoneWriteRequest? request,
        [FromServices] WeatherZoneService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.UpdateAsync(id, request, cancellationToken));

    private static async Task<IResult> DeleteAsync(
        Guid id,
        [FromQuery] int? version,
        [FromServices] WeatherZoneService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.DeleteAsync(id, version, cancellationToken));

    /// <summary>Maps a service result onto exactly one status: fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult<TValue>(WeatherZoneResult<TValue> result)
        where TValue : class => result.Outcome switch
        {
            WeatherZoneOutcome.Ok when result.Value is { } value => Results.Json(value),
            WeatherZoneOutcome.Created when result.Value is { } created =>
                Results.Json(created, statusCode: StatusCodes.Status201Created),
            WeatherZoneOutcome.Deleted => Results.NoContent(),
            WeatherZoneOutcome.NotFound => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status404NotFound),
            WeatherZoneOutcome.Invalid => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            WeatherZoneOutcome.Conflict => Results.Problem(
                detail: result.Message,
                statusCode: StatusCodes.Status409Conflict,
                extensions: result.CurrentItem is null
                    ? null
                    : new Dictionary<string, object?> { [ConflictItemExtension] = result.CurrentItem }),
            WeatherZoneOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
