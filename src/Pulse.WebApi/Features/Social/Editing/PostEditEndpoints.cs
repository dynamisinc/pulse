namespace Pulse.WebApi.Features.Social.Editing;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>
/// Edit own post (demo-feedback story 19): <c>PATCH /api/posts/{postId}</c> and <c>GET /api/posts/{postId}/edits</c>.
/// Exposes the composition-root extension methods <see cref="AddPostEditing"/> / <see cref="MapPostEditing"/>; the
/// orchestrator wires them into <c>Program.cs</c> (seam S-5) — this slice never edits it.
/// </summary>
/// <remarks>
/// Both routes sit under <c>/api/posts</c>, which <c>ExerciseLifecycleGatingMiddleware</c> already covers by segment
/// prefix, so a participant in a <c>build</c> / <c>completed</c> / <c>archived</c> exercise is refused before either
/// handler runs. The PATCH is a participant sim WRITE and is mapped behind <c>DenyReadOnlySessions()</c> here (COR-015);
/// the history GET is a read every session in the exercise may make (a read-only observer included).
/// </remarks>
public static class PostEditEndpoints
{
    /// <summary>The edit route.</summary>
    public const string EditRoute = "/api/posts/{postId:guid}";

    /// <summary>The history route.</summary>
    public const string HistoryRoute = "/api/posts/{postId:guid}/edits";

    /// <summary>
    /// Registers <see cref="PostEditService"/> (Scoped) and <c>TryAdd</c>s what it needs so the slice stands on its
    /// own: the session-persona accessor, the exercise-facts reader, the participant projector's fail-closed fallbacks
    /// and the system <see cref="TimeProvider"/>. The staff-session accessor is deliberately NOT registered here (the
    /// identity slice owns it), nor the broadcaster (the realtime slice), the clock or the pause tiers (optional).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPostEditing(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddHttpContextAccessor();
        services.TryAddScoped<ICurrentSessionPersonaAccessor, CurrentSessionPersonaAccessor>();
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddScoped<IReadOnlySessionProbe, ReadOnlySessionProbe>();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddPostSeamFallbacks();
        services.TryAddParticipantWriteGate();
        services.AddScoped<PostEditService>();

        return services;
    }

    /// <summary>Maps <c>PATCH /api/posts/{postId}</c> (read-only sessions refused) and <c>GET /api/posts/{postId}/edits</c>.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPostEditing(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // A sim WRITE: a shared read-only session is refused (403) before the handler runs (COR-015). Same body cap as
        // POST /api/posts.
        endpoints.MapGroup(string.Empty)
            .DenyReadOnlySessions()

            // #379: the shared held-world refusal (409 frozen) every participant write carries; the service asks the
            // same gate, so a direct service call is refused identically.
            .RefuseWhenWritesPaused()
            .MapPatch(EditRoute, EditPostAsync)
            .WithMetadata(new RequestSizeLimitAttribute(PostWriteEndpoints.MaxRequestBodyBytes));

        endpoints.MapGet(HistoryRoute, GetHistoryAsync);

        return endpoints;
    }

    /// <summary>Edits the caller's own post: 200 post, 400 invalid text, 401 no scope, 403 not yours, 404 not here, 409 refused.</summary>
    /// <param name="postId">The post id.</param>
    /// <param name="request">The new text.</param>
    /// <param name="service">The edit service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>The mapped result.</returns>
    private static async Task<IResult> EditPostAsync(
        Guid postId,
        EditPostRequest? request,
        PostEditService service,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Results.BadRequest("A JSON body with text is required.");
        }

        var result = await service.EditAsync(postId, request, cancellationToken);
        return result.Outcome switch
        {
            PostEditOutcome.Edited or PostEditOutcome.Unchanged when result.View is { } view => Results.Json(view),
            PostEditOutcome.ScopeUnresolved => Results.Unauthorized(),

            // Bare, like the create path's identity refusals: the reason helps a prober and nobody else.
            PostEditOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            PostEditOutcome.NotFound => Results.NotFound(),
            PostEditOutcome.Invalid => Results.BadRequest(result.ValidationError),
            PostEditOutcome.Refused => Results.Json(
                new PostEditRefusalDto { Reason = result.RefusalReason! }, statusCode: StatusCodes.Status409Conflict),
            PostEditOutcome.Conflict => Results.StatusCode(StatusCodes.Status409Conflict),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>Reads a post's versions, newest first: 200, 401 no scope, 404 not here or taken down.</summary>
    /// <param name="postId">The post id.</param>
    /// <param name="service">The edit service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>The mapped result.</returns>
    private static async Task<IResult> GetHistoryAsync(
        Guid postId,
        PostEditService service,
        CancellationToken cancellationToken)
    {
        var result = await service.GetHistoryAsync(postId, cancellationToken);
        return result.Outcome switch
        {
            PostEditHistoryOutcome.Ok when result.History is { } history => Results.Json(history),
            PostEditHistoryOutcome.ScopeUnresolved => Results.Unauthorized(),
            PostEditHistoryOutcome.NotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
