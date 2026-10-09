namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>
/// IQ-4 pacing guarantees (story 06 AC "Bursts are paced on the server"): first post at 0, strictly increasing, no gap
/// under 3 s, last within the window — deterministically with a pinned jitter source and as a property over the
/// production source.
/// </summary>
public sealed class InjectBurstPacingTests
{
    [Fact]
    public void FirstPost_IsDueImmediately_AtOffsetZero()
    {
        var offsets = InjectBurstPacing.ComputeOffsets(5, 90, new FixedJitterSource(40, 10, 70, 20));

        offsets[0].Should().Be(0, "one click on Fire must give an immediate post");
    }

    [Fact]
    public void PinnedJitter_ProducesSortedCutsOverTheMandatoryGaps()
    {
        // n = 4, window 90 → mandatory 9 s, slack 81. Draws 50, 5, 20 sort to 5, 20, 50.
        var offsets = InjectBurstPacing.ComputeOffsets(4, 90, new FixedJitterSource(50, 5, 20));

        offsets.Should().Equal(
            [0, 3 + 5, 6 + 20, 9 + 50],
            "child k is due at 3·(k−1) plus the (k−1)th sorted cut of the slack");
    }

    [Fact]
    public void ZeroSlack_GivesExactlyTheMinimumGap()
    {
        var offsets = InjectBurstPacing.ComputeOffsets(11, 30, new FixedJitterSource());

        offsets.Should().Equal([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
    }

    [Fact]
    public void IdenticalDraws_StillNeverCollide()
    {
        var offsets = InjectBurstPacing.ComputeOffsets(6, 90, new FixedJitterSource(30, 30, 30, 30, 30));

        offsets.Should().BeInAscendingOrder().And.OnlyHaveUniqueItems(
            "two posts must never be due at the same instant even when the jitter draws coincide");
        offsets.Zip(offsets.Skip(1), (a, b) => b - a).Should().OnlyContain(gap => gap >= InjectBurstPacing.MinGapSeconds);
    }

    [Theory]
    [InlineData(2, 30)]
    [InlineData(2, 600)]
    [InlineData(5, 90)]
    [InlineData(11, 30)]
    [InlineData(20, 57)]
    [InlineData(20, 90)]
    [InlineData(20, 600)]
    public void ProductionJitter_AlwaysHoldsEveryGuarantee(int posts, int window)
    {
        var source = new CryptoBurstJitterSource();

        for (var run = 0; run < 200; run++)
        {
            var offsets = InjectBurstPacing.ComputeOffsets(posts, window, source);

            offsets.Should().HaveCount(posts);
            offsets[0].Should().Be(0);
            offsets.Should().BeInAscendingOrder();
            offsets.Zip(offsets.Skip(1), (a, b) => b - a)
                .Should().OnlyContain(gap => gap >= InjectBurstPacing.MinGapSeconds, "no gap may be under 3 s");
            offsets[^1].Should().BeLessThanOrEqualTo(window, "the last post goes out within the window");
        }
    }

    [Fact]
    public void ProductionJitter_ActuallyJitters()
    {
        var source = new CryptoBurstJitterSource();
        var distinct = Enumerable.Range(0, 20)
            .Select(_ => string.Join(",", InjectBurstPacing.ComputeOffsets(6, 90, source)))
            .Distinct()
            .Count();

        distinct.Should().BeGreaterThan(1, "a pile-on must not have a fixed, robotic rhythm");
    }

    [Fact]
    public void AWindowTooShortForTheMinimumGap_IsRefused()
    {
        var act = () => InjectBurstPacing.ComputeOffsets(20, 30, new FixedJitterSource());

        act.Should().Throw<ArgumentOutOfRangeException>("20 posts need 57 s at 3 s apart; the validator refuses this first");
        InjectBurstPacing.MinimumWindowSeconds(20).Should().Be(57);
        InjectBurstPacing.MinimumWindowSeconds(2).Should().Be(3);
    }
}
