namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// identity-auth-roles/16 — the chained provider (ADMIN-IDENTITY-MODEL §1.3): a Person WITH a Pulse password is
/// authoritative (no fallback); a Person without one falls back to the Dynamis allowlist keyed on the staff facet's
/// ExternalSubject, so backfilled legacy staff sign in as before; an allowlist success for a person who HAS a Pulse
/// password is still refused.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PulsePasswordIdentityProviderTests
{
    private const string PulsePassword = "correct horse battery staple";
    private const string AllowlistSecret = "allowlist-secret-value";

    private readonly MsSqlContainerFixture _fixture;

    public PulsePasswordIdentityProviderTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task APersonWithAPulsePassword_SignsInWithIt_AndIsNeverFallenBackForAWrongOne()
    {
        var (org, email, subject) = await SeedStaffAsync(withPulsePassword: true);
        await using var context = _fixture.CreateContext();
        var provider = Provider(context, email, subject);

        var good = await provider.AuthenticateAsync(new StaffCredentials { Username = email.ToUpperInvariant(), Secret = PulsePassword, OrganizationId = org });
        good.Outcome.Should().Be(StaffAuthenticationOutcome.Authenticated);
        good.Identity!.ExternalSubject.Should().Be(subject, "the staff facet's subject, so login binds to the same StaffUser");

        var wrong = await provider.AuthenticateAsync(new StaffCredentials { Username = email, Secret = AllowlistSecret, OrganizationId = org });
        wrong.Outcome.Should().Be(
            StaffAuthenticationOutcome.Rejected, "Pulse is authoritative once a person has a password — the allowlist is not tried");
    }

    [RequiresDockerFact]
    public async Task ALegacyPersonWithoutAPulsePassword_SignsInThroughTheAllowlist_AsToday()
    {
        var (org, email, subject) = await SeedStaffAsync(withPulsePassword: false);
        await using var context = _fixture.CreateContext();

        var result = await Provider(context, email, subject)
            .AuthenticateAsync(new StaffCredentials { Username = email, Secret = AllowlistSecret, OrganizationId = org });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Authenticated);
        result.Identity!.ExternalSubject.Should().Be(subject);
    }

    [RequiresDockerFact]
    public async Task AnAllowlistSuccess_ForAPersonWhoHasAPulsePassword_IsRefused_EvenWithNoOrganizationHint()
    {
        var (_, email, subject) = await SeedStaffAsync(withPulsePassword: true);
        await using var context = _fixture.CreateContext();

        var result = await Provider(context, email, subject)
            .AuthenticateAsync(new StaffCredentials { Username = email, Secret = AllowlistSecret, OrganizationId = null });

        result.Outcome.Should().Be(StaffAuthenticationOutcome.Rejected);
    }

    [RequiresDockerFact]
    public async Task APasswordFromAnotherOrganization_DoesNotSignInHere()
    {
        var (_, email, subject) = await SeedStaffAsync(withPulsePassword: true);
        await using var context = _fixture.CreateContext();

        var result = await Provider(context, email, subject)
            .AuthenticateAsync(new StaffCredentials { Username = email, Secret = PulsePassword, OrganizationId = Guid.NewGuid() });

        result.Outcome.Should().Be(
            StaffAuthenticationOutcome.Rejected,
            "the person lookup is bounded by the server-resolved organization; the allowlist then refuses the Pulse password");
    }

    private static PulsePasswordIdentityProvider Provider(Pulse.WebApi.Data.PulseDbContext context, string email, string subject) =>
        new(context, new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions
        {
            Accounts =
            [
                new DynamisStaffAccount
                {
                    Username = email,
                    Secret = AllowlistSecret,
                    ExternalSubject = subject,
                    DisplayName = "Allowlisted",
                },
            ],
        })), TestPasswordVerifiers.New());

    private async Task<(Guid Org, string Email, string Subject)> SeedStaffAsync(bool withPulsePassword)
    {
        var id = Guid.NewGuid();
        var org = Guid.NewGuid();
        var email = $"staff.{id:N}@example.com";
        var staffUser = StaffTenantSeed.StaffUserFor(id, org);
        staffUser.Person!.Email = email;
        if (withPulsePassword)
        {
            staffUser.Person.PasswordHash = new PasswordHasher<Person>().HashPassword(staffUser.Person, PulsePassword);
        }

        await using var seed = _fixture.CreateContext();
        seed.StaffUsers.Add(staffUser);
        await seed.SaveChangesAsync();
        return (org, email, staffUser.ExternalSubject);
    }
}
