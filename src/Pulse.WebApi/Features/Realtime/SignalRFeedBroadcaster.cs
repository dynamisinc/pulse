namespace Pulse.WebApi.Features.Realtime;

using Microsoft.AspNetCore.SignalR;
using Pulse.WebApi.Features.Social;

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
/// </remarks>
public sealed class SignalRFeedBroadcaster : IFeedBroadcaster
{
    /// <summary>The SignalR client method name a subscriber handles to receive a fanned-out post.</summary>
    private const string PostReceivedEvent = "PostReceived";

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;

    /// <summary>Creates the broadcaster with the hub context it fans out through.</summary>
    /// <param name="hubContext">The context for <see cref="ExerciseRealtimeHub"/>.</param>
    public SignalRFeedBroadcaster(IHubContext<ExerciseRealtimeHub> hubContext)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        _hubContext = hubContext;
    }

    /// <inheritdoc />
    public async Task BroadcastPostAsync(
        Guid exerciseId,
        ParticipantPostDto post,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(post);

        await _hubContext.Clients
            .Group(ExerciseRealtimeHub.GroupNameFor(exerciseId))
            .SendAsync(PostReceivedEvent, post, cancellationToken: cancellationToken);
    }
}
