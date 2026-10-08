namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Xunit;
using static Pulse.WebApi.Tests.Features.Injects.InjectTestData;

/// <summary>
/// The pure item state machine (story 06 AC "Hold / release / skip / unskip / retry" and the edit/delete rules):
/// every allowed transition and every refused one.
/// </summary>
public sealed class InjectTransitionsTests
{
    private static readonly string[] AllStatuses =
    [
        InjectStatuses.Pending, InjectStatuses.Held, InjectStatuses.Firing,
        InjectStatuses.Fired, InjectStatuses.Skipped, InjectStatuses.Failed,
    ];

    // ---- hold ----

    [Theory]
    [InlineData(InjectKinds.Post)]
    [InlineData(InjectKinds.Burst)]
    public void Hold_FromPending_IsHeld(string kind)
    {
        var item = Item(kind, InjectStatuses.Pending, kind == InjectKinds.Post ? 1 : 3);

        InjectTransitions.Hold(item).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Held);
    }

    [Fact]
    public void Hold_AFiringBurst_SuspendsIt()
    {
        var item = Released(Item(), T0, 0, 10, 20);

        InjectTransitions.Hold(item).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Held);
    }

    [Fact]
    public void Hold_AFiringSinglePost_IsRefused()
    {
        var item = Item(InjectKinds.Post, InjectStatuses.Firing, 1);

        InjectTransitions.Hold(item).Should().NotBeNull("a single post in flight cannot be held");
        item.Status.Should().Be(InjectStatuses.Firing);
    }

    [Theory]
    [InlineData(InjectStatuses.Held)]
    [InlineData(InjectStatuses.Fired)]
    [InlineData(InjectStatuses.Skipped)]
    [InlineData(InjectStatuses.Failed)]
    public void Hold_FromAnyOtherStatus_IsRefusedAndChangesNothing(string status)
    {
        var item = Item(status: status);

        InjectTransitions.Hold(item).Should().NotBeNull();
        item.Status.Should().Be(status);
    }

    // ---- release ----

    [Fact]
    public void Release_AHeldItemThatNeverStarted_ReturnsToPending()
    {
        var item = Item(status: InjectStatuses.Held);

        InjectTransitions.Release(item, Guid.NewGuid()).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Pending);
        item.DriverHumanId.Should().BeNull("nothing is set running");
    }

    [Fact]
    public void Release_AHeldBurstThatStarted_ResumesFiring_DrivenByTheReleaser()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        item.Status = InjectStatuses.Held;
        var releaser = Guid.NewGuid();

        InjectTransitions.Release(item, releaser).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Firing);
        item.DriverHumanId.Should().Be(releaser, "the runner attributes the remaining posts to who set them running");
    }

    [Theory]
    [InlineData(InjectStatuses.Pending)]
    [InlineData(InjectStatuses.Firing)]
    [InlineData(InjectStatuses.Fired)]
    [InlineData(InjectStatuses.Skipped)]
    [InlineData(InjectStatuses.Failed)]
    public void Release_FromAnyOtherStatus_IsRefused(string status)
    {
        var item = Item(status: status);

        InjectTransitions.Release(item, Guid.NewGuid()).Should().NotBeNull();
        item.Status.Should().Be(status);
    }

    // ---- skip ----

    [Theory]
    [InlineData(InjectStatuses.Pending)]
    [InlineData(InjectStatuses.Held)]
    public void Skip_FromPendingOrHeld_SkipsTheItemAndItsPosts(string status)
    {
        var item = Item(status: status);

        InjectTransitions.Skip(item).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Skipped);
        Children(item).Should().OnlyContain(post => post.Status == InjectPostStatuses.Skipped);
    }

    [Fact]
    public void Skip_APartlyFiredHeldBurst_SkipsOnlyTheRemainingPosts()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        item.Status = InjectStatuses.Held;

        InjectTransitions.Skip(item).Should().BeNull();
        Children(item).Select(post => post.Status).Should().Equal(
            InjectPostStatuses.Fired, InjectPostStatuses.Skipped, InjectPostStatuses.Skipped);
    }

    [Theory]
    [InlineData(InjectStatuses.Firing)]
    [InlineData(InjectStatuses.Fired)]
    [InlineData(InjectStatuses.Skipped)]
    [InlineData(InjectStatuses.Failed)]
    public void Skip_FromAnyOtherStatus_IsRefused(string status)
    {
        var item = Item(status: status);

        InjectTransitions.Skip(item).Should().NotBeNull();
        item.Status.Should().Be(status);
    }

    // ---- unskip ----

    [Fact]
    public void Unskip_ASkippedItemThatNeverStarted_ReturnsToPending()
    {
        var item = Item();
        InjectTransitions.Skip(item);

        InjectTransitions.Unskip(item).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Pending);
        Children(item).Should().OnlyContain(post => post.Status == InjectPostStatuses.Pending);
    }

    [Fact]
    public void Unskip_ASkippedBurstThatHadFired_ComesBackHeld()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        item.Status = InjectStatuses.Held;
        InjectTransitions.Skip(item);

        InjectTransitions.Unskip(item).Should().BeNull();
        item.Status.Should().Be(InjectStatuses.Held, "something already went out, so it cannot be a fresh pending item");
        Children(item).Select(post => post.Status).Should().Equal(
            InjectPostStatuses.Fired, InjectPostStatuses.Pending, InjectPostStatuses.Pending);
    }

    [Theory]
    [InlineData(InjectStatuses.Pending)]
    [InlineData(InjectStatuses.Held)]
    [InlineData(InjectStatuses.Firing)]
    [InlineData(InjectStatuses.Fired)]
    [InlineData(InjectStatuses.Failed)]
    public void Unskip_FromAnyOtherStatus_IsRefused(string status)
    {
        var item = Item(status: status);

        InjectTransitions.Unskip(item).Should().NotBeNull();
        item.Status.Should().Be(status);
    }

    // ---- fire / retry gates ----

    [Fact]
    public void Fire_IsAllowedOnlyFromPendingOrHeld()
    {
        foreach (var status in AllStatuses)
        {
            var allowed = InjectTransitions.WhyNotFireable(Item(status: status)) is null;
            allowed.Should().Be(
                status is InjectStatuses.Pending or InjectStatuses.Held,
                "fire from {0} must be {1}", status, status is InjectStatuses.Pending or InjectStatuses.Held ? "allowed" : "refused");
        }

        InjectTransitions.WhyNotFireable(Item(status: InjectStatuses.Fired)).Should().Contain("already been fired");
    }

    [Fact]
    public void Retry_IsAllowedOnlyFromFailed()
    {
        foreach (var status in AllStatuses)
        {
            (InjectTransitions.WhyNotRetryable(Item(status: status)) is null)
                .Should().Be(status == InjectStatuses.Failed, "retry from {0}", status);
        }
    }

    // ---- edit / delete gates ----

    [Fact]
    public void Edit_IsAllowedOnlyFromPendingHeldOrFailed()
    {
        foreach (var status in AllStatuses)
        {
            (InjectTransitions.WhyNotEditable(Item(status: status)) is null).Should().Be(
                status is InjectStatuses.Pending or InjectStatuses.Held or InjectStatuses.Failed,
                "edit from {0}", status);
        }
    }

    [Fact]
    public void Edit_AHeldBurstThatAlreadyPublished_IsAllowed_ItsPublishedPostsAreGuardedSeparately()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        item.Status = InjectStatuses.Held;

        InjectTransitions.WhyNotEditable(item).Should().BeNull();
    }

    // ---- published posts are history ----

    [Fact]
    public void AnEdit_ThatKeepsEveryPublishedPostUnchanged_IsAllowed_AndMayChangeTheRest()
    {
        var (item, published) = HeldAfterFirstPost();
        var draft = Draft(item.Kind, Keep(published), Changed(Children(item)[2]));

        InjectTransitions.WhyEditWouldRewriteHistory(item, draft).Should().BeNull("unpublished posts may change or go");
    }

    [Fact]
    public void AnEdit_ThatDropsAPublishedPost_IsRefused()
    {
        var (item, _) = HeldAfterFirstPost();
        var draft = Draft(item.Kind, Changed(Children(item)[1]), Changed(Children(item)[2]));

        InjectTransitions.WhyEditWouldRewriteHistory(item, draft).Should().Be("Post 1 was already published and cannot be removed.");
    }

    [Fact]
    public void AnEdit_ThatRewritesAPublishedPost_IsRefused()
    {
        var (item, published) = HeldAfterFirstPost();
        var draft = Draft(item.Kind, Changed(Children(item)[2]), Changed(published));

        InjectTransitions.WhyEditWouldRewriteHistory(item, draft).Should().Be(
            "Post 2 was already published and cannot be changed.", "moving it is fine; changing its text is not");
    }

    [Fact]
    public void AnEdit_MayReorderAPublishedPost_Unchanged()
    {
        var (item, published) = HeldAfterFirstPost();
        var draft = Draft(item.Kind, Changed(Children(item)[2]), Keep(published));

        InjectTransitions.WhyEditWouldRewriteHistory(item, draft).Should().BeNull();
    }

    [Fact]
    public void AnEdit_ThatChangesTheKindOfAFiredItem_IsRefused_ButNotBeforeItFired()
    {
        var (item, published) = HeldAfterFirstPost();
        InjectTransitions.WhyEditWouldRewriteHistory(item, Draft(InjectKinds.Post, Keep(published)))
            .Should().Contain("kind cannot change");

        var fresh = Item(status: InjectStatuses.Held);
        InjectTransitions.WhyEditWouldRewriteHistory(fresh, Draft(InjectKinds.Post, Changed(Children(fresh)[0]))).Should().BeNull();
    }

    private static (InjectItem Item, InjectItemPost Published) HeldAfterFirstPost()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        var published = Fire(Children(item)[0]);
        item.Status = InjectStatuses.Held;
        return (item, published);
    }

    private static InjectItemDraft Draft(string kind, params InjectPostDraft[] posts) =>
        new(kind, "t", null, null, null, kind == InjectKinds.Burst ? 90 : null, posts);

    private static InjectPostDraft Keep(InjectItemPost child) =>
        new(child.Id, child.PersonaId, child.Text, [], child.ReplyToInjectPostId, child.ReplyToPostId, null, null, null, null);

    private static InjectPostDraft Changed(InjectItemPost child) =>
        new(child.Id, child.PersonaId, child.Text + " (edited)", [], null, null, null, null, null, null);

    [Fact]
    public void Edit_AnItemWithAPostInFlight_IsRefused()
    {
        var item = Item(status: InjectStatuses.Held);
        Children(item)[0].ClaimedAt = T0;

        InjectTransitions.WhyNotEditable(item).Should().NotBeNull();
    }

    [Fact]
    public void Delete_IsRefusedOnlyWhileFiringOrFired()
    {
        foreach (var status in AllStatuses)
        {
            (InjectTransitions.WhyNotDeletable(Item(status: status)) is null).Should().Be(
                status is not (InjectStatuses.Firing or InjectStatuses.Fired), "delete from {0}", status);
        }
    }

    // ---- settle ----

    [Fact]
    public void Settle_WithPostsStillPending_KeepsTheStatus()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);

        InjectTransitions.Settle(item);

        item.Status.Should().Be(InjectStatuses.Firing);
    }

    [Fact]
    public void Settle_WhenEveryPostFiredOrSkipped_IsFired()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        Fire(Children(item)[1]);
        Children(item)[2].Status = InjectPostStatuses.Skipped;

        InjectTransitions.Settle(item);

        item.Status.Should().Be(InjectStatuses.Fired);
        item.Error.Should().BeNull();
    }

    [Fact]
    public void Settle_WhenAnyPostFailed_IsFailed_WithTheFirstFailure()
    {
        var item = Released(Item(), T0, 0, 10, 20);
        Fire(Children(item)[0]);
        Children(item)[1].Status = InjectPostStatuses.Failed;
        Children(item)[1].Error = "mediaId does not resolve";
        Fire(Children(item)[2]);

        InjectTransitions.Settle(item);

        item.Status.Should().Be(InjectStatuses.Failed);
        item.Error.Should().Be("mediaId does not resolve");
    }

    [Fact]
    public void Settle_NeverOverwritesAControllersSkip()
    {
        var item = Item(status: InjectStatuses.Skipped);
        foreach (var child in Children(item))
        {
            child.Status = InjectPostStatuses.Skipped;
        }

        InjectTransitions.Settle(item);

        item.Status.Should().Be(InjectStatuses.Skipped);
    }

    [Fact]
    public void LiveChildren_ExcludesSoftDeletedPositions_InSequenceOrder()
    {
        var item = Item(childCount: 3);
        Children(item)[1].DeletedAt = T0;
        item.Posts = item.Posts.Reverse().ToList();

        InjectTransitions.LiveChildren(item).Select(post => post.Sequence).Should().Equal(1, 3);
    }
}
