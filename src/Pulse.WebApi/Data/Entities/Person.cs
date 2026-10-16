namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// The human (ADMIN-IDENTITY-MODEL §1.1, identity-auth-roles/16): who someone is and their credentials, owned by
/// exactly ONE customer <see cref="Organization"/>. Every role a person holds in an exercise is an
/// <see cref="Enrollment"/>; the staff facet (<see cref="StaffUser"/>) shares this row's primary key, and the
/// participant sign-in facet (<see cref="Account"/>) hangs off a participant-role enrollment.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tenant tier: <see cref="IOrganizationOwned"/>, a RESOLUTION ROOT — not centrally filtered.</b> Like
/// <see cref="StaffUser"/> and <see cref="Exercise"/>, a person is looked up at sign-in (by org slug and email, or
/// by email across orgs) in order to DISCOVER the tenant, so a global tenant filter here would be a deadlock.
/// Every read is bounded with <see cref="OrganizationScope.InOrganization{TEntity}"/> except those sign-in
/// lookups, which carry an <c>org-scope-exempt(ResolutionRoot)</c> marker the sweep test counts.
/// </para>
/// <para>
/// <b>Staff-world only (XC-002).</b> Nothing on a person is projected onto a participant surface. Credentials
/// are stored only as a <c>PasswordHasher&lt;Person&gt;</c> hash, never logged or returned (NFR-004 / NFR-009).
/// </para>
/// </remarks>
public sealed class Person : IOrganizationOwned
{
    /// <summary>The schema bound of <see cref="Email"/> (the RFC 5321 path limit).</summary>
    public const int MaxEmailLength = 254;

    /// <summary>The schema bound of <see cref="DisplayName"/>.</summary>
    public const int MaxDisplayNameLength = 200;

    /// <summary>The schema bound of <see cref="OrgRole"/>.</summary>
    public const int MaxOrgRoleLength = 32;

    /// <summary>The schema bound of <see cref="PasswordHash"/>.</summary>
    public const int MaxPasswordHashLength = 512;

    /// <summary>The only org-level grant (ADMIN-IDENTITY-MODEL §1.1): the organization administrator.</summary>
    public const string OrgAdminRole = "orgAdmin";

    /// <summary>
    /// Primary key. For a person with a staff facet this is ALSO <see cref="StaffUser.Id"/> (shared key), so every
    /// pre-existing staff id — sessions, link issuers, day-word setters, telemetry actor ids — stays valid.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>The owning customer tenant (COR-010). Non-nullable; server-stamped, never a client value.</summary>
    public Guid OrganizationId { get; set; }

    /// <summary>
    /// The normalized (trimmed, lower-case) email, unique per organization (the filtered unique index on
    /// <c>(OrganizationId, Email)</c>). Nullable only for legacy rows backfilled from a <see cref="StaffUser"/>
    /// until they are invited (A2). Staff-world only.
    /// </summary>
    public string? Email { get; set; }

    /// <summary>The person's display name (staff surfaces only, XC-002).</summary>
    public required string DisplayName { get; set; }

    /// <summary>The Pulse password hash, or <c>null</c> when the person has no Pulse password (legacy / not yet invited).</summary>
    public string? PasswordHash { get; set; }

    /// <summary>Wall-clock instant the password was last set, or <c>null</c>.</summary>
    public DateTimeOffset? PasswordChangedAt { get; set; }

    /// <summary>Consecutive failed sign-ins, driving lockout (ADMIN-IDENTITY-MODEL §3.2). Defaults to 0.</summary>
    public int FailedLoginCount { get; set; }

    /// <summary>Wall-clock instant until which sign-in is locked, or <c>null</c> when not locked.</summary>
    public DateTimeOffset? LockedOutUntil { get; set; }

    /// <summary>
    /// The org-level grant — <see cref="OrgAdminRole"/> or <c>null</c>. Not an exercise role: an org admin works
    /// inside an exercise only through an <see cref="Enrollment"/> of their own.
    /// </summary>
    public string? OrgRole { get; set; }

    /// <summary>Wall-clock instant the person was disabled, or <c>null</c> while enabled.</summary>
    public DateTimeOffset? DisabledAt { get; set; }

    /// <summary>Server wall-clock instant (UTC) the person was first recorded.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Whether <paramref name="orgRole"/> is the org-admin grant (case-insensitive, matching the CI collation).</summary>
    /// <param name="orgRole">A stored <see cref="OrgRole"/> value.</param>
    /// <returns><c>true</c> for <see cref="OrgAdminRole"/>.</returns>
    public static bool IsOrgAdmin(string? orgRole) =>
        string.Equals(orgRole, OrgAdminRole, StringComparison.OrdinalIgnoreCase);
}
