namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Ops.Organizations;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// #862 W-002 / Sonnet 8 / S-002 — hook-staged interleavings of the two invite paths #849 and #847 added, against real
/// SQL. A competing request is landed (on its own connection) just before the request under test takes its first person
/// row lock, so the void-then-issue of the two requests is forced to interleave: exactly one invite may stay live. Also
/// the <c>email-in-use</c> race (two people, one address) and the caller re-check (#840 rule) on the by-id invite.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InviteRaceTests
{
    private const string Secret = "invite-race-secret-5c2e";

    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public InviteRaceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task TwoInvitesById_OfThePersonAtOnce_LeaveExactlyOneLiveInvite()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (session, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var legacy = await SeedLegacyPersonAsync(org);
        var email = $"race.{Guid.NewGuid():N}@example.com";

        OrgInviteOutcome? competing = null;
        var hook = new BeforeCommandHook(IsPeopleUpdate, async () =>
        {
            var (other, _, otherContext) = OrgInviteServiceKit.Invite(_fixture, session, admin, org);
            await using (otherContext)
            {
                competing = (await other.InvitePersonAsync(legacy, new InviteExistingOrgPersonRequest { Email = email })).Outcome;
            }
        });

        var (service, _, context) = OrgInviteServiceKit.Invite(_fixture, session, admin, org, hook);
        await using (context)
        {
            var result = await service.InvitePersonAsync(legacy, new InviteExistingOrgPersonRequest { Email = email });
            hook.Fired.Should().BeTrue("the competing invite landed inside this request");
            competing.Should().Be(OrgInviteOutcome.Ok);
            result.Outcome.Should().Be(OrgInviteOutcome.Ok);
        }

        await using var read = _world.ReadContext();
        var tokens = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == legacy).ToListAsync();
        tokens.Should().HaveCount(2);
        tokens.Count(t => t.UsedAt == null).Should().Be(1, "the later invite voided the earlier committed one: never two live links");
    }

    [RequiresDockerFact]
    public async Task TwoInvitesById_OfTwoPeopleWithTheSameAddress_TheLoserIs409EmailInUse_AndWritesNothing()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (session, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var first = await SeedLegacyPersonAsync(org);
        var second = await SeedLegacyPersonAsync(org);
        var email = $"shared.{Guid.NewGuid():N}@example.com";

        OrgInviteOutcome? competing = null;
        var hook = new BeforeCommandHook(IsPeopleUpdate, async () =>
        {
            var (other, _, otherContext) = OrgInviteServiceKit.Invite(_fixture, session, admin, org);
            await using (otherContext)
            {
                competing = (await other.InvitePersonAsync(second, new InviteExistingOrgPersonRequest { Email = email })).Outcome;
            }
        });

        var (service, _, context) = OrgInviteServiceKit.Invite(_fixture, session, admin, org, hook);
        await using (context)
        {
            var result = await service.InvitePersonAsync(first, new InviteExistingOrgPersonRequest { Email = email });
            hook.Fired.Should().BeTrue();
            competing.Should().Be(OrgInviteOutcome.Ok, "the competing invite took the address first");
            result.Outcome.Should().Be(OrgInviteOutcome.Conflict);
            result.Error.Should().Be(OrgInviteService.EmailInUseError, "the (OrganizationId, Email) unique index arbitrates");
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == first)).Email.Should().BeNull("the loser rolled back");
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == second)).Email.Should().Be(email);
        (await read.CredentialTokens.AsNoTracking().AnyAsync(t => t.PersonId == first)).Should().BeFalse("the loser issued nothing");
        (await read.CredentialTokens.AsNoTracking().CountAsync(t => t.PersonId == second && t.UsedAt == null)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task AnInviteById_ByAnAdminDemotedMidRequest_Is403_AndWritesNothing()
    {
        // S-002 (the #840 rule): the caller is re-checked under a lock inside the transaction.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (admin, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole); // a second admin, so the demotion is not of the last one
        var (session, _, _) = await _world.SeedStaffSessionAsync(admin, exerciseId: null, Person.OrgAdminRole);
        var legacy = await SeedLegacyPersonAsync(org);

        var hook = new BeforeCommandHook(IsPeopleUpdate, async () =>
        {
            await using var other = _world.ReadContext();
            await other.People.IgnoreQueryFilters().Where(p => p.Id == admin)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.OrgRole, (string?)null));
        });

        var (service, caller, context) = OrgInviteServiceKit.Invite(_fixture, session, admin, org, hook);
        await using (context)
        {
            (await caller.ResolveAsync()).Should().NotBeNull("the caller was an org admin when the request authenticated");
            var result = await service.InvitePersonAsync(legacy, new InviteExistingOrgPersonRequest { Email = $"x.{Guid.NewGuid():N}@example.com" });
            hook.Fired.Should().BeTrue();
            result.Outcome.Should().Be(OrgInviteOutcome.Forbidden, "the caller lost the grant before the invite took its lock");
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == legacy)).Email.Should().BeNull();
        (await read.CredentialTokens.AsNoTracking().AnyAsync(t => t.PersonId == legacy)).Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task TwoOpsReissues_AtOnce_LeaveExactlyOneLiveInvite()
    {
        var (org, slug) = await _world.SeedOrganizationAsync();
        var adminEmail = $"first.{Guid.NewGuid():N}@example.com";
        var admin = Guid.NewGuid();
        await using (var seed = _world.ReadContext())
        {
            seed.People.Add(new Person
            {
                Id = admin,
                OrganizationId = org,
                DisplayName = "First Admin",
                Email = adminEmail,
                OrgRole = Person.OrgAdminRole,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            seed.StaffUsers.Add(new StaffUser
            {
                Id = admin,
                OrganizationId = org,
                ExternalSubject = $"{OpsOrganizationService.PulseLocalSubjectPrefix}{admin:N}",
                DisplayName = "First Admin",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        OpsOrganizationOutcome? competing = null;
        var hook = new BeforeCommandHook(IsPeopleUpdate, async () =>
        {
            var (other, otherContext) = OrgInviteServiceKit.Ops(_fixture, Secret);
            await using (otherContext)
            {
                competing = (await other.ReissueAdminInviteAsync(slug, new ReissueAdminInviteRequest { AdminEmail = adminEmail }, Secret)).Outcome;
            }
        });

        var (service, context) = OrgInviteServiceKit.Ops(_fixture, Secret, hook);
        await using (context)
        {
            var result = await service.ReissueAdminInviteAsync(slug, new ReissueAdminInviteRequest { AdminEmail = adminEmail }, Secret);
            hook.Fired.Should().BeTrue("the competing re-issue landed inside this request");
            competing.Should().Be(OpsOrganizationOutcome.Reissued);
            result.Outcome.Should().Be(OpsOrganizationOutcome.Reissued);
        }

        await using var read = _world.ReadContext();
        var tokens = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == admin).ToListAsync();
        tokens.Should().HaveCount(2);
        tokens.Count(t => t.UsedAt == null).Should().Be(1, "never two live first-admin invites");
    }

    private static bool IsPeopleUpdate(string sql) =>
        sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal);

    /// <summary>A legacy allowlist staffer: a staff facet, NO email and NO Pulse password (the #849 shape).</summary>
    private async Task<Guid> SeedLegacyPersonAsync(Guid org)
    {
        var (id, _) = await _world.SeedPersonAsync(org);
        await using var context = _world.ReadContext();
        await context.People
            .IgnoreQueryFilters()
            .Where(p => p.Id == id)
            .ExecuteUpdateAsync(set => set.SetProperty(p => p.Email, (string?)null).SetProperty(p => p.PasswordHash, (string?)null));
        return id;
    }
}
