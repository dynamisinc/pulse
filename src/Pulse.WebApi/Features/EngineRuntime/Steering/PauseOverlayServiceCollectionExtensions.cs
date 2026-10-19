namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;

/// <summary>
/// The composition-root wiring for the participant pause overlay (feature: world-steering, story 08). One
/// <c>Add*</c> and NO <c>Map*</c>: this slice maps no route of its own — the participant read is the
/// already-mapped, UNMODIFIED <c>GET /api/overlay-state</c>
/// (<c>Features/ParticipantShell/ParticipantShellEndpoints.cs</c>), reached by contributing an
/// <see cref="IOverlayStateProjection"/> behind it, and the push rides the already-mapped shared
/// <see cref="Pulse.WebApi.Features.Realtime.ExerciseRealtimeHub"/> at <c>/hubs/exercise</c>. The orchestrator
/// adds the single <see cref="AddPauseParticipantOverlay"/> line to <c>Program.cs</c> serially; no builder edits
/// that file.
/// </summary>
public static class PauseOverlayServiceCollectionExtensions
{
    /// <summary>
    /// Registers the participant-overlay write path and REPLACES story 07's no-op
    /// <see cref="NullPauseOverlayPublisher"/> with the real <see cref="PauseOverlayPublisher"/> — the
    /// <c>RemoveAll</c> + <c>AddSingleton</c> pattern <c>EngineReviewEndpoints.AddEngineReview</c> already uses
    /// to replace the generation core's no-op <c>IProviderHealthListener</c>.
    ///
    /// <para><b>Order-independent, both ways.</b> Story 07 registers its default with <c>TryAddSingleton</c>: if
    /// this call runs FIRST, that <c>TryAdd</c> sees the real publisher and no-ops; if it runs AFTER, the
    /// <c>RemoveAll</c> here evicts the no-op. So whichever order the orchestrator wires
    /// <c>AddPauseTierSteering()</c> and this call, the REAL publisher wins — and a DI-resolution test asserts
    /// exactly that (the #310→#317 "merged but unwired/unreplaced" lesson).</para>
    ///
    /// <para><b>Prerequisites the orchestrator wires first:</b> <c>AddExerciseScoping()</c> (the COR-001 request
    /// scope the <c>GET</c> reads), <c>AddSocialRealtimeHub()</c> (which calls <c>AddSignalR()</c> — the source
    /// of <c>IHubContext&lt;ExerciseRealtimeHub&gt;</c>; this feature adds NO second hub), and
    /// <c>AddPauseTierSteering()</c> (the <see cref="PauseTierRegistry"/> the tier reader resolves).</para>
    ///
    /// <para><b>⚠ ORDER IS LOAD-BEARING against <c>AddExerciseLifecycle()</c> — this is the one place in the
    /// steering feature where it is.</b> This call REPLACES <see cref="IOverlayStateProjection"/> with
    /// <see cref="SteeringPauseOverlayProjection"/>, and <c>AddExerciseLifecycle()</c> <c>Replace</c>s the same
    /// seam with the projection this one decorates. Whichever runs LAST wins, so this call MUST come after it.
    /// Wired before, the decorator is silently evicted and a Freeze becomes invisible to participants again —
    /// green tests, dead feature, the #310→#317 failure shape. <c>Program.cs</c> already satisfies this
    /// (<c>AddExerciseLifecycle()</c> sits with the exercise-configuration wave-3 contributors, well above the
    /// world-steering block), so <b>no composition-root edit is required</b>; the ordering itself is asserted
    /// against the real host by
    /// <c>SteeringCompositionRootWiringTests.ProgramCs_ResolvesTheSteeringPauseOverlayProjection_NotTheLifecycleProjectionAlone</c>.
    /// Note this is a genuine exception to the "<c>Replace</c> is order-independent" convention documented on
    /// <see cref="IChromeConfigProjection"/>: <c>Replace</c> is order-independent against a <c>TryAdd</c>ed
    /// FLOOR, never against another contributor's <c>Replace</c> of the same seam.</para>
    ///
    /// <para><b>Also required:</b> <c>AddExerciseConfiguration()</c> and <c>AddExerciseLifecycle()</c> — the
    /// decorator resolves the concrete <see cref="LifecycleOverlayStateProjection"/> and, through it, the
    /// <see cref="ISteeringOverlaySource"/> floor that <c>AddExerciseLifecycle()</c> registers. Absent, the seam
    /// throws LOUDLY on the first overlay read rather than silently degrading.</para>
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection AddPauseParticipantOverlay(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The per-exercise overlay store: in-memory runtime state, a singleton like PauseTierRegistry and
        // ExerciseClockService. Read by GET /api/overlay-state, written by the publisher below.
        services.TryAddSingleton<OverlayStateService>();

        // The authoritative-tier read, resolved LAZILY (inside the delegate body, at publish time) so the
        // PauseTierRegistry -> IPauseOverlayPublisher -> PauseTierRegistry cycle is never constructed. By the time
        // a publish happens, the registry singleton exists — it is the caller.
        services.TryAddSingleton<PauseTierReader>(provider =>
            exerciseId => provider.GetRequiredService<PauseTierRegistry>().GetTier(exerciseId));

        // The lifecycle status the PUSH side gates on (CR-001). Shared with the feed broadcaster's EndEx send gate
        // (#375), so both register it through the one TryAdd below.
        services.TryAddExerciseLifecycleStatusReader();

        // #390 Gate-1 WR-002: the COMPOSED overlay the pause publisher pushes — the same read the GET performs
        // (ParticipantShellConfigService.GetOverlayStateAsync): the exercise row (or the unconfigured fallback) through
        // ExerciseShellConfigSource, then the registered IOverlayStateProjection — in its OWN scope per call, for the
        // same captive-dependency reason as the lifecycle reader above.
        services.TryAddSingleton<ComposedOverlayStateReader>(provider =>
            async (exerciseId, cancellationToken) =>
            {
                await using var scope = provider.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();

                // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope the transition carries,
                // never a client-supplied id, so this read stays inside the caller's tenant.
                var exercise = await scope.ServiceProvider.GetRequiredService<PulseDbContext>().Exercises
                    .AsNoTracking()
                    .SingleOrDefaultAsync(row => row.Id == exerciseId, cancellationToken);
                var source = exercise is null
                    ? ExerciseShellConfigSource.Unconfigured(exerciseId)
                    : ExerciseShellConfigSource.FromExercise(exercise);

                return await scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>()
                    .ProjectAsync(source, cancellationToken);
            });

        services.RemoveAll<IPauseOverlayPublisher>();
        services.AddSingleton<IPauseOverlayPublisher, PauseOverlayPublisher>();

        // #390: a LIFECYCLE transition pushes the participant overlay too (the push side of the GET's
        // "lifecycle wins"). REPLACES AddExerciseLifecycle()'s TryAdded no-op — RemoveAll + add, so it wins in either
        // wiring order, exactly like the publisher swap above. A singleton that reads through the ComposedOverlayStateReader
        // registered above (its OWN scope per notification, committed state at ticket time — PR #651 review W1): see
        // LifecycleOverlayPublisher's remarks for why not scoped.
        services.RemoveAll<IExerciseLifecycleTransitionObserver>();
        services.AddSingleton<IExerciseLifecycleTransitionObserver, LifecycleOverlayPublisher>();

        // The READ side (Tom's ruling, 2026-07-27): the pause store contributes to the exercise-configuration
        // overlay seam by DECORATING the lifecycle projection — endex > pre-start > pause > none. See
        // SteeringPauseOverlayProjection for the chain, and for why ISteeringOverlaySource is deliberately left
        // at its no-op floor rather than being the seam used here.
        //
        // The inner projection is registered as its CONCRETE type so the decorator can depend on it without
        // resolving IOverlayStateProjection (which is itself) — TryAdd, so a host that registers it some other
        // way still wins. Scoped, matching the seam and the request-scoped unit of work behind it.
        services.TryAddScoped<LifecycleOverlayStateProjection>();
        services.Replace(ServiceDescriptor.Scoped<IOverlayStateProjection, SteeringPauseOverlayProjection>());

        return services;
    }

