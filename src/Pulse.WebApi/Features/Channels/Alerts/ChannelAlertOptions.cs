namespace Pulse.WebApi.Features.Channels.Alerts;

/// <summary>
/// The alert source's tunables (channels-foundation story 10), bound from <see cref="SectionName"/>. Every default is
/// the shipped behaviour, so an absent section changes nothing.
/// </summary>
public sealed class ChannelAlertOptions
{
    /// <summary>The configuration section.</summary>
    public const string SectionName = "Channels:Alerts";

    /// <summary>
    /// The SOC-072 pilot bridge (Q5): while true, every raise and clear also goes to the
    /// <see cref="IPlatformAlertNotifier"/>, so the alert renders as a platform notification as well as on the bar (one
    /// logical alert, two renderings). Default true: the bar and notifications coexist through December.
    /// </summary>
    public bool PlatformNotificationBridgeEnabled { get; set; } = true;

    /// <summary>
    /// How often the expiry sweep looks for alerts whose scenario-time expiry has passed. Default 5 s, the same idle
    /// cadence as the inject burst runner; a clock jump is picked up on the next sweep.
    /// </summary>
    public TimeSpan SweepInterval { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The bound on one post-commit <c>AlertsChanged</c> fan-out (active-set read + send), which runs under the
    /// exercise's announcement gate. Default 10 s; a send that overruns is cancelled and logged, never retried.
    /// </summary>
    public TimeSpan BroadcastTimeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>The longest wait between sweeps while sweeps keep failing (doubling from the interval). Default 60 s.</summary>
    public TimeSpan MaxFailureBackoff { get; set; } = TimeSpan.FromSeconds(60);
}
