namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Xunit;

/// <summary>
/// The registration-time injection of the PUBLISHED default org-admin credential
/// (<see cref="DefaultOrgAdminAccount"/>) — asserted through the REAL <c>AddStaffIdentity()</c> +
/// <c>AddOrgAdminSeed()</c> seam and, wherever it matters, through the REAL
/// <see cref="IIdentityProvider"/> rather than by inspecting the options object.
/// </summary>
/// <remarks>
/// <para>
/// <b>The production gate is now the only thing preventing a known administrator credential in a live
/// deployment</b>, so it is asserted here THREE independent ways — nothing registered, nothing injected into the
/// allowlist, nothing authenticable — because any one of them passing while another fails would still be a live
/// default admin. The registration and the injection are separate mechanisms and are gated separately; a change
/// that kept the seeder out of production but let the <c>PostConfigure</c> through would leave the credential
/// working on a real host with no seeder in sight.
/// </para>
/// <para>
/// Assertions go through <see cref="IIdentityProvider.AuthenticateAsync"/> on purpose: "the options contain an
/// entry" is not the property that matters — "someone can log in with this" is, and only the provider answers
/// that. Model-only (no host, no database), so these run on every machine and in every CI job.
/// </para>
/// </remarks>
public sealed class DefaultOrgAdminAccountRegistrationTests
{
    [Fact]
    public async Task ZeroConfig_OutsideProduction_TheDefaultCredentialAuthenticates()
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider();

        var result = await AuthenticateAsync(provider, DefaultOrgAdminAccount.Username, DefaultOrgAdminAccount.Secret);

