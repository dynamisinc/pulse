namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The COR-033 implementation of <see cref="IEvaluationEligibility"/>: an exercise's data is eligible for an
/// evaluation export unless the exercise is flagged practice/sandbox. This is the ONE place that rule lives.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isolation (always-Critical, COR-001/XC-002).</b> <see cref="Exercise"/> is the SCOPE, not an
/// <see cref="IExerciseScoped"/> entity, so <c>PulseDbContext</c>'s central read-side query filter is a NO-OP
/// on the <c>Exercises</c> table — an unguarded lookup here would happily answer about ANOTHER exercise. The
/// exercise therefore comes only from <see cref="IExerciseContext"/>, and the seam exposes no id parameter at
/// all, so there is nothing for a caller to aim elsewhere.
/// </para>
/// <para>
/// <b>Fail closed.</b> An unset scope collapses to <see cref="Guid.Empty"/> (the write-guard guarantees no row
/// carries it), and both that and a missing row return INELIGIBLE. A broken deployment therefore omits data
/// from an AAR rather than publishing rehearsal-or-unknown data into one.
/// </para>
/// <para>
/// <b>Reads one column, tracks nothing.</b> The query projects <c>IsPracticeMode</c> directly, so it neither
/// materializes the exercise row nor disturbs the change tracker of a unit of work that may be mid-write.
/// </para>
/// </remarks>
public sealed class PracticeModeEvaluationEligibility : IEvaluationEligibility
{
    private readonly PulseDbContext _dbContext;
    private readonly IExerciseContext _exerciseContext;

    /// <summary>Creates the seam over persistence and the server-resolved scope.</summary>
    /// <param name="dbContext">The persistence context the flag is read through.</param>
    /// <param name="exerciseContext">The server-resolved exercise scope — the ONLY source of "which exercise".</param>
    public PracticeModeEvaluationEligibility(PulseDbContext dbContext, IExerciseContext exerciseContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(exerciseContext);

        _dbContext = dbContext;
        _exerciseContext = exerciseContext;
    }

    /// <inheritdoc />
    public async Task<EvaluationEligibilityVerdict> GetVerdictAsync(CancellationToken cancellationToken = default)
    {
        var scope = _exerciseContext.CurrentExerciseId;
        if (scope is null || scope.Value == Guid.Empty)
        {
            return EvaluationEligibilityVerdict.ScopeUnresolved();
        }

        var exerciseId = scope.Value;

        // Nullable projection so "no row" is distinguishable from "row with the flag off".
        var isPracticeMode = await _dbContext.Exercises
            .AsNoTracking()
            .Where(e => e.Id == exerciseId)
            .Select(e => (bool?)e.IsPracticeMode)
            .FirstOrDefaultAsync(cancellationToken);

        if (isPracticeMode is null)
        {
            return EvaluationEligibilityVerdict.ExerciseNotFound(exerciseId);
        }

        return isPracticeMode.Value
            ? EvaluationEligibilityVerdict.PracticeExercise(exerciseId)
            : EvaluationEligibilityVerdict.Eligible(exerciseId);
    }
}
