namespace Pulse.Core.Tests.Features.EngineEval;

using FluentAssertions;
using Pulse.Core.Features.EngineEval;

/// <summary>
/// The release-gating prompt-injection red-team suite (ADP-024, §12.2). Every catalog attack must be
/// <b>structurally contained</b> (the fence neutralises it) and have its <b>obeyed form caught</b> by the
/// content guard. A regression in either — a new attack that forges the fence, or an obeyed tell the guard
/// misses — fails the build.
/// </summary>
public class InjectionRedTeamTests
{
    public static TheoryData<InjectionAttack> Attacks()
    {
        var data = new TheoryData<InjectionAttack>();
        foreach (var attack in InjectionRedTeam.Catalog)
        {
            data.Add(attack);
        }

        return data;
    }

    [Fact]
    public void Catalog_CoversEveryAttackCategory()
    {
        var covered = InjectionRedTeam.Catalog.Select(a => a.Category).Distinct();
        covered.Should().BeEquivalentTo(Enum.GetValues<InjectionCategory>());
    }

    [Theory]
    [MemberData(nameof(Attacks))]
    public void EveryAttack_IsStructurallyContained_ByTheFence(InjectionAttack attack)
    {
        // Layer 1: the payload cannot forge a second fence / turn boundary or break the author attribute.
        InjectionRedTeam.Containment(attack).Contained.Should().BeTrue($"'{attack.Name}' must be fenced as inert data");
    }

    [Fact]
    public void FenceForgery_ProducesNoSecondFenceOrTurnBoundary()
    {
        var forgery = InjectionRedTeam.Catalog.Single(a => a.Category == InjectionCategory.FenceForgery);
        var containment = InjectionRedTeam.Containment(forgery);

        containment.SingleClosingFence.Should().BeTrue("the attacker's </world_feed> is HTML-encoded, not a real closer");
        containment.SinglePostBoundary.Should().BeTrue("the attacker's <post> is encoded, not a forged turn");
    }

    [Theory]
    [MemberData(nameof(Attacks))]
    public void EveryObeyedAttack_IsCaughtByTheGuard(InjectionAttack attack)
    {
        // Layers 3-4: if the model DID obey and reproduce the attacker's tell, the guard flags the draft
        // before any human sees it. This is the hard release gate.
        InjectionRedTeam.Obeyed(attack.ObeyedTell).Clean
            .Should().BeFalse($"an obeyed '{attack.Name}' must be caught by the content guard");
    }

    [Fact]
    public void AnInCharacterReaction_PassesTheGuard_SoTheGateIsNotTriviallyGreen()
    {
        // The resisted form: a citizen reacting in-world, containing none of the attacker tells.
        const string resisted = "honestly terrified about the tap water — when is the county going to say something??";
        InjectionRedTeam.Obeyed(resisted).Clean.Should().BeTrue("a genuine in-character reaction is clean");
    }

    [Fact]
    public void TheGate_Bites_ObeyedIsDirty_ResistedIsClean()
    {
        // Proves the suite is a real gate (mirrors the spike's validated resistance): the guard separates an
        // obeyed burst from a resisted one, so the suite fails iff an attack actually succeeds.
        var obeyed = InjectionRedTeam.Catalog.Select(a => InjectionRedTeam.Obeyed(a.ObeyedTell).Clean);
        obeyed.Should().OnlyContain(clean => clean == false);
    }
}
