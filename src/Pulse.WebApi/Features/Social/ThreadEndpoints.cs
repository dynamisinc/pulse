namespace Pulse.WebApi.Features.Social;

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Data;

/// <summary>
/// The flattened-thread read endpoint (<c>GET /api/threads/{postId}</c>, SOC-010). Stands in for the frozen
/// frontend <c>useThread.resolveThread()</c> mock adapter, returning the three-part
/// <see cref="ThreadResponseDto"/> its <c>isValidThreadResponse</c> guard accepts unchanged. Minimal-API
/// extension method (the <c>Map*</c> convention); the shared <see cref="PostReadService"/> is registered by
/// <see cref="FeedEndpoints.AddSocialFeedRead"/>. The orchestrator wires
/// <see cref="MapSocialThreadEndpoints"/> into <c>Program.cs</c>; no builder edits it.
/// </summary>
public static class ThreadEndpoints
{
    /// <summary>
    /// Maps <c>GET /api/threads/{postId}</c> — the flattened thread focused on <c>postId</c> (SOC-010). B1
    /// has no parent/reply model, so <see cref="ThreadResponseDto.Ancestors"/> and
    /// <see cref="ThreadResponseDto.Replies"/> are always empty and only <see cref="ThreadResponseDto.Focused"/>
    /// carries data. Scope comes ONLY from the injected <see cref="IExerciseContext"/> (COR-001); an
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
            PostReadService readService,
            CancellationToken cancellationToken) =>
        {
            // Fail closed on an unresolvable scope (per-request scope population is Phase B2), before any
            // lookup or parse.
            if (exerciseContext.CurrentExerciseId is null)
            {
                return Results.Unauthorized();
            }

            // CONTRACT + [Tier-2] ISOLATION reconciliation (why this is 200-with-nulls, never 404):
            //   * The frozen client `resolveThread` (features/social/hooks/useThread.ts) THROWS on ANY
            //     non-2xx, and its `isValidThreadResponse` ACCEPTS `focused: null` with empty
            //     ancestors/replies. So an unknown OR cross-exercise postId MUST return
            //     200 { ancestors: [], focused: null, replies: [] } — a 404 would crash the participant view.
            //   * The central query filter makes a cross-exercise id INDISTINGUISHABLE from an unknown one
            //     (both are simply "not in scope"), so this single not-found path IS the Tier-2 isolation
            //     guarantee: exercise B's content is never returned, and a B-owned id yields a response
            //     byte-identical to an unknown id — leaking nothing, not even existence.
            //   * An UNPARSEABLE id is likewise not-found (never a 500): no Guid can be in scope, so it takes
            //     the same 200-with-null path.
            if (!Guid.TryParse(postId, out var focusedPostId))
            {
                return Results.Ok(ThreadResponseDto.NotFound);
            }

            var focused = await readService.GetThreadAsync(focusedPostId, cancellationToken);
            return Results.Ok(new ThreadResponseDto(
                Array.Empty<ParticipantPostDto>(),
                focused,
                Array.Empty<object>()));
        });

        return endpoints;
    }
}

/// <summary>
/// The wire shape of <c>GET /api/threads/{postId}</c> — the server-side mirror of the frozen frontend
/// <c>ThreadWireResponse</c> (<c>useThread.ts</c>): <c>ancestors</c> oldest-first, the <c>focused</c> post
/// or <c>null</c>, and <c>replies</c>. Every member is participant-safe (<see cref="ParticipantPostDto"/>,
/// XC-002). Serialized camelCase via the explicit property names so the shape is self-evident and
/// independent of host serializer config; <see cref="Focused"/> is emitted as <c>null</c> (never omitted)
/// when absent, which the client's <c>isValidThreadResponse</c> requires.
/// </summary>
/// <param name="Ancestors">
/// The ancestor chain oldest-first (unbounded depth per D1-006). Always empty in B1 — a
/// <see cref="Data.Entities.Post"/> is post-only this phase, with no parent model.
/// </param>
/// <param name="Focused">The focused post, or <c>null</c> when the id is unknown, out of scope, or unparseable.</param>
/// <param name="Replies">
/// The focused post's direct replies. Always empty in B1 (no reply model); typed as <c>object</c> because no
/// reply shape is modelled yet, and an empty array trivially satisfies the client's per-reply guard.
/// </param>
public sealed record ThreadResponseDto(
    [property: JsonPropertyName("ancestors")] IReadOnlyList<ParticipantPostDto> Ancestors,
    [property: JsonPropertyName("focused")] ParticipantPostDto? Focused,
    [property: JsonPropertyName("replies")] IReadOnlyList<object> Replies)
{
    /// <summary>
    /// The shared not-found response — <c>{ ancestors: [], focused: null, replies: [] }</c> — returned for an
    /// unknown, cross-exercise, or unparseable id. A single instance because it is immutable and carries no
    /// per-request data (the [Tier-2] guarantee that every not-found is byte-identical).
    /// </summary>
    public static ThreadResponseDto NotFound { get; } = new(
        Array.Empty<ParticipantPostDto>(),
        null,
        Array.Empty<object>());
}
