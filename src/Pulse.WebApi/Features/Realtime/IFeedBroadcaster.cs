namespace Pulse.WebApi.Features.Realtime;

using Pulse.WebApi.Features.Social;

/// <summary>
/// The contract-first seam between the post-write path and the real-time fan-out. Story 02's
/// <c>PostIngestService</c> calls <see cref="BroadcastPostAsync"/> after a successful persist; story 03 owns
/// the SignalR-backed implementation (<c>SignalRFeedBroadcaster</c>, fanning out over the exercise-grouped
/// hub). Kept as a small interface agreed upfront so 02 and 03 build in the same wave against the shape
/// rather than serializing on a shared file.
/// </summary>
public interface IFeedBroadcaster
{
    /// <summary>
    /// Broadcasts a newly-persisted post to the exercise's subscribers. The payload is the unconditionally
    /// participant-safe <see cref="ParticipantPostDto"/> — XC-002 on the broadcast is unconditional (there is
    /// no staff branch on this seam; a broadcast never carries provenance).
    /// </summary>
    /// <param name="exerciseId">The owning exercise run whose subscribers receive the post (COR-001 scope).</param>
    /// <param name="post">The participant-safe post to fan out.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the broadcast has been dispatched.</returns>
    Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default);

    /// <summary>
    /// Tells the exercise's subscribers that a post was taken down (demo-polish B6, CTL-025), so every
    /// participant feed drops it live. The payload is ONLY the post id (<c>PostRemoved { postId }</c>): no text,
    /// author, category or provenance ever rides this event (XC-002). It goes to the exercise-wide group,
    /// because participants are exactly who must stop seeing the post.
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), so the <see cref="IFeedBroadcaster"/> test doubles that
    /// predate takedown keep compiling unchanged. <c>SignalRFeedBroadcaster</c> implements the real fan-out.
    /// </remarks>
    /// <param name="exerciseId">The owning exercise run whose subscribers drop the post (COR-001 scope).</param>
    /// <param name="postId">The id of the post that was taken down.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the removal has been dispatched.</returns>
    Task BroadcastPostRemovedAsync(Guid exerciseId, Guid postId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
