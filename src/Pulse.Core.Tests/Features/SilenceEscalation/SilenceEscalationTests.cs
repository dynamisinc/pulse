namespace Pulse.Core.Tests.Features.SilenceEscalation;

using FluentAssertions;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.SilenceEscalation.Services;

public class SilenceEscalationTests
{
    [Theory]
    [InlineData(AddressingSource.OffPlatformMarker, false, true)] // marker always qualifies
    [InlineData(AddressingSource.OffPlatformMarker, true, true)]
    [InlineData(AddressingSource.OfficialPost, true, true)]       // official post qualifies only if matched
    [InlineData(AddressingSource.OfficialPost, false, false)]     // unmatched official post is NOT silence-satisfying
    public void IsQualifyingResponse_MarkerAlways_OfficialOnlyWhenMatched(AddressingSource source, bool matched, bool expected) =>
        SilenceRules.IsQualifyingResponse(source, matched).Should().Be(expected);

    [Fact]
    public void EscalationTone_ClimbsTowardSpeculationAndAnger_TheLongerTheSilence()
    {
        var earlier = SilenceRules.EscalationTone(minutesSilent: 20, windowMin: 20); // just past window
        var later = SilenceRules.EscalationTone(minutesSilent: 50, windowMin: 20);   // long silence

        (later.Speculation + later.Anger).Should().BeGreaterThan(earlier.Speculation + earlier.Anger,
            "a longer unaddressed silence reads visibly more speculative/angry (the vacuum fills)");
    }

    [Fact]
    public void EscalationTone_NeverGratefulOrCalm()
    {
        var tone = SilenceRules.EscalationTone(minutesSilent: 40, windowMin: 20);
        tone.Gratitude.Should().Be(0);
        tone.Calm.Should().Be(0);
        tone.Worry.Should().BeGreaterThan(0);
    }
}
