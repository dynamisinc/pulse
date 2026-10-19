namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// #602 L-3 — the org choice (<c>POST /api/auth/staff/login/choose</c>) is bound to the IP hash it was created from (a
/// mismatch is the uniform refusal, with no oracle and no consumption), and expired choices (consumed or not — a consumed
/// choice expires within two minutes of issue) are purged opportunistically when a choice is created or redeemed. Over
/// REAL SQL.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class OrgLoginChoiceHardeningTests
{
    private const string CreatingIp = "203.0.113.20";
    private const string OtherIp = "198.51.100.77";

    private readonly OrgSignInTestKit _kit;

    public OrgLoginChoiceHardeningTests(MsSqlContainerFixture fixture) => _kit = new OrgSignInTestKit(fixture);

    [Fact]
    public void TheChoiceIpHash_IsTheCreationHash_NeverTheRawAddress()
    {
        OrgStaffLoginService.HashChoiceIp(CreatingIp).Should().Be(SessionTokens.Hash("ip:" + CreatingIp));
        OrgStaffLoginService.HashChoiceIp(null).Should().Be(SessionTokens.Hash("ip:unknown"));
        OrgStaffLoginService.HashChoiceIp(CreatingIp).Should().NotContain(CreatingIp);
    }

    [RequiresDockerFact]
    public async Task AChoiceRedeemedFromAnotherIp_IsTheUniformRefusal_AndStaysRedeemableFromItsOwnIp()
    {
        var (token, orgB, personB) = await SeedChoiceAsync(CreatingIp);
        var issuer = new RecordingSessionIssuer();

        await using (var context = _kit.Context())
        {
            var service = OrgSignInTestKit.Service(context, issuer);
            var foreignIp = await service.ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, OtherIp);
            var unknownToken = await service.ChooseAsync(
                new StaffLoginChooseRequest { ChoiceToken = SessionTokens.Generate(), OrgSlug = orgB }, CreatingIp);

            foreignIp.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
            foreignIp.Should().BeEquivalentTo(unknownToken, "an IP mismatch is indistinguishable from an invalid token (no oracle)");
            (await service.ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, null))
                .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected, "an unknown caller IP is not the creating IP either");
            issuer.IssueCount.Should().Be(0);
        }

        await using (var read = _kit.Context())
        {
            (await read.LoginChoices.SingleAsync(c => c.TokenHash == SessionTokens.Hash(token))).ConsumedAt
                .Should().BeNull("a refused redemption never consumes the choice");
        }

        await using (var context = _kit.Context())
        {
            var chosen = await OrgSignInTestKit.Service(context, issuer)
                .ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = token, OrgSlug = orgB }, CreatingIp);
            chosen.Outcome.Should().Be(OrgStaffLoginOutcome.Authenticated, "the creating IP still redeems it");
            issuer.LastRequest!.PersonId.Should().Be(personB);
        }
    }

    [RequiresDockerFact]
    public async Task RedeemingAChoice_PurgesExpiredChoices_ConsumedOrNot_AndTheirCandidates_ButNotUnexpiredOnes()
    {
        var personId = await SeedPersonAsync();
        var expired = await SeedRawChoiceAsync(personId, DateTimeOffset.UtcNow.AddMinutes(-5), consumedAt: null);
        var expiredConsumed = await SeedRawChoiceAsync(
            personId, DateTimeOffset.UtcNow.AddMinutes(-1), consumedAt: DateTimeOffset.UtcNow.AddMinutes(-2));

        // Kept until its (at most two-minute) window closes, so an in-flight redemption and the audit trail still see it.
        var consumedUnexpired = await SeedRawChoiceAsync(personId, DateTimeOffset.UtcNow.AddMinutes(1), consumedAt: DateTimeOffset.UtcNow);
        var live = await SeedRawChoiceAsync(personId, DateTimeOffset.UtcNow.AddMinutes(2), consumedAt: null);

        await using (var context = _kit.Context())
        {
            (await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
                    .ChooseAsync(new StaffLoginChooseRequest { ChoiceToken = SessionTokens.Generate(), OrgSlug = "any" }, CreatingIp))
                .Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        }

        await AssertPurgedAsync(purged: [expired, expiredConsumed], kept: [consumedUnexpired, live]);
    }

    [RequiresDockerFact]
    public async Task CreatingAChoice_PurgesSpentChoices()
    {
        var personId = await SeedPersonAsync();
        var expired = await SeedRawChoiceAsync(personId, DateTimeOffset.UtcNow.AddMinutes(-5), consumedAt: null);

        var (token, _, _) = await SeedChoiceAsync(CreatingIp);

        await AssertPurgedAsync(purged: [expired], kept: []);
        await using var read = _kit.Context();
        (await read.LoginChoices.CountAsync(c => c.TokenHash == SessionTokens.Hash(token))).Should().Be(1, "the new choice is created");
    }

    private async Task AssertPurgedAsync(Guid[] purged, Guid[] kept)
    {
        await using var read = _kit.Context();
        var choices = await read.LoginChoices.Where(c => purged.Contains(c.Id) || kept.Contains(c.Id)).Select(c => c.Id).ToListAsync();
        var candidates = await read.LoginChoiceCandidates
            .Where(c => purged.Contains(c.ChoiceId) || kept.Contains(c.ChoiceId))
            .Select(c => c.ChoiceId)
            .ToListAsync();

        choices.Should().BeEquivalentTo(kept, "spent choices are purged; redeemable ones are not");
        candidates.Should().BeEquivalentTo(kept, "a purged choice's candidates go with it");
    }

    private async Task<Guid> SeedPersonAsync()
    {
        var org = await _kit.SeedOrganizationAsync();
        return await _kit.SeedPersonAsync(org.Id, OrgSignInTestKit.NewEmail());
    }

    private async Task<Guid> SeedRawChoiceAsync(Guid personId, DateTimeOffset expiresAt, DateTimeOffset? consumedAt)
    {
        var id = Guid.NewGuid();
        await using var seed = _kit.Context();
        var organizationId = (await seed.People.IgnoreQueryFilters().SingleAsync(p => p.Id == personId)).OrganizationId;
        seed.LoginChoices.Add(new LoginChoice
        {
            Id = id,
            TokenHash = SessionTokens.Hash(SessionTokens.Generate()),
            ExpiresAt = expiresAt,
            ConsumedAt = consumedAt,
            CreatedFromIpHash = OrgStaffLoginService.HashChoiceIp(CreatingIp),
        });
        seed.LoginChoiceCandidates.Add(new LoginChoiceCandidate { ChoiceId = id, PersonId = personId, OrganizationId = organizationId });
        await seed.SaveChangesAsync();
        return id;
    }

    /// <summary>Two orgs whose person verifies the same password: an open choice created from <paramref name="ip"/>.</summary>
    private async Task<(string Token, string OrgBSlug, Guid PersonB)> SeedChoiceAsync(string ip)
    {
        var orgA = await _kit.SeedOrganizationAsync();
        var orgB = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(orgA.Id, email, orgRole: Person.OrgAdminRole);
        var personB = await _kit.SeedPersonAsync(orgB.Id, email, orgRole: Person.OrgAdminRole);

        await using var context = _kit.Context();
        var login = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
            .LoginAsync(new StaffLoginRequest { Email = email, Password = OrgSignInTestKit.Password }, ip);
        login.Outcome.Should().Be(OrgStaffLoginOutcome.ChoiceRequired);
        return (login.Choice!.ChoiceToken, orgB.Slug, personB);
    }
}
