namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public StaffSignInLockoutConcurrencyTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

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

    [RequiresDockerFact]
    public async Task EveryFailure_ReusesOneCompiledQuery_WithTheLockoutInstantsAsSqlParameters()
    {
        // #660 W-1: the lockout instants must be SQL PARAMETERS, not per-call literals — otherwise every failed sign-in
        // compiles a new query (and SQL Server a new plan), a measurable cost on exactly the known-email path.
        var org = await _kit.SeedOrganizationAsync();
        var personId = await _kit.SeedPersonAsync(org.Id, OrgSignInTestKit.NewEmail());

        var commands = new CapturingCommandInterceptor();
        var compilations = 0;
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(commands)
            .LogTo(_ => Interlocked.Increment(ref compilations), [CoreEventId.QueryCompilationStarting])
            .Options;

        async Task FailAsync(DateTimeOffset now)
        {
            // One options instance → one internal service provider → one shared compiled-query cache, as in the host.
            await using var context = new PulseDbContext(options, null, null);
            var person = await context.People.InOrganization(org.Id).AsNoTracking().SingleAsync(p => p.Id == personId);
            commands.Clear();
            var compiledBefore = Volatile.Read(ref compilations);
            await StaffSignInLockout.RecordFailureAsync(context, person, now);
            commands.Last.Should().NotBeNull();
            commands.Last!.Compiled = Volatile.Read(ref compilations) - compiledBefore;
        }

        await FailAsync(new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.Zero));
        var first = commands.Last!;
        await FailAsync(new DateTimeOffset(2027, 6, 7, 8, 9, 10, TimeSpan.Zero));
        var second = commands.Last!;

        first.Sql.Should().StartWith("UPDATE", "the captured command is the failure's atomic UPDATE");
        second.Sql.Should().Be(first.Sql, "a different clock must not change the statement text (no literal instants)");
        second.Sql.Should().NotContain("2026").And.NotContain("2027", "the instants travel as parameters, never inlined");
        second.DateParameters.Should().HaveCountGreaterThanOrEqualTo(2, "every lockout arm is a datetimeoffset parameter");
        second.DateParameters.Should().Contain(new DateTimeOffset(2027, 6, 7, 8, 9, 10, TimeSpan.Zero) + StaffSignInLockout.BaseDuration);
        second.Compiled.Should().Be(0, "the second failure reuses the query compiled for the first");
    }

    private async Task<Person> ReadAsync(Guid personId)
    {
        await using var read = _kit.Context();
        return await read.People.IgnoreQueryFilters().AsNoTracking().SingleAsync(p => p.Id == personId);
    }
}

/// <summary>Captures the last executed non-query command's text and datetimeoffset parameter values (#660 W-1).</summary>
internal sealed class CapturingCommandInterceptor : DbCommandInterceptor
{
    /// <summary>The last captured command (its <c>Compiled</c> slot is filled in by the test).</summary>
    public CapturedCommand? Last { get; private set; }

    public void Clear() => Last = null;

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Last = new CapturedCommand(
            command.CommandText,
            command.Parameters.Cast<DbParameter>().Select(p => p.Value).OfType<DateTimeOffset>().ToList());
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }
}

/// <summary>One captured command.</summary>
internal sealed class CapturedCommand(string sql, IReadOnlyList<DateTimeOffset> dateParameters)
{
    public string Sql { get; } = sql;

    public IReadOnlyList<DateTimeOffset> DateParameters { get; } = dateParameters;

    public int Compiled { get; set; }
}
