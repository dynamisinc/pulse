namespace Pulse.WebApi.Features.Exports;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>
/// The printable exercise report (demo-feedback story 17): <c>GET /api/staff/exports/report?includeNoise=false</c>.
/// STAFF world. Minimal-API extension methods; the orchestrator wires <see cref="AddExerciseReport"/> and
/// <see cref="MapExerciseReport"/> into <c>Program.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Who may call it.</b> The same gate as the post export (<see cref="PostExportEndpoints"/>): any live staff
/// session assigned to the resolved exercise, whatever its role, through <see cref="EngineCockpitStaffAuthorizationFilter"/>
/// (no staff session or no resolved scope → 401; staff not assigned → 403). <see cref="NoStoreEndpointFilter"/> runs
/// first, so every response carries <c>Cache-Control: no-store</c>.
/// </para>
/// <para>
/// <b>Responses.</b> 200 with the <see cref="ExerciseReportDto"/> JSON. 401 for an unresolved scope (fail closed),
/// 404 when the scope has no exercise row, 413 with a readable reason when more than
/// <see cref="ExerciseReportService.MaxListedPosts"/> posts would be listed.
/// </para>
/// <para>
/// <b>Required <c>Program.cs</c> wiring (orchestrator-owned):</b> <c>builder.Services.AddExerciseReport();</c> and
/// <c>app.MapExerciseReport();</c>, beside the post export's lines. It relies on the same registrations as the post
/// export plus <c>AddMedia(...)</c> for the real <see cref="IMediaUrlSigner"/> (its plain registration wins over the
/// fail-closed fallback registered here with <c>TryAdd</c>, in any order). No middleware ordering.
/// </para>
/// </remarks>
public static class ExerciseReportEndpoints
{
    /// <summary>The report route.</summary>
    public const string ReportRoute = "/api/staff/exports/report";

    /// <summary>Registers the report service and the readers it needs. Idempotent: every registration is a <c>TryAdd</c>.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseReport(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddScoped<ExerciseReportService>();

        // The concrete reader, not IPostEngagementReader: see PostExportService's remarks on the zero-count fallback.
        services.TryAddScoped<PostEngagementReader>();
        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddSingleton(TimeProvider.System);

        // The fail-closed fallback only; AddMedia's plain registration of the real signer wins in any order.
        services.TryAddScoped<IMediaUrlSigner, UnconfiguredMediaUrlSigner>();

        return services;
    }

    /// <summary>Maps <c>GET /api/staff/exports/report</c> behind <c>no-store</c> and the staff gate.</summary>
    /// <param name="endpoints">The route builder to map onto.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapExerciseReport(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var staff = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<NoStoreEndpointFilter>()
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>();

        staff.MapGet(ReportRoute, GetReportAsync);

        return endpoints;
    }

    /// <summary>Builds the report. The filters have already admitted the caller.</summary>
    /// <param name="service">The report service.</param>
    /// <param name="includeNoise">Whether white-noise posts are listed (default <c>false</c>, DF-24).</param>
    /// <param name="cancellationToken">The request-aborted token.</param>
    /// <returns>200, 401, 404 or 413.</returns>
    private static async Task<IResult> GetReportAsync(
        ExerciseReportService service,
        bool? includeNoise,
        CancellationToken cancellationToken)
    {
        var result = await service.BuildAsync(includeNoise ?? false, cancellationToken);
        return result.Outcome switch
        {
            ExerciseReportOutcome.Ok when result.Report is { } report => Results.Ok(report),
            ExerciseReportOutcome.TooManyPosts => Results.Problem(
                detail: result.Reason,
                statusCode: StatusCodes.Status413PayloadTooLarge,
                title: "Too many posts for the report"),
            ExerciseReportOutcome.ScopeUnresolved => Results.Unauthorized(),
            ExerciseReportOutcome.NotFound => Results.NotFound(),
            _ => Results.StatusCode(StatusCodes.Status500InternalServerError),
        };
    }
}
