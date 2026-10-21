namespace Pulse.WebApi.Features.BackgroundWork;

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

/// <summary>
/// The safety net under the idle sleeps: every <see cref="Interval"/> it wakes EVERY registered
/// <see cref="WakeSignal"/> at once, so a write that somehow did not wake its service (a path nobody wired, a
/// direct-SQL ops script, a scaled-in instance) is picked up within the interval instead of waiting for a restart.
/// </summary>
/// <remarks>
/// <para>
/// One coordinated sweep, not one timer per service: all the sleepers wake together, so the serverless database is
/// woken once per interval (and then stays up for its auto-pause delay, an hour) rather than once per service at
/// drifting times. Default <see cref="DefaultInterval"/> (12 h): roughly two database-hours a day on an idle
/// environment, against round-the-clock before.
/// </para>
/// <para>
/// Configurable without a redeploy through <c>BackgroundWork:SafetySweepInterval</c> (a <see cref="TimeSpan"/>, e.g.
/// <c>06:00:00</c>); zero or negative disables the net.
/// </para>
/// </remarks>
public sealed partial class BackgroundWorkSafetySweep : BackgroundService
{
    /// <summary>The configuration key for the interval.</summary>
    public const string IntervalConfigurationKey = "BackgroundWork:SafetySweepInterval";

    /// <summary>The interval when none is configured.</summary>
    public static readonly TimeSpan DefaultInterval = TimeSpan.FromHours(12);

    private readonly IReadOnlyList<WakeSignal> _signals;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<BackgroundWorkSafetySweep> _logger;

    /// <summary>Creates the sweep.</summary>
    /// <param name="signals">Every registered wake signal.</param>
    /// <param name="timeProvider">The clock the interval runs on.</param>
    /// <param name="logger">Diagnostics.</param>
    /// <param name="configuration">Read for <see cref="IntervalConfigurationKey"/>; absent means the default.</param>
    public BackgroundWorkSafetySweep(
        IEnumerable<WakeSignal> signals,
        TimeProvider timeProvider,
        ILogger<BackgroundWorkSafetySweep> logger,
        IConfiguration? configuration = null)
    {
        ArgumentNullException.ThrowIfNull(signals);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _signals = signals.Distinct().ToList();
        _timeProvider = timeProvider;
        _logger = logger;
        Interval = ResolveInterval(configuration?[IntervalConfigurationKey]);
    }

    /// <summary>How often every sleeper is woken; <see cref="Timeout.InfiniteTimeSpan"/> when disabled.</summary>
    public TimeSpan Interval { get; }

    /// <summary>
    /// The interval a configured value means: absent or unparseable is <see cref="DefaultInterval"/>; zero or negative
    /// disables the net (<see cref="Timeout.InfiniteTimeSpan"/>).
    /// </summary>
    /// <param name="configured">The configured value, if any.</param>
    /// <returns>The interval.</returns>
    public static TimeSpan ResolveInterval(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured)
            || !TimeSpan.TryParse(configured, CultureInfo.InvariantCulture, out var interval))
        {
            return DefaultInterval;
        }

        return interval > TimeSpan.Zero ? interval : Timeout.InfiniteTimeSpan;
    }

    /// <summary>Wakes every registered signal once.</summary>
    public void WakeAll()
    {
        foreach (var signal in _signals)
        {
            signal.Wake();
        }
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (Interval == Timeout.InfiniteTimeSpan || _signals.Count == 0)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(Interval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            LogSafetySweep(_signals.Count);
            WakeAll();
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Debug,
        Message = "Background-work safety sweep: waking {SignalCount} idle services.")]
    private partial void LogSafetySweep(int signalCount);
}
