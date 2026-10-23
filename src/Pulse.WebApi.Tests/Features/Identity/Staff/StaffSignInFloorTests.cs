namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Identity.RoleMatrix;

/// <summary>
/// #602 W1 (M-5): the wall-clock floor of both staff sign-in funnels, proved DETERMINISTICALLY on a manual
/// <see cref="TimeProvider"/>. A spy hasher advances the virtual clock by a fixed KDF cost per verification, so the
/// attempt's virtual duration is "KDF work + floor padding". Each attempt that passed validation must end exactly at the
/// floor, whatever its path, or past it when the work alone exceeds the floor.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StaffSignInFloorTests
{
    private static readonly TimeSpan KdfCost = TimeSpan.FromMilliseconds(100);

    private readonly MsSqlContainerFixture _fixture;
    private readonly OrgSignInTestKit _kit;

    public StaffSignInFloorTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _kit = new OrgSignInTestKit(fixture);
    }

    [Fact]
    public void DefaultBoundOptions_YieldTheNonZeroProductionFloors()
    {
        // A missing (empty configuration) or blank / negative setting on UAT or prod must NEVER mean 0.
        foreach (var settings in new[]
        {
            new Dictionary<string, string?>(),
            new Dictionary<string, string?>
            {
                ["Authentication:StaffSignInTiming:OrgSignInFloorMilliseconds"] = string.Empty,
                ["Authentication:StaffSignInTiming:ExerciseBoundSignInFloorMilliseconds"] = "-5",
            },
        })
        {
            var timing = Resolve(settings);
            timing.OrgSignInFloor.Should().Be(TimeSpan.FromMilliseconds(StaffSignInTimingOptions.DefaultOrgSignInFloorMilliseconds));
            timing.ExerciseBoundSignInFloor.Should().Be(
                TimeSpan.FromMilliseconds(StaffSignInTimingOptions.DefaultExerciseBoundSignInFloorMilliseconds));
        }

        StaffSignInTimingOptions.DefaultOrgSignInFloorMilliseconds.Should().BeInRange(600, 1000, "the accepted org band");
        StaffSignInTimingOptions.DefaultExerciseBoundSignInFloorMilliseconds.Should().BePositive();

        var disabled = Resolve(new Dictionary<string, string?>
        {
            ["Authentication:StaffSignInTiming:OrgSignInFloorMilliseconds"] = "0",
            ["Authentication:StaffSignInTiming:ExerciseBoundSignInFloorMilliseconds"] = "0",
        });
        disabled.OrgSignInFloor.Should().Be(TimeSpan.Zero, "only an explicit 0 (tests) disables a floor");
        disabled.ExerciseBoundSignInFloor.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void EveryTestHost_RunsWithTheFloorsOff()
    {
        // The assembly-wide test default (TestHostDefaults): a real Program host built by a test resolves 0 floors.
        using var host = new RoleMatrixHost(connectionString: null);
        var timing = host.Services.GetRequiredService<StaffSignInTiming>();
        timing.OrgSignInFloor.Should().Be(TimeSpan.Zero);
        timing.ExerciseBoundSignInFloor.Should().Be(TimeSpan.Zero);
    }

    [RequiresDockerFact]
    public async Task OrgSignIn_UnknownEmail_AndKnownEmailWrongPassword_BothEndExactlyAtTheFloor()
    {
        var floor = TimeSpan.FromMilliseconds(750);
        var org = await _kit.SeedOrganizationAsync();
        var known = OrgSignInTestKit.NewEmail();
        await _kit.SeedPersonAsync(org.Id, known, orgRole: Person.OrgAdminRole);

        var outcomes = new Dictionary<string, (TimeSpan Duration, IReadOnlyList<TimeSpan> Delays)>
        {
            ["unknown email"] = await OrgAttemptAsync(floor, Slugless(OrgSignInTestKit.NewEmail(), "wrong"), OrgStaffLoginOutcome.Rejected),
            ["known email, wrong password"] = await OrgAttemptAsync(floor, Slugless(known, "wrong"), OrgStaffLoginOutcome.Rejected),
            ["known email, right password (success)"] = await OrgAttemptAsync(
                floor, Slugless(known, OrgSignInTestKit.Password), OrgStaffLoginOutcome.Authenticated),
            ["slug, known email, wrong password"] = await OrgAttemptAsync(
                floor, new StaffLoginRequest { OrgSlug = org.Slug, Email = known, Password = "wrong" }, OrgStaffLoginOutcome.Rejected),
        };

        foreach (var (name, (duration, delays)) in outcomes)
        {
            duration.Should().Be(floor, "\"{0}\" must end exactly at the floor", name);
            delays.Should().Equal([floor - (OrgStaffLoginService.SlowVerificationsPerAttempt * KdfCost)],
                "\"{0}\": the floor tops up the fixed KDF work with one delay", name);
        }
    }

    [RequiresDockerFact]
    public async Task OrgSignIn_WorkPastTheFloor_IsNotPadded()
    {
        var floor = TimeSpan.FromMilliseconds(300); // below the 5 x 100 ms of virtual KDF work
        var (duration, delays) = await OrgAttemptAsync(floor, Slugless(OrgSignInTestKit.NewEmail(), "wrong"), OrgStaffLoginOutcome.Rejected);

        duration.Should().Be(OrgStaffLoginService.SlowVerificationsPerAttempt * KdfCost);
        delays.Should().BeEmpty("residual differences exist only above the floor; nothing is added past it");
    }

    [RequiresDockerFact]
    public async Task ExerciseBoundSignIn_UnknownHandle_WrongPassword_AndSuccess_AllEndExactlyAtItsFloor()
    {
        var floor = TimeSpan.FromMilliseconds(350);
        var orgId = (await _kit.SeedOrganizationAsync()).Id;
        var exercise = await _kit.SeedExerciseAsync(orgId);
        var known = OrgSignInTestKit.NewEmail();
        await _kit.SeedEnrollmentAsync(exercise, await _kit.SeedPersonAsync(orgId, known));

        foreach (var (username, secret, expected) in new[]
        {
            (OrgSignInTestKit.NewEmail(), "wrong", StaffLoginOutcome.Rejected),
            (known, "wrong", StaffLoginOutcome.Rejected),
            (known, OrgSignInTestKit.Password, StaffLoginOutcome.Authenticated),
        })
        {
            var clock = new ManualTimeProvider();
            var hasher = new ClockAdvancingHasher(clock, KdfCost);
            var verifier = TestPasswordVerifiers.New(hasher);
            await using var context = _fixture.CreateContext();
            var provider = new PulsePasswordIdentityProvider(
                context, new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions())), verifier);
            var service = new StaffLoginService(context, provider, verifier, Timing(clock, exerciseBoundFloor: floor), new RecordingSessionIssuer());

            var started = clock.GetElapsed();
            var result = await service.LoginAsync(new StaffLoginRequest { Username = username, Secret = secret, ExerciseId = exercise.ToString() });

            result.Outcome.Should().Be(expected);
            (clock.GetElapsed() - started).Should().Be(floor, "{0} must end exactly at the exercise-bound floor", expected);
            clock.Delays.Should().Equal([floor - KdfCost]);
        }
    }

    [RequiresDockerFact]
    public async Task AValidationFailure_IsNotFloored()
    {
        // A malformed body is refused before any lookup: it reveals nothing about an account, so it is not delayed.
        var clock = new ManualTimeProvider();
        await using var context = _fixture.CreateContext();
        var verifier = TestPasswordVerifiers.New();
        var service = new OrgStaffLoginService(
            context,
            new PulsePasswordIdentityProvider(context, new DynamisIdentityProvider(Options.Create(new DynamisIdentityProviderOptions())), verifier),
            verifier,
            Timing(clock, orgFloor: TimeSpan.FromSeconds(1)),
            new RecordingSessionIssuer(),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<OrgStaffLoginService>.Instance);

        (await service.LoginAsync(new StaffLoginRequest { Email = "a@b.c" }, null)).Outcome.Should().Be(OrgStaffLoginOutcome.Invalid);
        clock.Delays.Should().BeEmpty();
    }

    private static StaffLoginRequest Slugless(string email, string password) => new() { Email = email, Password = password };

    private static StaffSignInTiming Resolve(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddStaffIdentity(configuration);
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<StaffSignInTiming>();
    }

    private static StaffSignInTiming Timing(TimeProvider clock, TimeSpan? orgFloor = null, TimeSpan? exerciseBoundFloor = null) => new(
        Options.Create(new StaffSignInTimingOptions
        {
            OrgSignInFloorMilliseconds = (int)(orgFloor ?? TimeSpan.Zero).TotalMilliseconds,
            ExerciseBoundSignInFloorMilliseconds = (int)(exerciseBoundFloor ?? TimeSpan.Zero).TotalMilliseconds,
        }),
        clock);

    private async Task<(TimeSpan Duration, IReadOnlyList<TimeSpan> Delays)> OrgAttemptAsync(
        TimeSpan floor,
        StaffLoginRequest request,
        OrgStaffLoginOutcome expected)
    {
        var clock = new ManualTimeProvider();
        await using var context = _kit.Context();
        var service = OrgSignInTestKit.Service(
            context, new RecordingSessionIssuer(), hasher: new ClockAdvancingHasher(clock, KdfCost), timing: Timing(clock, orgFloor: floor));

        var started = clock.GetElapsed();
        var result = await service.LoginAsync(request, "203.0.113.5");
        result.Outcome.Should().Be(expected, "the scenario must take the path it claims to measure");
        return (clock.GetElapsed() - started, clock.Delays);
    }

    /// <summary>
    /// A manual clock: time moves only when a test hasher "spends" KDF work or a delay's timer is created. A delay advances
    /// the clock by its due time and fires at once, so it is recorded and never actually waited.
    /// </summary>
    private sealed class ManualTimeProvider : TimeProvider
    {
        private long _ticks;

        public List<TimeSpan> Delays { get; } = [];

        public override long TimestampFrequency => TimeSpan.TicksPerSecond;

        public override long GetTimestamp() => Interlocked.Read(ref _ticks);

        public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddTicks(GetTimestamp());

        public TimeSpan GetElapsed() => TimeSpan.FromTicks(GetTimestamp());

        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            lock (Delays)
            {
                Delays.Add(dueTime);
            }

            Advance(dueTime);
            ThreadPool.QueueUserWorkItem(_ => callback(state));
            return new NoopTimer();
        }

        private sealed class NoopTimer : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => true;

            public void Dispose()
            {
            }

            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    /// <summary>A real PBKDF2 hasher whose every verification also advances the manual clock by a fixed KDF cost.</summary>
    private sealed class ClockAdvancingHasher(ManualTimeProvider clock, TimeSpan cost) : IPasswordHasher<Person>
    {
        private readonly PasswordHasher<Person> _inner = new();

        public string HashPassword(Person user, string password) => _inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(Person user, string hashedPassword, string providedPassword)
        {
            clock.Advance(cost);
            return _inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }
    }
}
