namespace Pulse.WebApi.Data.Entities;

using System.Collections.Generic;
using System.Linq.Expressions;

/// <summary>
/// The exercise-role vocabulary an <see cref="Enrollment"/> may carry (ADMIN-IDENTITY-MODEL §1.1). <c>orgAdmin</c>
/// is deliberately NOT here: it left the exercise-role vocabulary and is the org-level grant
/// <see cref="Person.OrgRole"/>. The database enforces the same set with a check constraint.
/// </summary>
public static class EnrollmentRoles
{
    /// <summary>The exercise planner.</summary>
    public const string Planner = "planner";

    /// <summary>The exercise controller.</summary>
    public const string Controller = "controller";

    /// <summary>The evaluator (read-only staff).</summary>
    public const string Evaluator = "evaluator";

    /// <summary>A participant.</summary>
    public const string Participant = "participant";

    /// <summary>A participant bound to an org persona (public information officer).</summary>
    public const string Pio = "pio";

    /// <summary>The staff-world roles: an enrollment in one of these needs a person and no account.</summary>
    public static IReadOnlySet<string> StaffRoles { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Planner, Controller, Evaluator };

    /// <summary>The participant-world roles: an enrollment in one of these is the parent of an account.</summary>
    public static IReadOnlySet<string> ParticipantRoles { get; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { Participant, Pio };

    /// <summary>
    /// The translatable predicate "this enrollment is a staff-world role" — for queries that list an exercise's staff
    /// (exports, the inject roster, the switcher) and must never pick up a participant enrollment.
    /// </summary>
    public static Expression<Func<Enrollment, bool>> IsStaffEnrollment { get; } =
        enrollment => enrollment.Role == Planner || enrollment.Role == Controller || enrollment.Role == Evaluator;

    /// <summary>Whether <paramref name="role"/> is a staff-world role.</summary>
    /// <param name="role">A role value.</param>
    /// <returns><c>true</c> for planner, controller or evaluator.</returns>
    public static bool IsStaffRole(string? role) => role is not null && StaffRoles.Contains(role);

    /// <summary>Whether <paramref name="role"/> is a participant-world role.</summary>
    /// <param name="role">A role value.</param>
    /// <returns><c>true</c> for participant or pio.</returns>
    public static bool IsParticipantRole(string? role) => role is not null && ParticipantRoles.Contains(role);

    /// <summary>
    /// Normalizes a staff role to its canonical casing, failing for anything outside <see cref="StaffRoles"/>.
    /// </summary>
    /// <param name="raw">The raw role.</param>
    /// <param name="role">The canonical role on success.</param>
    /// <returns><c>true</c> when <paramref name="raw"/> is a staff role.</returns>
    public static bool TryNormalizeStaffRole(string? raw, out string role)
    {
        var trimmed = raw?.Trim();
        foreach (var candidate in new[] { Planner, Controller, Evaluator })
        {
            if (string.Equals(trimmed, candidate, StringComparison.OrdinalIgnoreCase))
            {
                role = candidate;
                return true;
            }
        }

        role = string.Empty;
        return false;
    }
}
