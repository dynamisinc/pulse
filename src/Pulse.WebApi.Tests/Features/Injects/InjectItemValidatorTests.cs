namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>
/// The validation matrix (story 06 AC "Author and edit"): every field rule as a readable 400, code-point counting,
/// write-side sanitization (NFR-004), and the reference rules where a cross-exercise id reads EXACTLY like an unknown
/// one (COR-001).
/// </summary>
public sealed class InjectItemValidatorTests
{
    private static readonly Guid Persona = Guid.NewGuid();

    [Fact]
    public void AValidPost_Parses()
    {
        var parse = InjectItemValidator.Parse(PostItem());

        parse.Error.Should().BeNull();
        parse.Draft!.Kind.Should().Be(InjectKinds.Post);
        parse.Draft.BurstWindowSeconds.Should().BeNull("a post has no window");
        parse.Draft.Posts.Should().ContainSingle();
    }

    [Fact]
    public void ABurstWithNoWindow_DefaultsTo90Seconds()
    {
        var parse = InjectItemValidator.Parse(BurstItem(3));

        parse.Draft!.BurstWindowSeconds.Should().Be(90);
    }

    public static TheoryData<string, InjectItemWriteRequest, string> Invalid() => new()
    {
        { "missing kind", PostItem(kind: null), "kind must be" },
        { "unknown kind", PostItem(kind: "thread"), "kind must be" },
        { "empty title", PostItem(title: "  "), "title must be between 1 and 120" },
        { "long title", PostItem(title: new string('t', 121)), "title must be between 1 and 120" },
        { "long notes", PostItem(notes: new string('n', 501)), "notes must be at most 500" },
        { "negative minute", PostItem(plannedMinute: -1), "plannedMinute" },
        { "bad assignee", PostItem(assigneeId: "not-a-guid"), "assigneeId does not name" },
        { "no posts", PostItem(posts: []), "posts is required" },
        { "post with two", PostItem(posts: [Post(), Post()]), "exactly 1 post" },
        { "burst of one", BurstItem(1), "between 2 and 20" },
        { "burst of 21", BurstItem(21, window: 600), "between 2 and 20" },
        { "window 29", BurstItem(2, window: 29), "between 30 and 600" },
        { "window 601", BurstItem(2, window: 601), "between 30 and 600" },
        { "window too short for the gaps", BurstItem(20, window: 56), "at least 57 seconds" },
        { "null post", PostItem(posts: [null]), "Post 1: a post object is required" },
        { "bad persona id", PostItem(posts: [Post(personaId: "nope")]), "Post 1: personaId does not name a persona" },
        { "empty text", PostItem(posts: [Post(text: "")]), "Post 1: text must be between 1 and 280" },
        { "text 281", PostItem(posts: [Post(text: new string('x', 281))]), "Post 1: text must be between 1 and 280" },
        { "five media", PostItem(posts: [Post(media: Media(5))]), "Post 1: A post may carry up to 4 images or exactly 1 video, never both." },
        { "media without id", PostItem(posts: [Post(media: [new InjectMediaWriteRequest { Alt = "a" }])]), "needs a mediaId" },
        { "unparseable media id", PostItem(posts: [Post(media: [new InjectMediaWriteRequest { MediaId = "beat3-photo", Alt = "a" }])]), "Post 1: One or more media items could not be found." },
        { "duplicate media", PostItem(posts: [Post(media: [M("m1"), M("m1")])]), "The same mediaId cannot be attached twice." },
        { "empty alt", PostItem(posts: [Post(media: [M("m1", alt: " ")])]), "alt text is required on every media item." },
        { "alt 1001", PostItem(posts: [Post(media: [M("m1", alt: new string('a', 1001))])]), "alt text must be at most 1000 characters." },
        { "replyTo both", PostItem(posts: [Post(replyTo: new() { InjectPostId = G(), PostId = G() })]), "exactly one of" },
        { "replyTo id and sequence", BurstItem(Post(), Post(replyTo: new() { Sequence = 1, PostId = G() })), "exactly one of" },
        { "replyTo sequence to itself", BurstItem(Post(), Post(replyTo: new() { Sequence = 2 })), "Post 2: replyTo.sequence must name an earlier post" },
        { "replyTo sequence to a later post", BurstItem(Post(replyTo: new() { Sequence = 2 }), Post()), "Post 1: replyTo.sequence must name an earlier post" },
        { "replyTo sequence zero", BurstItem(Post(), Post(replyTo: new() { Sequence = 0 })), "replyTo.sequence" },
        { "bad child id", PostItem(posts: [Post(id: "nope")]), "Post 1: id does not name a post of this item" },
        { "duplicate child id", BurstItem(Post(id: SharedId), Post(id: SharedId)), "Post 2: the same post appears twice" },
        { "replyTo neither", PostItem(posts: [Post(replyTo: new())]), "exactly one of" },
        { "replyTo bad inject id", PostItem(posts: [Post(replyTo: new() { InjectPostId = "x" })]), "does not name a scripted post" },
        { "replyTo bad post id", PostItem(posts: [Post(replyTo: new() { PostId = "x" })]), "replyTo.postId must be a post id" },
        { "baseline negative", PostItem(posts: [Post(baseline: new() { Like = -1 })]), "engagementBaseline" },
        { "baseline too big", PostItem(posts: [Post(baseline: new() { Repost = 1_000_001 })]), "engagementBaseline" },
        { "second post bad", BurstItem(2, second: Post(text: "")), "Post 2: text" },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public void AnInvalidField_IsAReadable400(string because, InjectItemWriteRequest request, string expected)
    {
        var parse = InjectItemValidator.Parse(request);

        parse.Draft.Should().BeNull(because);
        parse.Error.Should().Contain(expected, because);
    }

    [Fact]
    public void ANullBody_IsAReadable400()
    {
        InjectItemValidator.Parse(null).Error.Should().Be("A JSON body is required.");
    }

    [Fact]
    public void Lengths_CountCodePoints_NotUtf16Units()
    {
        // 280 astral emoji = 560 UTF-16 units but 280 characters to a controller.
        var emoji = string.Concat(Enumerable.Repeat("\U0001F6B0", 280));

        InjectItemValidator.Parse(PostItem(posts: [Post(text: emoji)])).Error.Should().BeNull();
        InjectItemValidator.Parse(PostItem(posts: [Post(text: emoji + "\U0001F6B0")])).Error.Should().Contain("280");
        InjectItemValidator.CodePoints(emoji).Should().Be(280);
    }

    [Fact]
    public void FreeText_IsSanitizedOnWrite_StripNotEncode()
    {
        var parse = InjectItemValidator.Parse(PostItem(
            title: "<b>Beat 3</b>",
            notes: "<script>alert(1)</script>cue on PIO",
            posts: [Post(text: "Brown water <img src=x onerror=alert(1)>again", media: [M("m1", alt: "<i>tap</i> water")])]));

        parse.Error.Should().BeNull();
        parse.Draft!.Title.Should().Be("Beat 3");
        parse.Draft.Notes.Should().Be("cue on PIO");
        parse.Draft.Posts[0].Text.Should().Be("Brown water again");
        parse.Draft.Posts[0].Media[0].Alt.Should().Be("tap water");
    }

    [Fact]
    public void TextThatSanitizesToNothing_IsRefused()
    {
        InjectItemValidator.Parse(PostItem(posts: [Post(text: "<script>x</script>")])).Error.Should().Contain("text");
    }

    [Fact]
    public void AReplyToAnEarlierSiblingBySequence_Parses()
    {
        var parse = InjectItemValidator.Parse(BurstItem(Post(), Post(replyTo: new() { Sequence = 1 })));

        parse.Error.Should().BeNull();
        parse.Draft!.Posts[1].ReplyToSequence.Should().Be(1);
        parse.Draft.Posts[1].ReplyToInjectPostId.Should().BeNull();
    }

    [Fact]
    public void ABurstOfTwentyAtTheMinimumWindow_IsAccepted()
    {
        InjectItemValidator.Parse(BurstItem(20, window: 57)).Error.Should().BeNull();
    }

    // ---- references (phase 2) ----

    [Fact]
    public void Alt_IsMeasuredInUtf16UnitsAfterSanitizing_LikeTheFunnel()
    {
        // 600 astral characters are 1200 UTF-16 units — over the funnel's 1000, so authoring refuses it too.
        var alt = string.Concat(Enumerable.Repeat("\U0001F6B0", 600));

        InjectItemValidator.Parse(PostItem(posts: [Post(media: [M("m1", alt: alt)])])).Error
            .Should().Be("Post 1: alt text must be at most 1000 characters.");
    }

    public static TheoryData<string, string[], string?> MediaKindCases() => new()
    {
        { "four images", ["image", "image", "image", "image"], null },
        { "one video", ["video"], null },
        { "two videos", ["video", "video"], InjectItemValidator.MediaCountMessage },
        { "image and video", ["image", "video"], InjectItemValidator.MediaCountMessage },
        { "an unknown kind", ["audio"], InjectItemValidator.MediaCountMessage },
    };

    [Theory]
    [MemberData(nameof(MediaKindCases))]
    public void MediaKinds_AreUpToFourImagesOrExactlyOneVideo_NeverMixed(string because, string[] kinds, string? expected)
    {
        var media = kinds.Select((_, index) => (InjectMediaWriteRequest?)M($"kind-{because}-{index}")).ToArray();
        var draft = InjectItemValidator.Parse(PostItem(posts: [Post(media: media)])).Draft!;
        var library = kinds.Select((kind, index) => (Id: MediaId($"kind-{because}-{index}"), Kind: kind))
            .ToDictionary(entry => entry.Id, entry => entry.Kind);

        var error = InjectItemValidator.CheckReferences(draft, Facts(mediaKinds: library));

        if (expected is null)
        {
            error.Should().BeNull(because);
        }
        else
        {
            error.Should().Be($"Post 1: {expected}", because);
        }
    }

    [Fact]
    public void AnUnknownMediaId_AndAnotherExercisesMediaId_GetTheSameMessage()
    {
        var draft = InjectItemValidator.Parse(PostItem(posts: [Post(media: [M("not-in-this-library")])])).Draft!;

        // The library holds only assets the service found INSIDE the scope, so a cross-exercise id is unknown here.
        InjectItemValidator.CheckReferences(draft, Facts(mediaKinds: [])).Should()
            .Be("Post 1: One or more media items could not be found.");
    }

    [Fact]
    public void AnUnknownPersona_AndAnotherExercisesPersona_GetTheSameMessage()
    {
        var draft = InjectItemValidator.Parse(PostItem()).Draft!;

        // Neither id is in the in-scope set — the service only ever puts ids it found INSIDE the scope there, so an
        // unknown id and a cross-exercise id are the same input to this check, by construction.
        var message = InjectItemValidator.CheckReferences(draft, Facts(personas: []));

        message.Should().Be("Post 1: personaId does not name a persona in this exercise.");
    }

    [Fact]
    public void AnAssigneeOffTheRoster_IsRefused()
    {
        var assignee = Guid.NewGuid();
        var draft = InjectItemValidator.Parse(PostItem(assigneeId: assignee.ToString())).Draft!;

        InjectItemValidator.CheckReferences(draft, Facts(roster: [])).Should().Contain("assigneeId does not name");
        InjectItemValidator.CheckReferences(draft, Facts(roster: [assignee])).Should().BeNull();
    }

    [Fact]
    public void AReplyToAScriptedPostInAnotherLiveItem_IsAccepted_AndAnUnknownOneIsNot()
    {
        var target = Guid.NewGuid();
        var draft = InjectItemValidator.Parse(PostItem(posts: [Post(replyTo: new() { InjectPostId = target.ToString() })])).Draft!;

        InjectItemValidator.CheckReferences(draft, Facts(targets: new() { [target] = Guid.NewGuid() })).Should().BeNull();
        InjectItemValidator.CheckReferences(draft, Facts()).Should()
            .Be("Post 1: replyTo.injectPostId does not name a scripted post in this exercise.");
    }

    [Fact]
    public void OnEdit_AReplyToAnEchoedSibling_MustComeEarlierInTheNewOrder()
    {
        var itemId = Guid.NewGuid();
        var siblings = new List<Guid> { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        var facts = Facts(targets: siblings.ToDictionary(id => id, _ => itemId), editedItemId: itemId, editedChildren: [.. siblings]);

        // The new order is siblings 2, 0, 1 — so sibling 2 is now FIRST.
        InjectItemDraft Draft(int replyingPosition, Guid target) => InjectItemValidator.Parse(BurstItem(
            Enumerable.Range(0, 3)
                .Select(index => Post(
                    id: siblings[(index + 2) % 3].ToString(),
                    replyTo: index == replyingPosition ? new() { InjectPostId = target.ToString() } : null))
                .ToArray())).Draft!;

        InjectItemValidator.CheckReferences(Draft(1, siblings[2]), facts).Should().BeNull("sibling 2 moved to position 1");
        InjectItemValidator.CheckReferences(Draft(0, siblings[0]), facts).Should().Contain("earlier post", "sibling 0 is now second");
        InjectItemValidator.CheckReferences(Draft(1, siblings[0]), facts).Should().Contain("earlier post", "a post cannot reply to itself");
    }

    [Fact]
    public void OnEdit_AReplyToASiblingThisEditRemoves_IsUnknown()
    {
        var itemId = Guid.NewGuid();
        var kept = Guid.NewGuid();
        var removed = Guid.NewGuid();
        var draft = InjectItemValidator.Parse(BurstItem(
            Post(id: kept.ToString()),
            Post(replyTo: new() { InjectPostId = removed.ToString() }))).Draft!;

        var facts = Facts(
            targets: new() { [kept] = itemId, [removed] = itemId },
            editedItemId: itemId,
            editedChildren: [kept, removed]);

        InjectItemValidator.CheckReferences(draft, facts).Should().Contain("does not name a scripted post");
    }

    [Fact]
    public void OnEdit_AReplyToAPreviouslySoftDeletedPositionOfTheSameItem_IsUnknown()
    {
        var itemId = Guid.NewGuid();
        var softDeleted = Guid.NewGuid();
        var draft = InjectItemValidator.Parse(PostItem(posts: [Post(replyTo: new() { InjectPostId = softDeleted.ToString() })])).Draft!;

        var facts = Facts(targets: new() { [softDeleted] = itemId }, editedItemId: itemId, editedChildren: [Guid.NewGuid()]);

        InjectItemValidator.CheckReferences(draft, facts).Should().Contain("does not name a scripted post");
    }

    [Fact]
    public void AChildId_ThatIsNotALiveChildOfThisItem_GetsOneMessage_OnCreateOrEdit()
    {
        var foreign = Guid.NewGuid();
        var draft = InjectItemValidator.Parse(PostItem(posts: [Post(id: foreign.ToString())])).Draft!;
        const string Expected = "Post 1: id does not name a post of this item.";

        InjectItemValidator.CheckReferences(draft, Facts()).Should().Be(Expected, "on create no child exists yet");
        InjectItemValidator.CheckReferences(draft, Facts(editedItemId: Guid.NewGuid(), editedChildren: [Guid.NewGuid()]))
            .Should().Be(Expected, "another item's child, or nothing at all, reads the same (COR-001)");
        InjectItemValidator.CheckReferences(draft, Facts(editedItemId: Guid.NewGuid(), editedChildren: [foreign]))
            .Should().BeNull("this item's own child keeps its identity");
    }

    // ---- builders ----

    private static InjectReferenceFacts Facts(
        Guid[]? personas = null,
        Guid[]? roster = null,
        Dictionary<Guid, Guid>? targets = null,
        Guid? editedItemId = null,
        HashSet<Guid>? editedChildren = null,
        Dictionary<Guid, string>? mediaKinds = null) =>
        new(
            (personas ?? [Persona]).ToHashSet(),
            (roster ?? []).ToHashSet(),
            targets ?? [],
            editedItemId,
            editedChildren ?? [],
            mediaKinds ?? []);

    private static readonly string SharedId = Guid.NewGuid().ToString();

    private static string G() => Guid.NewGuid().ToString();

    private static InjectItemWriteRequest PostItem(
        string? kind = InjectKinds.Post,
        string? title = "Beat 3 photo",
        string? notes = null,
        int? plannedMinute = 12,
        string? assigneeId = null,
        InjectPostWriteRequest?[]? posts = null) => new()
        {
            Kind = kind,
            Title = title,
            Notes = notes,
            PlannedMinute = plannedMinute,
            AssigneeId = assigneeId,
            Posts = posts ?? [Post()],
        };

    private static InjectItemWriteRequest BurstItem(int count, int? window = null, InjectPostWriteRequest? second = null) => new()
    {
        Kind = InjectKinds.Burst,
        Title = "Pile-on",
        BurstWindowSeconds = window,
        Posts = Enumerable.Range(0, count).Select(index => index == 1 && second is not null ? second : Post()).ToArray(),
    };

    private static InjectItemWriteRequest BurstItem(params InjectPostWriteRequest[] posts) => new()
    {
        Kind = InjectKinds.Burst,
        Title = "Pile-on",
        Posts = posts,
    };

    private static InjectPostWriteRequest Post(
        string? personaId = null,
        string? id = null,
        string? text = "The water from my tap is BROWN #WaterIssues",
        InjectMediaWriteRequest?[]? media = null,
        InjectReplyToWriteRequest? replyTo = null,
        InjectEngagementBaselineWriteRequest? baseline = null) => new()
        {
            Id = id,
            PersonaId = personaId ?? Persona.ToString(),
            Text = text,
            Media = media,
            ReplyTo = replyTo,
            EngagementBaseline = baseline,
        };

    private static readonly Dictionary<string, Guid> MediaIds = [];

    /// <summary>A stable GUID per test key, so "m1" twice is the same asset.</summary>
    private static Guid MediaId(string key)
    {
        lock (MediaIds)
        {
            if (!MediaIds.TryGetValue(key, out var id))
            {
                id = Guid.NewGuid();
                MediaIds[key] = id;
            }

            return id;
        }
    }

    private static InjectMediaWriteRequest M(string key, string alt = "Brown tap water in a glass") =>
        new() { MediaId = MediaId(key).ToString(), Alt = alt };

    private static InjectMediaWriteRequest?[] Media(int count) =>
        Enumerable.Range(0, count).Select(index => (InjectMediaWriteRequest?)M($"m{index}")).ToArray();
}
