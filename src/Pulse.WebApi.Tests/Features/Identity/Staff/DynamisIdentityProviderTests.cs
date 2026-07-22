namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Providers;

/// <summary>
/// Unit tests for the Phase-1 <see cref="DynamisIdentityProvider"/> (story 05, COR-014 / NFR-009) — the
/// concrete staff-auth implementation behind the <see cref="IIdentityProvider"/> seam. Pure model-only
/// (<c>[Fact]</c>, no container): the provider reads bound options and touches no database. Covers the
/// fail-closed matrix (AC: "swapping the provider needs no call-site change" is proven at the login-service
/// layer; here we prove the Dynamis impl itself authenticates + rejects correctly).
/// </summary>
public sealed class DynamisIdentityProviderTests
{
    private const string Subject = "idp|controller-01";

    private static DynamisIdentityProvider Provider(params DynamisStaffAccount[] accounts) =>
        new(Options.Create(new DynamisIdentityProviderOptions { Accounts = new List<DynamisStaffAccount>(accounts) }));

    private static DynamisStaffAccount Account(string username, string secret, string subject = Subject, string displayName = "Controller One") =>
        new() { Username = username, Secret = secret, ExternalSubject = subject, DisplayName = displayName };

    [Fact]
    public async Task Authenticate_WithMatchingCredentials_ResolvesTheExternalIdentity()
    {
        var provider = Provider(Account("controller", "s3cr3t-pass"));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = "s3cr3t-pass" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Authenticated);
        result.Identity.Should().NotBeNull();
        result.Identity!.ExternalSubject.Should().Be(Subject, "the resolved subject is the StaffUser key the login provisions from");
        result.Identity.DisplayName.Should().Be("Controller One");
        result.Identity.Username.Should().Be("controller");
    }

    [Fact]
    public async Task Authenticate_WithWrongSecret_ReturnsRejected_AndNoIdentity()
    {
        var provider = Provider(Account("controller", "s3cr3t-pass"));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = "wrong" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected);
        result.Identity.Should().BeNull("a rejected credential must never leak a resolved identity (fail closed)");
    }

    [Fact]
    public async Task Authenticate_WithUnknownUsername_ReturnsRejected()
    {
        var provider = Provider(Account("controller", "s3cr3t-pass"));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "nobody", Secret = "s3cr3t-pass" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected);
        result.Identity.Should().BeNull();
    }

    [Fact]
    public async Task Authenticate_UsernameMatch_IsCaseInsensitive()
    {
        var provider = Provider(Account("Controller", "s3cr3t-pass"));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "CONTROLLER", Secret = "s3cr3t-pass" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Authenticated, "login handles are matched case-insensitively");
    }

    [Fact]
    public async Task Authenticate_SecretComparisonIsCaseSensitive()
    {
        var provider = Provider(Account("controller", "s3cr3t-pass"));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = "S3CR3T-PASS" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected, "the secret must match exactly (case-sensitive)");
    }

    [Fact]
    public async Task Authenticate_WithEmptyAllowlist_ReturnsRejected_FailClosed()
    {
        var provider = Provider();

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = "s3cr3t-pass" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected, "an unconfigured provider authenticates no one (fail closed)");
    }

    [Fact]
    public async Task Authenticate_EntryWithEmptyConfiguredSecret_CannotAuthenticate()
    {
        var provider = Provider(Account("controller", secret: string.Empty));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = string.Empty });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected,
            "an entry with an empty secret must never authenticate, even against an empty presented secret");
    }

    [Fact]
    public async Task Authenticate_EntryWithEmptyExternalSubject_CannotAuthenticate()
    {
        var provider = Provider(Account("controller", "s3cr3t-pass", subject: string.Empty));

        var result = await provider.AuthenticateAsync(new StaffCredentials { Username = "controller", Secret = "s3cr3t-pass" });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected,
            "an entry with no external subject cannot map to a StaffUser, so it must not authenticate");
    }
}
