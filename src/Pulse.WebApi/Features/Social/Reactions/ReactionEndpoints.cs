namespace Pulse.WebApi.Features.Social.Reactions;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The reaction HTTP surface (demo-polish B3): <c>PUT</c> and <c>DELETE /api/posts/{postId}/reactions/{kind}</c>,
/// <c>kind</c> ∈ <c>like</c> | <c>repost</c>. Both are idempotent and return <see cref="ReactionStateDto"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Composition root (orchestrator-owned).</b> <c>Program.cs</c> calls <see cref="AddSocialReactions"/> and maps
/// these routes INSIDE its <c>MapGroup(string.Empty).DenyReadOnlySessions()</c> group, so a shared read-only session
/// is refused with 403 before a handler runs (COR-015). The handlers do not re-apply that filter; the service's
/// participant-only allowlist (DP-10) independently refuses a read-only session, which is never of kind
/// <c>participant</c>.
/// </para>
/// <para>
/// <b>Scope and identity are server-authoritative (COR-001).</b> No route takes an exercise id or a persona id. The
/// post id is resolved inside the resolved exercise only: another exercise's real post id and an unknown id get the
/// same bare 404 (DP-16), so the response never confirms that a cross-exercise id exists.
/// </para>
/// </remarks>
public static class ReactionEndpoints
{
    /// <summary>
    /// Registers <see cref="ReactionService"/> and the REAL <see cref="IPostEngagementReader"/>
    /// (<see cref="PostEngagementReader"/>), both Scoped to match the request's <c>PulseDbContext</c> unit of work.
    /// </summary>
    /// <remarks>
    /// The reader is registered with a plain <c>AddScoped</c>, not <c>TryAdd</c>: the post read path registers a
    /// <c>TryAdd</c> fallback reader, and the real one must win whichever order the two calls run in (the last
    /// registration is the one resolved).
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns><paramref name="services"/>, for chaining.</returns>
    public static IServiceCollection AddSocialReactions(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The reaction write resolves its reactor from the current request's session, exactly as the follow write
        // does; AddSocialFollowGraph is TryAdd-based, so calling it again is a no-op where it is already wired.
        services.AddSocialFollowGraph();
        services.AddScoped<IPostEngagementReader, PostEngagementReader>();
        services.TryAddScoped<ReactionService>();

        return services;
    }

    /// <summary>
    /// Maps <c>PUT</c> and <c>DELETE /api/posts/{postId:guid}/reactions/{kind}</c>. Call it on the
    /// <c>DenyReadOnlySessions()</c> group (see the type remarks).
    /// </summary>
    /// <param name="endpoints">The endpoint route builder (the read-only-denied group).</param>
    /// <returns><paramref name="endpoints"/>, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialReactionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPut("/api/posts/{postId:guid}/reactions/{kind}", ReactAsync);
        endpoints.MapDelete("/api/posts/{postId:guid}/reactions/{kind}", UnreactAsync);

        return endpoints;
    }

    /// <summary>Activates the caller's reaction; idempotent on a repeat.</summary>
    /// <param name="postId">The post to react to.</param>
    /// <param name="kind">The reaction kind from the route.</param>
    /// <param name="reactionService">The reaction service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the resulting state, or 400/401/403/404 per the fail-closed outcomes.</returns>
    private static async Task<IResult> ReactAsync(
        Guid postId,
        string kind,
        ReactionService reactionService,
        CancellationToken cancellationToken)
    {
        var result = await reactionService.ReactAsync(postId, kind, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Soft-deletes the caller's reaction; idempotent on a repeat.</summary>
    /// <param name="postId">The post to stop reacting to.</param>
    /// <param name="kind">The reaction kind from the route.</param>
    /// <param name="reactionService">The reaction service.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>200 with the resulting state, or 400/401/403/404 per the fail-closed outcomes.</returns>
    private static async Task<IResult> UnreactAsync(
        Guid postId,
        string kind,
        ReactionService reactionService,
        CancellationToken cancellationToken)
    {
        var result = await reactionService.UnreactAsync(postId, kind, cancellationToken);
        return MapResult(result);
    }

    /// <summary>Maps a service outcome onto its HTTP status, failing closed on everything short of success.</summary>
    /// <param name="result">The service outcome.</param>
    /// <returns>The HTTP result.</returns>
    private static IResult MapResult(ReactionResult result) => result.Outcome switch
    {
        // A state change and an idempotent repeat return the SAME 200 body.
        ReactionOutcome.Changed or ReactionOutcome.Unchanged => Results.Ok(result.State),

        // Fail closed: no exercise resolved for this request.
        ReactionOutcome.ScopeUnresolved => Results.Unauthorized(),

        // Known caller, but not a participant with a persona in this exercise (DP-10).
        ReactionOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),

        // Unknown, taken down, or another exercise's post: one indistinguishable 404 (DP-16).
        ReactionOutcome.UnknownPost => Results.NotFound(),

        ReactionOutcome.Invalid => Results.BadRequest(result.ValidationError),

        // Unreachable; fail closed rather than emit a bare 200.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
