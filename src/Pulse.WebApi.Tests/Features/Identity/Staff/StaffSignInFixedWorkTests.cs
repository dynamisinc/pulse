namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// #602 M-2 / M-5 — the staff sign-in timing side channels, closed by FIXED slow-hash work. Every attempt that passes body
/// validation performs exactly <see cref="OrgStaffLoginService.SlowVerificationsPerAttempt"/> (org sign-in) or
/// <see cref="StaffLoginService.SlowVerificationsPerAttempt"/> (exercise-bound) PBKDF2 verifications, whatever the slug,
/// email, password, lock state and candidate count. Asserted by COUNTING verifications through a spy hasher
/// (<see cref="CountingPasswordHasher"/>) behind the production <see cref="StaffPasswordVerifier"/> seam — never by wall
/// time — over REAL SQL, so the provider's real verifications and the funnel's padding are both in the count.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffSignInFixedWorkTests
{
    private const string AllowlistSecret = "allowlist-secret-value";
    private const string WrongPassword = "a guess that matches nothing";

    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public StaffSignInFixedWorkTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

    [Fact]
    public void TheOrgSignInBudget_IsTheMostAnyAttemptCanNeed()
    {
        OrgStaffLoginService.SlowVerificationsPerAttempt.Should().Be(
            OrgStaffLoginService.MaxCandidates, "a slugless attempt verifies at most one Pulse password per capped candidate");
        StaffLoginService.SlowVerificationsPerAttempt.Should().Be(1, "the exercise-bound login has at most one password person");
    }

    [RequiresDockerFact]
    public async Task SlugSignIn_SpendsTheSameSlowHashWork_ForEveryOutcome()
    {
        var org = await _kit.SeedOrganizationAsync();
        var withPassword = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, withPassword, orgRole: Person.OrgAdminRole);
        var locked = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, locked, configure: LockOut);
        var allowlistOnly = OrgSignInTestKit.NewEmail();
        var allowlistPerson = await _kit.SeedPersonAsync(org.Id, allowlistOnly, orgRole: Person.OrgAdminRole, configure: p => p.PasswordHash = null);
        var allowlist = await AllowlistForAsync(allowlistOnly, allowlistPerson);

        var counts = new Dictionary<string, int>
        {
            ["unknown slug"] = await OrgCountAsync(Slug($"nope-{Guid.NewGuid():N}", withPassword, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Rejected),
            ["unknown email"] = await OrgCountAsync(Slug(org.Slug, OrgSignInTestKit.NewEmail(), WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["known email, wrong password"] = await OrgCountAsync(Slug(org.Slug, withPassword, WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["known email, right password"] = await OrgCountAsync(Slug(org.Slug, withPassword, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Authenticated),
            ["locked candidate, right password"] = await OrgCountAsync(Slug(org.Slug, locked, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Rejected),
            ["allowlist-only, wrong secret"] = await OrgCountAsync(Slug(org.Slug, allowlistOnly, WrongPassword), OrgStaffLoginOutcome.Rejected, allowlist),
            ["allowlist-only, right secret"] = await OrgCountAsync(Slug(org.Slug, allowlistOnly, AllowlistSecret), OrgStaffLoginOutcome.Authenticated, allowlist),
        };

        counts.Should().AllSatisfy(pair => pair.Value.Should().Be(
            OrgStaffLoginService.SlowVerificationsPerAttempt,
            "\"{0}\" must cost exactly the fixed PBKDF2 work — a different count is an existence / lock-state oracle",
            pair.Key));
    }

    [RequiresDockerFact]
    public async Task SluglessSignIn_SpendsTheSameSlowHashWork_RegardlessOfCandidateCountLockStateAndOutcome()
    {
        var unknown = OrgSignInTestKit.NewEmail();

        var one = OrgSignInTestKit.NewEmail();
        await SeedAcrossOrganizationsAsync(one, 1);

        var five = OrgSignInTestKit.NewEmail();
        await SeedAcrossOrganizationsAsync(five, OrgStaffLoginService.MaxCandidates);

        var fiveSomeLocked = OrgSignInTestKit.NewEmail();
        await SeedAcrossOrganizationsAsync(fiveSomeLocked, OrgStaffLoginService.MaxCandidates, lockedCount: 2);

        var allLocked = OrgSignInTestKit.NewEmail();
        await SeedAcrossOrganizationsAsync(allLocked, 3, lockedCount: 3);

        var counts = new Dictionary<string, int>
        {
            ["unknown email (allowlist path)"] = await OrgCountAsync(Slugless(unknown, WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["1 candidate, wrong password"] = await OrgCountAsync(Slugless(one, WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["1 candidate, right password"] = await OrgCountAsync(Slugless(one, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Authenticated),
            ["5 candidates, wrong password"] = await OrgCountAsync(Slugless(five, WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["5 candidates, right password (org choice)"] = await OrgCountAsync(Slugless(five, OrgSignInTestKit.Password), OrgStaffLoginOutcome.ChoiceRequired),
            ["5 candidates, 2 locked, wrong password"] = await OrgCountAsync(Slugless(fiveSomeLocked, WrongPassword), OrgStaffLoginOutcome.Rejected),
            ["3 candidates, all locked, right password"] = await OrgCountAsync(Slugless(allLocked, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Rejected),
        };

        counts.Should().AllSatisfy(pair => pair.Value.Should().Be(
            OrgStaffLoginService.SlowVerificationsPerAttempt,
            "\"{0}\" must cost exactly the fixed PBKDF2 work — the count may not scale with candidates or skip locked ones",
            pair.Key));
    }

    [RequiresDockerFact]
    public async Task LockedCandidates_GetNoRealVerification_SoTheyNeitherCountAFailureNorUnlock()
    {
        // The padding stands in for the locked candidate's verification; the lockout semantics stay exactly as before.
        var email = OrgSignInTestKit.NewEmail();
        var people = await SeedAcrossOrganizationsAsync(email, 2, lockedCount: 1);

        (await OrgCountAsync(Slugless(email, WrongPassword), OrgStaffLoginOutcome.Rejected))
            .Should().Be(OrgStaffLoginService.SlowVerificationsPerAttempt);

        await using var read = _kit.Context();
        var rows = await read.People.AsNoTracking().Where(p => people.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
        rows[people[0]].FailedLoginCount.Should().Be(StaffSignInLockout.Threshold, "a locked candidate is never verified for real");
        rows[people[0]].LockedOutUntil.Should().BeAfter(DateTimeOffset.UtcNow, "and is not unlocked by the attempt");
        rows[people[1]].FailedLoginCount.Should().Be(1, "the tried candidate's failure still counts, once");
    }

    [RequiresDockerFact]
    public async Task ExerciseBoundSignIn_SpendsExactlyOneSlowHash_ForEveryOutcome()
    {
        var org = (await _kit.SeedOrganizationAsync()).Id;
        var exercise = await _kit.SeedExerciseAsync(org);

        var withPassword = OrgSignInTestKit.NewEmail();
        await _kit.SeedEnrollmentAsync(exercise, await _kit.SeedPersonAsync(org, withPassword));
        var locked = OrgSignInTestKit.NewEmail();
        await _kit.SeedEnrollmentAsync(exercise, await _kit.SeedPersonAsync(org, locked, configure: LockOut));
        var allowlistOnly = OrgSignInTestKit.NewEmail();
        var allowlistPerson = await _kit.SeedPersonAsync(org, allowlistOnly, configure: p => p.PasswordHash = null);
        await _kit.SeedEnrollmentAsync(exercise, allowlistPerson);
        var allowlist = await AllowlistForAsync(allowlistOnly, allowlistPerson);

        var counts = new Dictionary<string, int>
        {
            ["unknown handle"] = await ExerciseBoundCountAsync(OrgSignInTestKit.NewEmail(), WrongPassword, exercise, StaffLoginOutcome.Rejected),
            ["password person, wrong password"] = await ExerciseBoundCountAsync(withPassword, WrongPassword, exercise, StaffLoginOutcome.Rejected),
            ["password person, right password"] = await ExerciseBoundCountAsync(withPassword, OrgSignInTestKit.Password, exercise, StaffLoginOutcome.Authenticated),
            ["locked person, right password"] = await ExerciseBoundCountAsync(locked, OrgSignInTestKit.Password, exercise, StaffLoginOutcome.Rejected),
            ["allowlist-only, wrong secret"] = await ExerciseBoundCountAsync(allowlistOnly, WrongPassword, exercise, StaffLoginOutcome.Rejected, allowlist),
            ["allowlist-only, right secret"] = await ExerciseBoundCountAsync(allowlistOnly, AllowlistSecret, exercise, StaffLoginOutcome.Authenticated, allowlist),
        };

        counts.Should().AllSatisfy(pair => pair.Value.Should().Be(
            StaffLoginService.SlowVerificationsPerAttempt,
            "\"{0}\" must cost exactly one PBKDF2 verification",
            pair.Key));
    }

    private static void LockOut(Person person)
    {
        person.FailedLoginCount = StaffSignInLockout.Threshold;
        person.LockedOutUntil = DateTimeOffset.UtcNow.AddMinutes(15);
    }

    private static StaffLoginRequest Slug(string slug, string email, string password) =>
        new() { OrgSlug = slug, Email = email, Password = password };

    private static StaffLoginRequest Slugless(string email, string password) => new() { Email = email, Password = password };

    /// <summary>Runs one org sign-in on a fresh request scope and returns its slow-verification count.</summary>
    private async Task<int> OrgCountAsync(
        StaffLoginRequest request,
        OrgStaffLoginOutcome expected,
        IList<DynamisStaffAccount>? allowlist = null)
    {
        var hasher = new CountingPasswordHasher();
        await using var context = _kit.Context();
        var result = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer(), allowlist, hasher)
            .LoginAsync(request, remoteIp: "203.0.113.7");

        result.Outcome.Should().Be(expected, "the scenario must take the path it claims to measure");
        return hasher.Verifications;
    }

    /// <summary>Runs one exercise-bound sign-in on a fresh request scope and returns its slow-verification count.</summary>
    private async Task<int> ExerciseBoundCountAsync(
        string username,
        string secret,
        Guid exerciseId,
        StaffLoginOutcome expected,
        DynamisStaffAccount[]? allowlist = null)
    {
        var hasher = new CountingPasswordHasher();
        var verifier = TestPasswordVerifiers.New(hasher);
        await using var context = _fixture.CreateContext();
        var provider = new PulsePasswordIdentityProvider(
            context,
            new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions { Accounts = [.. allowlist ?? []] })),
            verifier);
        var result = await new StaffLoginService(context, provider, verifier, new RecordingSessionIssuer())
            .LoginAsync(new StaffLoginRequest { Username = username, Secret = secret, ExerciseId = exerciseId.ToString() });

        result.Outcome.Should().Be(expected, "the scenario must take the path it claims to measure");
        return hasher.Verifications;
    }

    /// <summary>One person with <paramref name="email"/> (and the kit password) in each of <paramref name="count"/> fresh orgs.</summary>
    private async Task<List<Guid>> SeedAcrossOrganizationsAsync(string email, int count, int lockedCount = 0)
    {
        var people = new List<Guid>();
        for (var i = 0; i < count; i++)
        {
            var org = await _kit.SeedOrganizationAsync();
            var isLocked = i < lockedCount;
            people.Add(await _kit.SeedPersonAsync(
                org.Id,
                email,
                orgRole: Person.OrgAdminRole,
                configure: isLocked ? LockOut : null));
        }

        return people;
    }

    private async Task<DynamisStaffAccount[]> AllowlistForAsync(string email, Guid personId)
    {
        await using var read = _fixture.CreateContext();
        var subject = (await read.StaffUsers.SingleAsync(u => u.Id == personId)).ExternalSubject;
        return
        [
            new DynamisStaffAccount { Username = email, Secret = AllowlistSecret, ExternalSubject = subject, DisplayName = "Allowlisted" },
        ];
    }
}
