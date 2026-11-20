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
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// #840 — an org admin demoted or disabled while their own PATCH is in flight. Admin A is authorized, opens the change
/// transaction, and — just before A's first locking statement — admin B demotes or disables A and commits. A's PATCH must
/// then be refused with 403 and change nothing. The interleaving is staged with a command hook, not timing. Both PATCH
/// shapes are covered: one that reduces the admin count (takes the last-admin lock first) and one that does not.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgPeopleStaleCallerTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public OrgPeopleStaleCallerTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerTheory]
    [InlineData("demoted", "disable-target")]
    [InlineData("demoted", "grant-target")]
    [InlineData("disabled", "disable-target")]
    [InlineData("disabled", "grant-target")]
    public async Task AnAdminWhoLosesTheGrantMidRequest_Is403_AndTheirChangeDoesNotLand(string loss, string action)
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (adminA, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (adminB, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var (sessionA, _, _) = await _world.SeedStaffSessionAsync(adminA, exerciseId: null, Person.OrgAdminRole);
        var (sessionB, _, _) = await _world.SeedStaffSessionAsync(adminB, exerciseId: null, Person.OrgAdminRole);

        // B's change of A lands inside A's transaction, just before A's first UPDATE of [People] (the last-admin lock or
        // the caller re-read, whichever A's PATCH runs first).
        OrgPeopleOutcome? competing = null;
        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
            async () =>
            {
                var (serviceB, _, contextB) = OrgPeopleServiceKit.For(_fixture, sessionB, adminB, org);
                await using (contextB)
                {
                    competing = (await serviceB.UpdateAsync(
                        adminA,
                        loss == "demoted" ? new UpdateOrgPersonRequest { IsOrgAdmin = false } : new UpdateOrgPersonRequest { Disabled = true }))
                        .Outcome;
                }
            });

        var (serviceA, callerA, contextA) = OrgPeopleServiceKit.For(_fixture, sessionA, adminA, org, hook);
        await using (contextA)
        {
            // A is authorized as an org admin before anything is staged (the request has authenticated by then).
            (await callerA.ResolveAsync()).Should().NotBeNull();

            var result = await serviceA.UpdateAsync(
                target,
                action == "disable-target" ? new UpdateOrgPersonRequest { Disabled = true } : new UpdateOrgPersonRequest { IsOrgAdmin = true });

            hook.Fired.Should().BeTrue("B's change of A landed inside A's request");
            competing.Should().Be(OrgPeopleOutcome.Ok, "B's change of A committed first");
            result.Outcome.Should().Be(OrgPeopleOutcome.Forbidden, "A was {0} before A's change took its lock", loss);
        }

        await using var read = _world.ReadContext();
        var after = await read.People.AsNoTracking().SingleAsync(p => p.Id == target);
        after.DisabledAt.Should().BeNull("A's disable did not land");
        after.OrgRole.Should().BeNull("A's grant did not land");
        (await read.OrgAuditEvents.IgnoreQueryFilters().AsNoTracking().CountAsync(a => a.SubjectPersonId == target))
            .Should().Be(0, "nothing A attempted is audited as done");
    }

    [RequiresDockerFact]
    public async Task AnAdminWhoStillHoldsTheGrant_IsNotAffected()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var (session, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);

        var (service, _, context) = OrgPeopleServiceKit.For(_fixture, session, admin, org);
        await using (context)
        {
            (await service.UpdateAsync(target, new UpdateOrgPersonRequest { IsOrgAdmin = true })).Outcome.Should().Be(OrgPeopleOutcome.Ok);
        }
    }
}
