namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// Orchestrator review WR-5: <see cref="EngineAmbientPolicyRegistry.TrySet"/> is a reference compare-and-set that is
/// atomic with <see cref="EngineAmbientPolicyRegistry.DemoteAutonomous"/> — a stale snapshot never overwrites, and a
/// demotion racing a set never ends with autonomous resurrected. Docker-free.
/// </summary>
public sealed class EngineAmbientPolicyCasTests
{
    private const int RaceIterations = 2_000;

    private static AmbientTierPolicy Policy(AmbientPolicyMode mode, int perMinute = 5) => new()
    {
        Mode = mode,
        MaxPerMinute = perMinute,
        MaxPerHour = 50,
        TopicAllowList = [AmbientTopics.Food],
        PersonaAllowList = [Guid.NewGuid()],
        SetBy = "staff-user",
    };

    [Fact]
    public void TrySet_OnAFreshExercise_SucceedsAgainstTheOffSnapshot_AndFailsAgainstAnyOther()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exerciseId = Guid.NewGuid();
        var next = Policy(AmbientPolicyMode.Review);

        registry.TrySet(exerciseId, Policy(AmbientPolicyMode.Off), next)
            .Should().BeFalse("only the Off instance Get returned is the fresh exercise's snapshot");
        registry.Get(exerciseId).Should().BeSameAs(AmbientTierPolicy.Off);

        var snapshot = registry.Get(exerciseId);
        registry.TrySet(exerciseId, snapshot, next).Should().BeTrue();
        registry.Get(exerciseId).Should().BeSameAs(next);
    }

    [Fact]
    public void TrySet_ComparesByReference_NotByRecordValue()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exerciseId = Guid.NewGuid();
        var stored = Policy(AmbientPolicyMode.Review);
        registry.Set(exerciseId, stored);

        var valueEqualCopy = stored with { };
        valueEqualCopy.Should().Be(stored, "the record is value-equal...");

        registry.TrySet(exerciseId, valueEqualCopy, Policy(AmbientPolicyMode.Off))
            .Should().BeFalse("...but the compare-and-set is by reference to the snapshot actually read");
        registry.Get(exerciseId).Should().BeSameAs(stored);
    }

    [Fact]
    public void TwoWriters_OnTheSameSnapshot_OnlyTheFirstWins_TheSecondFailsOnItsStaleSnapshot()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exerciseId = Guid.NewGuid();
        registry.Set(exerciseId, Policy(AmbientPolicyMode.Review));

        var snapshotA = registry.Get(exerciseId);
        var snapshotB = registry.Get(exerciseId);
        var nextA = Policy(AmbientPolicyMode.Off);
        var nextB = Policy(AmbientPolicyMode.Review, perMinute: 9);

        registry.TrySet(exerciseId, snapshotA, nextA).Should().BeTrue();
        registry.TrySet(exerciseId, snapshotB, nextB).Should().BeFalse("B's snapshot went stale when A wrote");
        registry.Get(exerciseId).Should().BeSameAs(nextA);

        registry.TrySet(exerciseId, registry.Get(exerciseId), nextB).Should().BeTrue("a re-read snapshot succeeds");
    }

    [Fact]
    public void ADemotion_LandingBetweenReadAndWrite_FailsTheSet_AndAutonomousIsNotResurrected()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exerciseId = Guid.NewGuid();
        registry.Set(exerciseId, Policy(AmbientPolicyMode.Autonomous));

        var snapshot = registry.Get(exerciseId);
        var next = snapshot with { MaxPerMinute = 2 }; // still autonomous — e.g. a cap-lowering edit

        registry.DemoteAutonomous(exerciseId, out _).Should().BeTrue();

        registry.TrySet(exerciseId, snapshot, next).Should().BeFalse("the safety demotion made the snapshot stale");
        registry.Get(exerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "a stale writer never resurrects autonomous");
    }

    [Fact]
    public async Task RacingWriters_OnOneSnapshot_ExactlyOneWins_EveryIteration()
    {
        var registry = new EngineAmbientPolicyRegistry();

        for (var i = 0; i < RaceIterations; i++)
        {
            var exerciseId = Guid.NewGuid();
            registry.Set(exerciseId, Policy(AmbientPolicyMode.Review));
            var snapshot = registry.Get(exerciseId);
            var nextA = Policy(AmbientPolicyMode.Off);
            var nextB = Policy(AmbientPolicyMode.Review, perMinute: 9);
            using var barrier = new Barrier(2);

            var a = Task.Run(() => { barrier.SignalAndWait(); return registry.TrySet(exerciseId, snapshot, nextA); });
            var b = Task.Run(() => { barrier.SignalAndWait(); return registry.TrySet(exerciseId, snapshot, nextB); });
            var results = await Task.WhenAll(a, b);

            (results[0] ^ results[1]).Should().BeTrue("exactly one writer wins a compare-and-set on the same snapshot");
            registry.Get(exerciseId).Should().BeSameAs(results[0] ? nextA : nextB);
        }
    }

    [Fact]
    public async Task ADemotion_RacingAnAutonomousSet_AlwaysEndsOff()
    {
        var registry = new EngineAmbientPolicyRegistry();

        for (var i = 0; i < RaceIterations; i++)
        {
            var exerciseId = Guid.NewGuid();
            registry.Set(exerciseId, Policy(AmbientPolicyMode.Autonomous));
            var snapshot = registry.Get(exerciseId);
            var next = snapshot with { MaxPerMinute = 2 };
            using var barrier = new Barrier(2);

            var set = Task.Run(() => { barrier.SignalAndWait(); return registry.TrySet(exerciseId, snapshot, next); });
            var demote = Task.Run(() => { barrier.SignalAndWait(); return registry.DemoteAutonomous(exerciseId, out _); });
            await Task.WhenAll(set, demote);

            (await demote).Should().BeTrue("the demotion always finds an autonomous policy — the snapshot or the set's");
            registry.Get(exerciseId).Mode.Should().Be(
                AmbientPolicyMode.Off,
                "set-then-demote lowers the set's policy; demote-then-set fails the stale set — never autonomous");
        }
    }
}
