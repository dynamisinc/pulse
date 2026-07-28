namespace Pulse.WebApi.Features.Social;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// The All Posts feed read endpoint (<c>GET /api/feed</c>, SOC-080) plus the DI registration its handler
/// and the thread endpoint share. Stands in for the frozen frontend <c>feedService.resolveFeed()</c> mock
/// adapter: the wire shape is a bare <see cref="ParticipantPostDto"/> array that satisfies
/// <c>feedService.ts</c>'s <c>isPost</c> guard without any consumer change. Minimal-API extension methods
/// (the <c>Map*</c> convention) — the orchestrator wires the single <see cref="MapSocialFeedEndpoints"/> /
/// <see cref="AddSocialFeedRead"/> pair into <c>Program.cs</c>; no builder edits it.
/// </summary>
public static class FeedEndpoints
{
    /// <summary>The default <c>?scope=</c> value — the All Posts feed (SOC-080). Also what an omitted parameter means.</summary>
    private const string AllFeedScope = "all";

    /// <summary>The <c>?scope=</c> value selecting the SOC-081 Following feed.</summary>
    private const string FollowingFeedScope = "following";

    /// <summary>
    /// Registers the participant read path (<see cref="PostReadService"/>) with a Scoped lifetime — matching
    /// the request-scoped <see cref="PulseDbContext"/> and <see cref="IExerciseContext"/> it depends on. Both
    /// <see cref="MapSocialFeedEndpoints"/> and <see cref="ThreadEndpoints.MapSocialThreadEndpoints"/>
    /// resolve the same service, so this is the single registration for the feature's read surface.
    /// </summary>
    /// <param name="services">The service collection to register into.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddSocialFeedRead(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<PostReadService>();

        // profiles-social-graph/07: the Following scope filters authors by the caller's follow graph, so the
        // read path depends on the follow services. The registration is idempotent (TryAdd), so calling it
        // here AND from AddSocialPersonaRead is safe and neither slice can be wired without its dependency.
        services.AddSocialFollowGraph();

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/feed</c> — the current exercise's public post set, newest scenario time first
    /// (SOC-080, COR-053), each item participant-safe (XC-002). Scope comes ONLY from the injected
    /// <see cref="IExerciseContext"/> (COR-001), never a client parameter; an unresolved scope FAILS CLOSED
    /// with <c>401 Unauthorized</c> rather than a default, empty-but-200, or unscoped result.
    /// </summary>
    /// <remarks>
    /// <b>Feed scoping (<c>profiles-social-graph/07</c>, consumed by <c>feeds-discovery/02</c>).</b> The
    /// optional <c>?scope=</c> query parameter selects the channel: <c>all</c> (the default, and what an
    /// omitted parameter means) is the All Posts feed; <c>following</c> is the SOC-081 Following feed —
    /// posts authored by personas the caller's session-bound persona follows. Parameterizing THIS endpoint
    /// rather than adding a second one lets the Following feed be a query-string toggle instead of a second
    /// integration. An unrecognized value is a <c>400</c>, never a silent fall-back to the unfiltered feed:
    /// a typo must not hand a participant the All Posts set while the UI labels it "Following".
    /// </remarks>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialFeedEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/feed", async (
            string? scope,
            IExerciseContext exerciseContext,
            PostReadService readService,
            CancellationToken cancellationToken) =>
        {
            // Fail closed on an unresolvable scope (per-request scope population is Phase B2). Never fall
            // through to a query, whose global filter would otherwise return an empty-but-200 result.
            if (exerciseContext.CurrentExerciseId is null)
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrEmpty(scope) || string.Equals(scope, AllFeedScope, StringComparison.OrdinalIgnoreCase))
            {
                return Results.Ok(await readService.GetFeedAsync(cancellationToken));
            }

            if (string.Equals(scope, FollowingFeedScope, StringComparison.OrdinalIgnoreCase))
            {
                return Results.Ok(await readService.GetFollowingFeedAsync(cancellationToken));
            }

            return Results.BadRequest($"scope must be '{AllFeedScope}' or '{FollowingFeedScope}'.");
        });

        return endpoints;
    }
}
