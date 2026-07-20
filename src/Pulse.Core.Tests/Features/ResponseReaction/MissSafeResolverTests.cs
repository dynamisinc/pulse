namespace Pulse.Core.Tests.Features.ResponseReaction;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class MissSafeResolverTests
{
    private sealed class Clock(int minute) : IScenarioClock
    {
        public int CurrentScenarioMinute { get; } = minute;
    }

    private static Storyline SilentStoryline()
    {
        var s = Storyline.Create(Guid.NewGuid(), "Water contamination fears", "the county issues a boil water advisory",
            responseWindowMin: 20, initialIntensity: 30, hashtags: ["#WaterIssues"]);
        s.Seed(0);
        s.Tick(new Clock(30)); // window blown → Escalating, silence = 30
        return s;
    }

    private static AddressingCandidate Official(string text) =>
        new(AddressingSource.OfficialPost, "post-1", text, null, 31);

    // ---- Resolution (ADP-002/002a) ---------------------------------------------------------------

    [Fact]
    public void OffPlatformMarker_IsTheIdenticalSatisfier_AlwaysAMatch()
    {
        var s = SilentStoryline();
        var marker = new AddressingCandidate(AddressingSource.OffPlatformMarker, "marker-1", "", s.Id, 31);

        var resolution = MissSafeResolver.Resolve(marker, [s], autoConfirmEnabled: false);

        resolution.Kind.Should().Be(MatchKind.Matched);
        resolution.ViaOffPlatformMarker.Should().BeTrue();
        resolution.StorylineId.Should().Be(s.Id);
    }

    [Fact]
    public void OnTopicOfficialPost_NeedsConfirmation_UnlessAutoConfirmOptedIn()
    {
        var s = SilentStoryline();
        var post = Official("The county has issued a boil water advisory for downtown.");

        MissSafeResolver.Resolve(post, [s], autoConfirmEnabled: false).Kind.Should().Be(MatchKind.NeedsConfirmation);
        MissSafeResolver.Resolve(post, [s], autoConfirmEnabled: true).Kind.Should().Be(MatchKind.Matched);
    }

    [Fact]
    public void UnrelatedOfficialPost_IsUnmatched_TheMissSafeDefault()
    {
        MissSafeResolver.Resolve(Official("the mayor congratulates the high school football team"), [SilentStoryline()], autoConfirmEnabled: true)
            .Kind.Should().Be(MatchKind.Unmatched);
    }

    // ---- The load-bearing safety invariants (§7.1, adversarial review D4) ------------------------

    [Fact]
    public void AMatch_AddressesTheStoryline_ResetsSilence_AndBendsDown()
    {
        var s = SilentStoryline();
        s.MinutesSinceLastOfficialResponse.Should().Be(30);
        var intensityBefore = s.Intensity;

        var resolution = new MatchResolution(MatchKind.Matched, s.Id, 0.8, ViaOffPlatformMarker: false);
        var events = MissSafeResolver.Apply(resolution, s, scenarioMinute: 31);

        events.Should().NotBeEmpty();
        s.MinutesSinceLastOfficialResponse.Should().Be(0, "a match resets the silence clock");
        s.Phase.Should().Be(StorylinePhase.Addressed);
        s.Intensity.Should().BeLessThan(intensityBefore, "a matched response bends intensity down");
    }

    [Fact]
    public void UnmatchedContent_IsNeverTreatedAsSilence_TheAntiBerateInvariant()
    {
        var s = SilentStoryline();
        var silenceBefore = s.MinutesSinceLastOfficialResponse;

        var unmatched = new MatchResolution(MatchKind.Unmatched, null, 0.1, ViaOffPlatformMarker: false);
        var events = MissSafeResolver.Apply(unmatched, s, scenarioMinute: 31);

        events.Should().BeEmpty();
        s.MinutesSinceLastOfficialResponse.Should().Be(silenceBefore, "unmatched content must NOT reset the clock — it is never silence");
        s.Phase.Should().NotBe(StorylinePhase.Addressed, "an irrelevant post can never falsely satisfy the storyline");
    }

    [Fact]
    public void Slow_ReducesTheBurst_ButNeverPausesIt()
    {
        var four = Intent(count: 4);
        MissSafeResolver.Slow(four).Count.Should().Be(2, "slowed by the slow factor");

        var one = Intent(count: 1);
        MissSafeResolver.Slow(one).Count.Should().Be(1, "never to zero — slows, never pauses (ADP-002a)");
    }

    private static GenerationIntent Intent(int count) => new()
    {
        StorylineId = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        Trigger = ReactionTriggerKind.Inaction,
        Personas = [.. Enumerable.Range(0, count).Select(i => new PersonaDossier { Handle = $"@p{i}", DisplayName = "p", Type = PersonaType.Resident })],
        ToneMix = new ToneMix(),
        Count = count,
        Tier = GenerationTier.Standard,
        AutonomyLevel = AutonomyLevel.DelayedAuto,
    };
}
