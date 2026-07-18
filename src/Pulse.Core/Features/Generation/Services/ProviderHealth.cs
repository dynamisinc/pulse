namespace Pulse.Core.Features.Generation.Services;

/// <summary>
/// The degraded-mode signal (NFR-003 / ADP-042). When the generation provider's circuit breaker trips
/// — provider outage, sustained error rate, or a latency breach — the engine must fall back to
/// Suggest/manual and alert a controller. Generation-infra <em>raises</em> this signal from the breaker
/// (§3.5); autonomy-safety <em>implements</em> the actual fallback.
/// <para>
/// INVARIANT (§8.2): degradation only ever LOWERS autonomy. Automation never raises its own autonomy —
/// recovery re-enables generation at the current level, it does not escalate it.
/// </para>
/// </summary>
public interface IProviderHealthListener
{
    /// <summary>The provider became unhealthy (circuit opened). Drop autonomy to Suggest and alert.</summary>
    ValueTask OnDegradedAsync(string reason, CancellationToken cancellationToken = default);

    /// <summary>The provider recovered (circuit closed). Resume at the current autonomy — never higher.</summary>
    ValueTask OnRecoveredAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Default no-op listener, registered until autonomy-safety wires the fallback-to-Suggest behavior.
/// The circuit breaker still protects the provider; this just means no autonomy change is applied yet.
/// </summary>
public sealed class NoOpProviderHealthListener : IProviderHealthListener
{
    public ValueTask OnDegradedAsync(string reason, CancellationToken cancellationToken = default) =>
        ValueTask.CompletedTask;

    public ValueTask OnRecoveredAsync(CancellationToken cancellationToken = default) =>
        ValueTask.CompletedTask;
}
