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
/// Wave-0 freezes the shape only; the host-resolution middleware + endpoint are story 08 (exercise-isolation
/// feature), which owns this <c>Features/ExerciseResolution/</c> slice. Every property has an explicit
/// <see cref="JsonPropertyNameAttribute"/> (camelCase); <c>status</c> is the lowercase <c>ExerciseStatus</c>
/// vocabulary (<c>scheduled</c> / <c>active</c> / <c>complete</c> / <c>archived</c>). The <c>exerciseId</c>
/// is a display/telemetry-stamping value, NEVER a client-supplied query-scoping parameter (COR-001).
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

    /// <summary>Lifecycle status — the lowercase <c>ExerciseStatus</c> vocabulary.</summary>
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
