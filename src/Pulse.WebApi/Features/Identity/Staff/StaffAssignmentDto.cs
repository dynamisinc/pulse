namespace Pulse.WebApi.Features.Identity.Staff;

using System.Text.Json.Serialization;

/// <summary>
/// The response shape for one of a staff user's assignments — the data source the
/// <c>exercise-isolation/05</c> cross-exercise switcher lists (<c>{ exerciseId, exerciseName, role }</c>) and
/// the confirmation <c>POST /api/staff/active-exercise</c> returns for the newly-selected exercise. NOT one of
/// the two Wave-0 frozen DTOs — story 05 defines this small staff-world shape.
/// </summary>
/// <remarks>
/// Staff-world only (XC-002): it is an access record (exercise id + name + role), never participant-visible
/// content. Every property carries an explicit camelCase <see cref="JsonPropertyNameAttribute"/> so the wire
/// shape is fixed independent of host serializer config, matching the house DTO style.
/// </remarks>
public sealed class StaffAssignmentDto
{
    /// <summary>The assigned exercise's id.</summary>
    [JsonPropertyName("exerciseId")]
    public required string ExerciseId { get; init; }

    /// <summary>The assigned exercise's human-readable name (staff-facing).</summary>
    [JsonPropertyName("exerciseName")]
    public required string ExerciseName { get; init; }

    /// <summary>The staff role on that exercise — the <c>ExerciseRole</c> string vocabulary (verbatim).</summary>
    [JsonPropertyName("role")]
    public required string Role { get; init; }
}
