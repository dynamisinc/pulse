namespace Pulse.WebApi.Features.Identity.Roster;

using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// The roster HTTP surface (easy-login story 02, COR-011): <c>GET /api/staff/roster</c>, <c>POST /api/staff/roster</c>
/// and <c>POST /api/staff/roster/import?dryRun=</c>, exactly as the frozen wire contract in
/// <c>docs/features/easy-login/implementation.md</c> declares them. Staff-world only: no route here is reachable
/// anonymously or by a participant or read-only session (there is no self-registration).
/// </summary>
/// <remarks>
/// <para>
/// <b>Gate (EL-13).</b> Every route runs <see cref="EngineCockpitStaffAuthorizationFilter"/> (a live staff session
/// assigned to the resolved exercise: 401 without one, 403 unassigned) and then <see cref="RosterStaffRoleFilter"/>
/// (controller or planner there: 403 otherwise). Every response, the refusals included, carries
/// <c>Cache-Control: no-store</c>: the list carries join URLs, which are bearer credentials. 400 and 409 bodies are
/// ProblemDetails with a readable <c>detail</c>.
/// </para>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned seam commit):</b> <c>builder.Services.AddRoster();</c>
/// and <c>app.MapRosterEndpoints();</c>. The slice depends on <c>AddEasyLoginFoundation()</c> (story 01: the link
/// issuer, link DTO factory, join URL builder, exercise facts reader and clock), <c>AddStaffIdentity()</c> and
/// <c>AddSessions()</c> (the staff caller and assignments the filters read), and the persistence and exercise-scoping
/// registrations; registration order does not matter. No middleware and no pre-auth allowlist entry: these routes are
/// behind the default-deny session gate like every staff route.
/// </para>
/// <para>
/// <b>Routes and the literal segment.</b> <c>/api/staff/roster/import</c> is a literal segment, which ASP.NET routing
/// always prefers over a parameter, so story 03's <c>/api/staff/roster/{id:guid}/…</c> routes cannot shadow it in
/// either registration order.
/// </para>
/// </remarks>
public static class RosterEndpoints
{
    /// <summary>The roster list and single-add route.</summary>
    public const string RosterRoute = "/api/staff/roster";

    /// <summary>The CSV import route.</summary>
    public const string ImportRoute = "/api/staff/roster/import";

    /// <summary>The most bytes an import file may have (shared with the legacy account import: 1 MB).</summary>
    public const int MaxImportFileBytes = AccountEndpoints.MaxImportFileBytes;

    /// <summary>
    /// The request-body cap on the import route: the 1 MB file plus room for the multipart envelope (boundaries, part
    /// headers). The file's own 1 MB check still answers a readable 400; anything far larger is refused while it is read.
    /// </summary>
    public const long MaxImportRequestBytes = MaxImportFileBytes + (64 * 1024);

    /// <summary>
    /// The request-body cap on the single add: a <c>RosterRowWrite</c> is six short fields (about 1 KB at the field
    /// limits), so 16 KB leaves room for markup that is stripped on ingest while bounding the read, as the post write
    /// route does.
    /// </summary>
    public const long MaxAddRequestBytes = 16 * 1024;

    private const string DryRunParameter = "dryRun";

    /// <summary>Registers the roster services. Idempotent: every registration is a <c>TryAdd</c>.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddRoster(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Scoped to the PulseDbContext unit of work. TryAdd (Gate-2 CR-001): Program.cs wires this, so a test host that
        // calls it again must not register a second descriptor.
        services.TryAddScoped<RosterService>();
        services.TryAddScoped<RosterQueryService>();

