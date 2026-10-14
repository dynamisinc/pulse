namespace Pulse.WebApi.Features.Exports;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>
/// The post activity export (demo-feedback story 02, DF-8): <c>GET /api/staff/exports/posts.xlsx</c>. STAFF world.
/// Minimal-API extension methods; the orchestrator wires <see cref="AddPostExport"/> and <see cref="MapPostExport"/>
/// into <c>Program.cs</c> (seam S-2).
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call it.</b> Any live staff session assigned to the resolved exercise, whatever its role (controller,
/// evaluator or planner, DF-8). The gate is the staff half of <c>ModerationEndpoints</c>' composition, an empty-prefix
/// group carrying <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session or no resolved scope → 401;
/// staff not assigned to the exercise → 403), with no controller-role filter. Participant, shared read-only and
/// anonymous sessions are not staff sessions, so they get 401 from that filter. <see cref="NoStoreEndpointFilter"/>
/// runs first, so every response, the refusals included, carries <c>Cache-Control: no-store</c>.
/// </para>
/// <para>
/// <b>Responses.</b> 200 with the <c>.xlsx</c>, <c>Content-Disposition: attachment; filename="pulse-posts-&lt;slug&gt;-&lt;yyyyMMdd-HHmm&gt;.xlsx"</c>
/// (the server's UTC wall clock at download). 413 with a readable reason when the exercise has more than
/// <see cref="PostExportService.MaxRows"/> posts. 429 with a readable reason while another export is being built in
/// this process (<see cref="PostExportGate"/>). 404 when the resolved scope has no exercise row.
/// </para>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned, seam S-2):</b> <c>builder.Services.AddPostExport();</c> and
/// <c>app.MapPostExport();</c>. The slice depends on registrations other slices own: <c>AddStaffIdentity()</c> /
/// <c>AddSessions()</c> (the staff caller and assignments the filter reads), persistence and exercise scoping, and
/// optionally the exercise clock (telemetry scenario time). Registration order does not matter. No middleware, and
/// <c>/api/staff/**</c> is outside the lifecycle-gated routes, so an export works in every lifecycle state.
/// </para>
/// </remarks>
public static class PostExportEndpoints
{
    /// <summary>The export route.</summary>
    public const string ExportRoute = "/api/staff/exports/posts.xlsx";

    /// <summary>The <c>.xlsx</c> media type.</summary>
    public const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    /// <summary>Registers the export service and the readers it needs. Idempotent: every registration is a <c>TryAdd</c>.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPostExport(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<PostExportService>();

        // One gate per process: a second export while one is building is refused with 429 (Gate-1 M1).
        services.TryAddSingleton<PostExportGate>();

        // The concrete reader, not IPostEngagementReader: see PostExportService's remarks on the zero-count fallback.
        services.TryAddScoped<PostEngagementReader>();

        // Also registered (TryAdd) by the easy-login foundation; repeated so the slice never lacks them.
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddSingleton(TimeProvider.System);

        return services;
    }

    /// <summary>Maps <c>GET /api/staff/exports/posts.xlsx</c> behind <c>no-store</c> and the staff gate.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapPostExport(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // ModerationEndpoints' composition without its nested controller-role group: any assigned staff role exports.
        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        staff.MapGet(ExportRoute, ExportAsync);

        return endpoints;
    }

    /// <summary>
    /// Builds the workbook and returns it as an attachment, one export at a time per process. The filters have already
    /// admitted the caller.
    /// </summary>
    /// <param name="httpContext">The request (for the <c>Content-Disposition</c> header and the lease's lifetime).</param>
    /// <param name="gate">The process-wide single-flight guard.</param>
    /// <param name="service">The export service.</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>200, 401, 404, 413 or 429.</returns>
    private static async Task<IResult> ExportAsync(
        HttpContext httpContext,
        PostExportGate gate,
        PostExportService service,
        CancellationToken cancellationToken)
    {
        var lease = gate.TryEnter();
        if (lease is null)
        {
            return Results.Problem(
                detail: "Another post export is being built right now. Try again in a few seconds.",
                statusCode: StatusCodes.Status429TooManyRequests,
                title: "An export is already running");
        }

        var leaseHandedToResponse = false;
        try
        {
            var result = await service.ExportAsync(cancellationToken);

            switch (result.Outcome)
            {
                case PostExportOutcome.Ok when result.Content is { } content && result.FileName is { } fileName:
                    // Written by hand so the name is always quoted, as the contract shows. The name is [a-z0-9-.] only
                    // (PostExportLabels.FileName), so it needs no escaping.
                    httpContext.Response.Headers.ContentDisposition = $"attachment; filename=\"{fileName}\"";

                    // The gate stays shut until the response is written and the buffer released; Results.File
                    // disposes the stream, and the lease is disposed with the response.
                    httpContext.Response.RegisterForDispose(lease);
                    leaseHandedToResponse = true;
                    return Results.File(content, XlsxContentType);

                case PostExportOutcome.TooManyRows:
                    return Results.Problem(
                        detail: result.Reason,
                        statusCode: StatusCodes.Status413PayloadTooLarge,
                        title: "Too many posts to export");

                case PostExportOutcome.ScopeUnresolved:
                    return Results.Unauthorized();

                case PostExportOutcome.NotFound:
                    return Results.NotFound();

                default:
                    result.Content?.Dispose();
                    return Results.StatusCode(StatusCodes.Status500InternalServerError);
            }
        }
        finally
        {
            if (!leaseHandedToResponse)
            {
                lease.Dispose();
            }
        }
    }
}
