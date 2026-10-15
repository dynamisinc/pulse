namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Injects.Import;
using Xunit;

/// <summary>
/// demo-feedback/14 (DF-17 write path, DF-10 re-import) — <see cref="ImportRequests"/>, pure: alt text and the engagement
/// baseline travel in the ordinary write body, so <see cref="InjectItemValidator.Parse"/> sees an imported row exactly as
/// it sees a seeded (console) write; and the change comparison covers both.
/// </summary>
public sealed class ImportRequestsTests
{
    private static readonly Guid Persona = Guid.NewGuid();
    private static readonly Guid Photo = Guid.NewGuid();
    private static readonly Guid OtherPhoto = Guid.NewGuid();

    [Fact]
    public void ForCreate_CarriesAltAndBaseline_AndParsesExactlyAsTheSeedsConsoleWriteWithTheSameValues()
    {
        var candidate = Candidate([new PlannedMedia(Photo, "Statement card: boil water for zones 3-5")], like: 962, repost: 310, reply: null);

        var imported = InjectItemValidator.Parse(ImportRequests.ForCreate(candidate));

        // What scripts/uat/Seed-DemoContent.ps1 posts to /api/injects for the same item: only the baseline keys it has.
        var seeded = InjectItemValidator.Parse(new InjectItemWriteRequest
        {
            Kind = "post",
            Title = candidate.Title,
            PlannedMinute = candidate.PlannedMinute,
            Posts =
            [
                new InjectPostWriteRequest
                {
                    PersonaId = Persona.ToString(),
                    Text = candidate.Text,
                    Media = [new InjectMediaWriteRequest { MediaId = Photo.ToString(), Alt = "Statement card: boil water for zones 3-5" }],
                    EngagementBaseline = new InjectEngagementBaselineWriteRequest { Like = 962, Repost = 310 },
                },
            ],
        });

        imported.Error.Should().BeNull();
        seeded.Error.Should().BeNull();
        var post = imported.Draft!.Posts.Single();
        post.Media.Should().Equal(new InjectMediaDraft(Photo, "Statement card: boil water for zones 3-5"));
        (post.BaselineLike, post.BaselineRepost, post.BaselineReply).Should().Be((962, 310, (int?)null));
        imported.Draft.Should().BeEquivalentTo(seeded.Draft, "an imported item and a seeded item with the same values are indistinguishable");
    }

    [Fact]
    public void ForUpdate_TakesAltAndBaselineFromTheFile_AndKeepsTheChildAndItsReplyTarget()
    {
        var parent = Guid.NewGuid();
        var item = Item(media: [new InjectMediaRef { MediaId = Photo.ToString(), Alt = "pio-statement-card" }], like: 50, repost: 7, reply: null);
        item.Posts[0].ReplyToPostId = parent;
        var candidate = Candidate([new PlannedMedia(Photo, "Statement card")], like: 962, repost: null, reply: null);

        var request = ImportRequests.ForUpdate(candidate, item);

        var post = request.Posts!.Single()!;
        post.Id.Should().Be(item.Posts[0].Id.ToString(), "the child keeps its identity");
        post.ReplyTo!.PostId.Should().Be(parent.ToString(), "the MSEL has no reply-to column, so the console's target is kept");
        post.Media!.Single()!.Alt.Should().Be("Statement card");
        post.EngagementBaseline!.Like.Should().Be(962);
        post.EngagementBaseline.Repost.Should().BeNull("a blank engagement cell is 'not set': the file is the source for the baseline now");
    }

    [Fact]
    public void ForUpdate_WhenTheFileHasNoEngagementColumn_KeepsTheItemsBaseline_AndReportsNoChange()
    {
        var item = Item(media: [], like: 500, repost: 7, reply: null);
        var plainCadence = Candidate([], like: null, repost: null, reply: null, engagementInFile: false);

        var baseline = ImportRequests.ForUpdate(plainCadence, item).Posts!.Single()!.EngagementBaseline!;

        (baseline.Like, baseline.Repost, baseline.Reply).Should().Be((500, 7, (int?)null), "a plain Cadence export says nothing about engagement");
        Changes(item, plainCadence).Should().BeEmpty("so a console-set baseline is not a difference");
        ImportRequests.ForUpdate(plainCadence, Item(media: [])).Posts!.Single()!.EngagementBaseline.Should().BeNull();
    }

