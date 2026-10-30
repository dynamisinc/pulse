namespace Pulse.WebApi.Features.Channels.Alerts;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Injects;

/// <summary>
/// The alert source's DI and routes (channels-foundation story 10, FC-4): <c>GET /api/alerts/history</c> for the
/// participant (PRT-012), and the staff <c>POST /api/alerts</c> / <c>POST /api/alerts/{id}/clear</c>.
/// <c>GET /api/alerts</c> itself stays on <c>MapParticipantShellEndpoints</c>, whose
/// <c>ParticipantShellConfigService.GetAlertsAsync</c> delegates to <see cref="AlertReader.GetActiveAsync"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Participant read.</b> Scope comes only from the session (no <c>exerciseId</c> in the URL); an unresolved scope is
/// <c>401</c>, never an empty <c>200</c>. The route sits under <c>/api/alerts</c>, so the COR-032 lifecycle gate
/// already covers it.
/// </para>
/// <para>
/// <b>Staff mutations</b> sit behind the shipped <see cref="EngineCockpitStaffAuthorizationFilter"/> (no staff session →
/// <c>401</c>; a staff session not assigned to the exercise → <c>403</c>) AND
/// <see cref="EngineCockpitControllerRoleFilter"/> (only a controller raises or clears) — the <c>InjectEndpoints</c>
/// pattern. A raise publishes to every participant, so it carries <see cref="InjectFireRateLimiterPolicy"/>, which
/// <c>AddInjects()</c> registers.
/// </para>
/// </remarks>
public static class AlertEndpoints
{
    /// <summary>
    /// Registers the alert source: <see cref="AlertReader"/>, <see cref="AlertService"/> (also as
    /// <see cref="IAlertRaiser"/>), the no-op SOC-072 bridge (replaced by notifications story 03), the options and the
    /// <see cref="AlertExpirySweeper"/>. Prerequisites wired by the host: persistence + exercise scoping, staff
    /// identity, and an <c>IFeedBroadcaster</c>.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddChannelAlerts(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Idempotent as a whole: BindConfiguration is not TryAdd-based, so a second call would register its options
        // configuration twice.
        if (services.Any(descriptor => descriptor.ServiceType == typeof(AlertService)))
        {
            return services;
        }

        // TryAdd-based, so this converges with Program.cs's own AddExerciseClock() on one clock singleton.
        services.AddExerciseClock();
        services.AddOptions<ChannelAlertOptions>()
            .BindConfiguration(ChannelAlertOptions.SectionName)
            .Validate(
                options => options.BroadcastTimeout > TimeSpan.Zero,
                $"{ChannelAlertOptions.SectionName}:BroadcastTimeout must be a positive duration (zero cancels every "
                + "AlertsChanged push; a negative or infinite value would hold the announcement gate unbounded).")
            .ValidateOnStart();
        services.TryAddSingleton<IPlatformAlertNotifier, NullPlatformAlertNotifier>();
        services.TryAddSingleton<AlertAnnouncementGate>();
        services.TryAddScoped<AlertReader>();
        services.TryAddScoped<AlertService>();
        services.TryAddScoped<IAlertRaiser>(provider => provider.GetRequiredService<AlertService>());
        services.AddHostedService<AlertExpirySweeper>();

        return services;
    }

    /// <summary>Maps the history read and the two staff mutations.</summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapChannelAlerts(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/alerts/history", GetHistoryAsync);

        var controllerOnly = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        controllerOnly.MapPost("/api/alerts", RaiseAsync)
            .RequireRateLimiting(InjectFireRateLimiterPolicy.PolicyName);
        controllerOnly.MapPost("/api/alerts/{id:guid}/clear", ClearAsync);

        return endpoints;
    }

    private static async Task<IResult> GetHistoryAsync(
        string? cursor,
        int? limit,
        [FromServices] AlertReader reader,
        CancellationToken cancellationToken)
    {
        var read = await reader.GetHistoryAsync(cursor, limit, cancellationToken);
        return read switch
        {
            { Unresolved: true } => Results.Unauthorized(),
            { Page: { } page } => Results.Ok(page),
            _ => Results.Problem(detail: read.Error, statusCode: StatusCodes.Status400BadRequest),
        };
    }

    private static async Task<IResult> RaiseAsync(
        StaffAlertRaiseRequest? request,
        [FromServices] AlertService alerts,
        CancellationToken cancellationToken)
    {
        var outcome = await alerts.RaiseAsStaffAsync(request, cancellationToken);
        return outcome switch
        {
            { Unresolved: true } => Results.Unauthorized(),
            { Alert: { } alert } => Results.Json(alert, statusCode: StatusCodes.Status201Created),
            _ => Results.Problem(detail: outcome.Error, statusCode: StatusCodes.Status400BadRequest),
        };
    }

    private static async Task<IResult> ClearAsync(
        Guid id,
        [FromServices] AlertService alerts,
        CancellationToken cancellationToken) =>
        await alerts.ClearAsStaffAsync(id, cancellationToken) switch
        {
            null => Results.Unauthorized(),
            true => Results.NoContent(),
            false => Results.Problem(detail: "No active alert with that id.", statusCode: StatusCodes.Status404NotFound),
        };
}
