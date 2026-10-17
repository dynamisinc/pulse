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
    public void Catalog_CarriesAmbientPersonaBioSteeringCases()
    {
        // ambient-chatter story 01 (AC7): ambient posts publish without a click, so allow-listed persona bios that try
        // to steer the ambient prompt are standing catalog entries — and, through the theories above, each is fenced
        // and its obeyed form is caught by the guard.
        var ambient = InjectionRedTeam.Catalog.Where(a => a.Name.StartsWith("ambient /", StringComparison.Ordinal)).ToList();

        ambient.Should().HaveCountGreaterThanOrEqualTo(3);
        ambient.Should().OnlyContain(a => a.WorldFeedPayload.StartsWith("Bio:", StringComparison.Ordinal));
        ambient.Should().OnlyContain(a => !InjectionRedTeam.Obeyed(a.ObeyedTell).Clean);
    }

    public static TheoryData<InjectionAttack> PersonaVoiceNotesAttacks()
    {
        var data = new TheoryData<InjectionAttack>();
        foreach (var attack in InjectionRedTeam.Catalog.Where(a => a.Vector == InjectionVector.PersonaVoiceNotes))
        {
            data.Add(attack);
        }

        return data;
    }

    [Fact]
    public void Catalog_CarriesPersonaVoiceNotesVectorCases()
    {
        // Gate-1 M-2: the ambient bio-steering cases travel the REAL persona path, not only the world-feed fence.
        InjectionRedTeam.Catalog.Where(a => a.Vector == InjectionVector.PersonaVoiceNotes)
            .Should().HaveCountGreaterThanOrEqualTo(3)
            .And.OnlyContain(a => a.Name.StartsWith("ambient /", StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(PersonaVoiceNotesAttacks))]
    public void PersonaVoiceNotesAttack_ReachesTheTrustedPromptUnfenced_AndItsObeyedFormIsCaught(InjectionAttack attack)
    {
        var request = InjectionRedTeam.AssembleViaPersonaVoiceNotes(attack);

        // The real path: the payload sits in the trusted cast block, NOT inside the fence — so layer 1 does not apply...
        request.SystemPrompt.Should().Contain("  voice: " + attack.WorldFeedPayload,
            "VoiceNotes are rendered verbatim into the persona dossier by PromptAssembler.AppendPersona");
        request.WorldFeed.Should().NotContain(attack.WorldFeedPayload);

        // ...so the guard is the defence on this path: an obeyed tell is caught before anything can publish.
        InjectionRedTeam.Obeyed(attack.ObeyedTell).Clean
            .Should().BeFalse($"an obeyed '{attack.Name}' via persona voice notes must be caught by the content guard");
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
