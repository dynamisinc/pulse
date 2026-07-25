namespace Pulse.WebApi.Features.EngineRuntime.Steering;

using System.Threading;
using System.Threading.Tasks;

/// <summary>
/// The participant-overlay SEAM for the tiered pause (feature: world-steering, story 07; CTL-023). A tier
/// transition recorded by <see cref="PauseTierRegistry"/> is handed to this publisher so a participant-visible
/// pause/holding overlay can be pushed — but story 07 deliberately publishes NOTHING: the default registration
/// is the no-op <see cref="NullPauseOverlayPublisher"/> (<c>TryAddSingleton</c>, see
/// <see cref="PauseTierEndpoints.AddPauseTierSteering"/>), so the pause tier is recorded and the clock frozen
/// with no participant surface touched at all.
///
/// <para><b>Story 08 replaces it.</b> The participant-overlay story swaps the real implementation in with
/// <c>services.RemoveAll&lt;IPauseOverlayPublisher&gt;()</c> + <c>services.AddSingleton&lt;IPauseOverlayPublisher,
/// ...&gt;()</c> — exactly the pattern <c>EngineReviewEndpoints.AddEngineReview</c> already uses to replace the
/// generation core's no-op <c>IProviderHealthListener</c>. Because the default is registered with
/// <c>TryAddSingleton</c>, whichever order the orchestrator wires the two features, the REAL publisher wins if
/// it registered first and the <c>RemoveAll</c> guarantees it wins if it registers after.</para>
///
/// <para><b>Isolation (COR-001).</b> Every publish names exactly one exercise —
/// <see cref="PauseTierTransition.ExerciseId"/>, always the server-resolved scope, never a client-supplied id.
/// An implementation must fan out to that exercise alone (story 08's broadcaster is
/// <c>ExerciseRealtimeHub.GroupNameFor(exerciseId)</c>-scoped).</para>
///
/// <para><b>Never throws into the controller's action.</b> Implementations swallow their own transport
/// failures: a broken overlay push must not fail the tier change (or the clock freeze) that already happened.
/// </para>
/// </summary>
public interface IPauseOverlayPublisher
{
    /// <summary>
    /// Publishes a completed pause-tier transition to the exercise's participant surfaces. Called once per
    /// ACTUAL transition (a no-change <c>setTier</c> publishes nothing).
    /// </summary>
    /// <param name="transition">The completed transition — the exercise, the tiers, and the acting human.</param>
    /// <param name="cancellationToken">Cancels the publish.</param>
    /// <returns>A task that completes when the publish has been dispatched.</returns>
    Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default);
}

/// <summary>
/// The story-07 DEFAULT <see cref="IPauseOverlayPublisher"/>: a no-op. The pause tier is recorded
/// server-authoritatively and the scenario clock is frozen, but nothing is pushed to participants until story
/// 08 replaces this registration (see the interface docs). Stateless, so it is registered as a singleton and is
/// safe to call concurrently.
/// </summary>
public sealed class NullPauseOverlayPublisher : IPauseOverlayPublisher
{
    /// <inheritdoc />
    public Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(transition);
        return Task.CompletedTask;
    }
}
