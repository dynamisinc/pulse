namespace Pulse.WebApi.Features.EngineRuntime.Clock;

using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;

/// <summary>
/// The server scenario clock's read and push surface (fix/noise-new-posts-clock): <c>GET /api/clock</c> and the
/// <c>ScenarioClockChanged</c> push, so every client renders and stamps the ONE server clock instead of its own wall
/// clock. The orchestrator wires <see cref="AddScenarioClockApi"/> and <see cref="MapScenarioClockEndpoints"/> into
/// <c>Program.cs</c>; this slice never edits it.
/// </summary>
public static class ScenarioClockEndpoints
{
    /// <summary>The route of the clock read.</summary>
    public const string ClockRoute = "/api/clock";

    /// <summary>
    /// Registers the <c>ScenarioClockChanged</c> push (<see cref="ScenarioClockChangedPublisher"/>) as an
    /// <see cref="IExerciseClockChangeObserver"/>. Additive (<c>TryAddEnumerable</c>): it composes with the persistence
    /// slice's single <see cref="IExerciseClockChangeSink"/> instead of replacing it, in either wiring order. Needs
    /// <c>AddExerciseClock()</c>; the push sends through <c>AddSocialRealtimeHub()</c>'s broadcaster when present.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddScenarioClockApi(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<ScenarioClockChangedPublisher>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IExerciseClockChangeObserver, ScenarioClockChangedPublisher>(
            provider => provider.GetRequiredService<ScenarioClockChangedPublisher>()));

        return services;
    }

    /// <summary>
    /// Maps <c>GET /api/clock</c> — the resolved exercise's <see cref="ScenarioClockDto"/>. Any live session bound to
    /// the exercise may read it (participant, shared read-only, staff): it carries scenario time only. Scope comes ONLY
    /// from <see cref="IExerciseContext"/> (COR-001); it FAILS CLOSED with <c>401</c> on an unresolved scope, never a
    /// default "not started" 200. The session itself is required by the host's default-deny fallback policy, and the
    /// participant lifecycle gate covers the path like <c>/api/personas</c>.
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapScenarioClockEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(ClockRoute, GetClock);

        return endpoints;
    }

    private static IResult GetClock(IExerciseContext exerciseContext, IExerciseClock clock, TimeProvider timeProvider)
    {
        var scope = exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        return Results.Json(ScenarioClockDto.Read(clock, timeProvider, scope.Value));
    }
}