    [Fact]
    public void ForUpdate_WhenTheFileHasAnEngagementColumn_BlankCellsClearTheBaseline()
    {
        var item = Item(media: [], like: 500, repost: 7, reply: null);
        var withColumns = Candidate([], like: null, repost: null, reply: null, engagementInFile: true);

        ImportRequests.ForUpdate(withColumns, item).Posts!.Single()!.EngagementBaseline.Should().BeNull();
        Changes(item, withColumns).Should().Equal(["engagement"], "the file is the source once any engagement column is present");
    }

    [Fact]
    public void Differences_AnAltOnlyChange_IsAltText_ADifferentFileIsMedia()
    {
        var item = Item(media: [new InjectMediaRef { MediaId = Photo.ToString(), Alt = "pio-statement-card" }]);

        Changes(item, Candidate([new PlannedMedia(Photo, "pio-statement-card")])).Should().BeEmpty();
        Changes(item, Candidate([new PlannedMedia(Photo, "Statement card: boil water")])).Should().Equal("alt text");
        Changes(item, Candidate([new PlannedMedia(OtherPhoto, "pio-statement-card")])).Should().Equal("media");
        Changes(item, Candidate([])).Should().Equal("media");
    }

    [Fact]
    public void Differences_ABaselineChange_IsEngagement_AndNotSetIsTheSameAsZero()
    {
        var item = Item(media: [], like: 962, repost: null, reply: 0);

        Changes(item, Candidate([], like: 962, repost: null, reply: null)).Should().BeEmpty("0 and not set are the same count");
        Changes(item, Candidate([], like: 962, repost: 0, reply: 0)).Should().BeEmpty();
        Changes(item, Candidate([], like: 1000, repost: null, reply: 0)).Should().Equal("engagement");
        Changes(item, Candidate([], like: null, repost: null, reply: null)).Should().Equal(["engagement"], "a blank cell clears a set baseline");
        Changes(Item(media: []), Candidate([], like: 3, repost: null, reply: null)).Should().Equal("engagement");
    }

    [Fact]
    public void Differences_ListsAltTextAndEngagement_AfterTheOtherFields_InAFixedOrder()
    {
        var item = Item(media: [new InjectMediaRef { MediaId = Photo.ToString(), Alt = "old" }], like: 1);
        var candidate = Candidate([new PlannedMedia(Photo, "new")], like: 2, repost: null, reply: null) with { Text = "Rewritten." };

        Changes(item, candidate).Should().Equal("text", "alt text", "engagement");
    }

    // ---- helpers ----

    private static IReadOnlyList<string> Changes(InjectItem item, ImportCandidate candidate)
    {
        var parse = InjectItemValidator.Parse(ImportRequests.ForUpdate(candidate, item));
        parse.Error.Should().BeNull();
        return ImportRequests.Differences(item, parse.Draft!);
    }

    private static ImportCandidate Candidate(
        IReadOnlyList<PlannedMedia> media,
        int? like = null,
        int? repost = null,
        int? reply = null,
        bool engagementInFile = true) =>
        new("7", "Statement card", null, 5, null, KeepExistingAssignee: true, Persona, "Boil water notice for zones 3-5.", media, like, repost, reply,
            engagementInFile);

    /// <summary>An existing imported item matching <see cref="Candidate"/> in every field but media and baseline.</summary>
    private static InjectItem Item(IList<InjectMediaRef> media, int? like = null, int? repost = null, int? reply = null)
    {
        var id = Guid.NewGuid();
        var exercise = Guid.NewGuid();
        return new InjectItem
        {
            Id = id,
            ExerciseId = exercise,
            Kind = InjectKinds.Post,
            Title = "Statement card",
            PlannedMinute = 5,
            Status = InjectStatuses.Pending,
            ExternalRef = "7",
            Posts =
            [
                new InjectItemPost
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = exercise,
                    InjectItemId = id,
                    Sequence = 1,
                    PersonaId = Persona,
                    Text = "Boil water notice for zones 3-5.",
                    Status = InjectPostStatuses.Pending,
                    Media = media,
                    BaselineLike = like,
                    BaselineRepost = repost,
                    BaselineReply = reply,
                },
            ],
        };
    }
}
