namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Moq;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The full scripted-post path after demo-polish BP/B2/BM/B5 (inject-queue/06, IQ-10), on the REAL funnel: a scripted
/// burst whose first post carries library media and a seeded baseline, and whose second replies to it, persists real
/// posts (<c>PostMediaItem</c> rows, <c>ParentPostId</c>, baseline counts) and broadcasts participant projections that
/// carry <c>media</c> / <c>inReplyTo</c> and no provenance. Also pins that BP's participant-only media ownership rule
/// does not block a staff-authored scripted attachment uploaded by ANOTHER staff user, and that B5's role-scoped
/// realtime still sends an inject post to the exercise-wide (participant) group.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectRichPostFunnelTests
{
    private static readonly string[] ProvenanceAndStorageKeys =
        ["origin", "actingHumanId", "injectId", "createdWallClock", "engagementBaseline", "baselineLikeCount", "uploadedByHumanId", "blobName"];

    private readonly MsSqlContainerFixture _fixture;

    public InjectRichPostFunnelTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AScriptedBurst_WithMediaAReplyAndABaseline_TravelsTheRealFunnel()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        await using var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!, new FixedJitterSource());
        host.StepPerRequest = TimeSpan.Zero;
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);

        // Uploaded by a DIFFERENT staff user than the controller who fires: BP's ownership rule is participant-only.
        var photo = await host.AddMediaAssetAsync(seeded.ExerciseId, MediaKinds.Image, uploadedBy: Guid.NewGuid().ToString());

        var item = await host.CreateOkAsync(new
        {
            kind = "burst",
            title = "Beat 3: brown water",
            burstWindowSeconds = 30,
            posts = new object[]
            {
                new
                {
                    personaId = seeded.PersonaIds[0].ToString(),
                    text = "Look at what came out of my tap #WaterIssues",
                    media = new[] { new { mediaId = photo.ToString(), alt = "A glass of brown tap water" } },
                    engagementBaseline = new { like = 1450, repost = 320, reply = 88 },
                },
                new
                {
                    personaId = seeded.PersonaIds[1].ToString(),
                    text = "Same here on Elm St!",
                    replyTo = new { sequence = 1 },
                    engagementBaseline = new { like = 40 },
                },
            },
        });

        var fired = await host.ActionOkAsync(item.Guid, "fire");
        fired.FiredCount.Should().Be(1, "the photo goes out inline");
        host.Time.Advance(TimeSpan.FromSeconds(5)); // the reply is due at +3 s
        await host.Runner.RunTickAsync();

        await using var db = host.Db(seeded.ExerciseId);
        var posts = await db.Posts.Where(p => p.InjectId == item.Id).OrderBy(p => p.CreatedWallClock).ToListAsync();
        posts.Should().HaveCount(2);
        var (photoPost, reply) = (posts[0], posts[1]);

        // 1. Media: one PostMediaItem row for the library asset, with its alt.
        var mediaRows = await db.PostMediaItems.Where(m => m.PostId == photoPost.Id).ToListAsync();
        mediaRows.Should().ContainSingle().Which.Should().Match<PostMediaItem>(m => m.MediaAssetId == photo && m.Alt == "A glass of brown tap water");

        // 2. Baselines, honoured for origin inject (IQ-10).
        (photoPost.BaselineLikeCount, photoPost.BaselineRepostCount, photoPost.BaselineReplyCount).Should().Be((1450, 320, 88));
        (reply.BaselineLikeCount, reply.BaselineRepostCount, reply.BaselineReplyCount).Should().Be((40, 0, 0));

        // 3. The reply is a real reply to the photo post (resolved by B2 in scope).
        reply.ParentPostId.Should().Be(photoPost.Id, "replyTo {sequence: 1} -> the sibling's FiredPostId -> ParentPostId");
        photoPost.ParentPostId.Should().BeNull();
        posts.Should().OnlyContain(p => p.Origin == "inject" && p.ActingHumanId == seeded.StaffUserId.ToString());

        // 4. The participant broadcasts carry media / inReplyTo and the summed counts — and no provenance.
        var broadcasts = host.Broadcaster.Calls.Select(call => JsonSerializer.Serialize(call.Post)).ToList();
        broadcasts.Should().HaveCount(2);
        using (var first = JsonDocument.Parse(broadcasts[0]))
        {
            var media = first.RootElement.GetProperty("media");
            media.GetArrayLength().Should().Be(1);
            media[0].GetProperty("alt").GetString().Should().Be("A glass of brown tap water");
            media[0].GetProperty("kind").GetString().Should().Be("image");
            media[0].GetProperty("url").GetString().Should().NotBeNullOrEmpty();
            first.RootElement.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(1450);
        }

        using (var second = JsonDocument.Parse(broadcasts[1]))
        {
            second.RootElement.GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(photoPost.Id.ToString());
        }

        foreach (var json in broadcasts)
        {
            json.Should().NotContainAny(ProvenanceAndStorageKeys.Select(key => $"\"{key}\"").ToArray(),
                "a participant must never learn a post was scripted, by whom, or how it is stored (XC-002)");
        }
    }

    [RequiresDockerFact]
    public async Task AnInjectPost_IsBroadcastToTheExerciseWideParticipantGroup_NotOnlyToStaff()
    {
        // B5 made realtime role-scoped: participants are in `exercise:{id}`, verified staff ALSO in `exercise:{id}:staff`.
        // The funnel's broadcast is origin-agnostic; pin that the REAL SignalRFeedBroadcaster sends an inject post's
        // PostReceived to the exercise-wide group every participant is in.
        var sends = new ConcurrentQueue<(string Group, string Method, object?[] Args)>();
        var hub = new Mock<IHubContext<ExerciseRealtimeHub>>();
        hub.Setup(h => h.Clients.Group(It.IsAny<string>()))
            .Returns<string>(group => new RecordingClientProxy(group, sends));

        _fixture.ConnectionString.Should().NotBeNull();
        await using var host = await InjectTestHost.StartAsync(
            _fixture.ConnectionString!, broadcaster: new SignalRFeedBroadcaster(hub.Object));
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0]));

        (await host.ActionOkAsync(item.Guid, "fire")).Status.Should().Be("fired");

        var (group, method, args) = sends.Should().ContainSingle().Subject;
        group.Should().Be($"exercise:{seeded.ExerciseId}", "the exercise-wide group participants join — not the staff group");
        method.Should().Be("PostReceived");
        args.Should().ContainSingle().Which.Should().BeOfType<ParticipantPostDto>("the participant-safe projection");
    }

    // ---- W-2: the funnel still refuses at fire what changed after authoring --------------------------

    [RequiresDockerFact]
    public async Task AReplyParentTakenDownAfterAuthoring_FailsAtFire_WithTheFunnelsMessage_AndCanBeRetried()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        await using var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var parent = await host.AddPostAsync(seeded.ExerciseId, seeded.PersonaIds[1]);
        var item = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.PersonaIds[0], "@resident same here", new { postId = parent.ToString() }));

        await host.SetPostTakenDownAsync(seeded.ExerciseId, parent, takenDown: true); // B6 takedown between save and fire
        var fired = await host.ActionOkAsync(item.Guid, "fire");

        fired.Status.Should().Be("failed", "nothing is marked fired that the funnel did not create");
        fired.Error.Should().Be("parentPostId does not name a post in this exercise.", "B2's resolver refused it in the funnel");
        fired.Posts.Single().Should().Match<WirePost>(p => p.Status == "failed" && p.FiredPostId == null);
        (await PostCountAsync(host, seeded, item)).Should().Be(0, "no post was created");

        await host.SetPostTakenDownAsync(seeded.ExerciseId, parent, takenDown: false);
        var retried = await host.ActionOkAsync(item.Guid, "retry");
        retried.Status.Should().Be("fired", "Retry is still possible once the parent is back");
        await using var db = host.Db(seeded.ExerciseId);
        (await db.Posts.SingleAsync(p => p.InjectId == item.Id)).ParentPostId.Should().Be(parent);
    }

    [RequiresDockerFact]
    public async Task AMediaAssetGoneAtFire_FailsWithTheFunnelsMessage_AndCanBeRetried()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        await using var host = await InjectTestHost.StartAsync(_fixture.ConnectionString!);
        var seeded = await host.SeedExerciseAsync();
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        var photo = await host.AddMediaAssetAsync(seeded.ExerciseId);
        var item = await host.CreateOkAsync(new
        {
            kind = "post",
            title = "photo",
            posts = new[] { new { personaId = seeded.PersonaIds[0].ToString(), text = "look", media = new[] { new { mediaId = photo.ToString(), alt = "brown water" } } } },
        });

        MediaAsset removed;
        await using (var db = host.Db(seeded.ExerciseId))
        {
            removed = await db.MediaAssets.AsNoTracking().SingleAsync(a => a.Id == photo);
            db.MediaAssets.Remove(await db.MediaAssets.SingleAsync(a => a.Id == photo));
            await db.SaveChangesAsync();
        }

        var fired = await host.ActionOkAsync(item.Guid, "fire");

        fired.Status.Should().Be("failed");
        fired.Error.Should().Be("One or more media items could not be found.", "the funnel's own media message");
        (await PostCountAsync(host, seeded, item)).Should().Be(0);

        await using (var db = host.Db(seeded.ExerciseId))
        {
            db.MediaAssets.Add(removed);
            await db.SaveChangesAsync();
        }

        (await host.ActionOkAsync(item.Guid, "retry")).Status.Should().Be("fired", "Retry is still possible once the asset is back");
    }

    private static async Task<int> PostCountAsync(InjectTestHost host, SeededExercise seeded, WireItem item)
    {
        await using var db = host.Db(seeded.ExerciseId);
        return await db.Posts.CountAsync(p => p.InjectId == item.Id);
    }

    private sealed class RecordingClientProxy : IClientProxy
    {
        private readonly string _group;
        private readonly ConcurrentQueue<(string Group, string Method, object?[] Args)> _sends;

        public RecordingClientProxy(string group, ConcurrentQueue<(string Group, string Method, object?[] Args)> sends)
        {
            _group = group;
            _sends = sends;
        }

        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default)
        {
            _sends.Enqueue((_group, method, args));
            return Task.CompletedTask;
        }
    }
}
