namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A staff user's role on ONE exercise (story 05, COR-005) — the cross-exercise access model the
/// exercise-isolation/05 switcher reads and <c>POST /api/staff/active-exercise</c> validates against. A
/// staff human has one <see cref="StaffAssignment"/> per exercise they are assigned to; the set of a user's
/// assignments is what the switcher lists. Deliberately <b>NOT</b> <see cref="IExerciseScoped"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the isolation-filter exemption is safe (always-Critical).</b> <see cref="StaffAssignment"/> is
/// <b>cross-exercise by design</b> (COR-005 — a staff human spans exercises) and is the ONLY cross-exercise
/// object in the model. It does not implement the marker, so the B0 global query filter never confines it to
/// one exercise (a query for a staff user's assignments must return rows ACROSS exercises to populate the
/// switcher) and the write-guard never demands a scoped <c>ExerciseId</c>. Safe because: (a) it is a
/// <b>staff-world-only</b> access record, never queried on a participant path (XC-002); (b) it carries
/// <b>no participant-visible content</b> — it is an access-control join (exercise id + role), not content;
/// (c) a staff user's assignment read returns only their OWN assignments; (d) content isolation is
/// unaffected — selecting an active exercise populates <c>ExerciseContext.CurrentExerciseId</c> and every
/// <see cref="IExerciseScoped"/> content query is scoped from then on. See exercise-isolation and
/// identity-auth-roles <c>implementation.md</c> ("Why StaffAssignment is exempt from the isolation filter").
/// </para>
/// <para>
/// <b>Note</b> that <see cref="ExerciseId"/> here is a PLAIN column, NOT the <see cref="IExerciseScoped"/>
/// scope marker — the exemption is the entire point. <see cref="StaffUserId"/> is a plain id reference (no
/// navigation), matching the house pattern (<see cref="Persona.PersonaTemplateId"/>); referential integrity
/// to <see cref="StaffUser"/> is enforced in the service layer (Wave 1).
/// </para>
/// </remarks>
public sealed class StaffAssignment
{
    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The <see cref="StaffUser"/> this assignment belongs to (logical FK; no navigation). Indexed.</summary>
    public Guid StaffUserId { get; set; }

    /// <summary>
    /// The exercise this assignment grants a role on — a DELIBERATELY PLAIN column (NOT the
    /// <see cref="IExerciseScoped"/> scope marker), because assignments are cross-exercise by design (COR-005).
    /// </summary>
    public Guid ExerciseId { get; set; }

    /// <summary>
    /// The staff role for this exercise — the <c>ExerciseRole</c> union value as a string (typically
    /// <c>controller</c> / <c>evaluator</c> / <c>planner</c>), stored verbatim as the frozen frontend
    /// vocabulary so it flows onto the <c>Session.role</c> wire field with no case-mapping.
    /// </summary>
    public required string Role { get; set; }

    /// <summary>Server wall-clock instant the assignment was created (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }
}
