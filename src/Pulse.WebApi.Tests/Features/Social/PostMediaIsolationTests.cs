namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP isolation suite (COR-001 / XC-001, DP-16). Cross-exercise references are enforced by the
/// services, not the database: these tests name exercise B's REAL ids while writing under exercise A's scope and
/// require the SAME 4xx as an unknown id, with zero rows written. The read half proves a cross-exercise row staged
/// directly in the database (bypassing the funnel) never surfaces on A's or B's participant payloads.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostMediaIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task DP16_StaffAttachingExerciseBsRealAsset_GetsTheSame400AsAnUnknownId_AndWritesNothing()
    {
        // Staff has no own-uploads restriction, so ONLY the exercise check can refuse B's asset here.
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var bImage = await SeedAssetAsync(_fixture, b.Exercise, MediaKinds.Image, b.ParticipantHuman);
        var bBefore = await CountRowsAsync(_fixture, b.Exercise);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(a.Host, a.StaffToken);

        var crossExercise = await client.PostAsync(PostsUri, Json(StaffBody(a, media: new[] { Item(bImage.Id) })));
        var unknown = await client.PostAsync(PostsUri, Json(StaffBody(a, media: new[] { Item(Guid.NewGuid()) })));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest, "exercise B's asset does not exist in A's scope (DP-16)");
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(),
            "the response must never confirm that another exercise's asset id is real");

        (await CountRowsAsync(_fixture, a.Exercise)).Should().Be((0, 0, 0), "a refused write leaves no post, item or event");
        (await CountRowsAsync(_fixture, b.Exercise)).Should().Be(bBefore, "and nothing lands in the TARGET exercise either");
        factory.Signer.Calls.Should().BeEmpty("no URL is ever minted for another exercise's asset");
    }

    [RequiresDockerFact]
    public async Task DP16_ParticipantAttachingExerciseBsRealAsset_GetsTheSame400AsAnUnknownId_AndWritesNothing()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var bImage = await SeedAssetAsync(_fixture, b.Exercise, MediaKinds.Image, a.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(a.Host, a.ParticipantToken);

        // Even stamped with the caller's OWN human id, B's asset is out of scope.
        var crossExercise = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(bImage.Id) })));
        var unknown = await client.PostAsync(PostsUri, Json(Body(media: new[] { Item(Guid.NewGuid()) })));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
        (await CountRowsAsync(_fixture, a.Exercise)).Should().Be((0, 0, 0));
    }

    [RequiresDockerFact]
    public async Task DP16_ExerciseBsRealImageAsPosterMediaId_GetsTheSame400AsAnUnknownPoster_AndWritesNothing()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var aVideo = await SeedAssetAsync(_fixture, a.Exercise, MediaKinds.Video, a.ParticipantHuman);
        var bImage = await SeedAssetAsync(_fixture, b.Exercise, MediaKinds.Image, b.ParticipantHuman);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(a.Host, a.StaffToken);

        var crossExercise = await client.PostAsync(
            PostsUri, Json(StaffBody(a, media: new[] { Item(aVideo.Id, posterMediaId: bImage.Id) })));
        var unknown = await client.PostAsync(
            PostsUri, Json(StaffBody(a, media: new[] { Item(aVideo.Id, posterMediaId: Guid.NewGuid()) })));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a poster from exercise B is not in A's scope (DP-16)");
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
        (await CountRowsAsync(_fixture, a.Exercise)).Should().Be((0, 0, 0));
    }

    [RequiresDockerFact]
    public async Task DP16_ExerciseBsRealPostAsParentPostId_GetsTheSame400AsAnUnknownParent_AndWritesNothing()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var bPost = await SeedPostAsync(_fixture, b.Exercise, b.StaffPersona, BaseScenarioTime);
        var bBefore = await CountRowsAsync(_fixture, b.Exercise);

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(a.Host, a.ParticipantToken);

        var crossExercise = await client.PostAsync(PostsUri, Json(Body(parentPostId: bPost.Id.ToString())));
        var unknown = await client.PostAsync(PostsUri, Json(Body(parentPostId: Guid.NewGuid().ToString())));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(
            await unknown.Content.ReadAsStringAsync(), "a cross-exercise parent is indistinguishable from an unknown one");

        (await CountRowsAsync(_fixture, a.Exercise)).Should().Be((0, 0, 0));
        (await CountRowsAsync(_fixture, b.Exercise)).Should().Be(bBefore);
    }

    [RequiresDockerFact]
    public async Task DP16_AScopeBlindResolverReturningExerciseBsPost_IsStillRefused_ByIngestsOwnCheck()
    {
        // Defense in depth over the seam: even if a resolver hands back another exercise's post as "Resolved",
        // ingest re-checks the parent's exercise and refuses with the same text as unknown.
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var bPost = await SeedPostAsync(_fixture, b.Exercise, b.StaffPersona, BaseScenarioTime);

        await using var factory = CreateFactory();
        factory.Resolver.ScopeBlind = true;
        using var client = factory.CreateClientFor(a.Host, a.ParticipantToken);

        var crossExercise = await client.PostAsync(PostsUri, Json(Body(parentPostId: bPost.Id.ToString())));
        var unknown = await client.PostAsync(PostsUri, Json(Body(parentPostId: Guid.NewGuid().ToString())));

        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync());
        (await CountRowsAsync(_fixture, a.Exercise)).Should().Be((0, 0, 0));
    }

    [RequiresDockerFact]
    public async Task Participant_CannotAttachAnotherParticipantsUpload_SameExercise_SameTextAsUnknown()
    {
        var world = await SeedWorldAsync(_fixture);
        var theirs = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.OtherParticipantHuman);

        await using var factory = CreateFactory();

        using (var me = factory.CreateClientFor(world.Host, world.ParticipantToken))
        {
            var attempt = await me.PostAsync(PostsUri, Json(Body(media: new[] { Item(theirs.Id) })));
            var unknown = await me.PostAsync(PostsUri, Json(Body(media: new[] { Item(Guid.NewGuid()) })));

            attempt.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a participant may attach only their own uploads");
            (await attempt.Content.ReadAsStringAsync()).Should().Be(
                await unknown.Content.ReadAsStringAsync(), "another participant's asset is not confirmed to exist");
            (await CountRowsAsync(_fixture, world.Exercise)).Should().Be((0, 0, 0));
        }

        // Positive control: the uploader can attach it.
        using var owner = factory.CreateClientFor(world.Host, world.OtherParticipantToken);
        (await owner.PostAsync(PostsUri, Json(Body(media: new[] { Item(theirs.Id) })))).StatusCode
            .Should().Be(HttpStatusCode.Created);
    }

    [RequiresDockerFact]
    public async Task Feed_UnderScopeB_NeverCarriesExerciseAsMediaUrlsOrParent_EvenWhenACrossReferenceIsStagedInTheDatabase()
    {
        // Stage the DP-16 hazard the FK cannot stop: B's post has an item naming A's asset, and B's reply names A's
        // post as its parent. The read path must still serve nothing of A's.
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var aImage = await SeedAssetAsync(_fixture, a.Exercise, MediaKinds.Image, a.ParticipantHuman);
        var aPost = await SeedPostAsync(_fixture, a.Exercise, a.StaffPersona, BaseScenarioTime, body: "A-ONLY");
        await SeedMediaItemAsync(_fixture, a.Exercise, aPost.Id, aImage.Id, 0);

        var bPost = await SeedPostAsync(_fixture, b.Exercise, b.StaffPersona, BaseScenarioTime.AddMinutes(1), body: "B-post");
        await SeedMediaItemAsync(_fixture, b.Exercise, bPost.Id, aImage.Id, 0);
        var bReply = await SeedPostAsync(
            _fixture, b.Exercise, b.StaffPersona, BaseScenarioTime.AddMinutes(2), parentPostId: aPost.Id, body: "B-reply");

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(b.Host, b.ParticipantToken);

        var response = await client.GetAsync(new Uri("/api/feed?includeReplies=true", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "the signer would have thrown (500) had A's asset reached it");
        var body = await response.Content.ReadAsStringAsync();

        body.Should().NotContain(aPost.Id.ToString(), "A's post id never appears on B's payload, not even as a parent");
        body.Should().NotContain(aImage.Id.ToString("N"), "A's asset never gets a URL under B's scope");
        body.Should().NotContain(aImage.Id.ToString());
        body.Should().NotContain("A-ONLY");

        using var document = System.Text.Json.JsonDocument.Parse(body);
        var items = document.RootElement.EnumerateArray().ToArray();
        items.Select(i => i.GetProperty("id").GetString()).Should().BeEquivalentTo(
            [bPost.Id.ToString(), bReply.Id.ToString()]);
        items.Should().AllSatisfy(i => i.TryGetProperty("media", out _).Should().BeFalse());
        items.Should().AllSatisfy(i => i.TryGetProperty("inReplyTo", out _).Should().BeFalse());
        factory.Signer.Calls.Should().BeEmpty("nothing in B's scope had media to sign");

        // The rows DO exist — the empty media is the filter closing the door, not a missing row.
        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.PostId == bPost.Id)).Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Feed_UnderScopeA_ShowsAsMediaToA_AndUnderScopeB_NeverShowsAsPostsAtAll()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var aImage = await SeedAssetAsync(_fixture, a.Exercise, MediaKinds.Image, a.ParticipantHuman);

        await using var factory = CreateFactory();

        Guid postId;
        using (var aClient = factory.CreateClientFor(a.Host, a.ParticipantToken))
        {
            var created = await aClient.PostAsync(PostsUri, Json(Body(text: "A-MEDIA-POST", media: new[] { Item(aImage.Id) })));
            created.StatusCode.Should().Be(HttpStatusCode.Created);
            using var doc = await ReadJsonAsync(created);
            postId = Guid.Parse(doc.RootElement.GetProperty("id").GetString()!);

            var aFeed = await aClient.GetStringAsync(new Uri("/api/feed", UriKind.Relative));
            aFeed.Should().Contain(FakeMediaUrlSigner.UrlFor(aImage.Id), "A sees its own media");
        }

        using var bClient = factory.CreateClientFor(b.Host, b.ParticipantToken);
        var bFeed = await bClient.GetStringAsync(new Uri("/api/feed?includeReplies=true", UriKind.Relative));
        bFeed.Should().Be("[]", "exercise B's feed is empty — never A's post, media or URL");
        bFeed.Should().NotContain(postId.ToString());
    }

    [RequiresDockerFact]
    public async Task Personas_UnderScopeB_NeverSignAnAvatarFromExerciseA()
    {
        var a = await SeedWorldAsync(_fixture);
        var b = await SeedWorldAsync(_fixture);
        var aImage = await SeedAssetAsync(_fixture, a.Exercise, MediaKinds.Image, a.ParticipantHuman);

        // Stage the hazard: B's persona names A's asset as its avatar.
        await using (var seed = _fixture.CreateContext())
        {
            var persona = await seed.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == b.StaffPersona);
            persona.AvatarMediaId = aImage.Id;
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        using var client = factory.CreateClientFor(b.Host, b.ParticipantToken);

        var response = await client.GetAsync(new Uri("/api/personas", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotContain("avatarUrl", "A's asset is out of B's scope, so no URL is minted");
        body.Should().NotContain(aImage.Id.ToString("N"));
        factory.Signer.Calls.Should().BeEmpty();
    }

    private PostMediaWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
    }
}
