namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Helpers;

/// <summary>
/// identity-auth-roles/15 (Gate-1 M-3) — the exercise-bound staff login (<c>{username, secret, exerciseId}</c>) applies
/// the same per-person lockout and disable as the org sign-in to a person with a PULSE password: a locked-out or disabled
/// person is refused with the uniform failure (no verification, no session), a failed Pulse-password verification counts
/// toward the lockout, and a verified one clears the counter. An allowlist-only staffer is untouched (legacy behaviour).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffLoginPulsePasswordLockoutTests
{
    private const string AllowlistSecret = "allowlist-secret-value";

    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public StaffLoginPulsePasswordLockoutTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

    [RequiresDockerFact]
    public async Task ALockedOutPerson_IsRefused_EvenWithTheRightPassword_AndGetsNoSession()
    {
        var (exercise, email, person) = await SeedAsync(configureLocked: true);
        var issuer = new RecordingSessionIssuer();

        var result = await LoginAsync(issuer, email, OrgSignInTestKit.Password, exercise);

        result.Outcome.Should().Be(StaffLoginOutcome.Rejected, "a locked-out person gets the uniform failure");
        issuer.IssueCount.Should().Be(0);
        (await ReadPersonAsync(person)).FailedLoginCount.Should().Be(
            StaffSignInLockout.Threshold, "a blocked attempt is skipped without verification, so it does not count again");
    }

    [RequiresDockerFact]
    public async Task ADisabledPerson_IsRefused_EvenWithTheRightPassword()
    {
        var (exercise, email, _) = await SeedAsync(configureDisabled: true);
        var issuer = new RecordingSessionIssuer();

        var result = await LoginAsync(issuer, email, OrgSignInTestKit.Password, exercise);

        result.Outcome.Should().Be(StaffLoginOutcome.Rejected);
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task FailedPulsePasswordVerifications_CountTowardTheLockout_AndLockThePersonAtTheThreshold()
    {
        var (exercise, email, person) = await SeedAsync();
        var issuer = new RecordingSessionIssuer();

        (await LoginAsync(issuer, email, "wrong password", exercise)).Outcome.Should().Be(StaffLoginOutcome.Rejected);
        (await ReadPersonAsync(person)).FailedLoginCount.Should().Be(1, "a failed Pulse-password verification records a failure");

        for (var i = 1; i < StaffSignInLockout.Threshold; i++)
        {
            await LoginAsync(issuer, email, "wrong password", exercise);
        }

        var locked = await ReadPersonAsync(person);
        locked.LockedOutUntil.Should().NotBeNull("the threshold locks the person out");

        (await LoginAsync(issuer, email, OrgSignInTestKit.Password, exercise)).Outcome.Should().Be(
            StaffLoginOutcome.Rejected, "once locked, even the right password is refused");
        issuer.IssueCount.Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task AVerifiedPulsePassword_ClearsTheFailureCounter_AsTheOrgSignInDoes()
    {
        var (exercise, email, person) = await SeedAsync();
        var issuer = new RecordingSessionIssuer();
        await LoginAsync(issuer, email, "wrong password", exercise);
        await LoginAsync(issuer, email, "wrong password", exercise);

        (await LoginAsync(issuer, email, OrgSignInTestKit.Password, exercise)).Outcome.Should().Be(StaffLoginOutcome.Authenticated);

        issuer.IssueCount.Should().Be(1);
        var reset = await ReadPersonAsync(person);
        reset.FailedLoginCount.Should().Be(0);
        reset.LockedOutUntil.Should().BeNull();
    }

    [RequiresDockerFact]
    public async Task AnAllowlistOnlyStaffer_IsUnchanged_AFailedSecretRecordsNoLockoutState()
    {
        var org = (await _kit.SeedOrganizationAsync()).Id;
        var exercise = await _kit.SeedExerciseAsync(org);
        var email = OrgSignInTestKit.NewEmail();

        // An email but NO Pulse password: the provider falls back to the allowlist for this person.
        var person = await _kit.SeedPersonAsync(org, email, configure: p => p.PasswordHash = null);
        await _kit.SeedEnrollmentAsync(exercise, person);
        string subject;
        await using (var read = _fixture.CreateContext())
        {
            subject = (await read.StaffUsers.SingleAsync(u => u.Id == person)).ExternalSubject;
        }

        var issuer = new RecordingSessionIssuer();
        (await LoginAsync(issuer, email, "wrong secret", exercise, AllowlistFor(email, subject))).Outcome
            .Should().Be(StaffLoginOutcome.Rejected);
        (await ReadPersonAsync(person)).FailedLoginCount.Should().Be(0, "the legacy allowlist path keeps its observable behaviour");

        (await LoginAsync(issuer, email, AllowlistSecret, exercise, AllowlistFor(email, subject))).Outcome
            .Should().Be(StaffLoginOutcome.Authenticated);
    }

    private static DynamisStaffAccount[] AllowlistFor(string email, string subject) =>
    [
        new DynamisStaffAccount { Username = email, Secret = AllowlistSecret, ExternalSubject = subject, DisplayName = "Allowlisted" },
    ];

    private async Task<(Guid Exercise, string Email, Guid Person)> SeedAsync(bool configureLocked = false, bool configureDisabled = false)
    {
        var org = (await _kit.SeedOrganizationAsync()).Id;
        var exercise = await _kit.SeedExerciseAsync(org);
        var email = OrgSignInTestKit.NewEmail();
        var person = await _kit.SeedPersonAsync(org, email, configure: p =>
        {
            if (configureLocked)
            {
                p.FailedLoginCount = StaffSignInLockout.Threshold;
                p.LockedOutUntil = DateTimeOffset.UtcNow.AddMinutes(15);
            }

            if (configureDisabled)
            {
                p.DisabledAt = DateTimeOffset.UtcNow.AddDays(-1);
            }
        });
        await _kit.SeedEnrollmentAsync(exercise, person);
        return (exercise, email, person);
    }

    private async Task<StaffLoginResult> LoginAsync(
        RecordingSessionIssuer issuer,
        string username,
        string secret,
        Guid exerciseId,
        DynamisStaffAccount[]? allowlist = null)
    {
        await using var context = _fixture.CreateContext();
        var verifier = TestPasswordVerifiers.New();
        var provider = new PulsePasswordIdentityProvider(
            context,
            new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions { Accounts = [.. allowlist ?? []] })),
            verifier);
        var service = new StaffLoginService(context, provider, verifier, issuer);
        return await service.LoginAsync(new StaffLoginRequest { Username = username, Secret = secret, ExerciseId = exerciseId.ToString() });
    }

    private async Task<Pulse.WebApi.Data.Entities.Person> ReadPersonAsync(Guid id)
    {
        await using PulseDbContext read = _fixture.CreateContext();
        return await read.People.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == id);
    }
}
