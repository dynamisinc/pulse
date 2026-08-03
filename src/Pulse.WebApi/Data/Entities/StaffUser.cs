namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// A staff human identity (controller / evaluator / planner) authenticated through
/// <c>IIdentityProvider</c> — the Dynamis IdP in Phase 1, a future Entra/AD/SSO/Cadence-federation provider
/// behind the same interface (COR-014). A staff human SPANS exercises (COR-005), so this is deliberately
/// <b>NOT</b> <see cref="IExerciseScoped"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why unscoped is safe (isolation exemption, always-Critical).</b> The exercise-isolation guarantee
/// (COR-001 / XC-001) protects participant-visible CONTENT. A <see cref="StaffUser"/> is a
/// <b>staff-world-only access record</b> (never queried on any participant path — XC-002) carrying
/// <b>no participant-visible content</b>; it is an identity, not content. It therefore does not implement
/// the marker, so the B0 global query filter never confines it to one exercise and the write-guard never
/// demands an <c>ExerciseId</c>. Content isolation still holds: the moment a staff user selects an active
/// exercise (<see cref="StaffAssignment"/>, story 05) that populates <c>ExerciseContext.CurrentExerciseId</c>,
/// and every <see cref="IExerciseScoped"/> content query is scoped from then on.
/// </para>
/// <para>
/// <b>Wave-0 schema freeze.</b> Story 05 builds the provider + staff login behaviour; this only freezes the
/// entity. No credential is stored here — staff authenticate against the external IdP, so Pulse persists
/// only the resolved external identity, never a password (NFR-004).
/// </para>
/// <para>
/// <b>Organization tenant boundary (exercise-isolation/11, COR-010).</b> A staff human spans EXERCISES but
/// never spans CUSTOMERS: this entity now implements <see cref="IOrganizationOwned"/> via the non-nullable
/// <see cref="OrganizationId"/>, which is what bounds a staff user's reachable exercises and admin surface
/// to their own organization.
/// </para>
/// </remarks>
public sealed class StaffUser : IOrganizationOwned
{
    /// <summary>Primary key (Pulse-local staff user id — the <c>actingHumanId</c> for staff telemetry).</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// The owning customer tenant (COR-010, exercise-isolation/11) — the organization this staff human works
    /// for. Non-nullable; server-stamped from the resolved exercise's organization when the identity is first
    /// recorded, never taken from a client body.
    /// </summary>
    /// <remarks>
    /// <b>NOT globally filtered, deliberately</b> — <see cref="IOrganizationOwned"/> without
    /// <see cref="IOrganizationScoped"/>. Like <see cref="Exercise"/>, this is a RESOLUTION ROOT: staff login
    /// looks a human up by <see cref="ExternalSubject"/> BEFORE any session, exercise or tenant exists, so a
    /// tenant filter here could only ever return zero rows and lock every staff human out. Exactly the same
    /// shape as <see cref="Session"/>/<see cref="StaffAssignment"/> being unscoped on the inner tier because
    /// they are looked up pre-scope. Cross-tenant reachability is instead bounded explicitly, at the two
    /// places it matters, by <see cref="OrganizationScope.InOrganization{TEntity}"/> and by
    /// <c>StaffAssignmentService</c>'s org check.
    /// </remarks>
    public Guid OrganizationId { get; set; }

    /// <summary>
    /// The external IdP subject — the provider's stable, unique identifier for this human (e.g. an OIDC
    /// <c>sub</c>). Unique across Pulse; the provider-agnostic key <c>IIdentityProvider</c> resolves a login
    /// to, so swapping providers needs no schema change.
    /// </summary>
    public required string ExternalSubject { get; set; }

    /// <summary>Reserved: a human-readable login username if the IdP exposes one distinct from <see cref="ExternalSubject"/>.</summary>
    public string? Username { get; set; }

    /// <summary>Display name shown on staff surfaces only (XC-002) — never a participant surface.</summary>
    public required string DisplayName { get; set; }

    /// <summary>Server wall-clock instant the staff identity was first recorded (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Reserved (story 05): wall-clock instant of the last successful staff login, or <c>null</c> if never.</summary>
    public DateTimeOffset? LastLoginAt { get; set; }
}
