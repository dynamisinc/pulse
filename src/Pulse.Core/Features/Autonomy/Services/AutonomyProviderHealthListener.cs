namespace Pulse.Core.Features.Autonomy.Services;

using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// Bridges the generation core's degraded-mode signal (NFR-003 / ADP-042, §3.5) into the autonomy-safety
/// layer. It implements the <see cref="IProviderHealthListener"/> seam that generation-infra raises from
/// its circuit breaker, and drives the <b>same</b> clamp mechanism the manual kill switch uses (§8.4) —
/// so an automatic provider degradation and a controller's emergency brake converge on one code path.
///
/// <para>INVARIANT (§8.2): this is the automatic sibling of the kill switch and moves autonomy only
/// <i>down</i>. On a circuit trip it drops the engine to Suggest; on recovery it clears the degraded cause
/// but <b>never</b> raises autonomy back — a controller restores the pre-incident level explicitly. The
/// trip and recovery are stamped in scenario time (COR-050/051) via <see cref="IScenarioClock"/> so the
/// telemetry arc lines up with everything else the engine logs.</para>
///
/// <para>The <see cref="IEngineSafetySwitch"/> target is per-exercise. A single generation provider serves
/// the whole host, so a real deployment fans one circuit trip out to every active exercise's switch; that
/// registry is a WebApi/host concern (none yet). This adapter wires one exercise's switch — the shape the
/// reaction loop consumes — and returns the domain events for the caller to forward to telemetry
/// (engine-telemetry-tuning), keeping this feature free of a telemetry-sink dependency.</para>
/// </summary>
public sealed class AutonomyProviderHealthListener : IProviderHealthListener
{
    private readonly IEngineSafetySwitch _safetySwitch;
    private readonly IScenarioClock _clock;

    /// <summary>Bridges provider health for one exercise's <paramref name="safetySwitch"/>, stamped by <paramref name="clock"/>.</summary>
    public AutonomyProviderHealthListener(IEngineSafetySwitch safetySwitch, IScenarioClock clock)
    {
        _safetySwitch = safetySwitch ?? throw new ArgumentNullException(nameof(safetySwitch));
        _clock = clock ?? throw new ArgumentNullException(nameof(clock));
    }

    /// <inheritdoc />
    public ValueTask OnDegradedAsync(string reason, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _safetySwitch.DegradeToSuggest(reason, _clock.CurrentScenarioMinute);
        return ValueTask.CompletedTask;
    }

    /// <inheritdoc />
    public ValueTask OnRecoveredAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _safetySwitch.MarkProviderRecovered(_clock.CurrentScenarioMinute);
        return ValueTask.CompletedTask;
    }
}
