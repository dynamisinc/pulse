namespace Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;

using System.Text.Json.Serialization;

/// <summary>
/// <c>GET/PUT /api/staff/practice-mode</c> response body — the COR-033 practice/sandbox state of the exercise
/// the SERVER resolved for the caller.
/// </summary>
/// <remarks>
/// <para>
/// <b>A STAFF-WORLD shape (XC-002).</b> It is returned only to an authenticated staff caller assigned to the
/// resolved exercise, and practice state is never projected onto any participant surface — the participant
/// read model (<c>ExerciseShellConfigSource</c>) structurally omits the flag, so a projection cannot leak what
/// it was never handed.
/// </para>
/// <para>
/// <b>The exercise is never a parameter.</b> <see cref="ExerciseId"/> is echoed for display/query-keying only:
/// it is the scope the server already resolved, not something the client chose (COR-001).
/// </para>
/// <para>
/// <see cref="EvaluationEligible"/> is included so the staff editor states the consequence of the flag in the
/// same breath as the flag itself, and — importantly — so the console reads the SAME
/// <see cref="IEvaluationEligibility"/> seam E10 will, rather than re-deriving "practice means excluded"
/// client-side.
/// </para>
/// </remarks>
public sealed class PracticeModeDto
{
    /// <summary>The server-resolved exercise's id (echo only — never an input).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>Whether this exercise is a practice/sandbox run (COR-033). <c>false</c> until a planner flags it.</summary>
    [JsonPropertyName("isPracticeMode")]
    public required bool IsPracticeMode { get; init; }

    /// <summary>
    /// Whether this exercise's data is eligible for an evaluation export — read from the
    /// <see cref="IEvaluationEligibility"/> seam, never re-derived here.
    /// </summary>
    [JsonPropertyName("evaluationEligible")]
    public required bool EvaluationEligible { get; init; }

    /// <summary>Builds the response body from the resolved scope and the eligibility verdict.</summary>
    /// <param name="exerciseId">The server-resolved exercise.</param>
    /// <param name="isPracticeMode">The stored COR-033 flag.</param>
    /// <param name="verdict">The verdict from the evaluation-eligibility seam.</param>
    /// <returns>The practice-mode response body.</returns>
    public static PracticeModeDto From(Guid exerciseId, bool isPracticeMode, EvaluationEligibilityVerdict verdict)
    {
        ArgumentNullException.ThrowIfNull(verdict);

        return new PracticeModeDto
        {
            ExerciseId = exerciseId.ToString(),
            IsPracticeMode = isPracticeMode,
            EvaluationEligible = verdict.IsEligible,
        };
    }
}

/// <summary>
/// <c>PUT /api/staff/practice-mode</c> request body — sets or clears the COR-033 practice/sandbox flag on the
/// exercise the server resolved.
/// </summary>
/// <remarks>
/// <para>
/// <b>There is deliberately no exercise id on this body.</b> The target comes only from the server-resolved
/// scope, so a caller cannot aim the write at another exercise even by trying (COR-001/XC-002).
/// </para>
/// <para>
/// <see cref="IsPracticeMode"/> is NULLABLE so an absent field is a validation concern — a clean 400 with a
/// reason — rather than a deserialization failure or an accidental "off". Setting the flag is an explicit
/// decision either way.
/// </para>
/// </remarks>
public sealed class UpdatePracticeModeRequest
{
    /// <summary>The flag to store. Required: <c>null</c>/absent is a 400, never an implied <c>false</c>.</summary>
    [JsonPropertyName("isPracticeMode")]
    public bool? IsPracticeMode { get; init; }
}
