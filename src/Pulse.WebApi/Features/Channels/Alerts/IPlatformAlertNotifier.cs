namespace Pulse.WebApi.Features.Channels.Alerts;

using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The SOC-072 pilot bridge (channels-foundation story 10, Q5): the seam through which an alert ALSO becomes a
/// platform-wide Social notification. The alert source calls it after every raise and clear while
/// <see cref="ChannelAlertOptions.PlatformNotificationBridgeEnabled"/> holds. The notification center that renders it is
/// notifications story 03 (#119), which replaces <see cref="NullPlatformAlertNotifier"/>.
/// </summary>
/// <remarks>
/// <b>One logical alert, two renderings.</b> The notifier gets the SAME participant-safe <see cref="AlertDto"/> the bar
/// gets: the same <c>id</c> and the headline verbatim as <c>message</c> (D4-010). It must key the notification on that
/// id and never mint its own, so a client running the portal-era bar can suppress a toast for an alert id the bar is
/// already showing (the bar is authoritative). Calls are scoped to one exercise and never carry who raised the alert
/// (XC-002). A notifier fault never undoes the raise: the alert source logs it.
/// </remarks>
public interface IPlatformAlertNotifier
{
    /// <summary>An alert was raised in <paramref name="exerciseId"/>.</summary>
    /// <param name="exerciseId">The owning exercise (COR-001).</param>
    /// <param name="alert">The alert, exactly as the bar renders it.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the notification is dispatched.</returns>
    Task AlertRaisedAsync(Guid exerciseId, AlertDto alert, CancellationToken cancellationToken = default);

    /// <summary>An alert left the active set in <paramref name="exerciseId"/> (cleared or expired).</summary>
    /// <param name="exerciseId">The owning exercise (COR-001).</param>
    /// <param name="alertId">The alert id the notification was keyed on.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the withdrawal is dispatched.</returns>
    Task AlertClearedAsync(Guid exerciseId, string alertId, CancellationToken cancellationToken = default);
}

/// <summary>The default bridge until notifications story 03 lands: dispatches nothing.</summary>
public sealed class NullPlatformAlertNotifier : IPlatformAlertNotifier
{
    /// <inheritdoc />
    public Task AlertRaisedAsync(Guid exerciseId, AlertDto alert, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <inheritdoc />
    public Task AlertClearedAsync(Guid exerciseId, string alertId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
