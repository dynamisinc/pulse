namespace Pulse.WebApi.Features.Social.Pins;

using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The pins HTTP surface (demo-feedback story 04): the controller's exercise pin
/// (<c>PUT</c> / <c>DELETE /api/staff/posts/{postId}/pin</c>, DF-7) and the Pinned tab read
/// (<c>GET /api/feed/pinned</c>, DF-5). The PERSONAL pin needs no route of its own: it is the existing reaction route
/// with kind <c>pin</c> (DF-6), already mapped inside <c>DenyReadOnlySessions()</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Composition root (orchestrator-owned, seam S-2).</b> <c>Program.cs</c> calls <see cref="AddPostPins"/> and
/// <see cref="MapPostPins"/> at top level (not inside a read-only-denied group): the staff routes carry their own staff
/// filters, and the read is a read.
/// </para>
/// <para>
/// <b>Exercise pin gate.</b> The same composition as <c>ModerationEndpoints</c>: <see cref="EngineCockpitStaffAuthorizationFilter"/>
/// on an empty-prefix group (no staff session or no scope → 401; not assigned to this exercise → 403), then
/// <see cref="EngineCockpitControllerRoleFilter"/> on a nested one (an evaluator or planner → 403). Participant and
/// read-only sessions are not staff, so they get 401 before a handler runs.
/// </para>
/// <para>
/// <b>Pinned read gate.</b> Like <c>GET /api/feed</c>: an unresolved scope fails closed with 401. Any session in scope may
/// read it; only a participant session gets its personal pins and likes (see <see cref="PinnedFeedService"/>).
/// <c>/api/feed/pinned</c> sits under the lifecycle-gated <c>/api/feed</c> prefix, so it obeys the same lifecycle rules
/// as the feed.
/// </para>
/// </remarks>
public static class PinEndpoints
{
    /// <summary>The exercise pin route template.</summary>
    public const string StaffPinRoute = "/api/staff/posts/{postId:guid}/pin";

    /// <summary>The Pinned tab read route.</summary>
    public const string PinnedFeedRoute = "/api/feed/pinned";

    /// <summary>
    /// Registers <see cref="PinService"/> and <see cref="PinnedFeedService"/> (Scoped, matching the request's
    /// <c>PulseDbContext</c>), plus the session-persona accessor and the projector fallbacks the read depends on
    /// (both <c>TryAdd</c>-based, so calling them again where they are already wired is a no-op).
    /// </summary>
    /// <remarks>
    /// The services also use registrations other slices own: <c>IFeedBroadcaster</c> (<c>AddSocialRealtimeHub</c>),
    /// <c>IExerciseClock</c> (<c>AddExerciseClock</c>), the real engagement reader (<c>AddSocialReactions</c>), and the
    /// staff filters' <c>StaffAssignmentService</c> (<c>AddStaffIdentity</c>). Program.cs registers all of them.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPostPins(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSocialFollowGraph();
        services.TryAddPostSeamFallbacks();
        services.TryAddScoped<PinService>();
        services.TryAddScoped<PinnedFeedService>();

        return services;
    }

    /// <summary>
    /// Maps <c>PUT</c> / <c>DELETE /api/staff/posts/{postId:guid}/pin</c> behind the staff and controller-role gates,
    /// and <c>GET /api/feed/pinned</c>.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPostPins(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        var controllerOnly = staff
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        controllerOnly.MapPut(StaffPinRoute, PinForAllAsync);
        controllerOnly.MapDelete(StaffPinRoute, UnpinForAllAsync);

        endpoints.MapGet(PinnedFeedRoute, GetPinnedFeedAsync);

        return endpoints;
    }

    /// <summary>Pins a post for everyone; idempotent. The filters have already authorized an assigned controller.</summary>
    /// <param name="postId">The post (route).</param>
    /// <param name="user">The server-resolved session principal (the acting staff user).</param>
    /// <param name="service">The pin service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>204, 401 or 404.</returns>
    private static Task<IResult> PinForAllAsync(
        Guid postId, ClaimsPrincipal user, PinService service, CancellationToken cancellationToken) =>
        MutateAsync(user, (staffUserId, sessionId) => service.PinForAllAsync(postId, staffUserId, sessionId, cancellationToken));

    /// <summary>Clears a post's exercise pin; idempotent, allowed on a taken-down post.</summary>
    /// <param name="postId">The post (route).</param>
    /// <param name="user">The server-resolved session principal (the acting staff user).</param>
    /// <param name="service">The pin service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>204, 401 or 404.</returns>
    private static Task<IResult> UnpinForAllAsync(
        Guid postId, ClaimsPrincipal user, PinService service, CancellationToken cancellationToken) =>
        MutateAsync(user, (staffUserId, sessionId) => service.UnpinForAllAsync(postId, staffUserId, sessionId, cancellationToken));

    /// <summary>
    /// Reads the acting staff user from the principal <c>SessionAuthenticationMiddleware</c> resolved server-side (never
    /// from the request), runs the mutation and maps its outcome.
    /// </summary>
    private static async Task<IResult> MutateAsync(ClaimsPrincipal user, Func<Guid, Guid, Task<PinOutcome>> mutate)
    {
        // The filters already verified a live staff session; a principal without a staff user fails closed anyway.
        var identity = SessionPrincipal.Read(user);
        if (identity?.StaffUserId is not { } staffUserId || staffUserId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var outcome = await mutate(staffUserId, identity.SessionId);
        return outcome switch
        {
            PinOutcome.Changed or PinOutcome.Unchanged => Results.NoContent(),

            // Same response for an unknown id, another exercise's id, and (for a pin) a taken-down post (COR-001).
            PinOutcome.NotFound => Results.NotFound(),
            PinOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>The Pinned tab read. Fails closed (401) on an unresolved scope, like <c>GET /api/feed</c>.</summary>
    /// <param name="exerciseContext">The resolved exercise scope.</param>
    /// <param name="service">The Pinned read.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>200 with <see cref="PinnedFeedResponse"/>, or 401.</returns>
    private static async Task<IResult> GetPinnedFeedAsync(
        IExerciseContext exerciseContext, PinnedFeedService service, CancellationToken cancellationToken)
    {
        if (exerciseContext.CurrentExerciseId is not { } scope || scope == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(await service.GetAsync(cancellationToken));
    }
}
