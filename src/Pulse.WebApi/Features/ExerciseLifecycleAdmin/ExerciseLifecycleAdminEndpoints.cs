namespace Pulse.WebApi.Features.ExerciseLifecycleAdmin;

using System.Collections.Generic;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// The HTTP surface of the exercise-lifecycle-administration slice — organization-tier staff endpoints that
/// operate ABOVE any single exercise (COR-074 creation, COR-075 list, COR-076 the org-admin surface family):
/// <c>POST /api/org/exercises</c>, <c>GET /api/org/exercises</c> and <c>GET /api/org/staff-assignments</c>.
/// Exposes the composition-root extensions the orchestrator wires into <c>Program.cs</c>; this slice never
/// edits <c>Program.cs</c> itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>The route prefix says which tier this is.</b> <c>/api/org/*</c> — not <c>/api/staff/*</c> — because every
/// existing <c>/api/staff/*</c> endpoint is scoped to the one server-resolved exercise, while these are scoped
/// to the caller's CUSTOMER TENANT and deliberately span exercises. No route, query or body here carries an
/// organization id in any form: the tenant is always the caller's own, resolved server-side.
/// </para>
/// <para>
/// <b>Exercise ids on the org tier (demo-feedback story 22).</b> Until story 22 no org route took any parameter.
/// The row actions (rename, archive) need one: an EXERCISE id, never an organization id. Each is on the explicit
/// <see cref="ExerciseIdRoutes"/> allow-list and is authorized by <see cref="ExerciseManagementService"/> against
/// the caller's server-resolved tenant (<c>InOrganization</c>) before anything else; another customer's id is a
/// bare <c>404</c>, indistinguishable from an id that does not exist, never a <c>403</c>.
/// </para>
/// <para>
/// <b>Two different gates, on purpose (COR-076).</b> The two exercise routes carry
/// <see cref="OrgAdminAuthorizationFilter.ExerciseAdministrators"/> (planner, org-admin or controller — stories
/// 01/02 said "a Planner or OrgAdmin session"; demo-feedback DF-20 added the controller); the staff-assignment
/// read carries <see cref="OrgAdminAuthorizationFilter.OrgAdminOnly"/>, which refuses a planner and a controller
/// too. That asymmetry is what
/// makes <c>orgAdmin</c> a separate authorization family rather than a larger staff role.
/// </para>
/// <para>
/// <b>REQUIRED WIRING (orchestrator-owned) — three lines, and the third is ordered.</b>
/// <list type="number">
///   <item><description><c>builder.Services.AddExerciseLifecycleAdmin();</c> — DI. Must follow
///   <c>AddPulsePersistence</c>, <c>AddExerciseScoping</c> and <c>AddStaffIdentity</c>/<c>AddSessions</c>
///   (whose <c>ICurrentStaffSessionAccessor</c> the caller resolver reads).</description></item>
///   <item><description><c>app.MapExerciseLifecycleAdminEndpoints();</c> — the three routes.</description></item>
///   <item><description><c>app.UseOrganizationResolution();</c> — <b>immediately after</b>
///   <c>app.UseSessionAuthentication()</c> and <b>before</b> <c>app.UseAuthorization()</c>. Without it no
///   customer tenant is ever resolved and every route here 401s; wired too late it lands after the
///   request-scoped <c>PulseDbContext</c> has already captured its filters. See
///   <c>OrganizationResolutionExtensions</c>.</description></item>
/// </list>
/// All three are asserted against the REAL host by
/// <c>Features/ExerciseLifecycleAdmin/CompositionRootWiringTests</c>, so this slice cannot ship
/// merged-but-dead (the #310 → #317 failure mode).
/// </para>
/// </remarks>
public static class ExerciseLifecycleAdminEndpoints
{
    /// <summary>The org-scoped exercise collection route — <c>POST</c> creates (COR-074), <c>GET</c> lists (COR-075).</summary>
    public const string ExercisesRoute = "/api/org/exercises";

    /// <summary>The org-scoped staff-assignment read route (COR-076) — org-admin only.</summary>
    public const string StaffAssignmentsRoute = "/api/org/staff-assignments";

    /// <summary>
    /// One of the caller's organization's exercises, by id (demo-feedback story 22): <c>PATCH</c> renames it.
    /// The id is authorized against the caller's own tenant; another customer's id is a bare <c>404</c>.
    /// </summary>
    public const string ExerciseByIdRoute = "/api/org/exercises/{exerciseId:guid}";

    /// <summary>Archives one of the caller's organization's exercises (<c>completed → archived</c> only; story 22).</summary>
    public const string ArchiveExerciseRoute = "/api/org/exercises/{exerciseId:guid}/archive";

    /// <summary>
    /// The EXPLICIT allow-list of org-tier ENDPOINTS that take a route parameter (story 22), keyed by
    /// (HTTP method, route template) so a new verb on an existing path is a new entry, not a free ride. Every entry
    /// takes an exercise id that <see cref="ExerciseManagementService"/> authorizes against the caller's
    /// server-resolved tenant before anything else happens, answering a foreign or unknown id with the same bare
    /// <c>404</c>. <c>CompositionRootWiringTests</c> asserts that the parameterized org endpoints are EXACTLY this
    /// set, and <c>OrgExerciseByIdIsolationTests</c> drives every entry with another customer's id and asserts the
    /// 404. A new id-bearing org endpoint (a GET or DELETE on one of these paths included) therefore cannot land
    /// without being added here, and cannot be added here without being proven to refuse another tenant.
    /// </summary>
    public static IReadOnlySet<(string Method, string Route)> ExerciseIdRoutes { get; } =
        new HashSet<(string Method, string Route)>
        {
            ("PATCH", ExerciseByIdRoute),
            ("POST", ArchiveExerciseRoute),
        };

