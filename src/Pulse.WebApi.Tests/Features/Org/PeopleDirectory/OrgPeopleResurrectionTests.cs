namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Xunit;

/// <summary>
/// W-001 — no session comes back to life. A session that outlived a disable (or an org-admin revoke) is refused while the
/// person stays disabled (or demoted) by the per-request re-check, but would authenticate again the moment the person is
/// re-enabled (or re-granted). Enable therefore revokes every still-live session of the person, and granting the org-admin
/// grant revokes every still-live org-scope session — in the same transaction, counted in the audit payload.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgPeopleResurrectionTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OrgPeopleResurrectionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task Enable_RevokesEveryStillLiveSessionOfThePerson()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (adminSession, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org, disabled: true);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");
        var (survivor, _, _) = await _world.SeedStaffSessionAsync(target, exercise, "controller");

        var (service, _, context) = OrgPeopleServiceKit.For(_fixture, adminSession, admin, org);
        await using (context)
        {
            (await service.UpdateAsync(target, new UpdateOrgPersonRequest { Disabled = false })).Outcome.Should().Be(OrgPeopleOutcome.Ok);
        }

        await using var read = _fixture.CreateContext();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == survivor)).RevokedAt.Should().NotBeNull(
            "a session that outlived the disable must not come back to life with the enable");
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.SubjectPersonId == target && a.Kind == OrgPeopleService.EnabledKind);
        audit.Payload.Should().Contain("\"sessionsRevoked\":1");
    }

    [RequiresDockerFact]
    public async Task GrantingOrgAdmin_RevokesEveryStillLiveOrgScopeSession_ButNoExerciseSession()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var exercise = await _world.SeedExerciseAsync(org);
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (adminSession, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        await _world.SeedEnrollmentAsync(exercise, target, "controller");

        // An org-scope session left over from an earlier grant that a sweep missed, and an ordinary exercise session.
        var (orgSurvivor, _, _) = await _world.SeedStaffSessionAsync(target, exerciseId: null, Person.OrgAdminRole);
        var (exerciseSession, _, _) = await _world.SeedStaffSessionAsync(target, exercise, "controller");

        var (service, _, context) = OrgPeopleServiceKit.For(_fixture, adminSession, admin, org);
        await using (context)
        {
            (await service.UpdateAsync(target, new UpdateOrgPersonRequest { IsOrgAdmin = true })).Outcome.Should().Be(OrgPeopleOutcome.Ok);
        }

        await using var read = _fixture.CreateContext();
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == orgSurvivor)).RevokedAt.Should().NotBeNull(
            "an old org-scope session must not come back to life with the new grant");
        (await read.Sessions.AsNoTracking().SingleAsync(s => s.Id == exerciseSession)).RevokedAt.Should().BeNull(
            "the org grant governs org scope only");
        var audit = await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(a => a.SubjectPersonId == target && a.Kind == OrgPeopleService.OrgRoleGrantedKind);
        audit.Payload.Should().Contain("\"sessionsRevoked\":1");
    }
}
