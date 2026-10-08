namespace Pulse.WebApi.Features.Social.Moderation;

using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// The controller takedown endpoint (demo-polish B6, implementation.md §1.5.5):
/// <c>DELETE /api/staff/posts/{postId:guid}?category=</c>. STAFF world. Minimal-API extension methods; the
/// orchestrator wires <see cref="AddSocialModeration"/> and <see cref="MapSocialModerationEndpoints"/> into
/// <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call it.</b> Only a live staff session assigned to the resolved exercise as <c>controller</c>,
/// enforced by the same two filters the steering routes use, composed the same way:
/// <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or no resolved scope → 401; staff not
/// assigned to the resolved exercise → 403), then <see cref="EngineCockpitControllerRoleFilter"/> (an assigned
/// evaluator or planner → 403). Anonymous, participant and shared read-only sessions are not staff sessions, so
/// they get 401. Both filters run before the handler, so a refused caller never reaches validation or the
/// database lookup.
/// </para>
/// <para>
/// <b>Responses.</b> 204 when the post is taken down or was already down. 400 when <c>category</c> is outside
/// <see cref="TakedownCategories.All"/>. 404 when the id is unknown or belongs to another exercise; the
/// response is identical in both cases (COR-001, DP-16).
/// </para>
/// <para>
/// <b>Lifecycle.</b> <c>/api/staff/**</c> is not in <c>ExerciseLifecycleGatedRoutes</c>, so a controller can
/// take a post down in any lifecycle state. That is intended.
/// </para>
/// <para>
/// <b>No telemetry (DP-9).</b> The category is validated here and is never persisted. The console's
/// <c>steering_action</c> event is the single analytic record of the takedown; the server only writes an
/// operational log line (exercise, post, staff user, category) through <see cref="PostTakedownService"/>.
/// </para>
/// </remarks>
public static class ModerationEndpoints
{
    /// <summary>The takedown route template.</summary>
    public const string TakedownRoute = "/api/staff/posts/{postId:guid}";

    /// <summary>
    /// Registers <see cref="PostTakedownService"/> (Scoped, matching the request's <c>PulseDbContext</c>).
    /// </summary>
    /// <remarks>
    /// The service also needs registrations that other slices own: <c>IFeedBroadcaster</c>
    /// (<c>AddSocialRealtimeHub</c>), <c>IExerciseClock</c> (<c>AddExerciseClock</c>), and persistence and
    /// scoping. The route filters need <c>StaffAssignmentService</c> (<c>AddStaffIdentity</c>). Program.cs
    /// registers all of these, so call order does not matter.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSocialModeration(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<PostTakedownService>();

        return services;
    }

    /// <summary>
    /// Maps <c>DELETE /api/staff/posts/{postId:guid}</c> behind the staff gate and the controller-role gate.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialModerationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Same composition as StorylineSteeringEndpoints: the staff + assigned-exercise gate on an empty-prefix
        // group, and the controller-role gate on a nested empty-prefix group, so the mutation passes both.
        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        controllerOnly.MapDelete(TakedownRoute, TakeDownPostAsync);

        return endpoints;
    }

    /// <summary>
    /// Validates <paramref name="category"/>, then takes the post down. The filters have already authorized a
    /// controller assigned to the resolved exercise.
    /// </summary>
    /// <param name="postId">The post to take down (route).</param>
    /// <param name="category">The incident category (query). Optional, defaults to <c>other</c>. Not persisted (DP-9).</param>
    /// <param name="user">The server-resolved session principal (the acting staff user, for the log line only).</param>
    /// <param name="service">The takedown service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>204, 400, 401 or 404.</returns>
    private static async Task<IResult> TakeDownPostAsync(
        Guid postId,
        string? category,
        ClaimsPrincipal user,
        PostTakedownService service,
        CancellationToken cancellationToken)
    {
        if (!TakedownCategories.IsValid(category))
        {
            return Results.BadRequest($"category must be one of: {string.Join(", ", TakedownCategories.All)}.");
        }

        // The staff user id comes from the principal SessionAuthenticationMiddleware resolved server-side, never
        // from the request. The filters have already verified it is a live, assigned controller session.
        var staffUserId = SessionPrincipal.Read(user)?.StaffUserId;

        var result = await service.TakeDownAsync(
            postId, TakedownCategories.OrDefault(category), staffUserId, cancellationToken);

        return result.Outcome switch
        {
            PostTakedownOutcome.Removed or PostTakedownOutcome.AlreadyRemoved => Results.NoContent(),

            // Same response for an unknown id and another exercise's id, so it does not reveal that a
            // cross-exercise post exists (COR-001).
            PostTakedownOutcome.NotFound => Results.NotFound(),
            PostTakedownOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
