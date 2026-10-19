namespace Pulse.WebApi.Features.Org.PeopleDirectory;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The org directory's HTTP surface (identity-auth-roles/19, ADMIN-IDENTITY-MODEL §1.1 / §7.1), all org-admin only on an
/// org-scope session:
/// <list type="bullet">
///   <item><description><c>GET /api/org/people?search=&amp;page=&amp;pageSize=</c> — one page of the caller's organization's
///   people.</description></item>
///   <item><description><c>GET /api/org/people/{personId}</c> — one person.</description></item>
///   <item><description><c>PATCH /api/org/people/{personId}</c> — <c>{ "isOrgAdmin": bool }</c> or
///   <c>{ "disabled": bool }</c> (exactly one).</description></item>
/// </list>
/// </summary>
/// <remarks>
/// <b>WIRING:</b> the 3 additive <c>Program.cs</c> lines were approved by the orchestrator for this PR (#574): the
/// <c>using Pulse.WebApi.Features.Org.PeopleDirectory;</c> directive, <c>builder.Services.AddOrgPeople();</c> after
/// <c>AddExerciseLifecycleAdmin()</c>, and <c>app.MapOrgPeopleEndpoints();</c> with the other <c>/api/org/*</c> routes
/// (after <c>UseOrganizationResolution()</c>, like every org route). No organization id appears in any route, query or
/// body: the tenant is the caller's own, resolved server-side. The id-taking routes are on <see cref="PersonIdRoutes"/>,
/// the allow-list <c>CompositionRootWiringTests</c> pins, each driven by a foreign-tenant bare-404 test.
/// </remarks>
public static class OrgPeopleEndpoints
{
    /// <summary>The directory collection route.</summary>
    public const string PeopleRoute = "/api/org/people";

    /// <summary>One person of the caller's organization.</summary>
    public const string PersonRoute = "/api/org/people/{personId:guid}";

    /// <summary>The org-tier routes of this slice that take a PERSON id (the allow-list).</summary>
    public static IReadOnlySet<(string Method, string Route)> PersonIdRoutes { get; } =
        new HashSet<(string Method, string Route)> { ("GET", PersonRoute), ("PATCH", PersonRoute) };

    /// <summary>Registers the directory service (Scoped, matching the <c>PulseDbContext</c> unit of work).</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection.</returns>
    public static IServiceCollection AddOrgPeople(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<OrgPeopleService>();

        // Converge with the slices that already register these (TryAdd: same singletons / scoped services, any order).
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddScoped<StaffCallerContext>();
        services.TryAddSingleton<SessionConnectionRegistry>();
        services.TryAddSingleton<ISessionConnectionRevoker, SessionConnectionRevoker>();

        return services;
    }

    /// <summary>Maps the three directory routes, each gated org-admin only.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same builder.</returns>
    public static IEndpointRouteBuilder MapOrgPeopleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(PeopleRoute, ListAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        endpoints.MapGet(PersonRoute, GetAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        endpoints.MapPatch(PersonRoute, UpdateAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        return endpoints;
    }

    private static async Task<IResult> ListAsync(
        [FromQuery] string? search,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        [FromServices] OrgPeopleService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.ListAsync(search, page, pageSize, cancellationToken));

    private static async Task<IResult> GetAsync(
        Guid personId,
        [FromServices] OrgPeopleService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.GetAsync(personId, cancellationToken));

    private static async Task<IResult> UpdateAsync(
        Guid personId,
        [FromBody] UpdateOrgPersonRequest? request,
        [FromServices] OrgPeopleService service,
        CancellationToken cancellationToken) =>
        ToResult(await service.UpdateAsync(personId, request, cancellationToken));

    /// <summary>
    /// Maps a result to a status. <c>NotFound</c> is a BARE 404 with no body — the same for another customer's person as
    /// for an id that never existed.
    /// </summary>
    private static IResult ToResult(OrgPeopleResult result) => result.Outcome switch
    {
        OrgPeopleOutcome.Ok when result.Page is { } page => Results.Ok(page),
        OrgPeopleOutcome.Ok when result.Person is { } person => Results.Ok(person),
        OrgPeopleOutcome.Invalid => Results.BadRequest(new OrgPeopleErrorDto { Error = result.Error ?? OrgPeopleService.InvalidRequestError }),
        OrgPeopleOutcome.Unauthenticated => Results.Unauthorized(),
        OrgPeopleOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
        OrgPeopleOutcome.NotFound => Results.NotFound(),
        OrgPeopleOutcome.Conflict => Results.Conflict(new OrgPeopleErrorDto { Error = result.Error ?? string.Empty }),

        // Unreachable: an Ok outcome always carries a body. Fail closed rather than 200 an empty one.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };
}
