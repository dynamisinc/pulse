namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Generic;
using Microsoft.AspNetCore.SignalR;
using Pulse.WebApi.Features.Realtime;

/// <summary>
/// The staff-only push for the white-noise state (story 05): <c>NoiseStateChanged</c> with a
/// <see cref="NoiseStateDto"/>, on a level change and after published noise posts.
/// </summary>
/// <remarks>
/// <b>Staff group only (XC-002, COR-001).</b> The group is <see cref="ExerciseRealtimeHub.StaffGroupNameFor"/> of a
/// server-resolved exercise id, never the exercise-wide group participants join, so a participant connection never
/// receives the frame. Participants see only the posts themselves, through the ordinary <c>PostReceived</c> push.
/// </remarks>
public interface INoiseBroadcaster
{
    /// <summary>Pushes <paramref name="state"/> to the exercise's verified staff connections.</summary>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <param name="state">The state to push.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the push has been dispatched.</returns>
    Task BroadcastStateAsync(Guid exerciseId, NoiseStateDto state, CancellationToken cancellationToken = default);
}

/// <summary>
/// The SignalR <see cref="INoiseBroadcaster"/>, over the shared <see cref="ExerciseRealtimeHub"/> (no second hub),
/// as <c>EngineReviewBroadcaster</c> does it.
/// </summary>
public sealed class NoiseBroadcaster : INoiseBroadcaster
{
    /// <summary>The SignalR client method the console knob subscribes to.</summary>
    public const string NoiseStateChangedEvent = "NoiseStateChanged";

    private readonly IHubContext<ExerciseRealtimeHub> _hubContext;

    /// <summary>Creates the broadcaster over the exercise hub context.</summary>
    /// <param name="hubContext">The context for <see cref="ExerciseRealtimeHub"/>.</param>
    public NoiseBroadcaster(IHubContext<ExerciseRealtimeHub> hubContext)
    {
        ArgumentNullException.ThrowIfNull(hubContext);
        _hubContext = hubContext;
    }

    /// <inheritdoc />
    public async Task BroadcastStateAsync(Guid exerciseId, NoiseStateDto state, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(state);

        await _hubContext.Clients
            .Group(ExerciseRealtimeHub.StaffGroupNameFor(exerciseId))
            .SendAsync(NoiseStateChangedEvent, state, cancellationToken);
    }
}

/// <summary>
/// Limits the post-driven <c>NoiseStateChanged</c> push to at most one per <see cref="MinInterval"/> per exercise
/// (story 05). Level-change pushes do not pass through it. In memory, keyed by exercise id (COR-001).
/// </summary>
public sealed class NoiseStateThrottle
{
    /// <summary>The shortest interval between two post-driven pushes for one exercise.</summary>
    public static readonly TimeSpan MinInterval = TimeSpan.FromSeconds(2);

    private readonly Dictionary<Guid, DateTimeOffset> _lastPush = [];
    private readonly Lock _gate = new();

    /// <summary>
    /// Whether a post-driven push for <paramref name="exerciseId"/> may go out at <paramref name="now"/>; when it may,
    /// the push is recorded.
    /// </summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <param name="now">The current server time.</param>
    /// <returns><c>true</c> when at least <see cref="MinInterval"/> has passed since the last recorded push.</returns>
    public bool TryAcquire(Guid exerciseId, DateTimeOffset now)
    {
        lock (_gate)
        {
            if (_lastPush.TryGetValue(exerciseId, out var last) && now - last < MinInterval)
            {
                return false;
            }

            _lastPush[exerciseId] = now;
            return true;
        }
    }
}
