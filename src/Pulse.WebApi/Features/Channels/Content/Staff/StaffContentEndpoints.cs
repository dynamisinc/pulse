namespace Pulse.WebApi.Features.Channels.Content.Staff;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The staff content API (channels-foundation story 07, FC-4) on <c>/api/content-items*</c>: list / read / preview, and
/// create, edit, soft delete, publish, schedule, unschedule, retract, restore, revise, feature and the featured reorder,
/// every write a call into the funnel. Controllers may publish as any outlet and any content kind (PRS-020); a channel adds
/// a kind descriptor, never an endpoint.
/// </summary>
/// <remarks>
/// <para>
/// <b>Staff only.</b> On empty-prefix groups, exactly as <c>InjectEndpoints</c>: every route behind the SHIPPED
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or unresolved scope → <c>401</c>; a staff user not
/// assigned to the exercise → <c>403</c>), every mutation also behind <see cref="EngineCockpitControllerRoleFilter"/>. The
/// reads are open to any assigned staff role. Writes are blind to <c>exerciseId</c>: the scope is the session's.
/// </para>
/// <para>
/// <b>Rate limit (NFR-009).</b> <c>publish</c>, <c>schedule</c>, <c>revise</c> and <c>retract</c> share
/// <see cref="ContentPublishRateLimiterPolicy"/>; reads and draft edits are unlimited.
/// </para>
/// <para>
/// <b>Errors are ProblemDetails</b> with a readable <c>detail</c> (every message joined) and an <c>errors</c> array. A
/// <c>409</c> (illegal transition, stale <c>version</c>, a held publish) carries the item as it is now in the <c>item</c>
/// extension; a held publish also has <c>held: true</c>.
/// </para>
/// </remarks>
public static class StaffContentEndpoints
{
    /// <summary>The ProblemDetails extension carrying the item's current state on a <c>409</c>.</summary>
    public const string ConflictItemExtension = "item";

    /// <summary>The ProblemDetails extension listing every refusal message.</summary>
    public const string ErrorsExtension = "errors";

    /// <summary>The ProblemDetails extension flagging a publish a gate held.</summary>
    public const string HeldExtension = "held";

    /// <summary>
    /// Registers the staff content service, the funnel's featured-slot half and the shared publish rate-limit policy.
    /// Prerequisites wired by the host: the funnel (<c>AddContentPublishFunnel</c>), persistence + exercise scoping, staff
    /// identity and the exercise clock.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddStaffContent(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Idempotent as a whole: AddPolicy throws on a duplicate policy name.
        if (services.Any(descriptor => descriptor.ServiceType == typeof(StaffContentService)))
        {
            return services;
        }

        services.TryAddSingleton(TimeProvider.System);
        // The SAME funnel instance as IContentPublishService when that is the shipped funnel (one per scope).
        services.TryAddScoped<IContentFeaturing>(provider =>
            provider.GetRequiredService<IContentPublishService>() as ContentPublishService
            ?? ActivatorUtilities.CreateInstance<ContentPublishService>(provider));
        services.TryAddScoped<StaffContentService>();

        // AddRateLimiter is additive across slices; enforcement is the single app.UseRateLimiter() in Program.cs.
        services.AddRateLimiter(options =>
            options.AddPolicy<string, ContentPublishRateLimiterPolicy>(ContentPublishRateLimiterPolicy.PolicyName));

