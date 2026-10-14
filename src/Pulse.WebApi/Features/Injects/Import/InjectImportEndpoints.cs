namespace Pulse.WebApi.Features.Injects.Import;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// <c>POST /api/injects/import?dryRun=true|false</c> (multipart field <c>file</c>) — the MSEL import into the run sheet
/// (demo-feedback story 03), exactly as the frozen route table in <c>docs/features/demo-feedback/implementation.md</c>
/// declares it. Answers <c>200 InjectImportResultDto</c>; <c>400</c> ProblemDetails with a readable <c>detail</c> for a
/// refused upload (nothing written); <c>409</c> when the run sheet kept changing under the import.
/// </summary>
/// <remarks>
/// <para>
/// <b>Gate.</b> The SHIPPED <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or unresolved scope →
/// <c>401</c>; a staff session not assigned to the resolved exercise → <c>403</c>) then
/// <see cref="EngineCockpitControllerRoleFilter"/> (evaluator and planner → <c>403</c>), composed on empty-prefix groups
/// as <see cref="InjectEndpoints.MapInjects"/> does. Participants and anonymous callers never reach the handler.
/// </para>
/// <para>
/// <b>Upload handling (as the roster import).</b> The request body is capped at
/// <see cref="MselLimits.MaxRequestBytes"/> (the 2 MiB file plus the multipart envelope) while it is read, so an
/// unbounded body is never buffered; the file's own 2 MiB check still answers a readable <c>400</c>.
/// <c>DisableAntiforgery</c>: a bearer-token API (the staff token travels in the Authorization header, not a cookie),
/// so the CSRF antiforgery defends against does not apply; the staff gates are the authorization.
/// </para>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned seam S-2):</b> <c>builder.Services.AddInjectImport();</c>
/// after <c>AddInjects()</c>, and <c>app.MapInjectImport();</c>. <c>/api/injects/import</c> is a literal segment, which
/// routing prefers over the queue's <c>/api/injects/{id:guid}</c> routes (and "import" is not a guid), so the order of
/// <c>MapInjects()</c> and <c>MapInjectImport()</c> does not matter. No middleware.
/// </para>
/// </remarks>
public static class InjectImportEndpoints
{
    /// <summary>The import route.</summary>
    public const string ImportRoute = "/api/injects/import";

    /// <summary>The refusal for a missing or malformed <c>dryRun</c>.</summary>
    public const string DryRunMessage = "dryRun must be true or false.";

    /// <summary>The refusal for a request without a file.</summary>
    public const string NoFileMessage =
        "A non-empty .xlsx or .csv file (multipart/form-data field 'file') is required.";

    private const string DryRunParameter = "dryRun";

    /// <summary>
    /// Registers the import service (scoped, matching <c>PulseDbContext</c>). Idempotent (<c>TryAdd</c>). Prerequisite:
    /// <see cref="InjectEndpoints.AddInjects"/> (the queue the import writes through) and what it needs.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddInjectImport(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<InjectImportService>();
        return services;
    }

    /// <summary>Maps the import route behind the staff gate and the controller-role gate.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapInjectImport(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var controllerOnly = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        controllerOnly.MapPost(ImportRoute, ImportAsync)
            .WithMetadata(new RequestSizeLimitAttribute(MselLimits.MaxRequestBytes))
            .DisableAntiforgery();

        return endpoints;
    }

    private static async Task<IResult> ImportAsync(
        HttpRequest request,
        InjectImportService service,
        CancellationToken cancellationToken)
    {
        // A dry run must never become a real one by a typo: present, it must be exactly one true/false (any casing).
        // Absent, repeated, empty or anything else is a 400 (the roster import's rule; this route requires the flag).
        if (!request.Query.TryGetValue(DryRunParameter, out var dryRunValues)
            || dryRunValues.Count != 1
            || !bool.TryParse(dryRunValues[0]?.Trim(), out var isDryRun))
        {
            return Problem(StatusCodes.Status400BadRequest, DryRunMessage);
        }

        if (!request.HasFormContentType)
        {
            return Problem(StatusCodes.Status400BadRequest, NoFileMessage);
        }

        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(cancellationToken);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            // The body broke the request-size cap while it was read: say why, as a readable 400 (Gate-1 L-1).
            return Problem(StatusCodes.Status400BadRequest, InjectImportService.TooLargeMessage);
        }
        catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException)
        {
            return Problem(StatusCodes.Status400BadRequest, NoFileMessage);
        }

        var file = form.Files.GetFile("file");
        if (file is null || file.Length == 0)
        {
            return Problem(StatusCodes.Status400BadRequest, NoFileMessage);
        }

        if (file.Length > MselLimits.MaxFileBytes)
        {
            return Problem(StatusCodes.Status400BadRequest, InjectImportService.TooLargeMessage);
        }

        byte[] content;
        await using (var stream = file.OpenReadStream())
        using (var buffer = new MemoryStream((int)file.Length))
        {
            await stream.CopyToAsync(buffer, cancellationToken);
            content = buffer.ToArray();
        }

        var result = await service.ImportAsync(content, file.FileName, file.ContentType, isDryRun, cancellationToken);
        return result.Outcome switch
        {
            InjectOutcome.Ok when result.Value is { } report => Results.Json(report),
            InjectOutcome.Invalid => Problem(StatusCodes.Status400BadRequest, result.Message),
            InjectOutcome.Conflict => Problem(StatusCodes.Status409Conflict, result.Message),
            InjectOutcome.ScopeUnresolved => Results.Unauthorized(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }

    private static IResult Problem(int statusCode, string? detail) => Results.Problem(detail: detail, statusCode: statusCode);
}
