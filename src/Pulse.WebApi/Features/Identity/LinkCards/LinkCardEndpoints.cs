namespace Pulse.WebApi.Features.Identity.LinkCards;

using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Net.Http.Headers;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The card-sheet endpoint of easy participant login (story 04): <c>POST /api/staff/roster/cards</c>, which returns a
/// printable card per participant with their join URL and a server-rendered QR of it (EL-12). Staff world: it feeds
/// the print preview (story 12). Thin handler: read the body strictly, call <see cref="LinkCardService"/>, map the result.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why POST (EL-20).</b> 500 account ids in a query string (about 20 KB) exceed Kestrel's 8 KB request line (a
/// <c>414</c> above roughly 203 ids), and array spellings like <c>?id[]=</c> silently bound to an empty list, which
/// meant "everyone". The body is EXACTLY one of <c>{ "participantIds": [ … ] }</c> (1 to
/// <see cref="EasyLoginOptions.MaxCardsPerRequest"/>) or <c>{ "all": true }</c>, read with
/// <see cref="RosterCardsRequestBody.StrictJson"/>, and bounded at <see cref="MaxRequestBodyBytes"/>.
/// </para>
/// <para>
/// <b>Who may call it (EL-13).</b> <see cref="EngineCockpitStaffAuthorizationFilter"/> then
/// <see cref="RosterStaffRoleFilter"/>: <c>401</c> with no staff session (a participant, read-only or anonymous
/// caller) or no resolved exercise, <c>403</c> for a staff user not assigned to the resolved exercise or assigned as
/// anything but controller or planner. The filters run BEFORE the handler, so an unauthorized caller's body is never
/// read.
/// </para>
/// <para>
/// <b>Status contract.</b> <c>200</c> <see cref="RosterCardsDto"/>; <c>400</c> ProblemDetails for a body that is not
/// JSON, is malformed, has an unknown or repeated property, has both or neither of the two members, an empty
/// <c>participantIds</c>, <c>all</c> other than <c>true</c>, or more than <see cref="EasyLoginOptions.MaxCardsPerRequest"/>
/// ids; <c>413</c> ProblemDetails for a body over <see cref="MaxRequestBodyBytes"/>; <c>409</c> ProblemDetails when
/// <c>Authentication:FrontendBaseUrl</c> is not usable ("join links are not configured"). Every response the handler
/// writes carries <c>Cache-Control: no-store</c>, because a sheet holds bearer credentials. (The filters' own 401/403
/// carry no body and are written before the handler runs.)
/// </para>
/// <para>
/// <b>No exercise id anywhere.</b> The route and body name no exercise: the scope is the server-resolved
/// <c>IExerciseContext</c> (COR-001). The literal <c>cards</c> segment cannot collide with story 03's
/// <c>/api/staff/roster/{id:guid}/…</c> routes (a <c>guid</c> constraint, and more segments).
/// </para>
/// </remarks>
public static class LinkCardEndpoints
{
    /// <summary>The card-sheet route.</summary>
    public const string CardsRoute = "/api/staff/roster/cards";

    /// <summary>The largest request body accepted, in bytes (64 KiB; 500 GUIDs are about 20 KB). Larger is a <c>413</c>.</summary>
    public const long MaxRequestBodyBytes = 64 * 1024;

    /// <summary>The <c>Cache-Control</c> value on every handler response.</summary>
    public const string NoStore = "no-store";

    /// <summary>The <c>detail</c> of a 400 for a body that is not the strict JSON shape (fixed text: no echo of the input).</summary>
    public const string MalformedBodyMessage =
        "The body must be JSON, exactly { \"participantIds\": [ \"…\" ] } or { \"all\": true }, with no other property.";

    /// <summary>
    /// Registers the card sheet: the easy-login kernel it reads through (<see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>,
    /// idempotent, so a missing seam line cannot turn into a 500 on the first request), <see cref="QrSvgRenderer"/>
    /// (singleton, stateless) and <see cref="LinkCardService"/> (scoped, matching <c>PulseDbContext</c>). The kernel's
    /// registrations are all <c>TryAdd</c>, so a real link issuer that story 03 <c>Replace</c>d stays in place whichever
    /// of the two calls runs first. Prerequisites the host wires: persistence and exercise scoping,
    /// <c>AddExerciseClock()</c> and <c>AddStaffIdentity()</c> (the staff gate, <c>StaffAssignmentService</c> and the
    /// acting human). Idempotent.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddLinkCards(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddEasyLoginFoundation();
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<QrSvgRenderer>();
        services.TryAddScoped<LinkCardService>();

