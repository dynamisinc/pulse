namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The scripted-post queue API (inject-queue story 06) on <c>/api/injects*</c> — the frozen 06 ↔ 07 wire contract:
/// author, edit, delete, reorder, read, fire, hold, release, skip, unskip and retry.
/// </summary>
/// <remarks>
/// <para>
/// <b>Minimal-API <c>Add*</c>/<c>Map*</c> convention.</b> <c>Program.cs</c> calls <see cref="AddInjects"/> and
/// <see cref="MapInjects"/>; a composition-root test on the real <c>Program</c> guards that both are wired.
/// </para>
/// <para>
/// <b>STAFF world only (XC-002).</b> Every route sits behind the SHIPPED, unmodified
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or unresolved scope → <c>401</c>; a staff
/// session not assigned to the resolved exercise → <c>403</c>), and every MUTATION additionally behind
/// <see cref="EngineCockpitControllerRoleFilter"/> (only a controller may change the queue) — composed on empty-prefix
/// groups exactly as <c>PauseTierEndpoints</c> does. Participants and anonymous callers never reach a handler.
/// </para>
/// <para>
/// <b>Errors are ProblemDetails.</b> <c>400</c>/<c>404</c>/<c>409</c> carry a readable <c>detail</c>; a <c>409</c> also
/// carries the item's current state as the <c>item</c> extension member (when it exists) so the console can refresh
/// the row without a second call — ASP.NET serializes extensions at the TOP level, so it is <c>body.item</c>. A
/// cross-exercise id is a <c>404</c> identical to an unknown one (COR-001).
/// </para>
/// </remarks>
public static class InjectEndpoints
{
    /// <summary>The ProblemDetails extension member carrying the current item on a <c>409</c>.</summary>
    public const string ConflictItemExtension = "item";

    /// <summary>
    /// Registers the queue: <see cref="InjectQueueService"/> (scoped, matching <c>PulseDbContext</c>), the jitter
    /// source, the server clock (only if the host has none), and the <see cref="InjectBurstRunner"/> hosted service.
    /// Prerequisites the host wires first: persistence + exercise scoping, <c>AddExerciseClock()</c>,
    /// <c>AddStaffIdentity()</c> (the gate and the acting human), <c>AddSocialPostWrite()</c> +
    /// <c>AddSocialRealtimeHub()</c> (the ingest funnel and its broadcaster) and <c>AddPauseTierSteering()</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddInjects(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IBurstJitterSource, CryptoBurstJitterSource>();
        services.TryAddScoped<IInjectPostPublisher, FunnelInjectPostPublisher>();
        services.TryAddScoped<InjectQueueService>();
        services.AddHostedService<InjectBurstRunner>();

        return services;
    }

    /// <summary>
    /// Maps the <c>/api/injects*</c> routes: reads behind the staff gate, mutations behind the staff gate AND the
    /// controller-role gate.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapInjects(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        staff.MapGet("/api/injects", GetQueueAsync);
        staff.MapGet("/api/injects/assignees", GetAssigneesAsync);

        controllerOnly.MapPost("/api/injects", CreateAsync);
        controllerOnly.MapPut("/api/injects/{id:guid}", UpdateAsync);
        controllerOnly.MapDelete("/api/injects/{id:guid}", DeleteAsync);
        controllerOnly.MapPost("/api/injects/reorder", ReorderAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/fire", FireAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/hold", HoldAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/release", ReleaseAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/skip", SkipAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/unskip", UnskipAsync);
        controllerOnly.MapPost("/api/injects/{id:guid}/retry", RetryAsync);

        return endpoints;
    }

    private static async Task<IResult> GetQueueAsync(InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.GetQueueAsync(cancellationToken));

    private static async Task<IResult> GetAssigneesAsync(InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.GetAssigneesAsync(cancellationToken));

    private static async Task<IResult> CreateAsync(
        InjectItemWriteRequest? request,
        InjectQueueService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.CreateAsync(request, cancellationToken));

    private static async Task<IResult> UpdateAsync(
        Guid id,
        InjectItemWriteRequest? request,
        InjectQueueService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.UpdateAsync(id, request, cancellationToken));

    private static async Task<IResult> DeleteAsync(
        Guid id,
        int? version,
        InjectQueueService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.DeleteAsync(id, version, cancellationToken));

    private static async Task<IResult> ReorderAsync(
        InjectReorderRequest? request,
        InjectQueueService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ReorderAsync(request, cancellationToken));

    private static async Task<IResult> FireAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.FireAsync(id, cancellationToken));

    private static async Task<IResult> HoldAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.HoldAsync(id, cancellationToken));

    private static async Task<IResult> ReleaseAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.ReleaseAsync(id, cancellationToken));

    private static async Task<IResult> SkipAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.SkipAsync(id, cancellationToken));

    private static async Task<IResult> UnskipAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.UnskipAsync(id, cancellationToken));

    private static async Task<IResult> RetryAsync(Guid id, InjectQueueService service, CancellationToken cancellationToken) =>
        ToResult(await service.RetryAsync(id, cancellationToken));

    /// <summary>Maps a service result onto exactly one status — fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult<TValue>(InjectResult<TValue> result)
        where TValue : class => result.Outcome switch
        {
            InjectOutcome.Ok when result.Value is { } value => Results.Json(value),
            InjectOutcome.Created when result.Value is { } created =>
                Results.Json(created, statusCode: StatusCodes.Status201Created),
            InjectOutcome.Deleted => Results.NoContent(),
            InjectOutcome.NotFound => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status404NotFound),
            InjectOutcome.Invalid => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            InjectOutcome.Conflict => Results.Problem(
                detail: result.Message,
                statusCode: StatusCodes.Status409Conflict,
                extensions: result.CurrentItem is null
                    ? null
                    : new Dictionary<string, object?> { [ConflictItemExtension] = result.CurrentItem }),
            InjectOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
