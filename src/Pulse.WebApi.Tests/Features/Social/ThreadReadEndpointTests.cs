namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social.Threads;

/// <summary>
/// Integration tests for <c>GET /api/threads/{postId}</c> (story <c>social-api/01-feed-read-api</c>, #270;
/// SOC-010; made a real thread read by demo-polish B2, #426). Same host/seed/drive pattern as
/// <see cref="FeedReadEndpointTests"/>. Covers a root post with no thread around it, the real thread (ancestors root
/// to parent, replies oldest first, a tombstone), the projector pass-through and <c>viewer</c> state, the unknown-id
/// not-found shape, the XC-002 wire-level provenance-absence guarantee across every post in the thread, and the
/// fail-closed unresolved-scope AC. The [Tier-2] cross-exercise cases live in <c>FeedThreadIsolationTests</c> and
/// <c>Threads/ThreadReplyIsolationTests</c>, alongside the standing suite (<c>exercise-isolation/07</c>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ThreadReadEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ThreadReadEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Thread_RealInScopePost_ReturnsFocusedNonNull_WithEmptyAncestorsAndReplies_AndPersistedScenarioTime()
    {
        var exerciseA = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseA, authorPersonaId, "the focused post", scenarioTime));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ThreadUri(postId));

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        root.TryGetProperty("ancestors", out var ancestors).Should().BeTrue();
        ancestors.GetArrayLength().Should().Be(0, "a top-level post has no ancestors");

        root.TryGetProperty("replies", out var replies).Should().BeTrue();
        replies.GetArrayLength().Should().Be(0, "a post nobody replied to has no replies");

        root.TryGetProperty("focused", out var focused).Should().BeTrue();
        focused.ValueKind.Should().Be(JsonValueKind.Object, "a real, in-scope postId must resolve a non-null focused post");
        focused.GetProperty("id").GetString().Should().Be(postId.ToString());
        focused.GetProperty("authorPersonaId").GetString().Should().Be(authorPersonaId.ToString());
        focused.GetProperty("text").GetString().Should().Be("the focused post");

        // COR-053: scenarioTime is the persisted instant exactly, never re-derived from the server clock.
        DateTimeOffset.Parse(focused.GetProperty("scenarioTime").GetString()!).Should().Be(scenarioTime);
    }

    [RequiresDockerFact]
    public async Task Thread_RealThread_AncestorsRootToParent_RepliesOldestFirst_WithTombstone()
    {
        // B2 AC-2/AC-3 over HTTP through the real host composition (whatever projector Program.cs registers).
        var exerciseA = Guid.NewGuid();
        var root = ThreadSeed.NewPost(exerciseA, "root post", ThreadSeed.Anchor);
        var focused = ThreadSeed.NewPost(exerciseA, "focused post", ThreadSeed.Anchor.AddMinutes(1), root.Id);
        var second = ThreadSeed.NewPost(exerciseA, "second reply", ThreadSeed.Anchor.AddMinutes(20), focused.Id);
        var first = ThreadSeed.NewPost(exerciseA, "first reply", ThreadSeed.Anchor.AddMinutes(10), focused.Id);
        var removed = ThreadSeed.NewPost(exerciseA, "REMOVED-REPLY-TEXT", ThreadSeed.Anchor.AddMinutes(15), focused.Id, deletedAt: ThreadSeed.Anchor.AddMinutes(30));
        await SeedAsync(root, focused, second, first, removed);

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ThreadUri(focused.Id));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var json = JsonNode.Parse(body)!;
        ThreadReplyDtoShapeTests.IsValidThreadResponse(json).Should().BeTrue("the frozen client guard must accept the response");

        json["ancestors"]!.AsArray().Select(a => a!["id"]!.GetValue<string>()).Should().Equal(root.Id.ToString());
        json["focused"]!["id"]!.GetValue<string>().Should().Be(focused.Id.ToString());

        var replies = json["replies"]!.AsArray().Select(r => r!.AsObject()).ToList();
        replies.Select(r => r["id"]!.GetValue<string>()).Should().Equal(
            new[] { first.Id.ToString(), removed.Id.ToString(), second.Id.ToString() }, "replies are oldest first by scenario time");
        replies.Select(r => r["status"]!.GetValue<string>()).Should().Equal("visible", "taken-down", "visible");
        replies.Should().OnlyContain(r => r["replyToPersonaId"]!.GetValue<string>() == focused.AuthorPersonaId.ToString());

        var tombstone = replies[1];
        tombstone["text"]!.GetValue<string>().Should().BeEmpty();
        tombstone.ContainsKey("media").Should().BeFalse();
        JsonNode.DeepEquals(tombstone["counts"], JsonNode.Parse("""{"reply":0,"repost":0,"like":0}""")).Should().BeTrue();
        body.Should().NotContain("REMOVED-REPLY-TEXT", "a taken-down reply's content never leaves the server");
    }

    [RequiresDockerFact]
    public async Task Thread_PassesTheProjectorOutputThrough_AndViewerStateForAParticipant()
    {
        var exerciseA = Guid.NewGuid();
        var focused = ThreadSeed.NewPost(exerciseA, "focused post", ThreadSeed.Anchor);
        var reply = ThreadSeed.NewPost(exerciseA, "a reply", ThreadSeed.Anchor.AddMinutes(1), focused.Id);
        await SeedAsync(focused, reply);

        var projector = new RecordingPostProjector();
        var viewerPersona = Guid.NewGuid();
        await using var factory = new ThreadApiWebApplicationFactory(
            ConnectionString, exerciseA, projector, StubSessionPersonaAccessor.For(exerciseA, viewerPersona));
        using var client = factory.CreateClient();

        var json = JsonNode.Parse(await client.GetStringAsync(ThreadUri(focused.Id)))!;

        projector.Calls.Should().ContainSingle().Which.Options.Should().Be(
            new Pulse.WebApi.Features.Social.PostProjectionOptions(viewerPersona, IncludeViewerState: true));

        var focusedJson = json["focused"]!;
        focusedJson["counts"]!["like"]!.GetValue<int>().Should().Be(RecordingPostProjector.ProjectedCounts.Like);
        focusedJson["media"]!.AsArray().Should().ContainSingle();
        JsonNode.DeepEquals(focusedJson["viewer"], JsonNode.Parse("""{"liked":true,"reposted":false}""")).Should().BeTrue();

        var replyJson = json["replies"]![0]!;
        replyJson["inReplyTo"]!["postId"]!.GetValue<string>().Should().Be(focused.Id.ToString());
        replyJson["inReplyTo"]!["authorHandle"]!.GetValue<string>().Should().Be(RecordingPostProjector.ParentHandle);
        replyJson["counts"]!["reply"]!.GetValue<int>().Should().Be(RecordingPostProjector.ProjectedCounts.Reply);
        replyJson["status"]!.GetValue<string>().Should().Be("visible");
    }

    [RequiresDockerFact]
    public async Task Thread_FocusedPost_ResponseBody_NeverContainsProvenanceKeys()
    {
        var exerciseA = Guid.NewGuid();
        var postId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            var post = NewPost(postId, exerciseA, Guid.NewGuid(), "provenance must never leak on a thread either", DateTimeOffset.UtcNow);
            post.Origin = "controller-as-persona";
            post.ActingHumanId = "human-should-never-appear-thread";
            post.CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero);
            post.InjectId = "inject-should-never-appear-thread";
            seed.Posts.Add(post);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ThreadUri(postId));
        var body = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(body);
        var focused = document.RootElement.GetProperty("focused");

        focused.TryGetProperty("origin", out _).Should().BeFalse("origin is staff/telemetry-only (XC-002)");
        focused.TryGetProperty("actingHumanId", out _).Should().BeFalse("actingHumanId is staff/telemetry-only (COR-018, XC-002)");
        focused.TryGetProperty("createdWallClock", out _).Should().BeFalse("wall-clock time must never reach a participant (COR-053, XC-002)");
        focused.TryGetProperty("injectId", out _).Should().BeFalse("injectId is staff/telemetry-only (XC-002)");

        body.Should().NotContain("human-should-never-appear-thread");
        body.Should().NotContain("inject-should-never-appear-thread");
    }

    [RequiresDockerFact]
    public async Task Thread_EveryPostInTheThread_CarriesNoProvenanceOrBaselineKeys()
    {
        // XC-002 across ancestors, focused, visible replies and tombstones (ThreadSeed stamps inject provenance and
        // distinctive values on every row).
        var exerciseA = Guid.NewGuid();
        var root = ThreadSeed.NewPost(exerciseA, "root", ThreadSeed.Anchor);
        var focused = ThreadSeed.NewPost(exerciseA, "focused", ThreadSeed.Anchor.AddMinutes(1), root.Id);
        var reply = ThreadSeed.NewPost(exerciseA, "reply", ThreadSeed.Anchor.AddMinutes(2), focused.Id);
        var removed = ThreadSeed.NewPost(exerciseA, "removed", ThreadSeed.Anchor.AddMinutes(3), focused.Id, deletedAt: ThreadSeed.Anchor.AddMinutes(4));
        reply.BaselineLikeCount = 777;
        await SeedAsync(root, focused, reply, removed);

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var body = await client.GetStringAsync(ThreadUri(focused.Id));
        var json = JsonNode.Parse(body)!;

        var posts = json["ancestors"]!.AsArray().Append(json["focused"]).Concat(json["replies"]!.AsArray()).Select(p => p!.AsObject()).ToList();
        posts.Should().HaveCount(4);
        foreach (var post in posts)
        {
            post.Select(p => p.Key).Should().NotContain(ThreadReplyDtoShapeTests.Forbidden, "no participant payload carries provenance or baselines (XC-002)");
        }

        body.Should().NotContain("human-thread-should-never-appear").And.NotContain("inject-thread-should-never-appear");
    }

    [RequiresDockerFact]
    public async Task Thread_UnknownPostId_Returns200_WithNullFocused_AndEmptyAncestorsAndReplies()
    {
        var exerciseA = Guid.NewGuid();
        var unknownPostId = Guid.NewGuid();

        // No seeding at all: unknownPostId belongs to no exercise.
        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ThreadUri(unknownPostId));

        // useThread.ts's resolveThread throws on ANY non-2xx and isValidThreadResponse accepts
        // focused: null with empty ancestors/replies — a 404 here would crash the participant view.
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        root.GetProperty("focused").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("ancestors").GetArrayLength().Should().Be(0);
        root.GetProperty("replies").GetArrayLength().Should().Be(0);
    }

    [RequiresDockerFact]
    public async Task Thread_UnresolvedScope_Returns401_NeverEmptyOk()
    {
        var exerciseA = Guid.NewGuid();
        var postId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseA, Guid.NewGuid(), "should never be reachable", DateTimeOffset.UtcNow));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseId: null);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(ThreadUri(postId));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolvable exercise scope must fail closed with 401, before any lookup or parse");
    }

    private static Uri ThreadUri(Guid postId) => new($"/api/threads/{postId}", UriKind.Relative);

    private string ConnectionString
    {
        get
        {
            _fixture.ConnectionString.Should().NotBeNull(
                "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
            return _fixture.ConnectionString!;
        }
    }

    private SocialApiWebApplicationFactory CreateFactory(Guid? exerciseId) => new(ConnectionString, exerciseId);

    private async Task SeedAsync(params Post[] posts)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.AddRange(posts);
        await seed.SaveChangesAsync();
    }

    private static Post NewPost(Guid id, Guid exerciseId, Guid authorPersonaId, string body, DateTimeOffset scenarioTime) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = authorPersonaId,
        Body = body,
        CreatedScenarioTime = scenarioTime,
        Origin = "participant",
        ActingHumanId = "human-test",
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
    };
}
