namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using System.Threading;
using System.Threading.Tasks;

/// <summary>
/// Why an exercise's data is — or is not — eligible to appear in an evaluation export (COR-033). Carried
/// alongside the boolean so a consumer can log or explain an exclusion without re-deriving the rule.
/// </summary>
public enum EvaluationEligibilityReason
{
    /// <summary>Real conduct: a resolved exercise that is NOT flagged practice/sandbox. The only eligible case.</summary>
    Eligible,

    /// <summary>The resolved exercise is flagged practice/sandbox (COR-033), so its data is rehearsal data.</summary>
    PracticeExercise,

    /// <summary>No exercise scope was resolved for this call — ineligible, fail closed (COR-001).</summary>
    ScopeUnresolved,

    /// <summary>A scope was resolved but no exercise row backs it — ineligible, fail closed.</summary>
    ExerciseNotFound,
}

/// <summary>
/// The answer <see cref="IEvaluationEligibility"/> gives: whether the server-resolved exercise's data may be
/// included in an evaluation export, plus the reason behind that verdict.
/// </summary>
/// <remarks>
/// <see cref="IsEligible"/> is <c>true</c> for exactly one <see cref="Reason"/> —
/// <see cref="EvaluationEligibilityReason.Eligible"/> — so a consumer may branch on either without the two
/// ever disagreeing.
/// </remarks>
public sealed class EvaluationEligibilityVerdict
{
    private EvaluationEligibilityVerdict(bool isEligible, EvaluationEligibilityReason reason, Guid? exerciseId)
    {
        IsEligible = isEligible;
        Reason = reason;
        ExerciseId = exerciseId;
    }

    /// <summary>
    /// Whether the exercise's data may appear in an evaluation export. <c>true</c> ONLY for a resolved,
    /// existing exercise that is not flagged practice/sandbox.
    /// </summary>
    public bool IsEligible { get; }

    /// <summary>Why the verdict came out the way it did.</summary>
    public EvaluationEligibilityReason Reason { get; }

    /// <summary>
    /// The server-resolved exercise the verdict is about, or <c>null</c> when no scope was resolved. An ECHO
    /// of the resolved scope — never something a caller supplied.
    /// </summary>
    public Guid? ExerciseId { get; }

    /// <summary>Real conduct — the exercise's data belongs in the export.</summary>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <returns>An eligible verdict.</returns>
    public static EvaluationEligibilityVerdict Eligible(Guid exerciseId) =>
        new(true, EvaluationEligibilityReason.Eligible, exerciseId);

    /// <summary>A practice/sandbox rehearsal — excluded from the export (COR-033).</summary>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <returns>An ineligible verdict.</returns>
    public static EvaluationEligibilityVerdict PracticeExercise(Guid exerciseId) =>
        new(false, EvaluationEligibilityReason.PracticeExercise, exerciseId);

    /// <summary>The fail-closed verdict for an unresolved exercise scope.</summary>
    /// <returns>An ineligible verdict.</returns>
    public static EvaluationEligibilityVerdict ScopeUnresolved() =>
        new(false, EvaluationEligibilityReason.ScopeUnresolved, null);

    /// <summary>The fail-closed verdict for a resolved scope with no backing exercise row.</summary>
    /// <param name="exerciseId">The server-resolved exercise that has no row.</param>
    /// <returns>An ineligible verdict.</returns>
    public static EvaluationEligibilityVerdict ExerciseNotFound(Guid exerciseId) =>
        new(false, EvaluationEligibilityReason.ExerciseNotFound, exerciseId);
}

/// <summary>
/// THE evaluation-eligibility seam (COR-033, exercise-configuration story 04) — the single server-side read
/// that answers "may this exercise's data appear in an evaluation export?". E10's export filtering consumes
/// this and nothing else; no other consumer re-derives the rule.
/// </summary>
/// <remarks>
/// <para>
/// <b>The contract, precisely — a future export's correctness depends on it.</b>
/// </para>
/// <list type="number">
/// <item>
/// <b>It answers about the SERVER-RESOLVED exercise, and there is deliberately no <c>exerciseId</c>
/// parameter.</b> The scope comes from <c>IExerciseContext</c> (for a staff caller, the server-held
/// active-exercise selection) — never a request body, route value or query string. <c>Exercise</c> is the
/// scope rather than an <c>IExerciseScoped</c> entity, so <c>PulseDbContext</c>'s central query filter is a
/// NO-OP on the <c>Exercises</c> table; accepting an id here would hand a caller another exercise's verdict,
/// which is exactly the cross-exercise vector COR-001/XC-002 forbid. An export that must cover several
/// exercises asks once per resolved scope.
/// </item>
/// <item>
/// <b><see cref="EvaluationEligibilityVerdict.IsEligible"/> is <c>true</c> if and only if</b> a row exists
/// for the resolved exercise AND its <c>IsPracticeMode</c> flag is <c>false</c>. An exercise that has never
/// been flagged is real conduct, because the column defaults to <c>false</c>.
/// </item>
/// <item>
/// <b>It FAILS CLOSED and never throws for a missing scope or a missing row.</b> An unresolved scope or an
/// absent exercise yields ineligible with the matching reason, so a mis-wired export omits rehearsal-or-
/// unknown data rather than silently publishing it into an AAR.
/// </item>
/// <item>
/// <b>The verdict is EXERCISE-level, not record-level.</b> COR-033 flags a whole run as a rehearsal; there is
/// no per-post or per-event eligibility. An export filters whole exercises in or out.
/// </item>
/// <item>
/// <b>It is a LIVE read with no caching.</b> The flag is staff-settable at any time, so the verdict reflects
/// the state at the moment of the call. An export must take the verdict at export time and must not
/// remember an earlier one.
/// </item>
/// <item>
/// <b>It is a pure read.</b> Asking changes nothing — no persistence, no telemetry, no lifecycle effect
/// (the story's "otherwise fully functional" guarantee).
/// </item>
/// </list>
/// <para>
/// <b>Lifetime:</b> registered <c>Scoped</c> by <c>AddPracticeMode()</c>, matching the request-scoped
/// <c>PulseDbContext</c> / <c>IExerciseContext</c> unit of work it reads through. Resolve it per request;
/// never capture it in a singleton.
/// </para>
/// </remarks>
public interface IEvaluationEligibility
{
    /// <summary>
    /// Reads whether the server-resolved exercise's data is eligible for an evaluation export. Fails closed
    /// (ineligible) on an unresolved scope or a missing exercise row.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The eligibility verdict for the resolved exercise.</returns>
    Task<EvaluationEligibilityVerdict> GetVerdictAsync(CancellationToken cancellationToken = default);
}
