namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// #602 L-4 — <see cref="StaffSignInLockout.RecordFailureAsync"/> is ONE atomic <c>UPDATE</c>: N concurrent failures add
/// exactly N (no lost increment), and the lockout instant it writes is exactly the in-memory rule (threshold 5, 15 min
/// doubling, 4 h cap) — over REAL SQL Server, where the race actually exists.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffSignInLockoutConcurrencyTests
{
    private readonly OrgSignInTestKit _kit;

    public StaffSignInLockoutConcurrencyTests(MsSqlContainerFixture fixture) => _kit = new OrgSignInTestKit(fixture);

    [Fact]
    public void LockoutDuration_IsTheThresholdDoublingCappedRule()
    {
        StaffSignInLockout.LockoutDuration(StaffSignInLockout.Threshold - 1).Should().BeNull();
        StaffSignInLockout.LockoutDuration(5).Should().Be(TimeSpan.FromMinutes(15));
        StaffSignInLockout.LockoutDuration(6).Should().Be(TimeSpan.FromMinutes(30));
        StaffSignInLockout.LockoutDuration(7).Should().Be(TimeSpan.FromMinutes(60));
        StaffSignInLockout.LockoutDuration(8).Should().Be(TimeSpan.FromMinutes(120));
        StaffSignInLockout.LockoutDuration(9).Should().Be(TimeSpan.FromHours(4));
        StaffSignInLockout.LockoutDuration(400).Should().Be(TimeSpan.FromHours(4));
    }

    [RequiresDockerFact]
    public async Task ParallelFailures_AreEachCounted_NoIncrementIsLost()
    {
        const int Parallel = 16;
        var org = await _kit.SeedOrganizationAsync();
        var personId = await _kit.SeedPersonAsync(org.Id, OrgSignInTestKit.NewEmail());
        var now = DateTimeOffset.UtcNow;

        // Every attempt loads the SAME pre-failure row (count 0) in its own unit of work, then all record at once — the
        // shape in which a read-modify-write would collapse to a single increment.
        var loaded = await Task.WhenAll(Enumerable.Range(0, Parallel).Select(async _ =>
        {
            var context = _kit.Context();
            var person = await context.People.InOrganization(org.Id).SingleAsync(p => p.Id == personId);
            return (context, person);
        }));

        try
        {
            await Task.WhenAll(loaded.Select(pair => StaffSignInLockout.RecordFailureAsync(pair.context, pair.person, now)));
        }
        finally
        {
            foreach (var (context, _) in loaded)
            {
                await context.DisposeAsync();
            }
        }

        var row = await ReadAsync(personId);
        row.FailedLoginCount.Should().Be(Parallel, "N concurrent failures must add exactly N");
        row.LockedOutUntil.Should().Be(now + StaffSignInLockout.LockoutDuration(Parallel)!.Value);
    }

    [RequiresDockerFact]
    public async Task ParallelFailedSignIns_ThroughTheService_AreEachCounted()
    {
        // Below the threshold, so no attempt is skipped as locked: every one of them is a real verification failure.
        const int Parallel = StaffSignInLockout.Threshold - 1;
        var org = await _kit.SeedOrganizationAsync();
        var email = OrgSignInTestKit.NewEmail();
        var personId = await _kit.SeedPersonAsync(org.Id, email);

        await Task.WhenAll(Enumerable.Range(0, Parallel).Select(async _ =>
        {
            await using var context = _kit.Context();
            var result = await OrgSignInTestKit.Service(context, new RecordingSessionIssuer())
                .LoginAsync(new StaffLoginRequest { OrgSlug = org.Slug, Email = email, Password = "wrong" }, remoteIp: null);
            result.Outcome.Should().Be(OrgStaffLoginOutcome.Rejected);
        }));

        var row = await ReadAsync(personId);
        row.FailedLoginCount.Should().Be(Parallel);
        row.LockedOutUntil.Should().BeNull("the threshold was not reached");
    }

    [RequiresDockerFact]
    public async Task TheAtomicUpdate_AppliesExactlyTheInMemoryRule_AtEveryCount()
    {
        var org = await _kit.SeedOrganizationAsync();
        var personId = await _kit.SeedPersonAsync(org.Id, OrgSignInTestKit.NewEmail());
        var model = new Person { DisplayName = "model" };

        for (var failure = 1; failure <= 14; failure++)
        {
            var now = DateTimeOffset.UtcNow;
            await using (var context = _kit.Context())
            {
                var person = await context.People.InOrganization(org.Id).SingleAsync(p => p.Id == personId);
                await StaffSignInLockout.RecordFailureAsync(context, person, now);
            }

            StaffSignInLockout.RecordFailure(model, now);
            var row = await ReadAsync(personId);
            row.FailedLoginCount.Should().Be(model.FailedLoginCount, "failure {0}", failure);
            row.LockedOutUntil.Should().Be(model.LockedOutUntil, "failure {0}: the SQL CASE ladder must equal the rule", failure);
        }
    }

    private async Task<Person> ReadAsync(Guid personId)
    {
        await using var read = _kit.Context();
        return await read.People.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == personId);
    }
}
