namespace Pulse.WebApi.Tests.Features.EngineEval.ReactionCorrectness;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;
using Xunit;

/// <summary>
/// SCENARIO - "no firehose, no flatline" (engine-eval-harness story 04, AC5 second half; requirement ADP-011).
/// </summary>
/// <remarks>
/// <para>
/// <b>The story being told.</b> The engine has two opposite ways to ruin an exercise. It can bury participants
/// (a firehose: so many engine posts per minute that nothing is legible) or it can go dead (a flatline: a quiet
/// moment where the platform simply stops looking alive). The per-exercise rate governance is the guard rail on
/// both sides: a hard per-minute CAP on engine posts, and a believable-activity FLOOR that the ambient-chatter
/// policy fills when storylines are not.
/// </para>
/// <para>
/// <b>Firehose scenario.</b> Ten storylines blow their windows in the same minute while the exercise is capped at
/// 3 engine posts per scenario minute. Across 30 minutes of heavy pressure we add up the posts the loop queued in
/// each minute: it must never exceed the cap, and no storyline may be starved out of ever being heard (the cap
/// rations the posts; it does not silence anyone forever).
/// </para>
/// <para>
/// <b>Flatline scenario.</b> A quiet exercise (no storylines at all) with an ambient policy set to review mode.
/// Every minute the floor is short, so every minute the engine must put some everyday chatter in front of the
/// controller (no flatline), and never more than the policy's per-minute ceiling (no firehose).
/// </para>
/// </remarks>
public sealed class RateCapAndQuietFloorScenarioTests
{
    [Fact]
    public async Task UnderHeavyPressure_EngineOutputNeverExceedsThePerMinuteCap()
    {
        const int cap = 3;
        await using var scenario = ReactionScenario.Create(rate: new RateGovernanceConfig(maxEnginePostsPerMinute: cap, minBelievableActivity: 0));
        for (var i = 0; i < 10; i++)
        {
            scenario.AddStoryline(title: $"Concern {i}", responseWindowMin: 5);
        }

        await scenario.RunMinutesAsync(30);

        var postsPerMinute = scenario.Timeline
            .GroupBy(t => t.Minute)
            .ToDictionary(g => g.Key, g => g.Sum(t => t.PostsEnqueued));

        postsPerMinute.Values.Should().OnlyContain(posts => posts <= cap, "no scenario minute may carry more engine posts than the cap");
        postsPerMinute.Values.Max().Should().Be(cap, "the load was real: the cap was actually reached and then enforced");
    }

    [Fact]
    public async Task TheCapRationsPosts_ButTheWorldNeverGoesQuietWhileConcernsAreUnanswered()
    {
        await using var scenario = ReactionScenario.Create(rate: new RateGovernanceConfig(maxEnginePostsPerMinute: 3, minBelievableActivity: 0));
        for (var i = 0; i < 10; i++)
        {
            scenario.AddStoryline(title: $"Concern {i}", responseWindowMin: 5);
        }

        await scenario.RunMinutesAsync(40);

        var afterWindow = scenario.Timeline.Where(t => t.Minute >= 5).ToList();
        afterWindow.Should().NotBeEmpty();
        afterWindow.Should().OnlyContain(
            t => t.PostsEnqueued > 0, "a capped engine still speaks every minute while concerns are unanswered: capped, not flatlined");
    }

    [Fact]
    public async Task AQuietExercise_IsNeverDead_AndNeverBuried()
    {
        const int perMinuteCeiling = 3;
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review, perMinute: perMinuteCeiling, perHour: 1000);
        var seenItems = 0;

        for (var minute = 1; minute <= 10; minute++)
        {
            harness.Time.Advance(TimeSpan.FromMinutes(1));
            await harness.TickAsync();

            var items = await harness.ReviewItemsAsync();
            var thisMinute = items.Skip(seenItems).ToList();
            seenItems = items.Count;

            thisMinute.Should().NotBeEmpty($"minute {minute}: the believable-activity floor is short, so the quiet exercise must not flatline");
            thisMinute.Sum(i => i.Posts.Count).Should().BeLessThanOrEqualTo(
                perMinuteCeiling, $"minute {minute}: the policy ceiling keeps the chatter from becoming a firehose");
        }
    }
}
