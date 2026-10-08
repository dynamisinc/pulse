namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP write rules for <c>POST /api/posts</c>: the media count/kind/alt/duplicate matrix, the DP-6
/// legacy placeholder, the staff-only engagement baseline, the reply seam, the single unit of work, the one
/// telemetry event per create, and the 201 / broadcast shapes.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaWriteTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostMediaWriteTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Media on write" — the accepted shapes
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task FourOwnImages_Return201_StoreFourOrderedItems_InTheSameUnitOfWork_WithSanitizedAlt()
    {
        var world = await SeedWorldAsync(_fixture);
        var images = new List<MediaAsset>();
        for (var i = 0; i < 4; i++)
        {
            images.Add(await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman));
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var media = images.Select((img, i) => Item(img.Id, alt: i == 0 ? "<script>alert(1)</script>Flooded <b>street</b>" : $"photo {i}")).ToArray();
        var response = await client.PostAsync(PostsUri, Json(Body(media: media)));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        var postId = Guid.Parse(document.RootElement.GetProperty("id").GetString()!);

        await using var read = _fixture.CreateContext();
        var items = await read.PostMediaItems.IgnoreQueryFilters().Where(i => i.PostId == postId).OrderBy(i => i.Order).ToListAsync();
        items.Select(i => i.MediaAssetId).Should().Equal(images.Select(i => i.Id), "items keep the request order");
        items.Select(i => i.Order).Should().Equal(0, 1, 2, 3);
        items.Should().AllSatisfy(i => i.ExerciseId.Should().Be(world.Exercise, "each item is stamped with the post's scope (DP-2)"));
        items[0].Alt.Should().Be("Flooded street", "alt text is sanitized on ingest — strip, never encode (NFR-004)");

        // The 201 is the participant projection, media in order with signed URLs.
        var wireMedia = document.RootElement.GetProperty("media").EnumerateArray().ToArray();
        wireMedia.Select(m => m.GetProperty("id").GetString()).Should().Equal(images.Select(i => i.Id.ToString()));
        wireMedia[0].GetProperty("url").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(images[0].Id));
        wireMedia[0].GetProperty("alt").GetString().Should().Be("Flooded street");
        factory.Signer.Calls.Should().ContainSingle("one batched signer call per projection, never one per item");
    }

    [RequiresDockerFact]
    public async Task OneVideo_WithAPosterOverride_Returns201_AndProjectsThePosterUrl()
    {
        var world = await SeedWorldAsync(_fixture);
        var video = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, world.ParticipantHuman);
        var poster = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(video.Id, posterMediaId: poster.Id) })));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        var item = document.RootElement.GetProperty("media").EnumerateArray().Single();
        item.GetProperty("kind").GetString().Should().Be("video");
        item.GetProperty("posterUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(poster.Id));
        item.GetProperty("durationSec").GetDouble().Should().Be(12.5);

        await using var read = _fixture.CreateContext();
        var stored = await read.PostMediaItems.IgnoreQueryFilters().SingleAsync(i => i.MediaAssetId == video.Id);
        stored.PosterMediaAssetId.Should().Be(poster.Id);
    }

    [RequiresDockerFact]
    public async Task OneVideo_WithoutAnOverride_UsesTheAssetsOwnPoster()
    {
        var world = await SeedWorldAsync(_fixture);
        var poster = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        var video = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, world.ParticipantHuman, posterId: poster.Id);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(video.Id) })));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        document.RootElement.GetProperty("media")[0].GetProperty("posterUrl").GetString()
            .Should().Be(FakeMediaUrlSigner.UrlFor(poster.Id), "a library video keeps its own poster (DP-3)");
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Media on write" — the refusals (each writes nothing)
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task CountKindAltAndDuplicateViolations_AreEach400_AndWriteNothing()
    {
        var world = await SeedWorldAsync(_fixture);
        var human = world.ParticipantHuman;
        var images = new List<MediaAsset>();
        for (var i = 0; i < 5; i++)
        {
            images.Add(await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, human));
        }

        var videoA = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, human);
        var videoB = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, human);

        var cases = new (string Name, object Media)[]
        {
            ("five images", images.Select(i => Item(i.Id)).ToArray()),
            ("two videos", new[] { Item(videoA.Id), Item(videoB.Id) }),
            ("a video mixed with an image", new[] { Item(videoA.Id), Item(images[0].Id) }),
            ("missing alt", new[] { new { mediaId = images[0].Id.ToString() } }),
            ("whitespace alt", new[] { Item(images[0].Id, alt: "   ") }),
            ("alt that sanitizes to nothing", new[] { Item(images[0].Id, alt: "<b></b><script>x</script>") }),
            ("alt over 1000 characters", new[] { Item(images[0].Id, alt: new string('a', 1001)) }),
            ("a duplicate mediaId", new[] { Item(images[0].Id), Item(images[0].Id, alt: "again") }),
            ("an unparseable mediaId", new[] { new { mediaId = "not-a-guid", alt = "x" } }),
            ("a poster on an image", new[] { Item(images[0].Id, posterMediaId: images[1].Id) }),
            ("a video as a poster", new[] { Item(videoA.Id, posterMediaId: videoB.Id) }),
        };

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        foreach (var (name, media) in cases)
        {
            var response = await client.PostAsync(PostsUri, Json(Body(media: media)));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "{0} must be refused", name);
        }

        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((0, 0, 0), "no refused case wrote a post, item or event");
        factory.Broadcaster.Calls.Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task AltOfExactly1000Characters_IsAccepted()
    {
        var world = await SeedWorldAsync(_fixture);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(image.Id, alt: new string('a', 1000)) })));
        response.StatusCode.Should().Be(HttpStatusCode.Created, "1..1000 is inclusive");
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Legacy placeholder compatibility (DP-6)"
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task LegacyPlaceholders_WithNoMediaIdOnAnyEntry_AreIgnored_AndThePostIsCreatedAsText()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var legacy = new[] { new { kind = "image", alt = "photo of the river" }, new { kind = "image", alt = "second" } };
        var response = await client.PostAsync(PostsUri, Json(Body(text: "legacy client post", media: legacy)));

        response.StatusCode.Should().Be(HttpStatusCode.Created, "the pre-demo frontend's placeholders must not break posting (DP-6)");
        using var document = await ReadJsonAsync(response);
        document.RootElement.TryGetProperty("media", out _).Should().BeFalse("the placeholders are ignored, not stored");
        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((1, 0, 1), "a text post and its one event, no items");
    }

    [RequiresDockerFact]
    public async Task LegacyPlaceholder_MixedWithARealAttachment_Is400_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var mixed = new object[] { new { kind = "image", alt = "legacy" }, Item(image.Id) };
        var response = await client.PostAsync(PostsUri, Json(Body(media: mixed)));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((0, 0, 0));
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Baseline is staff-only"
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task StaffBaseline_IsStored_AndTheStaff201CountsAreBaselinePlusZero()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var response = await client.PostAsync(
            PostsUri, Json(StaffBody(world, engagementBaseline: new { like = 1450, repost = 999, reply = 12 })));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        var counts = document.RootElement.GetProperty("counts");
        counts.GetProperty("like").GetInt32().Should().Be(1450);
        counts.GetProperty("repost").GetInt32().Should().Be(999);
        counts.GetProperty("reply").GetInt32().Should().Be(12);
        document.RootElement.GetProperty("origin").GetString().Should().Be("controller-as-persona", "the staff shape");

        var postId = Guid.Parse(document.RootElement.GetProperty("id").GetString()!);
        await using var read = _fixture.CreateContext();
        var stored = await read.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);
        (stored.BaselineLikeCount, stored.BaselineRepostCount, stored.BaselineReplyCount).Should().Be((1450, 999, 12));

        // The broadcast carries the summed counts, never the baseline fields.
        var broadcastJson = JsonSerializer.Serialize(factory.Broadcaster.Calls.Single().Post);
        broadcastJson.Should().Contain("\"like\":1450").And.NotContainAny("baseline", "Baseline");
    }

    [RequiresDockerFact]
    public async Task StaffBaseline_PartialValues_DefaultTheRestToZero()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var response = await client.PostAsync(PostsUri, Json(StaffBody(world, engagementBaseline: new { like = 1000000 })));

        response.StatusCode.Should().Be(HttpStatusCode.Created, "1,000,000 is the inclusive upper bound");
        using var document = await ReadJsonAsync(response);
        var counts = document.RootElement.GetProperty("counts");
        (counts.GetProperty("like").GetInt32(), counts.GetProperty("repost").GetInt32(), counts.GetProperty("reply").GetInt32())
            .Should().Be((1000000, 0, 0));
    }

    [RequiresDockerFact]
    public async Task StaffBaseline_OutOfRange_Is400_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        foreach (var baseline in new object[] { new { like = -1 }, new { repost = 1000001 }, new { reply = -5 } })
        {
            (await client.PostAsync(PostsUri, Json(StaffBody(world, engagementBaseline: baseline)))).StatusCode
                .Should().Be(HttpStatusCode.BadRequest, "baseline values are 0..1,000,000");
        }

        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((0, 0, 0));
    }

    [RequiresDockerFact]
    public async Task ParticipantBaseline_IsIgnored_EvenWhenOutOfRange()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var inRange = await client.PostAsync(PostsUri, Json(Body(engagementBaseline: new { like = 5000, repost = 10, reply = 3 })));
        var outOfRange = await client.PostAsync(PostsUri, Json(Body(engagementBaseline: new { like = -7 })));

        inRange.StatusCode.Should().Be(HttpStatusCode.Created, "a participant's baseline is ignored, not judged");
        outOfRange.StatusCode.Should().Be(HttpStatusCode.Created, "ignored means ignored — not even validated");

        await using var read = _fixture.CreateContext();
        var stored = await read.Posts.IgnoreQueryFilters().Where(p => p.ExerciseId == world.Exercise).ToListAsync();
        stored.Should().HaveCount(2).And.AllSatisfy(p =>
            (p.BaselineLikeCount, p.BaselineRepostCount, p.BaselineReplyCount).Should().Be((0, 0, 0)));

        using var document = await ReadJsonAsync(inRange);
        document.RootElement.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(0);
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Reply write via the seam" + telemetry
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ResolvedReply_SetsParentPostId_EmitsOneReplyEvent_AndCarriesInReplyTo()
    {
        var world = await SeedWorldAsync(_fixture);
        var parent = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(text: "Is this true?", parentPostId: parent.Id.ToString())));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        var replyId = document.RootElement.GetProperty("id").GetString()!;
        var inReplyTo = document.RootElement.GetProperty("inReplyTo");
        inReplyTo.GetProperty("postId").GetString().Should().Be(parent.Id.ToString());
        inReplyTo.GetProperty("authorHandle").GetString().Should().Be($"p_{world.StaffPersona:N}", "no leading '@'");

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == Guid.Parse(replyId))).ParentPostId.Should().Be(parent.Id);

        var events = await read.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.Target != null && e.Target.EntityId == replyId).ToListAsync();
        var replyEvent = events.Should().ContainSingle("exactly one event per create").Subject;
        replyEvent.EventType.Should().Be("reply");
        replyEvent.Target!.EntityType.Should().Be("post");
        using var payload = JsonDocument.Parse(replyEvent.Payload!);
        payload.RootElement.GetProperty("parentPostId").GetString().Should().Be(parent.Id.ToString());

        var broadcast = factory.Broadcaster.Calls.Should().ContainSingle().Subject.Post;
        broadcast.InReplyTo.Should().Be(new PostInReplyToDto(parent.Id.ToString(), $"p_{world.StaffPersona:N}"),
            "PostReceived carries replies too, with inReplyTo");
        broadcast.Viewer.Should().BeNull("a broadcast never carries viewer state");
    }

    [RequiresDockerFact]
    public async Task UnknownOrSoftDeletedParent_IsTheSame400_AndWritesNothing()
    {
        var world = await SeedWorldAsync(_fixture);
        var deleted = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, deletedAt: BaseScenarioTime);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var toDeleted = await client.PostAsync(PostsUri, Json(Body(parentPostId: deleted.Id.ToString())));
        var toUnknown = await client.PostAsync(PostsUri, Json(Body(parentPostId: Guid.NewGuid().ToString())));
        var unparseable = await client.PostAsync(PostsUri, Json(Body(parentPostId: "nope")));

        foreach (var response in new[] { toDeleted, toUnknown, unparseable })
        {
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        var text = await toUnknown.Content.ReadAsStringAsync();
        (await toDeleted.Content.ReadAsStringAsync()).Should().Be(text, "deleted and unknown are indistinguishable");
        (await unparseable.Content.ReadAsStringAsync()).Should().Be(text);
        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((1, 0, 0), "only the seeded parent exists");
    }

    [RequiresDockerFact]
    public async Task WithOnlyTheFallbackResolver_ANonEmptyParentPostId_Is400_NotASilentTopLevelPost()
    {
        var world = await SeedWorldAsync(_fixture);
        var parent = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime);

        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!, keepFallbackResolver: true);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var reply = await client.PostAsync(PostsUri, Json(Body(parentPostId: parent.Id.ToString())));
        var topLevel = await client.PostAsync(PostsUri, Json(Body(parentPostId: string.Empty)));

        reply.StatusCode.Should().Be(HttpStatusCode.BadRequest, "until B2's resolver is registered, replies are refused");
        topLevel.StatusCode.Should().Be(HttpStatusCode.Created, "an EMPTY parentPostId is simply a top-level post");

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == world.Exercise && p.ParentPostId != null))
            .Should().Be(0, "nothing was written as a reply, and nothing was silently written top-level for the refused one");
        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((2, 0, 1));
    }

    [RequiresDockerFact]
    public async Task MediaPost_EmitsExactlyOnePostEvent_NotOnePerItem()
    {
        var world = await SeedWorldAsync(_fixture);
        var first = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        var second = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(first.Id), Item(second.Id) })));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        await using var read = _fixture.CreateContext();
        var events = await read.TelemetryEvents.IgnoreQueryFilters()
            .Where(e => e.ExerciseId == world.Exercise && e.Target != null && e.Target.EntityType == "post").ToListAsync();
        events.Should().ContainSingle().Which.EventType.Should().Be("post");
        events[0].Payload.Should().BeNull("a top-level post's event carries no reply payload");
    }

    // ---------------------------------------------------------------------------------------------
    // AC "Realtime and responses"
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Staff201_IsTheStaffShape_WithMediaAndInReplyTo_AndTheBroadcastIsTheParticipantProjection()
    {
        var world = await SeedWorldAsync(_fixture);
        var parent = await SeedPostAsync(_fixture, world.Exercise, world.ParticipantPersona, BaseScenarioTime);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "some-other-human");

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var response = await client.PostAsync(
            PostsUri, Json(StaffBody(world, media: new[] { Item(image.Id) }, parentPostId: parent.Id.ToString())));

        response.StatusCode.Should().Be(HttpStatusCode.Created, "staff may attach any in-exercise asset (no own-uploads rule)");
        using var document = await ReadJsonAsync(response);
        var root = document.RootElement;
        root.GetProperty("actingHumanId").GetString().Should().Be(world.StaffUserId.ToString(), "staff keeps its provenance");
        root.GetProperty("media")[0].GetProperty("url").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(image.Id));
        root.GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(parent.Id.ToString());

        var broadcast = factory.Broadcaster.Calls.Should().ContainSingle().Subject;
        broadcast.ExerciseId.Should().Be(world.Exercise);
        broadcast.Post.Media.Should().ContainSingle().Which.Url.Should().Be(FakeMediaUrlSigner.UrlFor(image.Id));
        broadcast.Post.InReplyTo!.PostId.Should().Be(parent.Id.ToString());
        broadcast.Post.Viewer.Should().BeNull();
        broadcast.Post.GetType().Should().Be(typeof(ParticipantPostDto), "the broadcast is the participant shape, never the staff one");
    }

    [RequiresDockerFact]
    public async Task Participant201_IsTheSameProjectionThatWasBroadcast()
    {
        var world = await SeedWorldAsync(_fixture);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var response = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(image.Id) })));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await response.Content.ReadAsStringAsync();
        var broadcast = JsonSerializer.Serialize(factory.Broadcaster.Calls.Single().Post, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        body.Should().Be(broadcast, "the participant 201 and PostReceived are one projection");
    }

    // ---------------------------------------------------------------------------------------------
    // Service level: the single unit of work, and the five-argument constructor
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AFailureWhileWritingTheMediaItems_RollsBackThePostAndItsEvent_PostItemsAndEventOrNothing()
    {
        var exerciseId = Guid.NewGuid();
        var human = "participant-human-uow";
        var image = await SeedAssetAsync(_fixture, exerciseId, MediaKinds.Image, human);

        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        var options = new DbContextOptionsBuilder<PulseDbContext>()
            .UseSqlServer(_fixture.ConnectionString!)
            .AddInterceptors(new FailAfterMediaItemInsertInterceptor())
            .Options;
        await using var context = new PulseDbContext(options, scope);
        var service = new PostIngestService(context, scope, new FakeFeedBroadcaster());

        var request = new CreatePostRequest
        {
            Text = "all or nothing",
            ScenarioTime = "2033-06-14T09:00:00-05:00",
            TimeZone = "America/Chicago",
            Media = [new CreatePostMediaRequest(image.Id.ToString(), "alt", null)],
        };
        var attribution = new PostAttribution { AuthorPersonaId = Guid.NewGuid(), Origin = "participant", ActingHumanId = human };

        var ingest = () => service.IngestAsync(request, attribution);

        (await ingest.Should().ThrowAsync<Exception>()).Which.ToString().Should().Contain(
            "simulated failure", "the failure is the interceptor's, raised after the item INSERT ran");
        (await CountRowsAsync(_fixture, exerciseId)).Should().Be(
            (0, 0, 0), "the post, its items and its event commit in ONE SaveChanges — a failure leaves nothing");
    }

    [RequiresDockerFact]
    public async Task TheFiveArgumentConstructor_StillCompiles_AndKeepsTodaysBroadcast_AndRefusesReplies()
    {
        var exerciseId = Guid.NewGuid();
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        await using var context = _fixture.CreateContext(scope);
        var broadcaster = new FakeFeedBroadcaster();
        var service = new PostIngestService(
            context, scope, broadcaster, Array.Empty<IPostPublishedObserver>(), NullLogger<PostIngestService>.Instance);

        var attribution = new PostAttribution { AuthorPersonaId = Guid.NewGuid(), Origin = "engine", ActingHumanId = string.Empty };
        var request = new CreatePostRequest { Text = "engine post", ScenarioTime = "2033-06-14T09:00:00-05:00", TimeZone = "America/Chicago" };

        var created = await service.IngestAsync(request, attribution);
        created.Outcome.Should().Be(PostIngestOutcome.Created);
        JsonSerializer.Serialize(broadcaster.Calls.Single().Post).Should().Be(
            JsonSerializer.Serialize(ParticipantPostDto.FromPost(created.Post!)), "no projector => today's FromPost payload");

        var reply = new CreatePostRequest
        {
            Text = "reply",
            ScenarioTime = "2033-06-14T09:00:00-05:00",
            TimeZone = "America/Chicago",
            ParentPostId = created.Post!.Id.ToString(),
        };
        var refused = await service.IngestAsync(reply, attribution);
        refused.Outcome.Should().Be(PostIngestOutcome.Invalid, "with no resolver, a non-empty parentPostId is a 400");
        (await CountRowsAsync(_fixture, exerciseId)).Posts.Should().Be(1);
    }

    // ---------------------------------------------------------------------------------------------
    // Gate-1 M-1 — a projection failure after the commit never fails the write
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AThrowingProjector_AfterTheCommit_StillAnswers201_Broadcasts_AndWritesExactlyOnePost()
    {
        var world = await SeedWorldAsync(_fixture);
        var parent = await SeedPostAsync(_fixture, world.Exercise, world.ParticipantPersona, BaseScenarioTime);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "any-uploader");

        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!, throwingProjector: true);
        using var client = factory.CreateClientFor(world.Host, world.StaffToken);

        var response = await client.PostAsync(PostsUri, Json(StaffBody(
            world,
            text: "PROJECTION-FAILS",
            media: new[] { Item(image.Id) },
            parentPostId: parent.Id.ToString(),
            engagementBaseline: new { like = 50 })));

        response.StatusCode.Should().Be(HttpStatusCode.Created, "the post is committed — a 500 would make the client retry and duplicate it");
        using var document = await ReadJsonAsync(response);
        document.RootElement.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(50, "the fallback keeps the baseline counts");
        document.RootElement.GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(parent.Id.ToString());

        var broadcast = factory.Broadcaster.Calls.Should().ContainSingle("the committed post is still broadcast").Subject.Post;
        broadcast.Text.Should().Be("PROJECTION-FAILS");
        broadcast.Counts.Should().Be(new ParticipantPostCounts(0, 0, 50));
        broadcast.InReplyTo.Should().Be(new PostInReplyToDto(parent.Id.ToString(), $"p_{world.ParticipantPersona:N}"),
            "the fallback carries the inReplyTo resolved before the commit");
        broadcast.Media.Should().BeNull("the fallback mints no URLs");
        broadcast.Viewer.Should().BeNull();

        await using var read = _fixture.CreateContext();
        (await read.Posts.IgnoreQueryFilters().CountAsync(p => p.Body == "PROJECTION-FAILS" && p.ExerciseId == world.Exercise))
            .Should().Be(1, "exactly one post row");
        (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((2, 1, 1), "the seeded parent, plus the new post, its item and its event");
    }

    [RequiresDockerFact]
    public async Task AProjectionFailure_IsLoggedAsAWarning_ButCancellationStillPropagates()
    {
        var exerciseId = Guid.NewGuid();
        var parent = await SeedPostAsync(_fixture, exerciseId, Guid.NewGuid(), BaseScenarioTime);
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        var attribution = new PostAttribution { AuthorPersonaId = Guid.NewGuid(), Origin = "engine", ActingHumanId = string.Empty };
        CreatePostRequest Reply(string text) => new()
        {
            Text = text,
            ScenarioTime = "2033-06-14T09:00:00-05:00",
            TimeZone = "America/Chicago",
            ParentPostId = parent.Id.ToString(),
        };

        await using (var context = _fixture.CreateContext(scope))
        {
            var logger = new CapturingLogger<PostIngestService>();
            var service = new PostIngestService(
                context, scope, new FakeFeedBroadcaster(), null, logger,
                new FakeReplyParentResolver(context, new ResolverProbe()), new ThrowingProjector(new InvalidOperationException("db gone")));

            var result = await service.IngestAsync(Reply("logged"), attribution);

            result.Outcome.Should().Be(PostIngestOutcome.Created);
            result.ParticipantView!.InReplyTo!.PostId.Should().Be(parent.Id.ToString());
            logger.Entries.Should().ContainSingle(e => e.Level == LogLevel.Warning && e.EventId.Id == 3)
                .Which.Message.Should().Contain(result.Post!.Id.ToString());
        }

        await using (var context = _fixture.CreateContext(scope))
        {
            var service = new PostIngestService(
                context, scope, new FakeFeedBroadcaster(), null, null,
                new FakeReplyParentResolver(context, new ResolverProbe()), new ThrowingProjector(new OperationCanceledException()));

            var ingest = () => service.IngestAsync(Reply("cancelled"), attribution);

            await ingest.Should().ThrowAsync<OperationCanceledException>("cancellation is never swallowed as a projection fault");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Gate-1 L-1 — a post with no media and no parent skips the projector, with identical output
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ATextOnlyPost_SkipsTheProjector_AndItsPayloadIsIdenticalToTheProjectorsOutput()
    {
        var exerciseId = Guid.NewGuid();
        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        await using var context = _fixture.CreateContext(scope);
        var projector = new CountingProjector(new ParticipantPostProjector(
            context, scope, new ZeroPostEngagementReader(), new FakeMediaUrlSigner(scope, new SignerProbe())));
        var broadcaster = new FakeFeedBroadcaster();
        var service = new PostIngestService(
            context, scope, broadcaster, null, null, new FakeReplyParentResolver(context, new ResolverProbe()), projector);

        var staff = new PostAttribution { AuthorPersonaId = Guid.NewGuid(), Origin = "controller-as-persona", ActingHumanId = "staff-1" };
        var textOnly = await service.IngestAsync(
            new CreatePostRequest
            {
                Text = "text only, with a baseline",
                ScenarioTime = "2033-06-14T09:00:00-05:00",
                TimeZone = "America/Chicago",
                EngagementBaseline = new EngagementBaselineRequest(Like: 1450, Repost: 999, Reply: 12),
            },
            staff);

        textOnly.Outcome.Should().Be(PostIngestOutcome.Created);
        projector.Calls.Should().Be(0, "nothing to sign and no parent to name — the projector's queries would buy nothing");

        var projected = (await projector.ProjectAsync([textOnly.Post!], new PostProjectionOptions(), default))[0];
        JsonSerializer.Serialize(broadcaster.Calls.Single().Post).Should().Be(
            JsonSerializer.Serialize(projected), "the skipped path is byte-identical to what the projector would have produced");
        JsonSerializer.Serialize(textOnly.ParticipantView).Should().Be(JsonSerializer.Serialize(projected));

        // A reply still goes through the projector.
        var reply = await service.IngestAsync(
            new CreatePostRequest
            {
                Text = "a reply",
                ScenarioTime = "2033-06-14T09:05:00-05:00",
                TimeZone = "America/Chicago",
                ParentPostId = textOnly.Post!.Id.ToString(),
            },
            staff);
        reply.Outcome.Should().Be(PostIngestOutcome.Created);
        projector.Calls.Should().Be(2, "the reply was projected (plus the one direct call above)");
    }

    // ---------------------------------------------------------------------------------------------
    // Gate-1 M-2 — markup that a single strip pass would rebuild, in the body AND the alt text
    // ---------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task TagRebuildingPayloads_InTheBodyAndTheAlt_AreStrippedUntilInert()
    {
        var world = await SeedWorldAsync(_fixture);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        const string rebuildImg = "<<b>img src=x onerror=alert(1)>";
        const string rebuildSvg = "<<i></i>svg onload=alert(2)>";
        var response = await client.PostAsync(PostsUri, Json(Body(
            text: $"Body {rebuildImg} and {rebuildSvg} end",
            media: new[] { Item(image.Id, alt: $"Alt {rebuildImg} and {rebuildSvg} end") })));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var document = await ReadJsonAsync(response);
        var postId = Guid.Parse(document.RootElement.GetProperty("id").GetString()!);

        await using var read = _fixture.CreateContext();
        var stored = await read.Posts.IgnoreQueryFilters().SingleAsync(p => p.Id == postId);
        var alt = (await read.PostMediaItems.IgnoreQueryFilters().SingleAsync(i => i.PostId == postId)).Alt;

        foreach (var (name, value) in new[] { ("body", stored.Body), ("alt", alt) })
        {
            value.Should().NotContain("<", "no tag may be rebuilt in the stored {0}", name);
            value.Should().NotContain("onerror").And.NotContain("onload");
        }

        stored.Body.Should().Be("Body  and  end");
        alt.Should().Be("Alt  and  end");
    }

    private PostMediaWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
    }

    /// <summary>
    /// Lets the INSERT into <c>PostMediaItems</c> execute, then throws — so the rows really were sent, and only the
    /// transaction can explain them not being there afterwards.
    /// </summary>
    private sealed class FailAfterMediaItemInsertInterceptor : DbCommandInterceptor
    {
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("[PostMediaItems]", StringComparison.Ordinal))
            {
                // Close the reader first so the rollback can run on the connection.
                await result.DisposeAsync();
                throw new InvalidOperationException("simulated failure after the media items were inserted");
            }

            return await base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
        }

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("[PostMediaItems]", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("simulated failure after the media items were inserted");
            }

            return base.NonQueryExecutedAsync(command, eventData, result, cancellationToken);
        }
    }
}