        return services;
    }

    /// <summary>Maps the <c>/api/content-items*</c> routes.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapStaffContent(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        staff.MapGet("/api/content-items", ListAsync);
        staff.MapGet("/api/content-items/{id:guid}", GetAsync);
        staff.MapGet("/api/content-items/{id:guid}/preview", PreviewAsync);

        controllerOnly.MapPost("/api/content-items", CreateAsync);
        controllerOnly.MapPut("/api/content-items/{id:guid}", UpdateAsync);
        controllerOnly.MapDelete("/api/content-items/{id:guid}", DeleteAsync);
        controllerOnly.MapPost("/api/content-items/{id:guid}/publish", PublishAsync)
            .RequireRateLimiting(ContentPublishRateLimiterPolicy.PolicyName);
        controllerOnly.MapPost("/api/content-items/{id:guid}/schedule", ScheduleAsync)
            .RequireRateLimiting(ContentPublishRateLimiterPolicy.PolicyName);
        controllerOnly.MapPost("/api/content-items/{id:guid}/unschedule", UnscheduleAsync);
        controllerOnly.MapPost("/api/content-items/{id:guid}/retract", RetractAsync)
            .RequireRateLimiting(ContentPublishRateLimiterPolicy.PolicyName);
        controllerOnly.MapPost("/api/content-items/{id:guid}/restore", RestoreAsync);
        controllerOnly.MapPost("/api/content-items/{id:guid}/revise", ReviseAsync)
            .RequireRateLimiting(ContentPublishRateLimiterPolicy.PolicyName);
        controllerOnly.MapPost("/api/content-items/{id:guid}/feature", FeatureAsync);
        controllerOnly.MapPost("/api/content-items/feature/reorder", ReorderFeaturedAsync);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        [FromQuery] string? channel,
        [FromQuery] string? status,
        [FromQuery] string? outlet,
        [FromQuery] string? kind,
        [FromQuery] int? limit,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListAsync(channel, status, outlet, kind, limit, cancellationToken));

    private static async Task<IResult> GetAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.GetAsync(id, cancellationToken));

    private static async Task<IResult> PreviewAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.PreviewAsync(id, cancellationToken));

    private static async Task<IResult> CreateAsync(
        ContentWriteRequest? request, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.CreateAsync(request, cancellationToken));

    private static async Task<IResult> UpdateAsync(
        Guid id,
        ContentWriteRequest? request,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.UpdateAsync(id, request, cancellationToken));

    private static async Task<IResult> DeleteAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.DeleteAsync(id, cancellationToken));

    private static async Task<IResult> PublishAsync(
        Guid id,
        PublishOptions? options,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.PublishAsync(id, options, cancellationToken));

    private static async Task<IResult> ScheduleAsync(
        Guid id,
        ContentScheduleRequest? request,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ScheduleAsync(id, request, cancellationToken));

    private static async Task<IResult> UnscheduleAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.UnscheduleAsync(id, cancellationToken));

    private static async Task<IResult> RetractAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.RetractAsync(id, cancellationToken));

    private static async Task<IResult> RestoreAsync(
        Guid id, [FromServices] StaffContentService service, CancellationToken cancellationToken) =>
        ToResult(await service.RestoreAsync(id, cancellationToken));

    private static async Task<IResult> ReviseAsync(
        Guid id,
        ContentReviseRequest? request,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ReviseAsync(id, request, cancellationToken));

    private static async Task<IResult> FeatureAsync(
        Guid id,
        ContentFeatureRequest? request,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.FeatureAsync(id, request, cancellationToken));

    private static async Task<IResult> ReorderFeaturedAsync(
        ContentFeatureReorderRequest? request,
        [FromServices] StaffContentService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ReorderFeaturedAsync(request, cancellationToken));

    /// <summary>Maps a result onto exactly one status: fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult(StaffContentResult result) => result.Outcome switch
    {
        StaffContentOutcome.Ok => Results.Json(result.Value),
        StaffContentOutcome.Created => Results.Json(result.Value, statusCode: StatusCodes.Status201Created),
        StaffContentOutcome.Deleted => Results.NoContent(),
        StaffContentOutcome.Unauthorized => Results.Unauthorized(),
        StaffContentOutcome.NotFound => Problem(result, StatusCodes.Status404NotFound),
        StaffContentOutcome.Invalid => Problem(result, StatusCodes.Status400BadRequest),
        StaffContentOutcome.Conflict => Problem(result, StatusCodes.Status409Conflict),
        StaffContentOutcome.Held => Problem(result, StatusCodes.Status409Conflict, held: true),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    private static IResult Problem(StaffContentResult result, int statusCode, bool held = false)
    {
        var errors = result.Errors ?? [];
        var extensions = new Dictionary<string, object?> { [ErrorsExtension] = errors };
        if (result.Current is { } current)
        {
            extensions[ConflictItemExtension] = current;
        }

        if (held)
        {
            extensions[HeldExtension] = true;
        }

        return Results.Problem(detail: string.Join(" ", errors), statusCode: statusCode, extensions: extensions);
    }
}
