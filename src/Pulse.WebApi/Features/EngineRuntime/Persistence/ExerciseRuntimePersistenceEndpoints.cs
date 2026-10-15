namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// Composition-root extensions for restart-proof steering state (demo-feedback story 18, DF-24..DF-28). The
/// orchestrator wires both lines into <c>Program.cs</c> at seam S-5; no builder edits that file.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ordering (S-5).</b> <see cref="AddExerciseRuntimePersistence"/> registers
/// <see cref="ExerciseRuntimeStateRehydrator"/> as a hosted service, and the host starts hosted services in
/// registration order, awaiting each <c>StartAsync</c>. It must therefore be called BEFORE the first call that
/// registers a ticking hosted service — <c>AddReactionLoopHost()</c> (<c>ReactionLoopHost</c>),
/// <c>AddEngineReview()</c> (<c>EngineReviewTickHost</c>), <c>AddInjects()</c> (<c>InjectBurstRunner</c>) and
/// <c>AddWhiteNoise()</c> (<c>WhiteNoisePacer</c>) — so the tiers, clocks and holding pages are back before anything
/// ticks. Its service registrations are <c>TryAdd</c> or <c>RemoveAll</c> + <c>Add</c>, so they are otherwise
/// order-independent against <c>AddExerciseClock()</c>, <c>AddPauseTierSteering()</c> and
/// <c>AddPauseParticipantOverlay()</c>.
/// </para>
/// <para>
/// <b>Prerequisites</b> (already in <c>Program.cs</c>): <c>AddPulsePersistence</c>, <c>AddExerciseScoping()</c>,
/// <c>AddExerciseClock()</c>, <c>AddPauseTierSteering()</c>, <c>AddPauseParticipantOverlay()</c> and B2's staff
/// identity (the reset route's filters).
/// </para>
/// </remarks>
public static class ExerciseRuntimePersistenceEndpoints
{
    /// <summary>The controller-only runtime reset route (DF-28). POST only: a GET answers 405.</summary>
    public const string ResetRoute = "/api/steering/runtime-state/reset";

    /// <summary>
    /// Registers the runtime-state persistence: the EF store, the real write-through persister (replacing
    /// <c>AddPauseTierSteering()</c>'s no-op), the clock's write queue (replacing <c>AddExerciseClock()</c>'s no-op
    /// sink), the reset service, and the startup <see cref="ExerciseRuntimeStateRehydrator"/> hosted service.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddExerciseRuntimePersistence(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<OverlayStateService>();
        services.TryAddSingleton<PauseTierReader>(provider =>
            exerciseId => provider.GetRequiredService<PauseTierRegistry>().GetTier(exerciseId));

        services.TryAddSingleton<IExerciseRuntimeStateStore, EfExerciseRuntimeStateStore>();

        services.RemoveAll<IExerciseRuntimeStatePersister>();
        services.AddSingleton<ExerciseRuntimeStateWriter>();
        services.AddSingleton<IExerciseRuntimeStatePersister>(
            provider => provider.GetRequiredService<ExerciseRuntimeStateWriter>());

        services.RemoveAll<IExerciseClockChangeSink>();
        services.AddSingleton<ExerciseClockWriteThrough>();
        services.AddSingleton<IExerciseClockChangeSink>(
            provider => provider.GetRequiredService<ExerciseClockWriteThrough>());

        services.TryAddScoped<ExerciseFactsReader>();
        services.TryAddScoped<RuntimeStateResetService>();

        // FIRST among the ticking hosted services (S-5): see the type's ordering note.
        services.AddHostedService<ExerciseRuntimeStateRehydrator>();

        return services;
    }

    /// <summary>
    /// Maps <c>POST /api/steering/runtime-state/reset</c> behind the SAME two filters as
    /// <c>POST /api/steering/pause-tier</c>: <see cref="EngineCockpitStaffAuthorizationFilter"/> (staff assigned to the
    /// resolved exercise; 401/403) and <see cref="EngineCockpitControllerRoleFilter"/> (controller role; 403).
    /// </summary>
    /// <param name="endpoints">The route builder.</param>
    /// <returns>The same route builder, for chaining.</returns>
    public static IEndpointRouteBuilder MapRuntimeStateReset(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        // The shape of MapPauseTierSteering: empty-prefix groups so the template reads as the client calls it.
        var controllerOnly = endpoints
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitStaffAuthorizationFilter>()
            .MapGroup(string.Empty)
            .AddEndpointFilter<EngineCockpitControllerRoleFilter>();

        controllerOnly.MapPost(ResetRoute, ResetAsync);

        return endpoints;
    }

    /// <summary>
    /// <c>POST /api/steering/runtime-state/reset</c> — resets the resolved exercise's runtime state and returns the
    /// resulting <see cref="PauseTierStateDto"/> (tier <c>running</c>, <c>clockFrozen: false</c>,
    /// <c>persisted</c> = whether the row delete committed). Fails closed with <c>401</c> on an unresolved scope.
    /// </summary>
    private static async Task<IResult> ResetAsync(RuntimeStateResetService service, CancellationToken cancellationToken)
    {
        var state = await service.ResetAsync(cancellationToken);
        return state is null ? Results.Unauthorized() : Results.Ok(state);
    }
}
