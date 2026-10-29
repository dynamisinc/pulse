namespace Pulse.WebApi.Features.Media;

using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Social.Follows;

/// <summary>The media caller: the human behind a staff session or a persona-bound participant session.</summary>
/// <param name="IsStaff">Whether the caller is staff (assigned to the exercise).</param>
/// <param name="HumanId">The acting human — a staff <c>StaffUserId</c> or the participant's <c>ActingHumanId</c>.</param>
/// <param name="PersonaId">The participant session's persona; <c>null</c> for staff.</param>
public sealed record MediaCaller(bool IsStaff, string HumanId, Guid? PersonaId);

/// <summary>
/// Who is calling a media route, from the SESSION alone (COR-001, COR-018) — shared by the upload pipeline and the
/// document read path so both apply one rule: staff first (a staff session may carry a persona too) and only when
/// ASSIGNED to the exercise (COR-005); otherwise a POSITIVE allowlist on the <c>participant</c> session kind bound to
/// this exercise. Anything else is authenticated but has nobody to act as (<c>null</c>).
/// </summary>
public static class MediaCallerResolution
{
    private const string ParticipantSessionKind = "participant";

    /// <summary>Resolves the caller for <paramref name="exerciseId"/>.</summary>
    /// <param name="staffSessionAccessor">Identifies a staff caller.</param>
    /// <param name="sessionPersonaAccessor">Identifies a persona-bound participant caller.</param>
    /// <param name="staffAssignments">The staff caller's own assignments.</param>
    /// <param name="exerciseId">The resolved exercise scope.</param>
    /// <param name="cancellationToken">Cancels the lookups.</param>
    /// <returns>The caller, or <c>null</c>.</returns>
    public static async Task<MediaCaller?> ResolveAsync(
        ICurrentStaffSessionAccessor staffSessionAccessor,
        ICurrentSessionPersonaAccessor sessionPersonaAccessor,
        StaffAssignmentService staffAssignments,
        Guid exerciseId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(staffSessionAccessor);
        ArgumentNullException.ThrowIfNull(sessionPersonaAccessor);
        ArgumentNullException.ThrowIfNull(staffAssignments);

        var staff = await staffSessionAccessor.GetCurrentStaffSessionAsync(cancellationToken);
        if (staff is not null)
        {
            // COR-005: the staff caller must be assigned to THIS exercise — re-checked explicitly, exactly as
            // EngineCockpitStaffAuthorizationFilter does for the library, never trusted from the active selection.
            var assignments = await staffAssignments.GetAssignmentsAsync(cancellationToken);
            var assigned = assignments?.Any(
                assignment => Guid.TryParse(assignment.ExerciseId, out var assignedExerciseId) && assignedExerciseId == exerciseId) == true;
            if (!assigned)
            {
                return null;
            }

            // Same value PostAttributionResolver stamps as a staff post's ActingHumanId (COR-018).
            return new MediaCaller(true, staff.StaffUserId.ToString(), null);
        }

        var participant = await sessionPersonaAccessor.GetCurrentSessionPersonaAsync(cancellationToken);
        if (participant is not null
            && string.Equals(participant.Kind, ParticipantSessionKind, StringComparison.Ordinal)
            && participant.ExerciseId == exerciseId
            && !string.IsNullOrWhiteSpace(participant.ActingHumanId))
        {
            return new MediaCaller(false, participant.ActingHumanId, participant.PersonaId);
        }

        return null;
    }
}
