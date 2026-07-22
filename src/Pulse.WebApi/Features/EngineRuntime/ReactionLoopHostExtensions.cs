namespace Pulse.WebApi.Features.EngineRuntime;

using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Publishing;

/// <summary>
/// Composition-root extensions for story 01 — the reaction-loop host + the shared publish funnel. The
/// orchestrator wires the single <c>AddReactionLoopHost()</c> / <c>MapEngineRuntime()</c> pair into
/// <c>Program.cs</c> between waves (after Gate-2); no builder edits <c>Program.cs</c>. Prerequisites already
/// wired earlier: <c>AddEngineGeneration</c> (the <see cref="Pulse.Core.Features.Generation.Services.IGenerationProvider"/>
/// + <see cref="Pulse.Core.Features.Generation.Services.IPromptAssembler"/> the generate stage consumes),
/// <c>AddExerciseClock</c> (the <see cref="Clock.IExerciseClock"/> + <c>IScenarioClock</c> adapter),
/// <c>AddEngineRuntimeSeams</c> (the <see cref="Telemetry.IEngineTelemetryEmitter"/> +
/// <see cref="Review.IEngineReviewStore"/>), <c>AddExerciseScoping</c>, and the social write path (the
/// <see cref="Pulse.WebApi.Features.Social.PostIngestService"/> the publish funnel routes through).
/// </summary>
public static class ReactionLoopHostExtensions
{
    /// <summary>
    /// Registers the reaction-loop host and its collaborators:
    /// <list type="bullet">
    ///   <item><see cref="GenerateStage"/> / <see cref="MeasureStage"/> — stateless stages (singletons).</item>
    ///   <item><see cref="ReactionLoopDriver"/> — the per-tick stage driver (singleton; holds per-exercise counters).</item>
    ///   <item><see cref="IReactionLoopRegistry"/> — the active-loop registry (singleton).</item>
    ///   <item><see cref="IEnginePublishService"/> — the single publish funnel (singleton; always builds its own
    ///   server-authoritative scope) that story 02's approve path also calls.</item>
    ///   <item><see cref="ReactionLoopHost"/> — the hosted <see cref="Microsoft.Extensions.Hosting.BackgroundService"/>.</item>
    /// </list>
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddReactionLoopHost(this IServiceCollection services)
    {
        System.ArgumentNullException.ThrowIfNull(services);

        // Present when AddExerciseClock ran first; TryAdd keeps this independent of registration order.
        services.TryAddSingleton(System.TimeProvider.System);

        services.TryAddSingleton<GenerateStage>();
        services.TryAddSingleton<MeasureStage>();
        services.TryAddSingleton<ReactionLoopDriver>();
        services.TryAddSingleton<IReactionLoopRegistry, ReactionLoopRegistry>();
        services.TryAddSingleton<ReactionLoopHostOptions>();

        // The single publish funnel (SOC-003) — a singleton that establishes its own per-exercise scope for
        // every publish unit of work (COR-001), so both the loop and story 02's approve share one path.
        services.TryAddSingleton<IEnginePublishService, EnginePublishService>();

        services.AddHostedService<ReactionLoopHost>();

        return services;
    }

    /// <summary>
    /// The endpoint-mapping counterpart to <see cref="AddReactionLoopHost"/>, for composition-root symmetry
    /// (the orchestrator calls <c>app.MapEngineRuntime()</c> alongside <c>AddReactionLoopHost()</c>). The
    /// reaction loop is a non-request-bound <see cref="Microsoft.Extensions.Hosting.BackgroundService"/> with
    /// NO HTTP surface of its own — the controller review-queue endpoints are story 02's — so this maps no
    /// routes today; it reserves the seam so a future engine diagnostics route needs no <c>Program.cs</c> edit.
    /// </summary>
    /// <param name="endpoints">The endpoint route builder.</param>
    /// <returns>The same builder, unchanged.</returns>
    public static IEndpointRouteBuilder MapEngineRuntime(this IEndpointRouteBuilder endpoints)
    {
        System.ArgumentNullException.ThrowIfNull(endpoints);
        return endpoints;
    }
}
