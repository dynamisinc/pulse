namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Moderation;
using Pulse.WebApi.Features.Social.Pins;

/// <summary>
/// The SignalR-backed <see cref="IFeedBroadcaster"/> — the fan-out half of the contract-first seam story 02's
/// <c>PostIngestService</c> calls after a successful persist. It pushes the participant-safe post to exactly
/// the owning exercise's group over <see cref="ExerciseRealtimeHub"/>.
/// </summary>
/// <remarks>
/// The broadcast payload is the unconditionally participant-safe <see cref="ParticipantPostDto"/> — there is
/// NO staff branch on this seam (XC-002 is unconditional here): a broadcast never carries
/// <c>origin</c>/<c>actingHumanId</c>/<c>createdWallClock</c>/<c>injectId</c>, because those fields are
/// structurally absent from the DTO. The target group is derived from the caller-supplied
/// <paramref name="exerciseId"/> scope via <see cref="ExerciseRealtimeHub.GroupNameFor"/> — the same
/// derivation the hub uses to place a connection, so a post reaches only the sessions in its own exercise.
/// <para>
/// <b>The EndEx send gate (#375, COR-032) — every frame passes ONE choke point.</b> Before each send the
/// broadcaster reads the exercise's stored lifecycle status through <see cref="ExerciseLifecycleStatusReader"/>
/// and asks <see cref="ExerciseLifecycleStates.IsParticipantAccessible"/> — the SAME predicate
/// <see cref="ExerciseLifecycleGatingMiddleware"/> refuses the REST participant surface on (it agrees with
/// <see cref="ExerciseLifecycleBehaviour.ParticipantAccessOpen"/> for every literal). Open (<c>staged</c> /
/// <c>live</c> / <c>paused</c>, legacy <c>active</c>): the frame goes to <see cref="ExerciseRealtimeHub.GroupNameFor"/>
/// as before. Anything else — <c>build</c>, <c>completed</c>, <c>archived</c>, an unknown literal, or no exercise
/// row — FAILS CLOSED: the frame goes to <see cref="ExerciseRealtimeHub.StaffGroupNameFor"/> only, so a participant
/// tab still connected after EndEx receives nothing while staff consoles keep their live view. The hub stays
/// un-gated on CONNECT by design (the overlay client re-GETs <c>/api/overlay-state</c> on reconnect); this send
/// side is what closes the risk the gating middleware names. The gate lives here rather than in a decorator so
/// that every caller (storyline auto-send, inject bursts, approve, controller-as-persona, pins, takedowns,
/// edits, engagement) inherits it and the registered <see cref="IFeedBroadcaster"/> stays this concrete type.
/// </para>
/// </remarks>
public sealed partial class SignalRFeedBroadcaster : IFeedBroadcaster
{
    /// <summary>The SignalR client method name a subscriber handles to receive a fanned-out post.</summary>
    private const string PostReceivedEvent = "PostReceived";

    /// <summary>The SignalR client method name a subscriber handles to drop a taken-down post (demo-polish B6).</summary>
    private const string PostRemovedEvent = "PostRemoved";

    /// <summary>The SignalR client method name a subscriber handles when an exercise pin changes (demo-feedback DF-7).</summary>
    private const string PostPinChangedEvent = "PostPinChanged";

    /// <summary>The SignalR client method name a subscriber handles when a post's author edits it (demo-feedback DF-33).</summary>
    private const string PostEditedEvent = "PostEdited";

    /// <summary>The SignalR client method name a subscriber handles when a post's shown counts change (demo-feedback DF-17).</summary>
    private const string PostEngagementChangedEvent = "PostEngagementChanged";

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;
    private readonly ExerciseLifecycleStatusReader _lifecycleStatusReader;
    private readonly ILogger<SignalRFeedBroadcaster> _logger;