    /// <summary>
    /// Registers the database-backed <see cref="ExerciseLifecycleStatusReader"/> (TryAdd, so a host or test that
    /// registered its own reader first still wins). Shared by <see cref="AddPauseParticipantOverlay"/> (the
    /// pause-overlay push gate, CR-001) and <c>RealtimeExtensions.AddSocialRealtimeHub</c> (the feed broadcaster's
    /// EndEx send gate, #375), so neither depends on the other being wired.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same collection, for chaining.</returns>
    public static IServiceCollection TryAddExerciseLifecycleStatusReader(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Resolved through its OWN scope per call: the publisher is a singleton and PulseDbContext is scoped, so a
        // constructor-injected context would be a captive dependency. IServiceScopeFactory lives here in the factory
        // rather than in the publisher's signature, which keeps that signature free of any persistence type (AC7's
        // assertion).
        //
        // Exercise is the SCOPE, not an IExerciseScoped entity, so PulseDbContext's global read filter is a no-op
        // on this table — this is a direct read by the SERVER-resolved id the transition carries, never a
        // client-supplied one (COR-001). Same idiom as PauseTierEndpoints.ResolveClockStartAsync.
        services.TryAddSingleton<ExerciseLifecycleStatusReader>(provider =>
            async (exerciseId, cancellationToken) =>
            {
                await using var scope = provider.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();

                // org-scope-exempt(ResolvedScope): exerciseId is the SERVER-resolved scope the transition
                // carries, never a client-supplied id, so this status read stays inside the caller's tenant.
                return await scope.ServiceProvider.GetRequiredService<PulseDbContext>().Exercises
                    .AsNoTracking()
                    .Where(exercise => exercise.Id == exerciseId)
                    .Select(exercise => exercise.Status)
                    .SingleOrDefaultAsync(cancellationToken);
            });

        return services;
    }
}
