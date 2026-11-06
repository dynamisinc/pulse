namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// Engine-runtime story 07 (engine state survives a restart), slice S1: the startup install seams on the two policy
/// registries. <see cref="EngineAmbientPolicyRegistry.InstallPersisted"/> installs a FRESH slot through the registry's own
/// compare-and-set primitive, so the instance <see cref="EngineAmbientPolicyRegistry.Get"/> returns is accepted by
/// <see cref="EngineAmbientPolicyRegistry.TrySet"/> ("CAS semantics are unchanged"); a persisted Autonomous boots Off with
/// the previous kept (Q1); and a live policy is never overwritten by a row. The tier policy restores exactly (Q5).
/// The #571/#607 TrySet/Set/DemoteAutonomous tests are unmodified. Docker-free.
/// </summary>
public sealed class EnginePolicyInstallTests
{
    private static AmbientTierPolicy Policy(AmbientPolicyMode mode) => new()
    {
        Mode = mode,
        MaxPerMinute = 3,
        MaxPerHour = 40,
        TopicAllowList = [AmbientTopics.Food],
        PersonaAllowList = [Guid.NewGuid()],
        SetBy = "controller-7",
    };

    // ---- Ambient: CAS seam -----------------------------------------------------------------------

    [Fact]
    public void PersistedAmbientPolicy_AcceptsTrySetOnTheReturnedInstance()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        var review = Policy(AmbientPolicyMode.Review);

        var result = registry.InstallPersisted(exercise, review);