        result.Outcome.Should().Be(
            StaffAuthenticationOutcome.Authenticated,
            "this is the whole point of the feature: with NO Authentication:StaffIdentity configuration at all, a "
            + "non-production host must accept the published default credential — otherwise the org tier still "
            + "needs a manual config step, which is the gap this closed");
        result.Identity!.ExternalSubject.Should().Be(
            DefaultOrgAdminAccount.ExternalSubject,
            "the subject must be the fixed, documented one — the seeded StaffUser row is keyed on it, so a "
            + "changed or generated subject would auto-provision a second, unassigned human at first login");
        result.Identity.Username.Should().Be(DefaultOrgAdminAccount.Username);
        result.Identity.DisplayName.Should().Be(DefaultOrgAdminAccount.DisplayName);
    }

    [Fact]
    public void ZeroConfig_MarksTheDefaultAsInjected_SoTheHostCanScreamAboutIt()
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider();

        // Materializing the options is what runs the PostConfigure; the flag is meaningless before that.
        _ = provider.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value;

        provider.GetRequiredService<DefaultOrgAdminAccountState>().WasInjected.Should().BeTrue(
            "the boot-time alarm is driven off this flag — if the injection stopped recording itself, the host "
            + "would run on a published admin credential in total silence");
    }

    [Fact]
    public async Task AConfiguredEntryForThatUsername_WINS_AndTheDefaultIsNotAppended()
    {
        const string operatorSecret = "operator-chosen-secret";
        var operatorSubject = $"idp|{Guid.NewGuid():N}";

        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(
            configurationValues: OrgAdminSeedTestKit.ConfiguredEntryForTheDefaultUsername(
                operatorSecret, operatorSubject));

        var withTheOperatorsSecret = await AuthenticateAsync(
            provider, DefaultOrgAdminAccount.Username, operatorSecret);
        var withTheDefaultSecret = await AuthenticateAsync(
            provider, DefaultOrgAdminAccount.Username, DefaultOrgAdminAccount.Secret);

        withTheOperatorsSecret.Outcome.Should().Be(
            StaffAuthenticationOutcome.Authenticated,
            "PostConfigure runs after every Configure, so a real configured entry is present and untouched — an "
            + "injection that OVERWROTE it would silently revoke the operator's own credential");
        withTheOperatorsSecret.Identity!.ExternalSubject.Should().Be(
            operatorSubject, "and it resolves to the operator's OWN identity, not the default's");

        withTheDefaultSecret.Outcome.Should().Be(
            StaffAuthenticationOutcome.Rejected,
            "the default must not be APPENDED alongside a configured entry either: two entries for one username "
            + "would leave the published credential quietly working on a host whose operator believes they "
            + "replaced it");

        provider.GetRequiredService<DefaultOrgAdminAccountState>().WasInjected.Should().BeFalse(
            "and nothing must scream about a default credential that was never injected — a false alarm on every "
            + "boot is how a real alarm gets ignored");
    }

    [Fact]
    public async Task AConfiguredEntryWithNoSecret_StillBlocksTheDefault()
    {
        var configuration = OrgAdminSeedTestKit.ConfiguredEntryForTheDefaultUsername(
            secret: string.Empty, externalSubject: $"idp|{Guid.NewGuid():N}");

        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(configurationValues: configuration);

        (await AuthenticateAsync(provider, DefaultOrgAdminAccount.Username, DefaultOrgAdminAccount.Secret))
            .Outcome.Should().Be(
                StaffAuthenticationOutcome.Rejected,
                "the injection asks 'is there an entry for this username', NOT 'is there a USABLE one': an "
                + "operator who named this account with a blank secret has expressed an intent (keep it, disable "
                + "it), and substituting a published credential for their deliberate blank would be worse than "
                + "the seeder standing down and logging what to fix — which is exactly what it then does");

        provider.GetRequiredService<DefaultOrgAdminAccountState>().WasInjected.Should().BeFalse();
    }

    [Fact]
    public void InProduction_NothingIsRegistered()
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(environmentName: Environments.Production);

        provider.GetServices<IHostedService>().Should().NotContain(
            service => service is OrgAdminSeedHostedService,
            "a production host must have no code path that could mint an administrator");
        provider.GetService<OrgAdminSeedService>().Should().BeNull(
            "nor a seeder anything else could resolve and run");
        provider.GetService<DefaultOrgAdminAccountState>().Should().BeNull(
            "and not even the flag that accompanies the default-credential injection — its absence is the "
            + "structural proof that the injection was never wired here");
    }

    [Fact]
    public void InProduction_NothingIsInjectedIntoTheAllowlist()
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(environmentName: Environments.Production);

        var accounts = provider.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value.Accounts;

        accounts.Should().BeEmpty(
            "the allowlist of a production host with no configured accounts must stay EMPTY. This is asserted "
            + "separately from 'the seeder is not registered' because the two are separate mechanisms: an "
            + "injection that escaped the gate would put a published credential into a live deployment's "
            + "allowlist with no seeder involved at all");
    }

    [Fact]
    public async Task InProduction_TheDefaultCredentialCannotAuthenticate()
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(environmentName: Environments.Production);

        (await AuthenticateAsync(provider, DefaultOrgAdminAccount.Username, DefaultOrgAdminAccount.Secret))
            .Outcome.Should().Be(
                StaffAuthenticationOutcome.Rejected,
                "the end state a human actually cares about: on a production host the published credential is "
                + "not a login. Asserted through the real provider so it holds however the options got there");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ABlankEnvironmentName_IsTreatedAsProduction_ForTheInjectionToo(string environmentName)
    {
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider(environmentName);

        provider.GetService<DefaultOrgAdminAccountState>().Should().BeNull(
            "IHostEnvironment.IsProduction() answers FALSE for a blank name, so a gate built on it alone would "
            + "fail OPEN here — and 'I don't know where I am' is precisely the state of a deployment that was "
            + "never told. This is the regression guard on that hardening");

        provider.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value.Accounts.Should().BeEmpty();

        (await AuthenticateAsync(provider, DefaultOrgAdminAccount.Username, DefaultOrgAdminAccount.Secret))
            .Outcome.Should().Be(StaffAuthenticationOutcome.Rejected);
    }

    [Fact]
    public async Task TheDefaultUsername_IsTheOneTheSeederLooksFor()
    {
        DefaultOrgAdminAccount.Username.Should().Be(
            OrgAdminSeedService.TargetUsername,
            "the injected account and the account the seeder resolves must be the same one; if they drifted, the "
            + "host would accept a login for an identity that was never granted orgAdmin anywhere");

        // And the injected entry is genuinely resolvable by the seeder's own lookup rule (non-empty secret AND
        // non-empty subject) — the rule that makes it refuse to write an unauthenticable administrator.
        using var provider = OrgAdminSeedTestKit.BuildRegisteredProvider();
        var injected = OrgAdminSeedTestKit.RegisteredAllowlist(provider).Value.Accounts
            .Single(account => string.Equals(
                account.Username, DefaultOrgAdminAccount.Username, StringComparison.OrdinalIgnoreCase));

        injected.Secret.Should().NotBeEmpty();
        injected.ExternalSubject.Should().NotBeEmpty();

        (await AuthenticateAsync(provider, DefaultOrgAdminAccount.Username, "not-the-default-secret"))
            .Outcome.Should().Be(
                StaffAuthenticationOutcome.Rejected,
                "and the injected entry is still a CREDENTIAL check, not a bypass — a wrong secret is refused");
    }

    /// <summary>Authenticates through the registered <see cref="IIdentityProvider"/>, in a real DI scope.</summary>
    private static async Task<StaffAuthenticationResult> AuthenticateAsync(
        IServiceProvider provider,
        string username,
        string secret)
    {
        using var scope = provider.CreateScope();

        return await scope.ServiceProvider.GetRequiredService<IIdentityProvider>()
            .AuthenticateAsync(new StaffCredentials { Username = username, Secret = secret });
    }
}