    /// <summary>Creates the broadcaster with the hub context it fans out through.</summary>
    /// <param name="hubContext">The context for <see cref="ExerciseRealtimeHub"/>.</param>
    /// <param name="lifecycleStatusReader">Reads the exercise's stored lifecycle status before each send.</param>
    /// <param name="logger">Logs a send that was withheld from participants.</param>
    public SignalRFeedBroadcaster(
        IHubContext<ExerciseRealtimeHub> hubContext,
        ExerciseLifecycleStatusReader lifecycleStatusReader,
        ILogger<SignalRFeedBroadcaster> logger)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        ArgumentNullException.ThrowIfNull(lifecycleStatusReader);
        ArgumentNullException.ThrowIfNull(logger);
        _hubContext = hubContext;
        _lifecycleStatusReader = lifecycleStatusReader;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task BroadcastPostAsync(
        Guid exerciseId,
        ParticipantPostDto post,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(post);

        var target = await ResolveTargetAsync(exerciseId, PostReceivedEvent, cancellationToken);
        await target.SendAsync(PostReceivedEvent, post, cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Sends <c>PostRemoved</c> with <see cref="PostRemovedDto"/> (the post id and nothing else, XC-002) to the
    /// exercise-wide group from <see cref="ExerciseRealtimeHub.GroupNameFor"/>, the same group
    /// <c>PostReceived</c> uses, because participants are the ones who must drop the post. While participants are
    /// admitted it never targets <see cref="ExerciseRealtimeHub.StaffGroupNameFor"/>: staff connections already belong
    /// to the exercise-wide group, so they receive it exactly once. (Outside those states the EndEx gate in the type's
    /// remarks sends to the staff group INSTEAD — still exactly once.)
    /// </remarks>
    public async Task BroadcastPostRemovedAsync(
        Guid exerciseId,
        Guid postId,
        CancellationToken cancellationToken = default)
    {
        var target = await ResolveTargetAsync(exerciseId, PostRemovedEvent, cancellationToken);
        await target.SendAsync(PostRemovedEvent, PostRemovedDto.For(postId), cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Sends <c>PostPinChanged</c> with <see cref="PostPinChangedDto"/> (the post id and the new flag, nothing else,
    /// XC-002) to the exercise-wide group from <see cref="ExerciseRealtimeHub.GroupNameFor"/>, exactly as
    /// <c>PostRemoved</c> does. Staff connections already belong to that group, so consoles receive it once too.
    /// </remarks>
    public async Task BroadcastPostPinChangedAsync(
        Guid exerciseId,
        Guid postId,
        bool pinnedForAll,
        CancellationToken cancellationToken = default)
    {
        var target = await ResolveTargetAsync(exerciseId, PostPinChangedEvent, cancellationToken);
        await target.SendAsync(PostPinChangedEvent, PostPinChangedDto.For(postId, pinnedForAll), cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Sends <c>PostEdited</c> with <see cref="PostEditedDto"/> to the exercise-wide group from
    /// <see cref="ExerciseRealtimeHub.GroupNameFor"/>, exactly as <c>PostRemoved</c> and <c>PostPinChanged</c> do. Staff
    /// connections already belong to that group, so consoles receive it once too.
    /// </remarks>
    public async Task BroadcastPostEditedAsync(
        Guid exerciseId,
        PostEditedDto edited,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(edited);

        var target = await ResolveTargetAsync(exerciseId, PostEditedEvent, cancellationToken);
        await target.SendAsync(PostEditedEvent, edited, cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Sends <c>PostEngagementChanged</c> with the given <see cref="PostEngagementChangedDto"/> (post id, shown counts,
    /// version; nothing else, XC-002) to the exercise-wide group from <see cref="ExerciseRealtimeHub.GroupNameFor"/>,
    /// exactly as <c>PostRemoved</c> does — never to the staff group alone while participants are admitted (see the
    /// type's EndEx gate). Staff connections already belong to that group, so consoles receive it once too.
    /// </remarks>
    public async Task BroadcastPostEngagementChangedAsync(
        Guid exerciseId,
        PostEngagementChangedDto change,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(change);

        var target = await ResolveTargetAsync(exerciseId, PostEngagementChangedEvent, cancellationToken);
        await target.SendAsync(PostEngagementChangedEvent, change, cancellationToken: cancellationToken);
    }

    /// <summary>
    /// The lifecycle choke point (#375): the exercise-wide group when participants are admitted, otherwise the
    /// staff-only group (fail closed). See the type's remarks.
    /// </summary>
    /// <param name="exerciseId">The server-resolved exercise the frame belongs to (COR-001).</param>
    /// <param name="eventName">The client event about to be sent, for the suppression log.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The client proxy the frame must be sent to.</returns>
    private async Task<IClientProxy> ResolveTargetAsync(Guid exerciseId, string eventName, CancellationToken cancellationToken)
    {
        // Exercise is the scope, not an IExerciseScoped entity: this is a direct status read by the SERVER-resolved
        // id the caller fans out for, never a client-supplied one.
        var status = await _lifecycleStatusReader(exerciseId, cancellationToken);
        if (ExerciseLifecycleStates.IsParticipantAccessible(status))
        {
            return _hubContext.Clients.Group(ExerciseRealtimeHub.GroupNameFor(exerciseId));
        }

        LogParticipantSendSuppressed(eventName, exerciseId, status ?? "(no exercise row)");
        return _hubContext.Clients.Group(ExerciseRealtimeHub.StaffGroupNameFor(exerciseId));
    }

    /// <summary>Source-generated notice that a frame was withheld from participants (CA1848).</summary>
    /// <param name="eventName">The client event withheld.</param>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="lifecycleStatus">The stored status that closed the participant group.</param>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "A {EventName} frame for exercise {ExerciseId} was NOT sent to participants: its lifecycle state " +
                  "{LifecycleStatus} is not participant-accessible (COR-032). It was sent to the staff group only.")]
    private partial void LogParticipantSendSuppressed(string eventName, Guid exerciseId, string lifecycleStatus);
}
