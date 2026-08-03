namespace Pulse.WebApi.Tests.Helpers;

using System;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// Seeds the <see cref="StaffUser"/> row that a stubbed staff session's <c>StaffUserId</c> points at
/// (exercise-isolation/11, COR-010).
/// </summary>
/// <remarks>
/// <para>
/// <b>Why every host that seeds a <see cref="StaffAssignment"/> must now also seed the STAFF USER.</b> Before
/// the customer-tenant tier, a test host could stub a staff session with an arbitrary <c>StaffUserId</c> and
/// seed only the <c>StaffAssignment</c> — nothing ever dereferenced the human. Story 11 changed that:
/// <c>StaffAssignmentService</c> resolves the caller's OWN <c>StaffUser.OrganizationId</c> server-side and
/// bounds the reachable exercises by it. A dangling <c>StaffUserId</c> therefore resolves to NO tenant and,
/// fail-closed, reaches NO exercises — a 403 on every staff endpoint.
/// </para>
/// <para>
/// That fail-closed behaviour is CORRECT and is deliberately not softened: a session naming a staff human who
/// does not exist must reach nothing. The fixtures were the thing that was unfaithful — in production
/// <c>StaffLoginService</c> / <c>BootstrapService</c> always create the <see cref="StaffUser"/> before any
/// session names it, so a host that omitted the row was modelling a state the platform cannot produce.
/// </para>
/// </remarks>
public static class StaffTenantSeed
{
    /// <summary>
    /// Builds the <see cref="StaffUser"/> row for a stubbed staff session, homed on a customer tenant.
    /// </summary>
    /// <param name="staffUserId">
    /// The id the stubbed <c>CurrentStaffSession</c> reports — must match, or the tenant resolves to nothing.
    /// </param>
    /// <param name="organizationId">
    /// The owning tenant. Defaults to <see cref="Organization.DefaultOrganizationId"/>, which is what the
    /// exercise fixtures across the suite use, so caller and exercise land in the SAME organization and the
    /// org bound passes for the reasons the test is actually about.
    /// </param>
    /// <returns>The entity to add.</returns>
    public static StaffUser StaffUserFor(Guid staffUserId, Guid? organizationId = null) => new()
    {
        Id = staffUserId,
        OrganizationId = organizationId ?? Organization.DefaultOrganizationId,

        // Unique per staff user (the column carries a unique index) and derived from the id, so parallel
        // classes sharing the one migrated database cannot collide.
        ExternalSubject = $"idp|{staffUserId:N}",
        DisplayName = "Test Staff User",
        CreatedAt = DateTimeOffset.UtcNow,
    };
}
