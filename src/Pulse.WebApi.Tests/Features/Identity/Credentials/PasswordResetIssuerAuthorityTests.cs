namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Credentials;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Tests.Features.Identity.Enrollments;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// #842 — a reset or invite link is only as good as its issuer's authority. An org admin issues a link and is then demoted
/// or disabled while the link is still inside its lifetime: redeeming it must answer exactly what an expired link answers
/// (<c>invalid-token</c>), set no password, and leave the token unconsumed. A link whose issuer is still an enabled org
/// admin, and a self-delivered link (no issuer), keep working.
/// </summary>
[Collection(MsSqlRcsiCollection.Name)]
public sealed class PasswordResetIssuerAuthorityTests
{
    private readonly MsSqlContainerFixture _fixture;
    private readonly CredentialTestWorld _world;

    public PasswordResetIssuerAuthorityTests(MsSqlRcsiFixture rcsi)
    {
        ArgumentNullException.ThrowIfNull(rcsi);
        var fixture = rcsi.Sql;
        _fixture = fixture;
        _world = new CredentialTestWorld(fixture);
    }

    [RequiresDockerTheory]
    [InlineData(CredentialTokenPurposes.Reset, "demoted")]
    [InlineData(CredentialTokenPurposes.Reset, "disabled")]
    [InlineData(CredentialTokenPurposes.Invite, "demoted")]
    [InlineData(CredentialTokenPurposes.Invite, "disabled")]
    public async Task ALinkWhoseIssuerLostOrgAdmin_IsInvalidToken_AndChangesNothing(string purpose, string loss)
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (issuer, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(purpose, target, org, issuedBy: issuer);

        // The issuer loses the grant after issuing, inside the link's lifetime.
        await using (var write = _world.ReadContext())
        {
            var person = await write.People.SingleAsync(p => p.Id == issuer);
            if (loss == "demoted")
            {
                person.OrgRole = null;
            }
            else
            {
                person.DisabledAt = DateTimeOffset.UtcNow;
            }

            await write.SaveChangesAsync();
        }

        var result = await RedeemAsync(issued.RawToken);

        result.Outcome.Should().Be(PasswordResetOutcome.Invalid);
        result.Error.Should().Be(PasswordResetService.InvalidTokenError, "the same uniform answer as an expired link");

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == target)).PasswordChangedAt.Should().BeNull("no password was set");
        (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == issued.Token.Id)).UsedAt.Should().BeNull(
            "the refused link is not consumed");
    }

    [RequiresDockerTheory]
    [InlineData("demoted")]
    [InlineData("disabled")]
    public async Task AnIssuerWhoLosesOrgAdminBetweenTheCheckAndTheClaim_VoidsTheLink(string loss)
    {
        // Sonnet M3 / S-001: the early issuer check passes, then — inside the redemption's transaction, just before its
        // first lock — the issuer is demoted or disabled and that commits. The locked re-check must refuse the claim.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (issuer, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org, issuedBy: issuer);

        var hook = new BeforeCommandHook(
            sql => sql.Contains("UPDATE", StringComparison.Ordinal) && sql.Contains("[People]", StringComparison.Ordinal),
            async () =>
            {
                await using var competing = _world.ReadContext();
                var person = await competing.People.SingleAsync(p => p.Id == issuer);
                if (loss == "demoted")
                {
                    person.OrgRole = null;
                }
                else
                {
                    person.DisabledAt = DateTimeOffset.UtcNow;
                }

                await competing.SaveChangesAsync();
            });

        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(hook)
            .Options;
        await using (var context = new PulseDbContext(options))
        {
            var service = new PasswordResetService(
                context, new CredentialTokenService(context, TimeProvider.System), TimeProvider.System, new RecordingConnectionRevoker());
            var result = await service.ResetAsync(new PasswordResetRequest { Token = issued.RawToken, NewPassword = CredentialTestWorld.NewPassword });

            hook.Fired.Should().BeTrue("the issuer lost the grant after the early check, before the claim");
            result.Outcome.Should().Be(PasswordResetOutcome.Invalid);
            result.Error.Should().Be(PasswordResetService.InvalidTokenError);
        }

        await using var read = _world.ReadContext();
        (await read.People.AsNoTracking().SingleAsync(p => p.Id == target)).PasswordChangedAt.Should().BeNull("no password was set");
        (await read.CredentialTokens.AsNoTracking().SingleAsync(t => t.Id == issued.Token.Id)).UsedAt.Should().BeNull(
            "the refused link is not consumed");
    }

    [RequiresDockerFact]
    public async Task ALinkWhoseIssuerIsStillAnEnabledOrgAdmin_Works()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (issuer, _) = await _world.SeedPersonAsync(org, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org, issuedBy: issuer);

        (await RedeemAsync(issued.RawToken)).Outcome.Should().Be(PasswordResetOutcome.Ok);
    }

    [RequiresDockerFact]
    public async Task ASelfDeliveredLink_WithNoIssuer_IsUnaffected()
    {
        var (org, _) = await _world.SeedOrganizationAsync();
        var (target, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org);

        (await RedeemAsync(issued.RawToken)).Outcome.Should().Be(PasswordResetOutcome.Ok, "a null issuer has no authority to re-check");
    }

    [RequiresDockerFact]
    public async Task ALinkIssuedByAnAdminOfAnotherOrganization_IsInvalidToken()
    {
        // The issuer re-check is bounded by the TOKEN's organization: an org admin elsewhere is not an admin here.
        var (org, _) = await _world.SeedOrganizationAsync();
        var (otherOrg, _) = await _world.SeedOrganizationAsync();
        var (foreignAdmin, _) = await _world.SeedPersonAsync(otherOrg, orgRole: Person.OrgAdminRole);
        var (target, _) = await _world.SeedPersonAsync(org);
        var issued = await _world.IssueAsync(CredentialTokenPurposes.Reset, target, org, issuedBy: foreignAdmin);

        var result = await RedeemAsync(issued.RawToken);
        result.Outcome.Should().Be(PasswordResetOutcome.Invalid);
        result.Error.Should().Be(PasswordResetService.InvalidTokenError);
    }

    private async Task<PasswordResetResult> RedeemAsync(string rawToken)
    {
        await using var context = _world.ReadContext();
        var service = new PasswordResetService(
            context, new CredentialTokenService(context, TimeProvider.System), TimeProvider.System, new RecordingConnectionRevoker());
        return await service.ResetAsync(new PasswordResetRequest { Token = rawToken, NewPassword = CredentialTestWorld.NewPassword });
    }
}
