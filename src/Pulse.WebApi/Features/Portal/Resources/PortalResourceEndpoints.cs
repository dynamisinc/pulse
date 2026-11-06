namespace Pulse.WebApi.Features.Portal.Resources;

using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.RoleMatrix;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// The Resources shelf API (exercise-portal story 04, PC-4) on <c>/api/portal/resources*</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Reads, one route per shape for both worlds.</b> <c>GET /api/portal/resources</c> and <c>/{id}</c> sit behind
/// <c>RequireChannelEnabled("portal")</c>, which admits staff assigned to the exercise whatever the gate says. A caller
/// with no staff session (participant, shared read-only) gets <see cref="PortalResourceDto"/>s of the visible,
/// non-deleted rows; a disabled channel, and a hidden, deleted, unknown or other-exercise id, are the one bare
/// <c>404</c>. An enrolled staff caller gets <see cref="PortalResourceStaffDto"/>s with hidden rows (the console view);
/// a staff session that is not enrolled is refused (<c>401</c>/<c>403</c>).
/// </para>
/// <para>
/// <b>Writes.</b> Behind the shipped <see cref="EngineCockpitStaffAuthorizationFilter"/> and
/// <see cref="ExerciseRoleFilter.PlannerOrController"/>; allowed while the channel is disabled (planners prepare before
/// enabling, like F08). Errors are ProblemDetails with a readable <c>detail</c>.
/// </para>
/// </remarks>
public static class PortalResourceEndpoints
{
    private const string Route = "/api/portal/resources";

    /// <summary>Registers the shelf service, its options and its sanitizer profile. Idempotent.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPortalResources(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        if (services.Any(d => d.ServiceType == typeof(IPortalResourceService)))
        {
            return services; // the profile registration is not a TryAdd; a second one would fail host start
        }

