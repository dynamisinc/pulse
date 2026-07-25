namespace Pulse.WebApi.Features.ExerciseResolution;

using System.Text.Json.Serialization;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The FROZEN exercise-scope wire shape — the server-side mirror of the frontend <c>ExerciseScope</c> type
/// (<c>src/frontend/src/core/exerciseContext/exerciseContextResolver.ts</c>). <c>GET /api/exercise-context</c>
/// (exercise-isolation story 08) returns exactly this, field-for-field, for EXACTLY ONE resolved exercise —
/// no list, no picker, no admin/simulation-status surface (COR-004, XC-002) — so flipping
/// <c>USE_MOCK_EXERCISE_CONTEXT</c> live drives <c>useExerciseContext()</c> with no consumer change.
/// </summary>
/// <remarks>
/// <para>
/// Wave-0 freezes the shape only; the host-resolution middleware + endpoint are story 08 (exercise-isolation
/// feature), which owns this <c>Features/ExerciseResolution/</c> slice. Every property has an explicit
/// <see cref="JsonPropertyNameAttribute"/> (camelCase). The <c>exerciseId</c> is a display/telemetry-stamping
/// value, NEVER a client-supplied query-scoping parameter (COR-001).
/// </para>
/// <para>
/// <b>The SHAPE stays frozen; only <c>status</c>'s VOCABULARY widened</b> (exercise-configuration story 01a —
/// Option B, Tier-2 sign-off given). <c>status</c> is the lowercase <c>ExerciseStatus</c> string passed
/// through from <see cref="Exercise.Status"/> VERBATIM — no mapping, no projection, no default. It now
/// carries the COR-032 vocabulary (<c>build</c> / <c>staged</c> / <c>live</c> / <c>paused</c> /
/// <c>completed</c> / <c>archived</c>) while the legacy four (<c>scheduled</c> / <c>active</c> /
/// <c>complete</c> / <c>archived</c>) remain valid through the transition. The frontend's
/// <c>isExerciseStatus</c> guard accepts that transitional superset and FAILS CLOSED on anything else, so a
/// literal coined here that is not in <c>implementation.md</c>'s authoritative list blanks the participant
/// world rather than raising a type error. Adding, removing or renaming a FIELD here is still a Tier-2
/// contract change.
/// </para>
/// </remarks>
public sealed class ExerciseScopeDto
{
    /// <summary>The resolved exercise id (display / telemetry-stamping only — never a query-scoping input).</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The exercise's human-readable name.</summary>
    [JsonPropertyName("exerciseName")]
    public required string ExerciseName { get; init; }

    /// <summary>The exercise's IANA time zone (XC-008), e.g. <c>America/New_York</c>.</summary>
    [JsonPropertyName("timeZone")]
    public required string TimeZone { get; init; }

    /// <summary>
    /// Lifecycle status — the lowercase <c>ExerciseStatus</c> vocabulary, passed through verbatim (COR-032's
    /// six, plus the legacy four still valid through the transition — see the type remarks).
    /// </summary>
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    /// <summary>
    /// Projects an <see cref="Exercise"/> to the frozen wire shape. <see cref="TimeZone"/> and
    /// <see cref="Status"/> read the exercise's stored config verbatim (required, non-null by their defaults).
    /// </summary>
    /// <param name="exercise">The resolved exercise to project.</param>
    /// <returns>The frozen single-exercise scope projection.</returns>
    public static ExerciseScopeDto FromExercise(Exercise exercise)
    {
        ArgumentNullException.ThrowIfNull(exercise);

        return new ExerciseScopeDto
        {
            ExerciseId = exercise.Id.ToString(),
            ExerciseName = exercise.Name,
            TimeZone = exercise.TimeZone,
            Status = exercise.Status,
        };
    }
}