        // Also registered (TryAdd) by AddEasyLoginFoundation(); repeated so the slice never lacks its clock.
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }

    /// <summary>Maps the three roster routes, each behind the staff gate and with <c>Cache-Control: no-store</c>.</summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapRosterEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(RosterRoute, ListAsync).WithRosterStaffGate();
        endpoints.MapPost(RosterRoute, AddAsync)
            .WithRosterStaffGate()
            .WithMetadata(new RequestSizeLimitAttribute(MaxAddRequestBytes));

        // multipart/form-data (field "file"). DisableAntiforgery: a bearer-token API (the staff token travels in the
        // Authorization header, not a cookie), so the CSRF antiforgery defends against does not apply; the staff gate
        // is the authorization. Same as /api/staff/accounts/import.
        endpoints.MapPost(ImportRoute, ImportAsync)
            .WithRosterStaffGate()
            .WithMetadata(new RequestSizeLimitAttribute(MaxImportRequestBytes))
            .DisableAntiforgery();

        return endpoints;
    }

    /// <summary>The staff gate, in order: no-store on every response, then the assigned-staff filter, then the role filter.</summary>
    private static RouteHandlerBuilder WithRosterStaffGate(this RouteHandlerBuilder builder) =>
        builder
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<RosterStaffRoleFilter>();

    private static async Task<IResult> ListAsync(RosterQueryService queryService, CancellationToken cancellationToken)
    {
        var roster = await queryService.ListAsync(cancellationToken);
        return roster is null ? Results.Unauthorized() : Results.Ok(roster);
    }

    private static async Task<IResult> AddAsync(RosterRowWrite? request, RosterService service, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return Problem(StatusCodes.Status400BadRequest, "A JSON roster row is required.");
        }

        var result = await service.AddAsync(request, cancellationToken);
        return result.Outcome switch
        {
            RosterOutcome.Ok when result.Entry is { } entry => Results.Json(entry, statusCode: StatusCodes.Status201Created),
            RosterOutcome.Invalid => Problem(StatusCodes.Status400BadRequest, result.Error),
            RosterOutcome.Conflict => Problem(StatusCodes.Status409Conflict, result.Error),
            RosterOutcome.Unauthenticated => Results.Unauthorized(),
            RosterOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static async Task<IResult> ImportAsync(
        HttpRequest request,
        IFormFile? file,
        RosterService service,
        CancellationToken cancellationToken)
    {
        // A dry run must never become a real one by a typo: absent means false; present, it must be exactly one
        // true/false (any casing). An empty "?dryRun=" or a repeated parameter is a 400, never a real import.
        var isDryRun = false;
        if (request.Query.TryGetValue(DryRunParameter, out var dryRun)
            && (dryRun.Count != 1 || !bool.TryParse(dryRun[0]?.Trim(), out isDryRun)))
        {
            return Problem(StatusCodes.Status400BadRequest, "dryRun must be true or false.");
        }

        if (file is null || file.Length == 0)
        {
            return Problem(StatusCodes.Status400BadRequest, "A non-empty CSV file (multipart/form-data field 'file') is required.");
        }

        if (file.Length > MaxImportFileBytes)
        {
            return Problem(StatusCodes.Status400BadRequest, $"the CSV file exceeds the maximum size of {MaxImportFileBytes} bytes.");
        }

        if (!AccountEndpoints.IsCsvUpload(file))
        {
            return Problem(StatusCodes.Status400BadRequest, "the uploaded file must be a CSV (text/csv or a .csv file).");
        }

        string content;
        await using (var stream = file.OpenReadStream())
        using (var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
        {
            content = await reader.ReadToEndAsync(cancellationToken);
        }

        var result = await service.ImportAsync(content, isDryRun, cancellationToken);
        return result.Outcome switch
        {
            RosterOutcome.Ok when result.Report is { } report => Results.Ok(report),
            RosterOutcome.Invalid => Problem(StatusCodes.Status400BadRequest, result.Error),
            RosterOutcome.Unauthenticated => Results.Unauthorized(),
            RosterOutcome.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static IResult Problem(int statusCode, string? detail) => Results.Problem(detail: detail, statusCode: statusCode);
}
