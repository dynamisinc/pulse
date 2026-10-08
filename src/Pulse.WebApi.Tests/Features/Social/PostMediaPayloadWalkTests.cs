namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP AC "XC-002 structural check": every participant payload this push touches — the feed (with and
/// without replies), the thread read, the SignalR <c>PostReceived</c> broadcast, the participant 201, and the
/// persona read — is serialized and WALKED at every depth. Any provenance, storage, uploader, baseline or
/// impersonation-tell key fails the test, as does any distinctive stored value of those columns.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaPayloadWalkTests
{
    /// <summary>Keys that must never appear on a participant payload, at any depth (implementation.md §1.1).</summary>
    private static readonly string[] ForbiddenKeys =
    [
        "origin", "actingHumanId", "createdWallClock", "injectId",
        "uploadedByHumanId", "blobName", "contentType", "bytes", "originalFileName",
        "engagementBaseline", "baseline", "baselineLikeCount", "baselineRepostCount", "baselineReplyCount",
        "like_baseline", "likeBaseline", "repostBaseline", "replyBaseline",
        "personaType", "castable",
    ];

    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    private readonly MsSqlContainerFixture _fixture;

    public PostMediaPayloadWalkTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task EveryParticipantPayload_CarriesNoProvenanceStorageBaselineOrPersonaTellKey_AtAnyDepth()
    {
        var world = await SeedWorldAsync(_fixture);
        var poster = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        var video = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Video, world.ParticipantHuman, posterId: poster.Id);
        var image = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        var avatar = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);
        var banner = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using (var seed = _fixture.CreateContext())
        {
            var persona = await seed.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == world.StaffPersona);
            persona.AvatarMediaId = avatar.Id;
            persona.BannerMediaId = banner.Id;
            persona.Location = "Fairhaven, OH";
            persona.PersonaType = "bad-actor";
            persona.Castable = true;
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory();
        var payloads = new List<(string Name, string Json)>();

        // A staff post with a seeded baseline and a video (the console's write), then a participant reply with an
        // image — both through the real funnel, so both reach the broadcast.
        Guid rootId;
        using (var staff = factory.CreateClientFor(world.Host, world.StaffToken))
        {
            var created = await staff.PostAsync(PostsUri, Json(StaffBody(
                world,
                text: "Boil-water notice",
                media: new[] { Item(video.Id) },
                engagementBaseline: new { like = 1450, repost = 999, reply = 12 })));
            created.StatusCode.Should().Be(HttpStatusCode.Created);
            using var doc = await ReadJsonAsync(created);
            rootId = Guid.Parse(doc.RootElement.GetProperty("id").GetString()!);
        }

        factory.Engagement.Set(rootId, like: 3, repost: 1, reply: 1, likedBy: world.ParticipantPersona);

        using (var participant = factory.CreateClientFor(world.Host, world.ParticipantToken))
        {
            var reply = await participant.PostAsync(
                PostsUri, Json(Body(text: "Is this real?", media: new[] { Item(image.Id) }, parentPostId: rootId.ToString())));
            reply.StatusCode.Should().Be(HttpStatusCode.Created);
            payloads.Add(("participant 201 (reply)", await reply.Content.ReadAsStringAsync()));

            payloads.Add(("feed", await participant.GetStringAsync(new Uri("/api/feed", UriKind.Relative))));
            payloads.Add(("feed + replies", await participant.GetStringAsync(new Uri("/api/feed?includeReplies=true", UriKind.Relative))));
            payloads.Add(("following feed", await participant.GetStringAsync(new Uri("/api/feed?scope=following&includeReplies=true", UriKind.Relative))));
            payloads.Add(("thread", await participant.GetStringAsync(new Uri($"/api/threads/{rootId}", UriKind.Relative))));
            payloads.Add(("personas", await participant.GetStringAsync(new Uri("/api/personas", UriKind.Relative))));
        }

        // SignalR serializes the RUNTIME type (DP-17), so walk exactly that.
        factory.Broadcaster.Calls.Should().HaveCount(2, "the post and the reply were each broadcast once");
        foreach (var (_, post) in factory.Broadcaster.Calls)
        {
            payloads.Add(("PostReceived", JsonSerializer.Serialize(post, post.GetType(), WebOptions)));
        }

        // Precondition: the walk is over payloads that really carry the new members, so a pass means something.
        var feedWithReplies = payloads.Single(p => p.Name == "feed + replies").Json;
        feedWithReplies.Should().Contain("\"media\"").And.Contain("\"inReplyTo\"").And.Contain("\"viewer\"").And.Contain("\"like\":1453");
        payloads.Single(p => p.Name == "personas").Json.Should().Contain("\"avatarUrl\"").And.Contain("\"location\"");

        var distinctiveValues = new[] { video, image, avatar, banner, poster }
            .SelectMany(asset => new[] { asset.BlobName, asset.OriginalFileName })
            .Concat(["human-should-never-appear", "inject-should-never-appear", world.ParticipantHuman, world.StaffUserId.ToString(), "bad-actor", "video/mp4", "image/jpeg"])
            .ToArray();

        foreach (var (name, json) in payloads)
        {
            using var document = JsonDocument.Parse(json);
            var keys = AllPropertyNames(document.RootElement).ToHashSet(StringComparer.OrdinalIgnoreCase);
            keys.Should().NotIntersectWith(ForbiddenKeys, "the {0} payload is participant-facing (XC-002)", name);
            json.Should().NotContainAny(distinctiveValues, "no stored provenance/storage value may leak onto the {0} payload", name);
        }

        payloads.Where(p => p.Name == "PostReceived").Should().AllSatisfy(
            p => p.Json.Should().NotContain("\"viewer\"", "a broadcast never carries viewer state"));
    }

    private PostMediaWebApplicationFactory CreateFactory()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return new PostMediaWebApplicationFactory(_fixture.ConnectionString!);
    }
}
