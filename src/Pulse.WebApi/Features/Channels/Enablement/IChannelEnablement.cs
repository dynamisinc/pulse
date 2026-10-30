namespace Pulse.WebApi.Features.Channels.Enablement;

using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// FC-7 channel enablement (channels-foundation 08, #704; PRT-003, COR-030): whether a participant channel is
/// enabled for the SERVER-RESOLVED exercise. Backs the <c>RequireChannelEnabled(channelId)</c> endpoint filter and
/// answers the question <c>GET /api/channel-nav-config</c> answers through the same rule
/// (<see cref="ChannelCatalog.ResolveEnabled"/>), so the nav and the gate never disagree.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope comes from the server only (XC-001).</b> The exercise is <c>IExerciseContext.CurrentExerciseId</c>;
/// nothing is read from the request. An unresolved scope answers <c>false</c> (fail closed).
/// </para>
/// <para>
/// <b>Live (no cache beyond one request).</b> The implementation is scoped and reads the exercise row per request,
/// so a planner toggling a channel mid-session applies to the participant's next request without a restart.
/// </para>
/// </remarks>
public interface IChannelEnablement
{
    /// <summary>
    /// Whether <paramref name="channelId"/> is enabled for the resolved exercise: its stored
    /// <c>Exercise.EnabledChannels</c>, or <see cref="ChannelCatalog.DefaultEnabledIds"/> when not configured.
    /// An uncatalogued id or an unresolved scope is <c>false</c>.
    /// </summary>
    /// <param name="channelId">A <see cref="ChannelCatalog"/> channel id (canonical casing).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>true</c> when the channel is enabled.</returns>
    Task<bool> IsEnabledAsync(string channelId, CancellationToken cancellationToken = default);
}
