namespace Pulse.WebApi.Features.Realtime;

using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
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

    /// <summary>
    /// Tells the exercise's subscribers that its scenario clock changed (fix/noise-new-posts-clock): a Start, Freeze,
    /// Unfreeze, Jump, startup restore or reset. The payload is ONLY <see cref="ScenarioClockChangedDto"/>
    /// (<c>ScenarioClockChanged { exerciseId, started, frozen, scenarioTime, serverTime }</c>): scenario time and the server wall
    /// clock at the same read, never the pause tier or who changed it (XC-002). It goes to the exercise-wide group
    /// (participants AND staff, who are members of it) only while <c>IsLivePushOpen</c> holds; otherwise to the staff
    /// group only (#375, see the type remarks), so staff consoles receive it in every state, exactly once.
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), so the <see cref="IFeedBroadcaster"/> test doubles that predate the
    /// server clock keep compiling unchanged. <c>SignalRFeedBroadcaster</c> implements the real fan-out.
    /// </remarks>
    /// <param name="exerciseId">The exercise whose clock changed (COR-001 scope).</param>
    /// <param name="clock">The frame: the clock state read at send time plus the exercise id (W-001).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastScenarioClockChangedAsync(
        Guid exerciseId, ScenarioClockChangedDto clock, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that a content item became <c>published</c> (channels-foundation FC-5): a
    /// publish-now, the scheduled runner, or a restore. Client event <c>ContentPublished</c>; the payload is ONLY the
    /// participant-safe <see cref="ChannelContentSummaryDto"/> (no body, no status/origin/actingHumanId/wall clock,
    /// XC-002). It goes to the exercise-wide group only while <c>IsLivePushOpen</c> holds; otherwise to the staff group
    /// only (#375, see the type remarks).
    /// </summary>
    /// <remarks>
    /// A <b>default interface method</b> (a no-op), added by channels-foundation story 02 so the funnel (04) and the
    /// alert source (10) can call it before story 09 implements it in <c>SignalRFeedBroadcaster</c>, and so the
    /// existing test doubles keep compiling unchanged.
    /// </remarks>
    /// <param name="exerciseId">The owning exercise run (COR-001 scope).</param>
    /// <param name="content">The published item's summary.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastContentPublishedAsync(
        Guid exerciseId, ChannelContentSummaryDto content, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that a published item was revised (<c>update</c> / <c>correction</c> /
    /// <c>silent_rewrite</c>; FC-5). Client event <c>ContentRevised</c>; the payload is ONLY
    /// <see cref="ContentRevisedDto"/> (<c>{ id, channelId, permalink, updatedScenarioTime, revisions[], headline, dek }</c>):
    /// no body (the client refetches), no revision author or wall clock (XC-002). Exercise-wide only while
    /// <c>IsLivePushOpen</c> holds; otherwise the staff group only (#375).
    /// </summary>
    /// <remarks>A no-op <b>default interface method</b> until story 09 (see <see cref="BroadcastContentPublishedAsync"/>).</remarks>
    /// <param name="exerciseId">The owning exercise run (COR-001 scope).</param>
    /// <param name="revised">The revise frame.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastContentRevisedAsync(
        Guid exerciseId, ContentRevisedDto revised, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that a published item was retracted (or soft-deleted; FC-5). Client event
    /// <c>ContentRetracted</c>; the payload is ONLY <see cref="ContentRetractedDto"/>
    /// (<c>{ id, channelId, permalink, retractedScenarioTime }</c>). Exercise-wide only while <c>IsLivePushOpen</c>
    /// holds; otherwise the staff group only (#375).
    /// </summary>
    /// <remarks>A no-op <b>default interface method</b> until story 09 (see <see cref="BroadcastContentPublishedAsync"/>).</remarks>
    /// <param name="exerciseId">The owning exercise run (COR-001 scope).</param>
    /// <param name="retracted">The retract frame.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastContentRetractedAsync(
        Guid exerciseId, ContentRetractedDto retracted, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// Tells the exercise's subscribers that the active alert set changed (raised, cleared or expired; FC-5). Client
    /// event <c>AlertsChanged</c>; the payload is <see cref="AlertsChangedDto"/>, the FULL active set, so a late or
    /// reconnecting client converges. Never who raised an alert or its origin (XC-002). Exercise-wide only while
    /// <c>IsLivePushOpen</c> holds; otherwise the staff group only (#375).
    /// </summary>
    /// <remarks>A no-op <b>default interface method</b> until story 09 (see <see cref="BroadcastContentPublishedAsync"/>).</remarks>
    /// <param name="exerciseId">The owning exercise run (COR-001 scope).</param>
    /// <param name="alerts">The full active alert set.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the frame has been dispatched.</returns>
    Task BroadcastAlertsChangedAsync(
        Guid exerciseId, AlertsChangedDto alerts, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