        services.AddOptions<PortalResourceOptions>().BindConfiguration(PortalResourceOptions.SectionName);
        services.AddSanitizerProfile(PortalResourceSanitizer.ProfileName, PortalResourceSanitizer.Profile);
        services.TryAddScoped<IPortalResourceService, PortalResourceService>();
        return services;
    }

    /// <summary>Maps the <c>/api/portal/resources*</c> routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPortalResources(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var reads = endpoints.MapGroup(string.Empty).RequireChannelEnabled(ChannelVocabulary.Portal);
        reads.MapGet(Route, ListAsync);
        reads.MapGet($"{Route}/{{id:guid}}", GetAsync);

        var writes = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .RequireExerciseRole(ExerciseRoleFilter.PlannerOrController);
        writes.MapPost(Route, CreateAsync);
        writes.MapPut($"{Route}/{{id:guid}}", UpdateAsync);
        writes.MapDelete($"{Route}/{{id:guid}}", DeleteAsync);
        writes.MapPost($"{Route}/reorder", ReorderAsync);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        HttpContext httpContext,
        [FromServices] IExerciseContext scope,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        var caller = await ExerciseCallerRole.ResolveAsync(httpContext);
        if (caller.Outcome == ExerciseCallerOutcome.NoStaffSession)
        {
            return HasScope(scope)
                ? Results.Json(await service.ListVisibleAsync(cancellationToken))
                : Results.Unauthorized();
        }

        return caller.Outcome == ExerciseCallerOutcome.Enrolled
            ? Results.Json(await service.ListStaffAsync(cancellationToken))
            : caller.Refusal();
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        HttpContext httpContext,
        [FromServices] IExerciseContext scope,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        var caller = await ExerciseCallerRole.ResolveAsync(httpContext);
        if (caller.Outcome == ExerciseCallerOutcome.NoStaffSession)
        {
            if (!HasScope(scope))
            {
                return Results.Unauthorized();
            }

            return await service.GetVisibleAsync(id, cancellationToken) is { } visible
                ? Results.Json(visible)
                : Results.NotFound();
        }

        if (caller.Outcome != ExerciseCallerOutcome.Enrolled)
        {
            return caller.Refusal();
        }

        return await service.GetStaffAsync(id, cancellationToken) is { } staff ? Results.Json(staff) : Results.NotFound();
    }

    private static async Task<IResult> CreateAsync(
        HttpContext httpContext,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        if (await ReadBodyAsync<PortalResourceWriteRequest>(httpContext, cancellationToken) is not { } request)
        {
            return MissingBody();
        }

        var result = await service.CreateAsync(request, await CallerAsync(httpContext), cancellationToken);
        return result is { Outcome: PortalWriteOutcome.Ok, Value: { } created }
            ? Results.Created($"{Route}/{created.Id}", created)
            : ToResult(result);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        HttpContext httpContext,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        if (await ReadBodyAsync<PortalResourceWriteRequest>(httpContext, cancellationToken) is not { } request)
        {
            return MissingBody();
        }

        return ToResult(await service.UpdateAsync(id, request, await CallerAsync(httpContext), cancellationToken));
    }

    private static async Task<IResult> DeleteAsync(
        Guid id,
        HttpContext httpContext,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        var result = await service.DeleteAsync(id, await CallerAsync(httpContext), cancellationToken);
        return result.Outcome == PortalWriteOutcome.Ok ? Results.NoContent() : ToResult(result);
    }

    private static async Task<IResult> ReorderAsync(
        HttpContext httpContext,
        [FromServices] IPortalResourceService service,
        CancellationToken cancellationToken)
    {
        var request = await ReadBodyAsync<PortalResourceReorderRequest>(httpContext, cancellationToken);
        if (request is not { OrderedIds: not null })
        {
            return MissingBody();
        }

        return ToResult(await service.ReorderAsync(request, await CallerAsync(httpContext), cancellationToken));
    }

    /// <summary>
    /// Reads a write body INSIDE the handler, after the staff and role filters: parameter binding runs before endpoint
    /// filters, so a bound body (the contract's <c>required</c> members, a malformed or non-JSON body) would answer a
    /// refused caller with <c>400</c>/<c>415</c> instead of <c>401</c>/<c>403</c>. A missing or malformed body is <c>null</c>.
    /// </summary>
    private static async Task<T?> ReadBodyAsync<T>(HttpContext httpContext, CancellationToken cancellationToken)
        where T : class
    {
        if (!httpContext.Request.HasJsonContentType())
        {
            return null;
        }

        try
        {
            return await httpContext.Request.ReadFromJsonAsync<T>(cancellationToken);
        }
        catch (Exception ex) when (ex is JsonException
            or BadHttpRequestException { StatusCode: not StatusCodes.Status413PayloadTooLarge })
        {
            return null;
        }
    }

    private static bool HasScope(IExerciseContext scope) =>
        scope.CurrentExerciseId is { } id && id != Guid.Empty;

    /// <summary>The acting human: the role filter in front of every write has already resolved an enrolled caller.</summary>
    private static async Task<PortalStaffCaller> CallerAsync(HttpContext httpContext) =>
        new() { ActingHumanId = (await ExerciseCallerRole.ResolveAsync(httpContext)).PersonId.ToString() };

    private static IResult MissingBody() =>
        Results.Problem(detail: "A valid JSON request body is required.", statusCode: StatusCodes.Status400BadRequest);

    /// <summary>Maps a write result onto exactly one status: fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult<T>(PortalWriteResult<T> result)
        where T : class => result.Outcome switch
        {
            PortalWriteOutcome.Ok when result.Value is { } value => Results.Json(value),
            PortalWriteOutcome.NotFound => Results.NotFound(),
            PortalWriteOutcome.Conflict => Results.Problem(
                detail: string.Join(" ", result.Errors), statusCode: StatusCodes.Status409Conflict),
            PortalWriteOutcome.Invalid => Results.Problem(
                detail: string.Join(" ", result.Errors), statusCode: StatusCodes.Status400BadRequest),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
