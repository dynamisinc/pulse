namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// identity-auth-roles/21 — the <see cref="CredentialTokenService"/> lifecycle against real SQL: hash-only storage,
/// lifetimes, same-purpose voiding on issue, the uniform redeemable lookup, single-use claims, and the
/// credential-change invalidation of both purposes.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class CredentialTokenServiceTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public CredentialTokenServiceTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerFact]
    public async Task Issue_ReturnsAUrlSafe256BitTokenOnce_StoresOnlyItsSha256_WithThePurposesLifetime()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var now = DateTimeOffset.UtcNow;

        var reset = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org, now);
        var invite = await _world.IssueAsync(CredentialTokenPurposes.Invite, person, org, now);

        reset.RawToken.Should().MatchRegex("^[A-Za-z0-9_-]{43}$", "32 random bytes, base64url without padding");
        reset.RawToken.Should().NotBe(invite.RawToken);
        reset.ToString().Should().NotContain(reset.RawToken, "the issue result never prints its raw token");

        await using var read = _world.ReadContext();
        var stored = await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == person).ToListAsync();
        stored.Should().HaveCount(2);
        stored.Should().OnlyContain(t => t.TokenHash.Length == 64 && t.OrganizationId == org && t.UsedAt == null);
        stored.Select(t => t.TokenHash).Should().BeEquivalentTo([SessionTokens.Hash(reset.RawToken), SessionTokens.Hash(invite.RawToken)]);
        stored.Single(t => t.Purpose == CredentialTokenPurposes.Reset).ExpiresAt.Should().BeCloseTo(now.AddMinutes(60), TimeSpan.FromMilliseconds(1));
        stored.Single(t => t.Purpose == CredentialTokenPurposes.Invite).ExpiresAt.Should().BeCloseTo(now.AddDays(7), TimeSpan.FromMilliseconds(1));
    }

    [RequiresDockerFact]
    public async Task Issue_VoidsTheEarlierUnusedTokensOfTheSamePurpose_Only_AndOnlyForThatPerson()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var (bystander, _) = await _world.SeedPersonAsync(org);
        var firstReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org);
        var invite = await _world.IssueAsync(CredentialTokenPurposes.Invite, person, org);
        var bystanderReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, bystander, org);

        var secondReset = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org);

        await using var read = _world.ReadContext();
        async Task<DateTimeOffset?> UsedAt(Guid id) => (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == id)).UsedAt;
        (await UsedAt(firstReset.Token.Id)).Should().NotBeNull("issuing voids the earlier unused token of the same purpose");
        (await UsedAt(invite.Token.Id)).Should().BeNull("a reset leaves an outstanding invite alone");
        (await UsedAt(bystanderReset.Token.Id)).Should().BeNull("another person's token is untouched");
        (await UsedAt(secondReset.Token.Id)).Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task FindRedeemable_IsNullForUnknownExpiredUsedOrMalformed_AndTheRowOtherwise()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var live = await _world.IssueAsync(CredentialTokenPurposes.Invite, person, org);
        var expired = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org, DateTimeOffset.UtcNow.AddHours(-2));

        await using var context = _fixture.CreateContext();
        var service = new CredentialTokenService(context, TimeProvider.System);
        var now = DateTimeOffset.UtcNow;

        (await service.FindRedeemableAsync(live.RawToken, now)).Should().NotBeNull().And.Match<CredentialToken>(t => t.Id == live.Token.Id);
        (await service.FindRedeemableAsync($"  {live.RawToken}  ", now))?.Id.Should().Be(live.Token.Id, "surrounding whitespace is trimmed");
        (await service.FindRedeemableAsync(expired.RawToken, now)).Should().BeNull("expired");
        (await service.FindRedeemableAsync("unknown-token", now)).Should().BeNull("unknown");
        (await service.FindRedeemableAsync(null, now)).Should().BeNull("missing");
        (await service.FindRedeemableAsync(new string('a', CredentialTokenService.MaxRawTokenLength + 1), now)).Should().BeNull("over-long");

        (await service.TryClaimAsync(live.Token.Id, org, now)).Should().BeTrue();
        (await service.FindRedeemableAsync(live.RawToken, now)).Should().BeNull("used");
    }

    [RequiresDockerFact]
    public async Task TryClaim_IsSingleUse_AcrossTwoUnitsOfWork_AndRefusesAnotherOrganizationsBound()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org);
        var now = DateTimeOffset.UtcNow;

        await using var first = _fixture.CreateContext();
        await using var second = _fixture.CreateContext();
        await using var third = _fixture.CreateContext();

        (await new CredentialTokenService(third, TimeProvider.System).TryClaimAsync(issued.Token.Id, otherOrg, now))
            .Should().BeFalse("the claim is bounded by the token's own organization");

        var claims = await Task.WhenAll(
            new CredentialTokenService(first, TimeProvider.System).TryClaimAsync(issued.Token.Id, org, now),
            new CredentialTokenService(second, TimeProvider.System).TryClaimAsync(issued.Token.Id, org, now));

        claims.Count(claimed => claimed).Should().Be(1, "of two concurrent redemptions exactly one wins");
    }

    [RequiresDockerFact]
    public async Task CredentialChangeInvalidation_VoidsEveryOutstandingTokenOfBothPurposes_ForThatPersonOnly()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);
        var (bystander, _) = await _world.SeedPersonAsync(org);
        await _world.IssueAsync(CredentialTokenPurposes.Reset, person, org);
        await _world.IssueAsync(CredentialTokenPurposes.Invite, person, org);
        var bystanderToken = await _world.IssueAsync(CredentialTokenPurposes.Invite, bystander, org);

        await using (var context = _fixture.CreateContext())
        {
            var voided = await CredentialTokenService.StageCredentialChangeInvalidationAsync(
                context, CredentialSubject.ForPerson(person), org, DateTimeOffset.UtcNow);
            voided.Should().Be(2, "both purposes");
            await context.SaveChangesAsync();
        }

        await using var read = _world.ReadContext();
        (await read.CredentialTokens.AsNoTracking().Where(t => t.PersonId == person).ToListAsync())
            .Should().OnlyContain(t => t.UsedAt != null);
        (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == bystanderToken.Token.Id)).UsedAt.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task TheDatabase_RefusesATokenWithNoSubject_TwoSubjects_OrAnUnknownPurpose_AndTheWriteGuardAnEmptyTenant()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (person, _) = await _world.SeedPersonAsync(org);

        async Task<Exception?> Insert(Action<CredentialToken> shape)
        {
            var row = new CredentialToken
            {
                Id = Guid.NewGuid(),
                TokenHash = SessionTokens.Hash(Guid.NewGuid().ToString("N")),
                Purpose = CredentialTokenPurposes.Reset,
                PersonId = person,
                OrganizationId = org,
                ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
                CreatedAt = DateTimeOffset.UtcNow,
            };
            shape(row);
            await using var context = _fixture.CreateContext();
            context.CredentialTokens.Add(row);
            try
            {
                await context.SaveChangesAsync();
                return null;
            }
            catch (Exception exception)
            {
                return exception;
            }
        }

        (await Insert(_ => { })).Should().BeNull("positive control: a well-formed row is accepted");
        (await Insert(t => t.PersonId = null)).Should().BeOfType<DbUpdateException>("CK_CredentialTokens_OneSubject: no subject");
        var account = Guid.NewGuid();
        (await Insert(t => t.AccountId = account)).Should().BeOfType<DbUpdateException>("two subjects (and an unknown account)");
        (await Insert(t => t.Purpose = "magic")).Should().BeOfType<DbUpdateException>("CK_CredentialTokens_Purpose");
        (await Insert(t => t.OrganizationId = Guid.Empty)).Should().BeOfType<OrganizationScopeViolationException>(
            "CredentialToken is IOrganizationOwned, so the write-guard refuses an orphan tenant");
    }
}
