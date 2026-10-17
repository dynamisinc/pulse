namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// An organization-tier audit record (ADMIN-IDENTITY-MODEL §7.5, identity-auth-roles/16). <c>TelemetryEvent</c>
/// requires a real exercise, so org-scope actions — enrollment grant/revoke (including self-grant), the lead
/// change, org-scope exercise create, and later org-scope sign-in, org choice, people and reset actions — are
/// recorded here instead. Exercise-scoped actions stay in <c>TelemetryEvent</c> (XC-004), unchanged.
/// </summary>
/// <remarks>
/// <b><see cref="IOrganizationScoped"/> — the central org filter covers every read.</b> Written in the SAME unit
/// of work as the mutation it records. <see cref="Payload"/> is opaque JSON, never parsed server-side, and never
/// carries a secret. Staff-world only (XC-002).
/// </remarks>
public sealed class OrgAuditEvent : IOrganizationScoped
{
    /// <summary>The schema bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 64;

    /// <summary>The schema bound of <see cref="Outcome"/>.</summary>
    public const int MaxOutcomeLength = 32;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning customer tenant. Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid OrganizationId { get; set; }

    /// <summary>The event kind, e.g. <c>org.enrollment.granted</c>.</summary>
    public required string Kind { get; set; }

    /// <summary>The outcome, e.g. <c>success</c> or <c>refused</c>.</summary>
    public required string Outcome { get; set; }

    /// <summary>The acting person, or <c>null</c> when the actor is unknown (e.g. a refused anonymous attempt).</summary>
    public Guid? ActorPersonId { get; set; }

    /// <summary>The person acted upon, or <c>null</c>.</summary>
    public Guid? SubjectPersonId { get; set; }

    /// <summary>The exercise concerned, or <c>null</c> for a purely org-level action.</summary>
    public Guid? ExerciseId { get; set; }

    /// <summary>Opaque JSON detail (never a secret).</summary>
    public required string Payload { get; set; }

    /// <summary>Server wall-clock instant (UTC) the action happened.</summary>
    public DateTimeOffset OccurredAt { get; set; }
}
