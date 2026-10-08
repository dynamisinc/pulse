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
/// <b>Exercise-scoped STAFF group is server-derived (COR-001, always-Critical).</b> The target group is built
/// ONLY from the caller-supplied <c>exerciseId</c> (which every service path resolves from
/// <see cref="Pulse.WebApi.Data.IExerciseContext"/>, never from client input) via the single source of truth
/// <see cref="ExerciseRealtimeHub.StaffGroupNameFor"/> — the same derivation the hub uses to place a VERIFIED
/// staff connection, so a push reaches only the staff connections of its own exercise and never another's.
/// <para>
/// <b>Staff group, never the exercise-wide group (demo-polish B5, XC-002).</b> The payload is
/// <see cref="EngineReviewItemDto"/>, a STAFF-only shape carrying unpublished engine drafts and their
/// provenance. Participant connections share the hub and join the exercise-wide
/// <see cref="ExerciseRealtimeHub.GroupNameFor"/> group, so this push must never target it: it targets
/// <c>exercise:{id}:staff</c>, which the hub admits a connection to only after verifying, server-side, a live
/// staff session assigned to that exercise. A participant connection therefore never receives the frame at
/// all — the boundary is enforced on the wire, not by the client declining to handle it.
/// </para>
/// </remarks>
public interface IEngineReviewBroadcaster
{
    /// <summary>
    /// Pushes one changed review item to its exercise's verified staff group (<c>exercise:{id}:staff</c>) — never
    /// the exercise-wide group participants join. Called after a disposition change / auto-HOLD fire /
    /// auto-send has been persisted.
    /// </summary>
    /// <param name="exerciseId">The owning exercise run whose staff connections receive the push (server-derived scope).</param>
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
/// to the SAME single <c>core/realtime</c> connection the participant feed uses, so there is no second hub —
/// but only to that hub's role-scoped staff group (<see cref="ExerciseRealtimeHub.StaffGroupNameFor"/>).
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
            .Group(ExerciseRealtimeHub.StaffGroupNameFor(exerciseId))
            .SendAsync(ReviewItemChangedEvent, item, cancellationToken: cancellationToken);
    }
}
