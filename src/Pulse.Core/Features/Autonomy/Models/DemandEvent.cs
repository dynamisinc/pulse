namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// A kind of decision the engine <b>demands</b> of a controller (CTL-034 / D5-014/2.7). These are the
/// signals the workload meter counts. Crucially this is a measure of <b>demand</b> — work the engine
/// pushes onto a human — <b>never</b> a measure of controller performance or throughput. A design that
/// pushes sustained demand past the budget is a defect (§8.5), not a slow controller.
/// </summary>
public enum DemandEventKind
{
    /// <summary>A burst landed in the review queue, demanding one review decision (one burst = one decision, ADP-040).</summary>
    QueueFire,

    /// <summary>A review-queue action the controller must take on a queued/held burst (approve / edit / veto / re-roll).</summary>
    ReviewAction,

    /// <summary>A response-match confirmation prompt ("does this address #WaterIssues? Y/N", ADP-002a).</summary>
    ResponseMatchPrompt,
}

/// <summary>
/// One demand event stamped in scenario time (COR-050/051): what was demanded and when. The workload meter
/// aggregates these over a rolling scenario-time window. Staff-only (XC-002).
/// </summary>
/// <param name="Kind">The kind of demanded decision.</param>
/// <param name="ScenarioMinute">Scenario minutes since exercise start when the demand occurred.</param>
public readonly record struct DemandEvent(DemandEventKind Kind, int ScenarioMinute);
