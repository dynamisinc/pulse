namespace Pulse.Core.Features.Autonomy.Services;

using Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The CTL-034 controller-workload meter (E8 architecture §8.5, D5-014/2.7). It counts the decisions the
/// engine <b>demands</b> of one controller — review-queue actions + response-match prompts + queue fires —
/// over a rolling <b>scenario-time</b> window (COR-050/051), and flags when sustained demand would exceed
/// the budget of ~6/min. The visible metric is <b>queue pressure = demand</b>: amber past the budget.
///
/// <para>This is a <b>demand</b> meter, <b>never</b> a controller-performance measure (D5-014/2.7 forbids
/// surfacing it as surveillance). It measures what the engine's design pushes onto the human; a value past
/// budget is a signal that the <i>engine</i> is generating too much demand (a defect to flag, §8.5), not
/// that the controller is slow. It exposes no throughput/efficiency/latency of the human — only demand.</para>
///
/// <para>Kept in scenario time so a freeze (no advancing minutes) accrues no phantom demand and a time-jump
/// doesn't dilute the rate. One meter per controller per exercise; not thread-safe (single-threaded loop).</para>
/// </summary>
public sealed class WorkloadDemandMeter
{
    /// <summary>The CTL-034 budget: sustained demand must stay at or below this many decisions per scenario minute.</summary>
    public const int BudgetPerMinute = 6;

    /// <summary>The default rolling window (D5-014/2.7 "rolling 60s" = one scenario minute).</summary>
    public const int DefaultWindowMinutes = 1;

    /// <summary>
    /// The default retention window in scenario minutes. Chosen far above any realistic analysis window so
    /// auto-prune never disturbs a rate query, while still bounding memory over a multi-hour exercise.
    /// </summary>
    public const int DefaultRetentionMinutes = 120;

    private readonly List<DemandEvent> _events = [];
    private readonly int _retentionMinutes;
    private int _maxScenarioMinute;

    /// <summary>The controller this meter tracks demand for.</summary>
    public Guid ControllerId { get; }

    /// <summary>The exercise the demand is scoped to (COR-001).</summary>
    public Guid ExerciseId { get; }

    /// <summary>
    /// Creates a demand meter for one controller in one exercise. <paramref name="retentionMinutes"/> bounds
    /// how far back events are kept: on every <see cref="Record"/> the meter auto-prunes anything older than
    /// the latest scenario minute minus this window, so memory (and the <see cref="DemandInWindow"/> scan)
    /// stay O(retention), not O(total). Keep it comfortably larger than any window passed to
    /// <see cref="DemandInWindow"/> / <see cref="IsOverBudget"/>, or an over-long query would under-count.
    /// </summary>
    public WorkloadDemandMeter(Guid exerciseId, Guid controllerId, int retentionMinutes = DefaultRetentionMinutes)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("The demand meter is exercise-scoped (COR-001).", nameof(exerciseId));
        }

        if (controllerId == Guid.Empty)
        {
            throw new ArgumentException("The demand meter tracks one controller.", nameof(controllerId));
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(retentionMinutes, 1);

        ExerciseId = exerciseId;
        ControllerId = controllerId;
        _retentionMinutes = retentionMinutes;
    }

    /// <summary>
    /// Records one demanded decision at <paramref name="scenarioMinute"/>, then auto-prunes events older than
    /// the retention window so the retained set (and every rate scan) stays bounded even if the caller never
    /// calls <see cref="Prune"/>.
    /// </summary>
    public void Record(DemandEventKind kind, int scenarioMinute)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(scenarioMinute);
        _events.Add(new DemandEvent(kind, scenarioMinute));

        _maxScenarioMinute = Math.Max(_maxScenarioMinute, scenarioMinute);
        var oldest = _maxScenarioMinute - _retentionMinutes;
        if (oldest > 0)
        {
            _events.RemoveAll(e => e.ScenarioMinute < oldest);
        }
    }

    /// <summary>
    /// The number of demanded decisions inside the rolling window ending at <paramref name="nowScenarioMinute"/>
    /// — events with minute in <c>(now - windowMinutes, now]</c>.
    /// </summary>
    public int DemandInWindow(int nowScenarioMinute, int windowMinutes = DefaultWindowMinutes)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(nowScenarioMinute);
        ArgumentOutOfRangeException.ThrowIfLessThan(windowMinutes, 1);

        var lowerExclusive = nowScenarioMinute - windowMinutes;
        var count = 0;
        foreach (var e in _events)
        {
            if (e.ScenarioMinute > lowerExclusive && e.ScenarioMinute <= nowScenarioMinute)
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>
    /// The demand rate in decisions per scenario minute over the rolling window ending at
    /// <paramref name="nowScenarioMinute"/>. Averaging over a multi-minute window is what makes "sustained"
    /// meaningful — a single one-minute spike is smoothed, so only genuinely sustained demand trips the budget.
    /// </summary>
    public double DemandPerMinute(int nowScenarioMinute, int windowMinutes = DefaultWindowMinutes) =>
        DemandInWindow(nowScenarioMinute, windowMinutes) / (double)windowMinutes;

    /// <summary>
    /// Whether sustained demand over the window exceeds the CTL-034 budget (the amber condition, D5-014/2.7).
    /// Strictly greater than the budget — a rate exactly at 6/min is within budget.
    /// </summary>
    public bool IsOverBudget(int nowScenarioMinute, int windowMinutes = DefaultWindowMinutes) =>
        DemandPerMinute(nowScenarioMinute, windowMinutes) > BudgetPerMinute;

    /// <summary>
    /// Drops recorded events older than <paramref name="beforeScenarioMinute"/> to bound memory over a long
    /// exercise. The reaction loop can call this behind its longest analysis window; it never affects a
    /// rate computed within that window.
    /// </summary>
    public void Prune(int beforeScenarioMinute) => _events.RemoveAll(e => e.ScenarioMinute < beforeScenarioMinute);

    /// <summary>Total demand events currently retained (for tests/diagnostics).</summary>
    public int RetainedCount => _events.Count;
}