        result.Installed.Should().BeTrue();
        registry.Get(exercise).Should().BeSameAs(result.Current, "Get returns the installed slot's instance");
        registry.TrySet(exercise, expected: registry.Get(exercise), next: AmbientTierPolicy.Off).Should().BeTrue(
            "the installed slot is an ordinary CAS slot: TrySet against the instance Get returned succeeds");
        registry.Get(exercise).Should().BeSameAs(AmbientTierPolicy.Off);
    }

    [Fact]
    public void InstalledSlot_RejectsAStaleTrySet_AfterAnotherWrite()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        registry.InstallPersisted(exercise, Policy(AmbientPolicyMode.Review));
        var snapshot = registry.Get(exercise);

        registry.TrySet(exercise, snapshot, Policy(AmbientPolicyMode.Review)).Should().BeTrue();

        registry.TrySet(exercise, snapshot, Policy(AmbientPolicyMode.Review)).Should().BeFalse(
            "the persisted install did not weaken the reference compare-and-set");
    }

    [Theory]
    [InlineData(AmbientPolicyMode.Off)]
    [InlineData(AmbientPolicyMode.Review)]
    public void OffAndReview_AreInstalledAsPersisted_WithNothingHeld(AmbientPolicyMode mode)
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        var persisted = Policy(mode);

        var result = registry.InstallPersisted(exercise, persisted);

        result.Installed.Should().BeTrue();
        registry.Get(exercise).Should().BeSameAs(persisted, $"{mode} never acts without a human, so it restores as it was");
        result.HeldPrevious.Should().BeNull();
    }

    [Fact]
    public void Autonomous_InstallsAsOff_CapsAndListsKept_AndThePreviousIsHeld()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        var autonomous = Policy(AmbientPolicyMode.Autonomous);

        var result = registry.InstallPersisted(exercise, autonomous);

        result.Installed.Should().BeTrue();
        registry.Get(exercise).Mode.Should().Be(AmbientPolicyMode.Off, "Autonomous is a raise and never auto-restores (Q1)");
        registry.Get(exercise).Should().Be(
            autonomous with { Mode = AmbientPolicyMode.Off }, "the caps and allow-lists are kept, like DemoteAutonomous");
        result.HeldPrevious.Should().BeSameAs(autonomous, "the previous policy is kept for a human restore");
        registry.TrySet(exercise, registry.Get(exercise), autonomous).Should().BeTrue(
            "the human restore goes through the ordinary TrySet (and so every raise check its caller runs)");
    }

    [Fact]
    public void Install_NeverOverwritesALivePolicy_TheRowIsAFollower()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        var live = Policy(AmbientPolicyMode.Review);
        registry.TrySet(exercise, AmbientTierPolicy.Off, live).Should().BeTrue();

        var result = registry.InstallPersisted(exercise, Policy(AmbientPolicyMode.Off));

        result.Installed.Should().BeFalse("a policy written before the load reached the exercise is newer than the row");
        result.Current.Should().BeSameAs(live);
        result.HeldPrevious.Should().BeNull();
        registry.Get(exercise).Should().BeSameAs(live);
    }

    [Fact]
    public void Install_IsPerExercise_AndRejectsAnEmptyExerciseOrNullPolicy()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        registry.InstallPersisted(a, Policy(AmbientPolicyMode.Review));

        registry.Get(b).Should().BeSameAs(AmbientTierPolicy.Off, "installing A's row never moves B (COR-001)");

        var empty = () => registry.InstallPersisted(Guid.Empty, Policy(AmbientPolicyMode.Review));
        empty.Should().Throw<ArgumentException>();
        var nullPolicy = () => registry.InstallPersisted(a, null!);
        nullPolicy.Should().Throw<ArgumentNullException>();
    }

    // ---- Ambient: a corrupt row fails loudly, before anything is installed (Q7) ----------------------

    private static (string Reason, AmbientTierPolicy Row)[] CorruptAmbientRows()
    {
        var valid = Policy(AmbientPolicyMode.Review);
        var cap = RateGovernanceConfig.Default.MaxEnginePostsPerMinute;
        return
        [
            ("undefined mode", valid with { Mode = (AmbientPolicyMode)3 }),
            ("undefined autonomous-looking mode", valid with { Mode = (AmbientPolicyMode)(-1) }),
            ("negative per-minute cap", valid with { MaxPerMinute = -1 }),
            ("per-minute cap above the exercise cap", valid with { MaxPerMinute = cap + 1 }),
            ("negative per-hour cap", valid with { MaxPerHour = -1 }),
            ("per-hour cap above 60 x the exercise cap", valid with { MaxPerHour = (cap * 60) + 1 }),
            ("topic outside the vocabulary", valid with { TopicAllowList = ["not-a-topic"] }),
            ("empty persona id", valid with { PersonaAllowList = [Guid.Empty] }),
            (
                "over-long persona allow-list",
                valid with
                {
                    PersonaAllowList = Enumerable.Range(0, AmbientPolicyValidator.MaxPersonaAllowListLength + 1)
                        .Select(_ => Guid.NewGuid())
                        .ToList(),
                }),
            ("null topic allow-list", valid with { TopicAllowList = null! }),
            ("null persona allow-list", valid with { PersonaAllowList = null! }),
            ("over-cap autonomous (would be held, not just demoted)", Policy(AmbientPolicyMode.Autonomous) with { MaxPerMinute = cap + 1 }),
        ];
    }

    [Fact]
    public void Install_RejectsEveryCorruptRow_AndInstallsNothing()
    {
        foreach (var (reason, corrupt) in CorruptAmbientRows())
        {
            var registry = new EngineAmbientPolicyRegistry();
            var exercise = Guid.NewGuid();

            var act = () => registry.InstallPersisted(exercise, corrupt);

            act.Should().Throw<ArgumentException>($"a {reason} row must fail loudly so the rehydrator fails closed (Q7)");
            registry.Get(exercise).Should().BeSameAs(AmbientTierPolicy.Off, $"a rejected {reason} row installs nothing");
            registry.TrySet(exercise, AmbientTierPolicy.Off, Policy(AmbientPolicyMode.Review)).Should().BeTrue(
                $"the slot is still the resting Off after a {reason} row, so a controller write is not blocked");
        }
    }

    [Fact]
    public void Install_AcceptsARowAtTheCapBoundaries_AndEmptyAllowLists()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exercise = Guid.NewGuid();
        var cap = RateGovernanceConfig.Default.MaxEnginePostsPerMinute;
        var edge = Policy(AmbientPolicyMode.Review) with
        {
            MaxPerMinute = cap,
            MaxPerHour = cap * 60,
            TopicAllowList = [],
            PersonaAllowList = [],
        };

        var result = registry.InstallPersisted(exercise, edge);

        result.Installed.Should().BeTrue("a row exactly at the caps is a row the settings POST would have accepted");
        registry.Get(exercise).Should().BeSameAs(edge);
    }

    // ---- Tier policy: restored exactly (Q5) --------------------------------------------------------

    [Theory]
    [InlineData(TierPolicyMode.Standard)]
    [InlineData(TierPolicyMode.Ambient)]
    [InlineData(TierPolicyMode.Auto)]
    public void TierPolicy_IsInstalledExactly(TierPolicyMode mode)
    {
        var registry = new EngineTierPolicyRegistry();
        var exercise = Guid.NewGuid();

        registry.TryInstallPersisted(exercise, mode).Should().BeTrue();

        registry.GetMode(exercise).Should().Be(mode, "the tier policy is a cost/model choice, restored automatically (Q5)");
        registry.GetMode(Guid.NewGuid()).Should().Be(TierPolicyMode.Auto, "and only for that exercise (COR-001)");
    }

    [Fact]
    public void TierPolicy_Install_NeverOverwritesALiveMode_AndRejectsAnUndefinedMode()
    {
        var registry = new EngineTierPolicyRegistry();
        var exercise = Guid.NewGuid();
        registry.SetMode(exercise, TierPolicyMode.Ambient);

        registry.TryInstallPersisted(exercise, TierPolicyMode.Standard).Should().BeFalse();
        registry.GetMode(exercise).Should().Be(TierPolicyMode.Ambient, "a live mode is newer than the row");

        var undefined = () => registry.TryInstallPersisted(Guid.NewGuid(), (TierPolicyMode)42);
        undefined.Should().Throw<ArgumentException>("a corrupt row fails loudly so the rehydrator fails closed (Q7)");
    }
}
