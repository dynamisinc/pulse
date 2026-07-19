namespace Pulse.Core.Features.Autonomy.Services;

using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The automation-facing safety seam (E8 architecture §8.2/§3.5). It exposes <b>only lowering paths</b>:
/// there is deliberately no method here by which automation could <i>raise</i> autonomy. The degraded-mode
/// bridge (<see cref="AutonomyProviderHealthListener"/>) drives this on a provider circuit trip; the manual
/// kill switch drives the same clamp from a human action (<see cref="EngineAutonomyState.EngageKillSwitch"/>).
///
/// <para>INVARIANT (§8.2): degradation and recovery only ever move autonomy <i>down</i> or leave it where it
/// is. Recovery re-enables generation at the current level — it never escalates. A controller restores the
/// pre-incident level explicitly (a human action, not automation).</para>
/// </summary>
public interface IEngineSafetySwitch
{
    /// <summary>
    /// Clamp the engine to Suggest because the generation provider degraded (§3.5). Idempotent and
    /// lowering-only: if the effective level is already Suggest (or the engine is stopped), nothing changes
    /// and the return is null. Returns the change to log (XC-004) otherwise.
    /// </summary>
    AutonomyLevelChanged? DegradeToSuggest(string reason, int scenarioMinute);

    /// <summary>
    /// The provider recovered (circuit closed). Clears the degraded clamp's <i>cause</i> but <b>never</b>
    /// raises autonomy — a controller re-raises explicitly (§8.2). Returns null (no autonomy change).
    /// </summary>
    AutonomyLevelChanged? MarkProviderRecovered(int scenarioMinute);
}
