namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The real-time push seam for the controller review cockpit (story 02). A disposition change (approve /
/// edit / veto / re-roll), an auto-HOLD fire on countdown expiry, or a swamped-mode auto-send pushes the
/// changed <see cref="EngineReviewItemDto"/> to exactly the owning exercise's controllers, reusing the B1
/// <see cref="ExerciseRealtimeHub"/> transport (NO second connection). The cockpit reconciles its queue by
/// <c>draftId</c> and disposition, so one "item changed" push covers "left the queue" (Published/Vetoed) and
/// "moved to NEEDS YOU" (Held) alike.
/// </summary>
/// <remarks>
/// <b>Exercise-scoped group is server-derived (COR-001, always-Critical).</b> The target group is built ONLY
/// from the caller-supplied <c>exerciseId</c> (which every service path resolves from
/// <see cref="Pulse.WebApi.Data.IExerciseContext"/>, never from client input) via the single source of truth
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/> — the same derivation the hub uses to place a connection,
/// so a push reaches only the controllers in its own exercise and never another's.
/// <para>
/// The payload is <see cref="EngineReviewItemDto"/>, a STAFF-only shape (the cockpit is COBRA, XC-002 hides
/// engine provenance from PARTICIPANTS only) — it is never sent to a participant surface.
/// </para>
/// </remarks>
public interface IEngineReviewBroadcaster
{
    /// <summary>
    /// Pushes one changed review item to its exercise's controller group. Called after a disposition change /
    /// auto-HOLD fire / auto-send has been persisted.
    /// </summary>
    /// <param name="exerciseId">The owning exercise run whose controllers receive the push (server-derived scope).</param>
    /// <param name="item">The changed review item, projected to the frozen wire shape.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the push has been dispatched.</returns>
    Task BroadcastReviewItemChangedAsync(
        Guid exerciseId,
        EngineReviewItemDto item,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// SignalR-backed <see cref="IEngineReviewBroadcaster"/>. Fans out over the shared
/// <see cref="ExerciseRealtimeHub"/> (mapped at <c>/hubs/exercise</c> by B1) — the review cockpit subscribes
/// to the SAME single <c>core/realtime</c> connection the participant feed uses, so there is no second hub.
/// </summary>
public sealed class EngineReviewBroadcaster : IEngineReviewBroadcaster
{
    /// <summary>The SignalR client method the flipped <c>useReviewQueue</c> subscribes to for a changed review item.</summary>
    private const string ReviewItemChangedEvent = "ReviewItemChanged";

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;

    /// <summary>Creates the broadcaster over the exercise hub context it pushes through.</summary>
    /// <param name="hubContext">The context for <see cref="ExerciseRealtimeHub"/> (reused from B1; no second hub).</param>
    public EngineReviewBroadcaster(IHubContext<ExerciseRealtimeHub> hubContext)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        _hubContext = hubContext;
    }

    /// <inheritdoc />
    public async Task BroadcastReviewItemChangedAsync(
        Guid exerciseId,
        EngineReviewItemDto item,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(item);

        await _hubContext.Clients
            .Group(ExerciseRealtimeHub.GroupNameFor(exerciseId))
            .SendAsync(ReviewItemChangedEvent, item, cancellationToken: cancellationToken);
    }
}
