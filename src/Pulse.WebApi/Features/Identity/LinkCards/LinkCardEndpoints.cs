namespace Pulse.WebApi.Features.Identity.LinkCards;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Net.Http.Headers;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The card-sheet endpoint of easy participant login (story 04): <c>GET /api/staff/roster/cards</c>, which returns a
/// printable card per participant with their join URL and a server-rendered QR of it (EL-12). Staff world: it feeds
/// the print preview (story 12). Thin handler: parse, call <see cref="LinkCardService"/>, map the result.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call it (EL-13).</b> <see cref="EngineCockpitStaffAuthorizationFilter"/> then
/// <see cref="RosterStaffRoleFilter"/>: <c>401</c> with no staff session (a participant, read-only or anonymous
/// caller) or no resolved exercise, <c>403</c> for a staff user not assigned to the resolved exercise or assigned as
/// anything but controller or planner.
/// </para>
/// <para>
/// <b>Status contract.</b> <c>200</c> <see cref="RosterCardsDto"/>; <c>400</c> ProblemDetails for more than
/// <see cref="EasyLoginOptions.MaxCardsPerRequest"/> <c>id</c>s; <c>409</c> ProblemDetails when
/// <c>Authentication:FrontendBaseUrl</c> is not usable ("join links are not configured"). Every response the handler
/// writes carries <c>Cache-Control: no-store</c>, because a sheet holds bearer credentials.
/// </para>
/// <para>
/// <b>No exercise id anywhere.</b> The route, query and body name no exercise: the scope is the server-resolved
/// <c>IExerciseContext</c> (COR-001). The literal <c>cards</c> segment cannot collide with story 03's
/// <c>/api/staff/roster/{id:guid}/…</c> routes (a <c>guid</c> constraint, and more segments).
/// </para>
/// </remarks>
public static class LinkCardEndpoints
{
    /// <summary>The card-sheet route.</summary>
    public const string CardsRoute = "/api/staff/roster/cards";

    /// <summary>The repeatable query parameter naming one account (<c>?id=a&amp;id=b</c>).</summary>
    public const string IdQueryParameter = "id";

    /// <summary>The <c>Cache-Control</c> value on every handler response.</summary>
    public const string NoStore = "no-store";

    /// <summary>
    /// Registers the card sheet: <see cref="QrSvgRenderer"/> (singleton, stateless) and <see cref="LinkCardService"/>
    /// (scoped, matching <c>PulseDbContext</c>). Prerequisites the host wires first: persistence and exercise scoping,
    /// <c>AddExerciseClock()</c>, <c>AddStaffIdentity()</c> (the staff gate and the acting human) and
    /// <c>AddEasyLoginFoundation()</c> (options, URL builder, facts reader, link DTO factory). Idempotent.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddLinkCards(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<QrSvgRenderer>();
        services.TryAddScoped<LinkCardService>();

        return services;
    }

    /// <summary>Maps <c>GET /api/staff/roster/cards</c> behind the staff gate and the controller-or-planner gate.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapLinkCardEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(CardsRoute, GetCardsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>();

        return endpoints;
    }

    /// <summary>
    /// Builds the card sheet. <paramref name="id"/> binds the repeated <c>id</c> query values; none at all means every
    /// participant. The service is <c>[FromServices]</c> explicitly so a host missing <c>AddLinkCards()</c> fails
    /// loudly instead of binding it from the request.
    /// </summary>
    private static async Task<IResult> GetCardsAsync(
        [FromQuery(Name = IdQueryParameter)] string[]? id,
        [FromServices] LinkCardService service,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        // A sheet is a stack of bearer credentials: no cache, browser or proxy, may keep any answer from here.
        httpContext.Response.Headers[HeaderNames.CacheControl] = NoStore;

        var result = await service.GenerateAsync(id ?? [], cancellationToken);

        return result.Outcome switch
        {
            LinkCardOutcome.Ok when result.Sheet is { } sheet => Results.Json(sheet),
            LinkCardOutcome.TooManyIds => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            LinkCardOutcome.JoinLinksUnavailable => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status409Conflict),
            LinkCardOutcome.Unauthenticated => Results.Unauthorized(),
            LinkCardOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),

            // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