    /// <summary>
    /// Registers the slice's three scoped services plus the shared per-request staff-caller resolver. All are
    /// Scoped, matching the <c>PulseDbContext</c> unit of work they read and write through — and the resolver
    /// memoizes within the request, so the endpoint filter and the service it gates share one lookup.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseLifecycleAdmin(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<StaffCallerContext>();
        services.AddScoped<ExerciseCreationService>();
        services.AddScoped<ExerciseListService>();
        services.AddScoped<OrgStaffDirectoryService>();
        services.AddScoped<ExerciseManagementService>();

        return services;
    }

    /// <summary>Maps the three organization-administration endpoints.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseLifecycleAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // identity-auth-roles/17 (§8.2, signed off): create exercise is org admin only.
        endpoints.MapPost(ExercisesRoute, CreateExerciseAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        endpoints.MapGet(ExercisesRoute, ListExercisesAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.ExerciseAdministrators);

        endpoints.MapGet(StaffAssignmentsRoute, ListStaffAssignmentsAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.OrgAdminOnly);

        // Story 22 row actions. identity-auth-roles/17 (§8.2): rename / archive are the org admin's and the planner's
        // (controller refused). The id is authorized against the caller's tenant — and, for a planner, their own
        // planner enrollment — inside the service, so the filter's 401/403 never depends on the id at all.
        endpoints.MapPatch(ExerciseByIdRoute, RenameExerciseAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.ExerciseManagers);

        endpoints.MapPost(ArchiveExerciseRoute, ArchiveExerciseAsync)
            .AddEndpointFilter(OrgAdminAuthorizationFilter.ExerciseManagers);

        return endpoints;
    }

    /// <summary>
    /// Creates one exercise under the caller's own organization (COR-074). Services are marked
    /// <c>[FromServices]</c> explicitly so route building can never mistake one for a request body.
    /// </summary>
    private static async Task<IResult> CreateExerciseAsync(
        [FromBody] CreateExerciseRequest? request,
        [FromServices] ExerciseCreationService creationService,
        CancellationToken cancellationToken)
    {
        var result = await creationService.CreateAsync(request, cancellationToken);

        return result.Outcome switch
        {
            // 201 with NO Location header, deliberately: there is no GET-by-id route to point at (story 22's
            // by-id routes are PATCH and POST actions only), and a Location that 404s on GET would be worse
            // than none.
            CreateExerciseOutcome.Created when result.Response is { } response =>
                Results.Json(response, statusCode: StatusCodes.Status201Created),
            CreateExerciseOutcome.Invalid => Results.BadRequest(result.Error),
            CreateExerciseOutcome.Unauthenticated => Results.Unauthorized(),
            CreateExerciseOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            CreateExerciseOutcome.HostnameTaken => Results.Conflict(result.Error),

            // Unreachable: a Created outcome always carries a response. Fail closed rather than 200 an empty body.
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>Renames one of the caller's organization's exercises (story 22).</summary>
    private static async Task<IResult> RenameExerciseAsync(
        Guid exerciseId,
        [FromBody] RenameExerciseRequest? request,
        [FromServices] ExerciseManagementService managementService,
        CancellationToken cancellationToken) =>
        ToResult(await managementService.RenameAsync(exerciseId, request, cancellationToken));

    /// <summary>Archives one of the caller's organization's exercises (story 22; completed only).</summary>
    private static async Task<IResult> ArchiveExerciseAsync(
        Guid exerciseId,
        [FromServices] ExerciseManagementService managementService,
        CancellationToken cancellationToken) =>
        ToResult(await managementService.ArchiveAsync(exerciseId, cancellationToken));

    /// <summary>
    /// Maps a row-action result to a status. <c>NotFound</c> is a BARE 404 with no body, the same for another
    /// customer's exercise as for an id that never existed, so the response discloses nothing about either.
    /// </summary>
    private static IResult ToResult(ExerciseManagementResult result) => result.Outcome switch
    {
        ExerciseManagementOutcome.Ok when result.Exercise is { } exercise => Results.Ok(exercise),
        ExerciseManagementOutcome.Invalid => Results.BadRequest(result.Error),
        ExerciseManagementOutcome.Unauthenticated => Results.Unauthorized(),
        ExerciseManagementOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
        ExerciseManagementOutcome.NotFound => Results.NotFound(),
        ExerciseManagementOutcome.NotCompleted => Results.Conflict(
            new ExerciseActionConflictDto { Reason = ExerciseManagementService.NotCompletedReason }),

        // Unreachable: an Ok outcome always carries a row. Fail closed rather than 200 an empty body.
        _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
    };

    /// <summary>Lists the caller's organization's exercises (COR-075). A <c>null</c> result fails closed to 401.</summary>
    private static async Task<IResult> ListExercisesAsync(
        [FromServices] ExerciseListService listService,
        CancellationToken cancellationToken)
    {
        var exercises = await listService.ListAsync(cancellationToken);

        return exercises is null ? Results.Unauthorized() : Results.Ok(exercises);
    }

    /// <summary>Lists the caller's organization's staff assignments (COR-076). A <c>null</c> result fails closed to 401.</summary>
    private static async Task<IResult> ListStaffAssignmentsAsync(
        [FromServices] OrgStaffDirectoryService directoryService,
        CancellationToken cancellationToken)
    {
        var assignments = await directoryService.ListAsync(cancellationToken);

        return assignments is null ? Results.Unauthorized() : Results.Ok(assignments);
    }
}
