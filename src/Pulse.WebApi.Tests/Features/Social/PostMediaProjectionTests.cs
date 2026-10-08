namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP read projection (<c>IParticipantPostProjector</c> behind <c>GET /api/feed</c>): counts =
/// baseline + real, <c>viewer</c> only for a persona-bound participant session, <c>includeReplies</c> (DP-5),
/// <c>Take(200)</c>, newest-first by SCENARIO time (COR-053), soft-deleted rows excluded, stable media URLs, and
/// the Following scope under the same rules.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaProjectionTests
{
    private static readonly Uri FeedUri = new("/api/feed", UriKind.Relative);
    private static readonly Uri FeedWithRepliesUri = new("/api/feed?includeReplies=true", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public PostMediaProjectionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Counts_AreBaselinePlusReal_AndViewerReflectsTheParticipantsOwnPersona()
    {
        var world = await SeedWorldAsync(_fixture);
        var post = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, baseline: (100, 20, 3));

        await using var factory = CreateFactory();
        factory.Engagement.Set(post.Id, like: 5, repost: 2, reply: 1, likedBy: world.ParticipantPersona);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var item = (await GetFeedAsync(client, FeedUri)).Single();

        var counts = item.GetProperty("counts");
        counts.GetProperty("like").GetInt32().Should().Be(105, "baseline 100 + real 5");
        counts.GetProperty("repost").GetInt32().Should().Be(22);
        counts.GetProperty("reply").GetInt32().Should().Be(4);

        var viewer = item.GetProperty("viewer");
        viewer.GetProperty("liked").GetBoolean().Should().BeTrue("the participant's own persona liked it");
        viewer.GetProperty("reposted").GetBoolean().Should().BeFalse();
        factory.Engagement.ViewerRequests.Should().Contain(world.ParticipantPersona, "viewer state is read for the SESSION's persona");
    }

    [RequiresDockerFact]
    public async Task Viewer_IsAbsent_ForAStaffSession_EvenOneOperatingAPersona()
    {
        var world = await SeedWorldAsync(_fixture);
        var post = await SeedPostAsync(_fixture, world.Exercise, world.ParticipantPersona, BaseScenarioTime, baseline: (7, 0, 0));

        await using var factory = CreateFactory();
        factory.Engagement.Set(post.Id, like: 1, repost: 0, reply: 0, likedBy: world.StaffPersona);

        foreach (var token in new[] { world.StaffToken, world.StaffWithPersonaToken })
        {
            using var client = factory.CreateClientFor(world.Host, token);
            var item = (await GetFeedAsync(client, FeedUri)).Single();
            item.TryGetProperty("viewer", out _).Should().BeFalse("staff never gets viewer state (DP-10)");
            item.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(8, "counts are the same for every caller");
        }

        factory.Engagement.ViewerRequests.Should().AllSatisfy(v => v.Should().BeNull(), "no viewer persona is ever asked for");
    }

    [RequiresDockerFact]
    public async Task Feed_IsTopLevelOnly_UnlessIncludeReplies_AndRepliesCarryInReplyTo()
    {
        var world = await SeedWorldAsync(_fixture);
        var root = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime);
        var reply = await SeedPostAsync(_fixture, world.Exercise, world.ParticipantPersona, BaseScenarioTime.AddMinutes(1), parentPostId: root.Id);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        (await GetFeedAsync(client, FeedUri)).Select(Id).Should().Equal([root.Id.ToString()], "the default feed is top-level only");
        (await GetFeedAsync(client, new Uri("/api/feed?includeReplies=false", UriKind.Relative))).Select(Id)
            .Should().Equal([root.Id.ToString()]);

        var withReplies = await GetFeedAsync(client, FeedWithRepliesUri);
        withReplies.Select(Id).Should().Equal([reply.Id.ToString(), root.Id.ToString()], "newest scenario time first (DP-5)");
        var inReplyTo = withReplies[0].GetProperty("inReplyTo");
        inReplyTo.GetProperty("postId").GetString().Should().Be(root.Id.ToString());
        inReplyTo.GetProperty("authorHandle").GetString().Should().Be($"p_{world.StaffPersona:N}");
        withReplies[1].TryGetProperty("inReplyTo", out _).Should().BeFalse("a top-level post has no inReplyTo");
    }

    [RequiresDockerFact]
    public async Task AReplyWhoseParentIsDeletedLater_KeepsItsInReplyTo()
    {
        var world = await SeedWorldAsync(_fixture);
        var deletedParent = await SeedPostAsync(
            _fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, deletedAt: BaseScenarioTime.AddHours(1));
        var reply = await SeedPostAsync(
            _fixture, world.Exercise, world.ParticipantPersona, BaseScenarioTime.AddMinutes(1), parentPostId: deletedParent.Id);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var feed = await GetFeedAsync(client, FeedWithRepliesUri);
        feed.Select(Id).Should().Equal([reply.Id.ToString()], "the soft-deleted parent itself is excluded");
        feed[0].GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(deletedParent.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task Feed_ExcludesSoftDeletedPostsAndReplies()
    {
        var world = await SeedWorldAsync(_fixture);
        var live = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime);
        await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddMinutes(1), deletedAt: BaseScenarioTime);
        await SeedPostAsync(
            _fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddMinutes(2), parentPostId: live.Id, deletedAt: BaseScenarioTime);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        (await GetFeedAsync(client, FeedWithRepliesUri)).Select(Id).Should().Equal([live.Id.ToString()]);
    }

    [RequiresDockerFact]
    public async Task Feed_IsOrderedByScenarioTime_NeverByWallClock()
    {
        var world = await SeedWorldAsync(_fixture);
        var wall = DateTimeOffset.UtcNow;

        // Wall-clock order is the exact REVERSE of scenario order.
        var scenarioOldest = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, wallClock: wall.AddMinutes(2));
        var scenarioMiddle = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddHours(1), wallClock: wall.AddMinutes(1));
        var scenarioNewest = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddHours(2), wallClock: wall);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var feed = await GetFeedAsync(client, FeedUri);
        feed.Select(Id).Should().Equal(
            [scenarioNewest.Id.ToString(), scenarioMiddle.Id.ToString(), scenarioOldest.Id.ToString()],
            "participants see scenario time only (COR-053)");
        DateTimeOffset.Parse(feed[0].GetProperty("scenarioTime").GetString()!).Should().Be(BaseScenarioTime.AddHours(2));
    }

    [RequiresDockerFact]
    public async Task Feed_ReturnsAtMost200_TheNewestByScenarioTime()
    {
        var world = await SeedWorldAsync(_fixture);

        await using (var seed = _fixture.CreateContext())
        {
            for (var i = 0; i < 205; i++)
            {
                seed.Posts.Add(new Post
                {
                    Id = Guid.NewGuid(),
                    ExerciseId = world.Exercise,
                    AuthorPersonaId = world.StaffPersona,
                    Body = $"bulk {i}",
                    CreatedScenarioTime = BaseScenarioTime.AddMinutes(i),
                    Origin = "engine",
                    ActingHumanId = string.Empty,
                    CreatedWallClock = DateTimeOffset.UtcNow,
                });
            }

            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var feed = await GetFeedAsync(client, FeedUri);
        feed.Should().HaveCount(PostReadService.FeedTake, "the feed is capped at Take(200)");
        feed.Select(i => i.GetProperty("text").GetString()).Should().NotContain(
            ["bulk 0", "bulk 1", "bulk 2", "bulk 3", "bulk 4"], "the five OLDEST scenario posts fall off the end");
        feed[0].GetProperty("text").GetString().Should().Be("bulk 204");
    }

    [RequiresDockerFact]
    public async Task MediaUrls_AreIdenticalAcrossTwoReads_AndOneSignerCallCoversThePage()
    {
        var world = await SeedWorldAsync(_fixture);
        var first = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime);
        var second = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddMinutes(1));
        var imageA = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "h");
        var imageB = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "h");
        var poster = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "h");
        var video = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, "h", posterId: poster.Id);
        await SeedMediaItemAsync(_fixture, world.Exercise, first.Id, imageA.Id, 0, alt: "a");
        await SeedMediaItemAsync(_fixture, world.Exercise, first.Id, imageB.Id, 1, alt: "b");
        await SeedMediaItemAsync(_fixture, world.Exercise, second.Id, video.Id, 0, alt: "clip");

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var firstRead = await client.GetStringAsync(FeedUri);
        var secondRead = await client.GetStringAsync(FeedUri);

        secondRead.Should().Be(firstRead, "URLs minted in one bucket are byte-identical, so the browser cache works");
        factory.Signer.Calls.Should().HaveCount(2, "ONE signer call per read, not one per post or per item");
        factory.Signer.Calls.First().Should().BeEquivalentTo([imageA.Id, imageB.Id, video.Id, poster.Id]);

        using var document = JsonDocument.Parse(firstRead);
        var byId = document.RootElement.EnumerateArray().ToDictionary(Id);
        byId[first.Id.ToString()].GetProperty("media").EnumerateArray().Select(m => m.GetProperty("alt").GetString())
            .Should().Equal("a", "b");
        byId[second.Id.ToString()].GetProperty("media")[0].GetProperty("posterUrl").GetString()
            .Should().Be(FakeMediaUrlSigner.UrlFor(poster.Id));
    }

    [RequiresDockerFact]
    public async Task WithTheFallbackSigner_TextOnlyPostsAndReads_NeverReachIt()
    {
        var world = await SeedWorldAsync(_fixture);

        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!, keepFallbackSigner: true);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        (await client.PostAsync(PostsUri, Json(Body()))).StatusCode.Should().Be(HttpStatusCode.Created);
        (await client.GetAsync(FeedUri)).StatusCode.Should().Be(HttpStatusCode.OK, "the unconfigured signer throws only if reached");
        (await client.GetAsync(new Uri("/api/personas", UriKind.Relative))).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [RequiresDockerFact]
    public async Task FollowingScope_AppliesTheSameRules_TopLevelUnlessIncludeReplies_WithViewer()
    {
        var world = await SeedWorldAsync(_fixture);
        var followedPost = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, baseline: (10, 0, 0));
        var followedReply = await SeedPostAsync(
            _fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddMinutes(1), parentPostId: followedPost.Id);
        await SeedPostAsync(_fixture, world.Exercise, world.OtherParticipantPersona, BaseScenarioTime.AddMinutes(2));

        await using (var seed = _fixture.CreateContext())
        {
            seed.Follows.Add(new Follow
            {
                Id = Guid.NewGuid(),
                ExerciseId = world.Exercise,
                FollowerPersonaId = world.ParticipantPersona,
                FolloweePersonaId = world.StaffPersona,
                CreatedScenarioTime = BaseScenarioTime,
                CreatedWallClock = DateTimeOffset.UtcNow,
            });
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        factory.Engagement.Set(followedPost.Id, like: 1, repost: 0, reply: 1, repostedBy: world.ParticipantPersona);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        var following = await GetFeedAsync(client, new Uri("/api/feed?scope=following", UriKind.Relative));
        following.Select(Id).Should().Equal([followedPost.Id.ToString()], "top-level only, followed authors only");
        following[0].GetProperty("counts").GetProperty("like").GetInt32().Should().Be(11);
        following[0].GetProperty("viewer").GetProperty("reposted").GetBoolean().Should().BeTrue();

        var withReplies = await GetFeedAsync(client, new Uri("/api/feed?scope=following&includeReplies=true", UriKind.Relative));
        withReplies.Select(Id).Should().Equal([followedReply.Id.ToString(), followedPost.Id.ToString()]);
    }

    [RequiresDockerFact]
    public async Task Projector_RefusesToProjectAPostOutsideTheResolvedScope()
    {
        var scopeA = Guid.NewGuid();
        var context = new Pulse.WebApi.Data.ExerciseContext { CurrentExerciseId = scopeA };
        await using var db = _fixture.CreateContext(context);
        var projector = new ParticipantPostProjector(
            db, context, new FakePostEngagementReader(), new FakeMediaUrlSigner(context, new SignerProbe()));

        var foreign = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            AuthorPersonaId = Guid.NewGuid(),
            Body = "from another exercise",
            Origin = "engine",
            ActingHumanId = string.Empty,
        };

        var project = () => projector.ProjectAsync([foreign], new PostProjectionOptions(), default);

        await project.Should().ThrowAsync<Pulse.WebApi.Data.ExerciseScopeViolationException>(
            "a post outside the scope never becomes a participant payload");
        (await projector.ProjectAsync([], new PostProjectionOptions(), default)).Should().BeEmpty();
    }

    private static string Id(JsonElement item) => item.GetProperty("id").GetString()!;

    private static async Task<JsonElement[]> GetFeedAsync(System.Net.Http.HttpClient client, Uri uri)
    {
        var response = await client.GetAsync(uri);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.EnumerateArray().Select(e => e.Clone()).ToArray();
    }

    private PostMediaWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
    }
}
