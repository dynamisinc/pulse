namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Xunit;
using static Pulse.WebApi.Tests.Features.Injects.InjectTestData;

/// <summary>
/// The pure pacing decision (IQ-4): due instants, one post per tick, the lateness shift that keeps a burst's spacing
/// through a pause / hold / restart (never dumping overdue posts), reply waits, and the claim lease.
/// </summary>
public sealed class InjectBurstPlannerTests
{
    private static readonly IReadOnlyDictionary<Guid, Guid?> NoParents = new Dictionary<Guid, Guid?>();

    [Fact]
    public void NotYetDue_Waits()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);

        InjectBurstPlanner.Next(item, T0.AddSeconds(9), NoParents).Kind.Should().Be(InjectStepKind.Wait);
    }

    [Fact]
    public void Due_PublishesExactlyTheNextPost_WithItsLateness()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);

        var step = InjectBurstPlanner.Next(item, T0.AddSeconds(12), NoParents);

        step.Kind.Should().Be(InjectStepKind.Publish);
        step.Child.Should().BeSameAs(Children(item)[1]);
        step.LatenessSeconds.Should().Be(2);
    }

    [Fact]
    public void NoPendingPost_Completes()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        foreach (var child in Children(item))
        {
            Fire(child);
        }

        InjectBurstPlanner.Next(item, T0.AddSeconds(30), NoParents).Kind.Should().Be(InjectStepKind.Complete);
    }

    [Fact]
    public void Running_PublishesOnSchedule_OnePerTick()
    {
        var fired = Simulate(Released(Item(childCount: 4), T0, 0, 10, 20, 35), until: 60, paused: _ => false);

        fired.Should().Equal([0, 10, 20, 35], "with nothing paused every post goes out exactly when due");
    }

    [Fact]
    public void PauseInjects_PublishesNothing_ThenResumesAtTheOriginalSpacing_WithoutDumping()
    {
        // Paused from t=15 to t=60: posts 3 (due 20) and 4 (due 30) come due while paused.
        var fired = Simulate(
            Released(Item(childCount: 5), T0, 0, 10, 20, 30, 40),
            until: 120,
            paused: t => t is >= 15 and < 60);

        fired.Should().Equal(
            [0, 10, 60, 70, 80],
            "nothing goes out while paused, the first overdue post goes out at resume, and the lateness shifts the "
            + "remainder so the original 10 s spacing holds — two overdue posts are never published together");
    }

    [Fact]
    public void ABackendRestart_IsTheSameLatenessRule()
    {
        // The process is down from t=5 to t=100 — no ticks at all — then resumes.
        var fired = Simulate(
            Released(Item(childCount: 4), T0, 0, 10, 20, 30),
            until: 200,
            paused: _ => false,
            down: t => t is > 5 and < 100);

        fired.Should().Equal([0, 100, 110, 120], "the downtime is lateness like any other; the remainder keeps its spacing");
    }

    [Fact]
    public void GapsNeverFallBelowThreeSeconds_AcrossRepeatedPauses()
    {
        var offsets = InjectBurstPacing.ComputeOffsets(10, 60, new CryptoBurstJitterSource()).ToArray();
        var fired = Simulate(
            Released(Item(childCount: 10), T0, offsets),
            until: 600,
            paused: t => (t / 7) % 2 == 1);

        fired.Should().HaveCount(10);
        fired.Zip(fired.Skip(1), (a, b) => b - a).Should().OnlyContain(gap => gap >= InjectBurstPacing.MinGapSeconds);
    }

    [Fact]
    public void AScheduleThatGoesBackwards_StillNeverPublishesUnderThreeSecondsApart()
    {
        // An edit to a started burst can leave a later post with an EARLIER offset; the last-publish gate holds the gap.
        var fired = Simulate(Released(Item(childCount: 4), T0, 0, 20, 5, 6), until: 120, paused: _ => false);

        fired.Should().Equal([0, 20, 23, 26], "posts 3 and 4 were already overdue, so each waits only for the 3 s gap");
    }

    [Fact]
    public void ThePostRightAfterAPublish_WaitsForTheMinimumGap()
    {
        var item = Released(Item(), T0, 0, 1, 20);
        Fire(Children(item)[0]);
        item.LastPublishedAt = T0;

        InjectBurstPlanner.Next(item, T0.AddSeconds(2), NoParents).Kind.Should().Be(InjectStepKind.Wait);
        InjectBurstPlanner.Next(item, T0.AddSeconds(3), NoParents).Kind.Should().Be(InjectStepKind.Publish);
    }

    // ---- reply parents ----

    [Fact]
    public void AReplyToAnEarlierPostStillPending_Waits()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var children = Children(item);
        Fire(children[0]);
        children[2].ReplyToInjectPostId = children[1].Id;

        // Force the case the ordering normally prevents: the parent is pending but the reply is the next to go.
        children[1].Sequence = 4;

        var step = InjectBurstPlanner.Next(item, T0.AddSeconds(25), NoParents);

        step.Kind.Should().Be(InjectStepKind.Wait, "a reply waits for its parent's post id");
        step.Child.Should().BeSameAs(children[2]);
    }

    [Fact]
    public void AReplyToAnEarlierFiredPost_PublishesAsAReplyToThatPost()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var children = Children(item);
        var parent = Fire(children[0]);
        children[1].ReplyToInjectPostId = parent.Id;

        var step = InjectBurstPlanner.Next(item, T0.AddSeconds(10), NoParents);

        step.Kind.Should().Be(InjectStepKind.Publish);
        step.ParentPostId.Should().Be(parent.FiredPostId!.Value);
    }

    [Fact]
    public void AReplyToAnEarlierPostThatFailed_FailsWithFireTheParentFirst()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var children = Children(item);
        children[0].Status = InjectPostStatuses.Failed;
        children[1].ReplyToInjectPostId = children[0].Id;

        var step = InjectBurstPlanner.Next(item, T0.AddSeconds(10), NoParents);

        step.Kind.Should().Be(InjectStepKind.Fail);
        step.Error.Should().StartWith("Fire the parent first");
    }

    [Fact]
    public void AReplyToAnUnfiredPostInAnotherItem_FailsWithFireTheParentFirst()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var otherItemsPost = Guid.NewGuid();
        Children(item)[0].ReplyToInjectPostId = otherItemsPost;

        var step = InjectBurstPlanner.Next(item, T0, new Dictionary<Guid, Guid?> { [otherItemsPost] = null });

        step.Kind.Should().Be(InjectStepKind.Fail);
        step.Error.Should().Be(InjectBurstPlanner.ParentNotFiredMessage);
    }

    [Fact]
    public void AReplyToAFiredPostInAnotherItem_PublishesAsAReplyToIt()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var otherItemsPost = Guid.NewGuid();
        var publishedAs = Guid.NewGuid();
        Children(item)[0].ReplyToInjectPostId = otherItemsPost;

        var step = InjectBurstPlanner.Next(item, T0, new Dictionary<Guid, Guid?> { [otherItemsPost] = publishedAs });

        step.Kind.Should().Be(InjectStepKind.Publish);
        step.ParentPostId.Should().Be(publishedAs);
    }

    [Fact]
    public void AReplyToAnExistingPost_PassesItsIdThrough()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var existing = Guid.NewGuid();
        Children(item)[0].ReplyToPostId = existing;

        InjectBurstPlanner.Next(item, T0, NoParents).ParentPostId.Should().Be(existing);
    }

    // ---- the claim lease ----

    [Fact]
    public void AFreshClaim_Waits_SoAnotherInstanceNeverRepublishesAPostInFlight()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Children(item)[0].ClaimedAt = T0;

        InjectBurstPlanner.Next(item, T0.AddSeconds(30), NoParents).Kind.Should().Be(InjectStepKind.Wait);
    }

    [Fact]
    public void AClaimOlderThanTheLease_IsReconciledBeforeAnythingIsPublished()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Children(item)[0].ClaimedAt = T0;

        var step = InjectBurstPlanner.Next(item, T0 + InjectBurstPlanner.ClaimLease, NoParents);

        step.Kind.Should().Be(InjectStepKind.Reconcile);
        step.Child.Should().BeSameAs(Children(item)[0]);
    }

    [Fact]
    public void ShiftToMakeDueNow_MakesTheNextPostDueExactlyNow()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        var now = T0.AddSeconds(4.25);

        item.ShiftSeconds = InjectBurstPlanner.ShiftToMakeDueNow(item, Children(item)[1], now);

        InjectBurstPlanner.DueAt(item, Children(item)[1], now).Should().Be(now);
        InjectBurstPlanner.DueAt(item, Children(item)[2], now).Should().Be(now.AddSeconds(10), "the rest keep their spacing");
    }

    /// <summary>
    /// Drives the planner like the runner does — one tick per second — applying each Publish (fire + lateness shift)
    /// and returning the second each post went out at.
    /// </summary>
    private static List<int> Simulate(InjectItem item, int until, Func<int, bool> paused, Func<int, bool>? down = null)
    {
        var fired = new List<int>();
        for (var t = 0; t <= until; t++)
        {
            if (paused(t) || (down?.Invoke(t) ?? false))
            {
                continue;
            }

            var step = InjectBurstPlanner.Next(item, T0.AddSeconds(t), NoParents);
            if (step.Kind == InjectStepKind.Publish)
            {
                Fire(step.Child!);
                item.ShiftSeconds += step.LatenessSeconds;
                item.LastPublishedAt = T0.AddSeconds(t);
                fired.Add(t);
            }
        }

        return fired;
    }
}
