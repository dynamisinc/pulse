namespace Pulse.WebApi.Features.Social;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;

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

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/feed</c> — the current exercise's public post set, newest scenario time first
    /// (SOC-080, COR-053), each item participant-safe (XC-002). Scope comes ONLY from the injected
    /// <see cref="IExerciseContext"/> (COR-001), never a client parameter; an unresolved scope FAILS CLOSED
    /// with <c>401 Unauthorized</c> rather than a default, empty-but-200, or unscoped result.
    /// </summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapSocialFeedEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/feed", async (
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

            var feed = await readService.GetFeedAsync(cancellationToken);
            return Results.Ok(feed);
        });

        return endpoints;
    }
}
