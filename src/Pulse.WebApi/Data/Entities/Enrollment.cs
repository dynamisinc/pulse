namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The one record of "this person holds this role in this exercise" (ADMIN-IDENTITY-MODEL §1.1,
/// identity-auth-roles/16) — for EVERY role. It replaces <c>StaffAssignment</c> (migrated with the same ids) and
/// carries the role and persona that used to live on <see cref="Account"/>; an account is now the participant
/// sign-in facet of a participant-role enrollment (<see cref="Account.EnrollmentId"/>).
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="IExerciseScoped"/> — the central exercise filter covers it.</b> Every in-exercise read (roster,
/// role checks, exports) is confined to the resolved exercise automatically. The org tier's CROSS-exercise reads
/// (a person's own enrollments for the switcher and staff sign-in, the org staff directory) use an explicit
/// <c>IgnoreQueryFilters()</c> plus an <c>InOrganization</c> join on <see cref="Exercise"/>, each marked
/// <c>org-scope-exempt(TenantChecked)</c> and counted by the sweep test.
/// </para>
/// <para>
/// <b>Database rules.</b> One enrollment per person per exercise (filtered unique index on
/// <c>(ExerciseId, PersonId)</c>); the role vocabulary is checked; a <see cref="PersonaId"/> is refused on a staff
/// role; <see cref="IsLead"/> is valid only on a controller, and at most one per exercise (filtered unique index).
/// The service layer additionally requires a staff role to carry a <see cref="PersonId"/> and no account, and a
/// participant role to carry an account.
/// </para>
/// </remarks>
public sealed class Enrollment : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="Role"/>.</summary>
    public const int MaxRoleLength = 32;

    /// <summary>Primary key (a migrated <c>StaffAssignment</c> keeps its id).</summary>
    public Guid Id { get; set; }

    /// <summary>The exercise this enrollment grants a role in (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The <see cref="Person"/> holding the role, or <c>null</c> for a one-off participant (an account with no
    /// directory person, ADMIN-IDENTITY-MODEL §2.1). Required for staff roles (service-enforced).
    /// </summary>
    public Guid? PersonId { get; set; }

    /// <summary>
    /// The role in this exercise: <c>planner</c> | <c>controller</c> | <c>evaluator</c> | <c>participant</c> |
    /// <c>pio</c> (<see cref="EnrollmentRoles"/>), stored verbatim as the frozen frontend vocabulary.
    /// </summary>
    public required string Role { get; set; }

    /// <summary>The persona a participant-role enrollment posts as, or <c>null</c>. Refused on staff roles (check constraint).</summary>
    public Guid? PersonaId { get; set; }

    /// <summary>
    /// Whether this controller is the exercise's lead controller (ADMIN-IDENTITY-MODEL §1.1, signed off
    /// 2026-10-16). Valid only on a <c>controller</c> enrollment; at most one per exercise. Gates swamped mode and
    /// the engine autonomy write.
    /// </summary>
    public bool IsLead { get; set; }

    /// <summary>Server wall-clock instant (UTC) the enrollment was granted.</summary>
    public DateTimeOffset CreatedAt { get; set; }
}
