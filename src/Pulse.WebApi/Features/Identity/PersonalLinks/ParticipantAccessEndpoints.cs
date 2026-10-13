namespace Pulse.WebApi.Features.Identity.PersonalLinks;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The four staff routes over one participant's access (easy-login/03, frozen contract):
/// <c>POST /api/staff/roster/{id}/link/reissue</c>, <c>…/link/revoke</c>, <c>…/disable</c> and <c>…/enable</c>. Mapped by
/// <see cref="PersonalLinkExtensions.MapPersonalLinkEndpoints"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Gate (EL-13).</b> Every route sits behind <see cref="EngineCockpitStaffAuthorizationFilter"/> then
/// <see cref="RosterStaffRoleFilter"/>: <c>401</c> with no staff session or no resolved scope, <c>403</c> when not
/// assigned to the resolved exercise or not a controller/planner there. Participants and anonymous callers never reach
/// a handler.
/// </para>
/// <para>
/// <b>No exercise id anywhere.</b> <c>{id}</c> is the participant's account id, declared <c>{id:guid}</c> so a malformed
/// id is a 404 like an unknown one; the exercise is always the server-resolved scope, and an account from another
/// exercise is the same <c>404</c> ProblemDetails as an unknown id.
/// </para>
/// <para>
/// <b>Responses.</b> <c>200</c> <see cref="RosterActionResultDto"/> (its <c>link.joinUrl</c> is a secret, returned to
/// staff only); <c>404</c> ProblemDetails with a readable <c>detail</c>. Every response carries
/// <c>Cache-Control: no-store</c>.
/// </para>
/// </remarks>
public static class ParticipantAccessEndpoints
{
    /// <summary>The route group prefix: one participant on the roster, by account id.</summary>
    public const string ParticipantRoute = "/api/staff/roster/{id:guid}";

    /// <summary>The readable 404 detail, identical for an unknown id and another exercise's id.</summary>
    public const string NotFoundDetail = "No participant with that id is on this exercise's roster.";

    /// <summary>Maps the four staff routes behind the staff and roster-role gates.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The route group (for tests that inspect its endpoints).</returns>
    internal static RouteGroupBuilder MapParticipantAccessEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // Order matters: no-store first so even a 401/403 is not cached, then assigned staff, then controller/planner.
        var participant = endpoints
            .MapGroup(ParticipantRoute)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>();

        participant.MapPost("/link/reissue", ReissueAsync);
        participant.MapPost("/link/revoke", RevokeAsync);
        participant.MapPost("/disable", DisableAsync);
        participant.MapPost("/enable", EnableAsync);

        return participant;
    }

    private static async Task<IResult> ReissueAsync(
        Guid id, [FromServices] ParticipantAccessService service, CancellationToken cancellationToken) =>
        ToResult(await service.ReissueAsync(id, cancellationToken));

    private static async Task<IResult> RevokeAsync(
        Guid id, [FromServices] ParticipantAccessService service, CancellationToken cancellationToken) =>
        ToResult(await service.RevokeAsync(id, cancellationToken));

    private static async Task<IResult> DisableAsync(
        Guid id, [FromServices] ParticipantAccessService service, CancellationToken cancellationToken) =>
        ToResult(await service.DisableAsync(id, cancellationToken));

    private static async Task<IResult> EnableAsync(
        Guid id, [FromServices] ParticipantAccessService service, CancellationToken cancellationToken) =>
        ToResult(await service.EnableAsync(id, cancellationToken));

    /// <summary>Maps a service result to its status: fail closed, never a default 200.</summary>
    private static IResult ToResult(ParticipantAccessResult result) => result.Outcome switch
    {
        ParticipantAccessOutcome.Ok when result.Body is { } body => Results.Ok(body),
        ParticipantAccessOutcome.NotFound => Results.Problem(detail: NotFoundDetail, statusCode: StatusCodes.Status404NotFound),
        ParticipantAccessOutcome.Unauthenticated => Results.Unauthorized(),
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}

/// <summary>
/// Marks every response of the routes it wraps <c>Cache-Control: no-store</c> (the frozen contract's rule for staff
/// responses: a <c>RosterActionResultDto</c> can carry a join URL, a bearer credential). Set before the next filter
/// runs, so a gate's 401/403 carries it too. No dependencies; created by the filter factory.
/// </summary>
internal sealed class NoStoreEndpointFilter : IEndpointFilter
{
    /// <inheritdoc />
    public ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        context.HttpContext.Response.Headers.CacheControl = "no-store";
        return next(context);
    }
}
