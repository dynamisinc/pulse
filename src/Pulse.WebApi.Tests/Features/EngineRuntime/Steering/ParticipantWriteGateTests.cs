namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// #379 — <see cref="ParticipantWriteGate"/>: participant writes are refused at the Freeze tier, or in any lifecycle
/// state that does not accept participant writes (paused, build, completed, archived, unknown/unreadable). Every
/// (tier × status) combination is pinned, plus "Freeze refuses whatever the clock reads".
/// </summary>
public sealed class ParticipantWriteGateTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 9, 4, 9, 30, 0, TimeSpan.Zero);

    /// <summary>Every tier crossed with every status (canonical, legacy, unknown, unreadable).</summary>
    public static TheoryData<PauseTier, string?, bool> Matrix()
    {
        var data = new TheoryData<PauseTier, string?, bool>();
        string?[] statuses = ["build", "staged", "live", "paused", "completed", "archived", "active", "scheduled", "bogus", null];
        foreach (var tier in new[] { PauseTier.Running, PauseTier.Injects, PauseTier.Engine, PauseTier.Freeze })
        {
            foreach (var status in statuses)
            {
                var acceptsWrites = status is "staged" or "live" or "active";
                data.Add(tier, status, tier == PauseTier.Freeze || !acceptsWrites);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Matrix))]
    public async Task IsRefused_ForEveryTierAndLifecycleStatus(PauseTier tier, string? status, bool expectedRefused)
    {
        var exerciseId = Guid.NewGuid();
        var (registry, _) = NewRegistry();
        await SetTierAsync(registry, exerciseId, tier);
        await using var db = UnusedContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db), registry);

        gate.IsRefused(exerciseId, status).Should().Be(
            expectedRefused, "tier {0} with lifecycle '{1}' must {2}be refused", tier, status, expectedRefused ? string.Empty : "not ");
    }

    [Fact]
    public async Task FreezeTier_RefusesRegardlessOfTheClockState()
    {
        var exerciseId = Guid.NewGuid();
        var (registry, clock) = NewRegistry();
        await SetTierAsync(registry, exerciseId, PauseTier.Freeze);
        await using var db = UnusedContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db), registry);

        clock.IsFrozen(exerciseId).Should().BeTrue();
        gate.IsRefused(exerciseId, "live").Should().BeTrue("Freeze with the clock frozen");

        clock.Unfreeze(exerciseId);
        clock.IsFrozen(exerciseId).Should().BeFalse("this case needs the Freeze tier with a RUNNING clock");
        gate.IsRefused(exerciseId, "live").Should().BeTrue("the Freeze TIER refuses whatever the clock reads");
        (await gate.IsRefusedAsync(exerciseId)).Should().BeTrue("the async path refuses on the tier before any read");
    }

    [Fact]
    public async Task AFrozenClockWithoutAFreezeTier_DoesNotRefuse()
    {
        var exerciseId = Guid.NewGuid();
        var (registry, clock) = NewRegistry();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        clock.Freeze(exerciseId);
        await using var db = UnusedContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db), registry);

        gate.IsRefused(exerciseId, "live").Should().BeFalse("there is no separate frozen-clock condition");
    }

    [Fact]
    public async Task WithNoPauseTierRegistry_OnlyTheLifecycleDecides()
    {
        await using var db = UnusedContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db));

        gate.IsRefused(Guid.NewGuid(), "live").Should().BeFalse();
        gate.IsRefused(Guid.NewGuid(), "paused").Should().BeTrue();
    }

    [Fact]
    public async Task FreezeInOneExercise_DoesNotRefuseAnother()
    {
        var frozen = Guid.NewGuid();
        var other = Guid.NewGuid();
        var (registry, _) = NewRegistry();
        await SetTierAsync(registry, frozen, PauseTier.Freeze);
        await using var db = UnusedContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db), registry);

        gate.IsRefused(frozen, "live").Should().BeTrue();
        gate.IsRefused(other, "live").Should().BeFalse("a tier is per exercise (COR-001)");
    }

    private static (PauseTierRegistry Registry, IExerciseClock Clock) NewRegistry()
    {
        var clock = new ExerciseClockService(TimeProvider.System);
        return (new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance), clock);
    }

    private static async Task SetTierAsync(PauseTierRegistry registry, Guid exerciseId, PauseTier tier)
    {
        if (tier == PauseTier.Running)
        {
            return;
        }

        var result = await registry.SetTierAsync(
            exerciseId, tier, "controller-1", new PauseClockStart(ScenarioStart, TimeZoneInfo.Utc));
        result.Outcome.Should().Be(PauseTierOutcome.Applied);
    }

    /// <summary>A context that is never queried by the synchronous decision (no connection is opened).</summary>
    private static PulseDbContext UnusedContext() => new(
        new DbContextOptionsBuilder<PulseDbContext>().UseSqlServer("Server=unused.invalid;Database=unused").Options,
        new ExerciseContext());
}

/// <summary><see cref="ParticipantWriteGate.IsRefusedAsync"/> reading the stored status through real SQL.</summary>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantWriteGateSqlTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ParticipantWriteGateSqlTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task IsRefusedAsync_ReadsTheStoredStatus_AndFailsClosedOnAnUnknownExercise()
    {
        var live = Guid.NewGuid();
        var paused = Guid.NewGuid();
        await using (var seed = _fixture.CreateContext())
        {
            seed.Exercises.Add(NewExercise(live, "live"));
            seed.Exercises.Add(NewExercise(paused, "paused"));
            await seed.SaveChangesAsync();
        }

        await using var db = _fixture.CreateContext();
        var gate = new ParticipantWriteGate(new ExerciseFactsReader(db));

        (await gate.IsRefusedAsync(live)).Should().BeFalse();
        (await gate.IsRefusedAsync(paused)).Should().BeTrue();
        (await gate.IsRefusedAsync(Guid.NewGuid())).Should().BeTrue("an unreadable exercise fails closed");
    }

    private static Exercise NewExercise(Guid id, string status) => new()
    {
        OrganizationId = Organization.DefaultOrganizationId,
        Id = id,
        Name = $"Exercise {id:N}",
        Hostname = $"gate-{id:N}.example.com",
        TimeZone = "UTC",
        Status = status,
    };
}
