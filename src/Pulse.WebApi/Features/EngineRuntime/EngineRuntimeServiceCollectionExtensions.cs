namespace Pulse.WebApi.Features.EngineRuntime;

using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// Composition-root extension for the engine-runtime Wave-0 SEAMS shared by stories 01 and 02 — the XC-004
/// telemetry emitter and the review-item persistence store. The orchestrator wires the single call into
/// <c>Program.cs</c>; no builder edits <c>Program.cs</c>. This registers ONLY the shared seam services; each
/// story exposes its own <c>Add*</c>/<c>Map*</c> for its loop host / endpoints / SignalR (implementation.md
/// integration seam).
/// </summary>
public static class EngineRuntimeServiceCollectionExtensions
{
    /// <summary>
    /// Registers the shared engine-runtime seam services: <see cref="IEngineTelemetryEmitter"/> (stateless →
    /// singleton) and <see cref="IEngineReviewStore"/> (Scoped, matching the <c>PulseDbContext</c> unit of
    /// work).
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddEngineRuntimeSeams(this IServiceCollection services)
    {
        System.ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton<IEngineTelemetryEmitter, EngineTelemetryEmitter>();
        services.AddScoped<IEngineReviewStore, EngineReviewStore>();

        return services;
    }
}
