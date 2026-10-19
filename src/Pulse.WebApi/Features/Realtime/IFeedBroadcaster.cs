namespace Pulse.WebApi.Features.Realtime;

using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Engagement;

/// <summary>
/// The contract-first seam between the post-write path and the real-time fan-out. Story 02's
/// <c>PostIngestService</c> calls <see cref="BroadcastPostAsync"/> after a successful persist; story 03 owns
/// the SignalR-backed implementation (<c>SignalRFeedBroadcaster</c>, fanning out over the exercise-grouped
/// hub). Kept as a small interface agreed upfront so 02 and 03 build in the same wave against the shape
/// rather than serializing on a shared file.
/// </summary>
/// <remarks>
/// <para>
/// <b>Lifecycle routing (#375).</b> Every frame on this seam goes to the exercise-wide group
/// (<c>ExerciseRealtimeHub.GroupNameFor</c>) only while the exercise is open to live pushes
/// (<c>ExerciseLifecycleStates.IsLivePushOpen</c> — <c>staged</c> / <c>live</c> / <c>paused</c>; it coincides
/// with the REST rule <c>IsParticipantAccessible</c> today, but may diverge in <c>completed</c>). In any other
/// state — and for an unknown status or a missing exercise row — it goes to the staff-only group
/// (<c>ExerciseRealtimeHub.StaffGroupNameFor</c>) instead, so a tab still connected after EndEx receives nothing
/// while staff consoles keep their live view. "Exercise-wide group" in the members below means: while open.
/// </para>
/// </remarks>
public interface IFeedBroadcaster
{
    /// <summary>
    /// Broadcasts a newly-persisted post to the exercise's subscribers. The payload is the unconditionally
    /// participant-safe <see cref="ParticipantPostDto"/> — XC-002 on the broadcast is unconditional (there is
    /// no staff branch on this seam; a broadcast never carries provenance). It reaches the exercise-wide group
    /// only while <c>IsLivePushOpen</c> holds; otherwise to the staff group only (#375, see the type remarks).
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
    /// because participants are exactly who must stop seeing the post — only while
    /// <c>IsLivePushOpen</c> holds; otherwise to the staff group only (#375, see the type remarks).
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

    /// <summary>
    /// Tells the exercise's subscribers that a controller pinned a post for everyone, or cleared that pin
    /// (demo-feedback DF-7), so every Pinned tab and console updates live. The payload is ONLY
    /// <c>PostPinChanged { postId, pinnedForAll }</c>: never who pinned it, when, or any post content (XC-002). It goes
    /// to the exercise-wide group, because participants are exactly who see exercise pins — only while
    /// <c>IsLivePushOpen</c> holds; otherwise to the staff group only (#375, see the type remarks).
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), so the <see cref="IFeedBroadcaster"/> test doubles that predate
    /// exercise pins keep compiling unchanged. <c>SignalRFeedBroadcaster</c> implements the real fan-out.
    /// </remarks>
    /// <param name="exerciseId">The owning exercise run whose subscribers receive the change (COR-001 scope).</param>
    /// <param name="postId">The post whose exercise pin changed.</param>
    /// <param name="pinnedForAll">Whether the post is now pinned for everyone.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the change has been dispatched.</returns>
    Task BroadcastPostPinChangedAsync(
        Guid exerciseId, Guid postId, bool pinnedForAll, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that a participant edited their own post or reply (demo-feedback DF-33, story
    /// 19), after the edit committed. The payload is ONLY <c>PostEdited { postId, text, edited { count, scenarioTime },
    /// version }</c> (<see cref="PostEditedDto"/>): the new text, the edit summary in SCENARIO time and the monotonic
    /// <c>version</c> (= the edit count) a client uses to drop a stale frame. Never who edited it, the wall clock or the
    /// previous text (XC-002). It goes to the exercise-wide group only while
    /// <c>IsLivePushOpen</c> holds; otherwise to the staff group only (#375, see the type remarks).
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), so the <see cref="IFeedBroadcaster"/> test doubles that predate
    /// editing keep compiling unchanged. <c>SignalRFeedBroadcaster</c> implements the real fan-out.
    /// </remarks>
    /// <param name="exerciseId">The owning exercise run whose subscribers receive the edit (COR-001 scope).</param>
    /// <param name="edited">The participant-safe edit frame.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastPostEditedAsync(
        Guid exerciseId, PostEditedDto edited, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that a post's shown engagement changed (demo-feedback DF-17): a like or repost
    /// was added or removed, or a reply landed under it. The payload is ONLY
    /// <c>PostEngagementChanged { postId, counts { reply, repost, like }, version }</c>: the shown counts every
    /// participant sees and a database-derived version (DF-18). It never carries who reacted, the viewer's own
    /// <c>active</c> state, or the baseline / real split (XC-002). It goes to the exercise-wide group, because every
    /// participant card showing the post must update — only while
    /// <c>IsLivePushOpen</c> holds; otherwise to the staff group only (#375, see the type remarks).
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), so the <see cref="IFeedBroadcaster"/> test doubles that predate live
    /// engagement keep compiling unchanged. <c>SignalRFeedBroadcaster</c> implements the real fan-out.
    /// </remarks>
    /// <param name="exerciseId">The owning exercise run whose subscribers receive the change (COR-001 scope).</param>
    /// <param name="change">The post's new shown counts and version.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the change has been dispatched.</returns>
    Task BroadcastPostEngagementChangedAsync(
        Guid exerciseId, PostEngagementChangedDto change, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
