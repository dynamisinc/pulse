namespace Pulse.WebApi.Features.Social;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// The flattened-thread read endpoint (<c>GET /api/threads/{postId}</c>, SOC-010) and the reply-parent resolver
/// registration (demo-polish B2). Returns the three-part <see cref="ThreadResponseDto"/> that the frozen frontend
/// <c>useThread.resolveThread()</c> guard (<c>isValidThreadResponse</c>) accepts. The orchestrator wires
/// <see cref="AddSocialThreads"/> and <see cref="MapSocialThreadEndpoints"/> into <c>Program.cs</c>.
/// </summary>
public static class ThreadEndpoints
{
    /// <summary>
    /// Registers the thread read (<see cref="ThreadReadService"/>) and the real <see cref="IReplyParentResolver"/>
    /// (<see cref="ReplyParentResolver"/>), both Scoped to match the request's <see cref="PulseDbContext"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The resolver is registered with a plain <c>AddScoped</c>, NOT <c>TryAdd</c>. BP's post-write slice registers
    /// a <c>TryAdd</c> fallback resolver, and this registration must win in either order: if the fallback was added
    /// first, this later registration is the one resolved; if this one was added first, the fallback's
    /// <c>TryAdd</c> does nothing.
    /// </para>
    /// <para>
    /// <c>ICurrentSessionPersonaAccessor</c> is <c>TryAdd</c>ed (as the feed and post-write slices do) so this slice
    /// does not depend on another slice having registered it first. <see cref="ThreadReadService"/> REQUIRES
    /// <see cref="IParticipantPostProjector"/> (Gate-2 integration, B2 M-2), which BP owns: like every other Social
    /// registration, this one calls BP's idempotent <c>TryAddPostSeamFallbacks</c>, so the projector is present
    /// whichever Social extension runs first, and the real resolver, reader and signer still win (they are plain
    /// <c>Add*</c> registrations).
    /// </para>
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSocialThreads(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddHttpContextAccessor();
        services.TryAddScoped<ICurrentSessionPersonaAccessor, CurrentSessionPersonaAccessor>();

        services.AddScoped<IReplyParentResolver, ReplyParentResolver>();
        services.TryAddPostSeamFallbacks();
        services.TryAddScoped<ThreadReadService>();

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/threads/{postId}</c>: the thread focused on <c>postId</c>, with ancestors from root to
    /// parent, the focused post, and its direct replies oldest first (SOC-010, D1-006). Soft-deleted replies are
    /// tombstones (D1-009). Scope comes ONLY from the injected <see cref="IExerciseContext"/> (COR-001); an
    /// unresolved scope FAILS CLOSED with <c>401 Unauthorized</c>.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialThreadEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // The route captures {postId} as a raw string (NOT a ':guid' route constraint) so an unparseable id
        // reaches the handler and resolves to the not-found shape below rather than a framework 404/400 —
        // see the contract note in the handler.
        endpoints.MapGet("/api/threads/{postId}", async (
            string postId,
            IExerciseContext exerciseContext,
            HttpContext httpContext,
            CancellationToken cancellationToken) =>
        {
            // Fail closed on an unresolvable scope, before any lookup or parse.
            if (exerciseContext.CurrentExerciseId is null)
            {
                return Results.Unauthorized();
            }

            // CONTRACT + [Tier-2] ISOLATION reconciliation (why a missing thread is 200-with-nulls, never 404):
            //   * The frozen client `resolveThread` (features/social/hooks/useThread.ts) THROWS on ANY
            //     non-2xx, and its `isValidThreadResponse` ACCEPTS `focused: null` with empty
            //     ancestors/replies. So an unknown OR cross-exercise postId MUST return
            //     200 { ancestors: [], focused: null, replies: [] } — a 404 would crash the participant view.
            //   * The central query filter makes a cross-exercise id INDISTINGUISHABLE from an unknown one
            //     (both are simply "not in scope"), so this single not-found path IS the Tier-2 isolation
            //     guarantee: exercise B's content is never returned, and a B-owned id yields a response
            //     byte-identical to an unknown id — leaking nothing, not even existence.
            //   * An UNPARSEABLE or SOFT-DELETED focused id takes the same path (ThreadReadService returns the
            //     shared ThreadResponseDto.NotFound instance for all of them), never a 500.
            //
            // AddSocialThreads() registers ThreadReadService. Before B2, AddSocialFeedRead() + this Map call were the
            // whole contract for this route, and hand-built hosts still compose it that way. AddSocialFeedRead()
            // registers every dependency ThreadReadService needs, so in such a host it is constructed for the
            // request instead of failing (a missing registration would otherwise make minimal APIs infer it as the
            // request BODY and refuse to build the endpoint).
            var threadReadService =
                ActivatorUtilities.GetServiceOrCreateInstance<ThreadReadService>(httpContext.RequestServices);
            return Results.Ok(await threadReadService.GetThreadAsync(postId, cancellationToken));
        });

        return endpoints;
    }
}

/// <summary>
/// The wire shape of <c>GET /api/threads/{postId}</c>: the server-side mirror of the frozen frontend
/// <c>ThreadWireResponse</c> (<c>useThread.ts</c>), with <c>ancestors</c> root first, the <c>focused</c> post or
/// <c>null</c>, and <c>replies</c> oldest first. Every member is participant-safe (XC-002). Serialized camelCase
/// through explicit property names. <see cref="Focused"/> is written as <c>null</c> (never omitted) when absent,
/// because the client's <c>isValidThreadResponse</c> requires the key.
/// </summary>
/// <param name="Ancestors">
/// The visible ancestor chain, root first and the direct parent last (D1-006: flattened). Soft-deleted ancestors
/// are omitted; the walk is capped at <see cref="ThreadReadService.MaxAncestorDepth"/> hops.
/// </param>
/// <param name="Focused">The focused post, or <c>null</c> when the id is unknown, out of scope, unparseable or soft-deleted.</param>
/// <param name="Replies">
/// The focused post's direct replies, oldest first by scenario time. Typed as <see cref="ThreadReplyDto"/> (not the
/// base class) so the reply-only members are serialized (DP-17).
/// </param>
public sealed record ThreadResponseDto(
    [property: JsonPropertyName("ancestors")] IReadOnlyList<ParticipantPostDto> Ancestors,
    [property: JsonPropertyName("focused")] ParticipantPostDto? Focused,
    [property: JsonPropertyName("replies")] IReadOnlyList<ThreadReplyDto> Replies)
{
    /// <summary>
    /// The shared not-found response — <c>{ ancestors: [], focused: null, replies: [] }</c> — returned for an
    /// unknown, cross-exercise, unparseable or soft-deleted focused id. A single instance because it is immutable
    /// and carries no per-request data (the [Tier-2] guarantee that every not-found is byte-identical).
    /// </summary>
    public static ThreadResponseDto NotFound { get; } = new(
        Array.Empty<ParticipantPostDto>(),
        null,
        Array.Empty<ThreadReplyDto>());
}
