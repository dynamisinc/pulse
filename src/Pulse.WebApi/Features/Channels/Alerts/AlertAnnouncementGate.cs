namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Collections.Concurrent;

/// <summary>
/// One lock per exercise around "read the active set, broadcast it" (channels-foundation story 10), so an exercise's
/// <c>AlertsChanged</c> frames leave in the order their sets were read and a client never ends on a stale set. Singleton;
/// one small semaphore per exercise that has announced an alert on this host.
/// </summary>
public sealed class AlertAnnouncementGate
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> _gates = new();

    /// <summary>The exercise's gate.</summary>
    /// <param name="exerciseId">The exercise.</param>
    /// <returns>Its semaphore (count 1).</returns>
    public SemaphoreSlim For(Guid exerciseId) => _gates.GetOrAdd(exerciseId, _ => new SemaphoreSlim(1, 1));
}