        return services;
    }

    /// <summary>
    /// Maps <c>POST /api/staff/roster/cards</c> behind the staff gate and the controller-or-planner gate, with the
    /// 64 KiB body limit.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapLinkCardEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapPost(CardsRoute, PostCardsAsync)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>()
            .WithMetadata(new RequestSizeLimitAttribute(MaxRequestBodyBytes));

        return endpoints;
    }

    /// <summary>
    /// Builds the card sheet. The body is read here, not by parameter binding, so that EVERY malformed shape (not
    /// JSON, broken JSON, an unknown member, a wrong type) is a 400 ProblemDetails with a readable detail rather than a
    /// framework-dependent bare 400. The service is <c>[FromServices]</c> explicitly so a host missing
    /// <c>AddLinkCards()</c> fails loudly instead of binding it from the request.
    /// </summary>
    private static async Task<IResult> PostCardsAsync(
        HttpRequest request,
        [FromServices] LinkCardService service,
        CancellationToken cancellationToken)
    {
        // A sheet is a stack of bearer credentials: no cache, browser or proxy, may keep any answer from here.
        request.HttpContext.Response.Headers[HeaderNames.CacheControl] = NoStore;

        var (body, refusal) = await ReadBodyAsync(request, cancellationToken);
        if (refusal is not null)
        {
            return refusal;
        }

        var result = await service.GenerateAsync(body, cancellationToken);

        return result.Outcome switch
        {
            LinkCardOutcome.Ok when result.Sheet is { } sheet => Results.Json(sheet),
            LinkCardOutcome.Invalid or LinkCardOutcome.TooManyIds =>
                Results.Problem(detail: result.Message, statusCode: StatusCodes.Status400BadRequest),
            LinkCardOutcome.JoinLinksUnavailable => Results.Problem(detail: result.Message, statusCode: StatusCodes.Status409Conflict),
            LinkCardOutcome.Unauthenticated => Results.Unauthorized(),
            LinkCardOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),

            // Unreachable: every outcome is handled above. Fail closed rather than fall through to a 200.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// Reads the body as <see cref="RosterCardsRequestBody"/> with the strict settings. A JSON <c>null</c> comes back
    /// as a <c>null</c> body (the service refuses it with a readable 400); anything that is not JSON of the shape is a
    /// 400 here; a body over the route's limit is the server's 413.
    /// </summary>
    private static async Task<(RosterCardsRequestBody? Body, IResult? Refusal)> ReadBodyAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.HasJsonContentType())
        {
            return (null, Results.Problem(detail: MalformedBodyMessage, statusCode: StatusCodes.Status400BadRequest));
        }

        try
        {
            var body = await JsonSerializer.DeserializeAsync<RosterCardsRequestBody>(
                request.Body, RosterCardsRequestBody.StrictJson, cancellationToken);
            return (body, null);
        }
        catch (JsonException)
        {
            // Malformed JSON, an unknown / repeated / mis-cased member, or a wrong type. The exception text is not
            // echoed: a fixed detail cannot carry anything the caller sent.
            return (null, Results.Problem(detail: MalformedBodyMessage, statusCode: StatusCodes.Status400BadRequest));
        }
        catch (BadHttpRequestException exception)
        {
            // The server refused the body while it was read: over the route's 64 KiB limit (413), or a broken transfer.
            var tooLarge = exception.StatusCode == StatusCodes.Status413PayloadTooLarge;
            return (null, Results.Problem(
                detail: tooLarge
                    ? $"The request body is larger than {MaxRequestBodyBytes / 1024} KiB."
                    : "The request body could not be read.",
                statusCode: tooLarge ? StatusCodes.Status413PayloadTooLarge : StatusCodes.Status400BadRequest));
        }
    }
}
