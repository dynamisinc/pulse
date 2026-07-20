namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// Integration tests for <c>GET /api/threads/{postId}</c> (story <c>social-api/01-feed-read-api</c>, #270;
/// SOC-010). Same host/seed/drive pattern as <see cref="FeedReadEndpointTests"/> (and, before it,
/// <c>Telemetry/TelemetryIngestTests</c>). Covers the thread shape AC (a real in-scope post resolves
/// <c>focused</c> non-null with empty <c>ancestors</c>/<c>replies</c>, B1 having no parent/reply model yet),
/// the unknown-id not-found shape, the XC-002 wire-level provenance-absence guarantee on <c>focused</c>, and
/// the fail-closed unresolved-scope AC. The [Tier-2] cross-exercise case lives in
/// <c>FeedThreadIsolationTests</c>, alongside the standing suite (<c>exercise-isolation/07</c>).
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
        ancestors.GetArrayLength().Should().Be(0, "B1 has no parent/reply model — ancestors are always empty");

        root.TryGetProperty("replies", out var replies).Should().BeTrue();
        replies.GetArrayLength().Should().Be(0, "B1 has no parent/reply model — replies are always empty");

        root.TryGetProperty("focused", out var focused).Should().BeTrue();
        focused.ValueKind.Should().Be(JsonValueKind.Object, "a real, in-scope postId must resolve a non-null focused post");
        focused.GetProperty("id").GetString().Should().Be(postId.ToString());
        focused.GetProperty("authorPersonaId").GetString().Should().Be(authorPersonaId.ToString());
        focused.GetProperty("text").GetString().Should().Be("the focused post");

        // COR-053: scenarioTime is the persisted instant exactly, never re-derived from the server clock.
        DateTimeOffset.Parse(focused.GetProperty("scenarioTime").GetString()!).Should().Be(scenarioTime);
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

    private SocialApiWebApplicationFactory CreateFactory(Guid? exerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new SocialApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
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
