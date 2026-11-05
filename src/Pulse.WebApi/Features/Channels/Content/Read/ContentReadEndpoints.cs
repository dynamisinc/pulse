namespace Pulse.WebApi.Features.Channels.Content.Read;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;

/// <summary>
/// The participant content read API (channels-foundation story 06, FC-4): the list, the permalink read and the in-sim
/// link-card resolver. All GET, all read-only.
/// </summary>
/// <remarks>
/// <para>
/// <b>Routes.</b> One literal route group per content channel (<c>/api/channels/news/content</c>, <c>…/press/…</c>,
/// <c>…/weather/…</c>), each behind <c>RequireChannelEnabled(channel)</c> (story 08), so a disabled channel is the same
/// bare 404 as an unmapped route and an unknown channel id simply matches no route. <c>GET /api/link-previews?path=</c> is
/// channel-agnostic (Social calls it); its resolver applies the same enablement rule to the path's channel.
/// </para>
/// <para>
/// <b>One 404.</b> Every not-found answer here is a bare <c>Results.NotFound()</c>, byte-identical to the gate's and to
/// the host's unknown-route 404 (XC-001/COR-001): a draft, a scheduled release, a soft-deleted item, a disabled outlet and
/// another exercise's item cannot be told apart from a slug that never existed. An unresolved scope is a 401 (fail
/// closed); a malformed <c>limit</c>/<c>cursor</c> is a 400 ProblemDetails.
/// </para>
/// </remarks>
public static class ContentReadEndpoints
{
    /// <summary>Registers the read service, the participant projector and <see cref="IInSimLinkResolver"/> (all scoped).</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddContentRead(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<ParticipantContentProjector>();
        services.TryAddScoped<ContentReadService>();
        services.TryAddScoped<IInSimLinkResolver, InSimLinkResolver>();
        return services;
    }

    /// <summary>Maps <c>/api/channels/{news|press|weather}/content*</c> and <c>/api/link-previews</c>.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapContentRead(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        foreach (var channelId in ChannelVocabulary.ContentChannelIds)
        {
            var channel = endpoints
                .MapGroup($"/api/channels/{channelId}/content")
                .RequireChannelEnabled(channelId);

            channel.MapGet(string.Empty, (
                [FromQuery] string? outlet,
                [FromQuery] string? category,
                [FromQuery] bool? featured,
                [FromQuery] int? limit,
                [FromQuery] string? cursor,
                [FromServices] ContentReadService reads,
                CancellationToken cancellationToken) =>
                ListAsync(reads, channelId, outlet, category, featured, limit, cursor, cancellationToken));

            channel.MapGet("/{outletSlug}/{contentSlug}", (
                string outletSlug,
                string contentSlug,
                [FromServices] ContentReadService reads,
                CancellationToken cancellationToken) =>
                PermalinkAsync(reads, channelId, outletSlug, contentSlug, cancellationToken));
        }

        endpoints.MapGet("/api/link-previews", LinkPreviewAsync);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        ContentReadService reads,
        string channelId,
        string? outlet,
        string? category,
        bool? featured,
        int? limit,
        string? cursor,
        CancellationToken cancellationToken) =>
        ToResult(await reads.ListAsync(channelId, outlet, category, featured ?? false, limit, cursor, cancellationToken));

    private static async Task<IResult> PermalinkAsync(
        ContentReadService reads,
        string channelId,
        string outletSlug,
        string contentSlug,
        CancellationToken cancellationToken) =>
        ToResult(await reads.GetPermalinkAsync(channelId, outletSlug, contentSlug, cancellationToken));

    private static async Task<IResult> LinkPreviewAsync(
        [FromQuery] string? path,
        [FromServices] IExerciseContext exerciseContext,
        [FromServices] IInSimLinkResolver resolver,
        CancellationToken cancellationToken)
    {
        if (exerciseContext.CurrentExerciseId is not { } exerciseId || exerciseId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var preview = path is null ? null : await resolver.ResolveAsync(path, cancellationToken);
        return preview is null ? Results.NotFound() : Results.Json(preview);
    }

    /// <summary>Maps a read result onto exactly one status: fail closed, never a default/empty <c>200</c>.</summary>
    private static IResult ToResult<TValue>(ContentReadResult<TValue> result)
        where TValue : class => result.Outcome switch
        {
            ContentReadOutcome.Ok when result.Value is { } value => Results.Json<object>(value),
            ContentReadOutcome.NotFound => Results.NotFound(),
            ContentReadOutcome.Invalid => Results.Problem(detail: result.Error, statusCode: StatusCodes.Status400BadRequest),
            ContentReadOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
}
