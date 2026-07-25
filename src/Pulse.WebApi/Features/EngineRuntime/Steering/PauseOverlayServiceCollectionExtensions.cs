namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

/// <summary>
/// The composition-root wiring for the participant pause overlay (feature: world-steering, story 08). One
/// <c>Add*</c> and NO <c>Map*</c>: this slice maps no route of its own — the participant read is the
/// already-mapped <c>GET /api/overlay-state</c> (<c>Features/ParticipantShell/ParticipantShellEndpoints.cs</c>,
/// one handler edited by this story) and the push rides the already-mapped shared
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

        services.RemoveAll<IPauseOverlayPublisher>();
        services.AddSingleton<IPauseOverlayPublisher, PauseOverlayPublisher>();

        return services;
    }
}
