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
/// Integration tests for <c>GET /api/feed</c> (story <c>social-api/01-feed-read-api</c>, #270; SOC-080).
/// Boots the real host (<see cref="SocialApiWebApplicationFactory"/>) against the shared Testcontainers SQL
/// Server, seeds through a separate scoped <see cref="Data.PulseDbContext"/>, and drives the endpoint over
/// HTTP — the same pattern <c>Telemetry/TelemetryIngestTests</c> establishes. Covers the feed's shape AC
/// (SOC-080), the XC-002 wire-level provenance-absence guarantee, scenario-time preservation (COR-053), and
/// the fail-closed unresolved-scope AC. Cross-exercise scoping itself (the isolation half of SOC-080) lives
/// in <c>FeedThreadIsolationTests</c>, alongside the standing suite (<c>exercise-isolation/07</c>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class FeedReadEndpointTests
{
    private static readonly Uri FeedUri = new("/api/feed", UriKind.Relative);

    private readonly MsSqlContainerFixture _fixture;

    public FeedReadEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Feed_ScopedToExerciseA_ReturnsPost_WithIsPostShape_AndPersistedScenarioTime()
    {
        var exerciseA = Guid.NewGuid();
        var postId = Guid.NewGuid();
        var authorPersonaId = Guid.NewGuid();
        var scenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5));

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postId, exerciseA, authorPersonaId, "Hello exercise A", scenarioTime));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(FeedUri);

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = document.RootElement.EnumerateArray().ToArrayOfElements();

        items.Should().ContainSingle("the feed must contain exactly the one post seeded in exercise A");
        var item = items[0];

        // feedService.ts's `isPost` runtime guard: id, authorPersonaId, text, scenarioTime, counts.{reply,repost,like}.
        item.GetProperty("id").GetString().Should().Be(postId.ToString());
        item.GetProperty("authorPersonaId").GetString().Should().Be(authorPersonaId.ToString());
        item.GetProperty("text").GetString().Should().Be("Hello exercise A");
        item.TryGetProperty("counts", out var counts).Should().BeTrue();
        counts.GetProperty("reply").GetInt32().Should().Be(0);
        counts.GetProperty("repost").GetInt32().Should().Be(0);
        counts.GetProperty("like").GetInt32().Should().Be(0);

        // COR-053: scenarioTime is the persisted instant exactly, never re-derived from the server clock.
        item.TryGetProperty("scenarioTime", out var scenarioTimeElement).Should().BeTrue();
        DateTimeOffset.Parse(scenarioTimeElement.GetString()!).Should().Be(scenarioTime);
    }

    [RequiresDockerFact]
    public async Task Feed_ResponseBody_NeverContainsProvenanceKeys_OnAnyItem()
    {
        // XC-002 / S2-2 retirement: seed a post whose provenance fields are all distinctive, non-default
        // values, so a leak would be unmistakable — then assert those KEYS are structurally absent from the
        // raw wire JSON, not merely unread.
        var exerciseA = Guid.NewGuid();
        var postId = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            var post = NewPost(postId, exerciseA, Guid.NewGuid(), "provenance must never leak", DateTimeOffset.UtcNow);
            post.Origin = "inject";
            post.ActingHumanId = "human-should-never-appear";
            post.CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero);
            post.InjectId = "inject-should-never-appear";
            seed.Posts.Add(post);
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(FeedUri);
        var body = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(body);
        var items = document.RootElement.EnumerateArray().ToArrayOfElements();
        items.Should().ContainSingle();
        var item = items[0];

        item.TryGetProperty("origin", out _).Should().BeFalse("origin is staff/telemetry-only (XC-002)");
        item.TryGetProperty("actingHumanId", out _).Should().BeFalse("actingHumanId is staff/telemetry-only (COR-018, XC-002)");
        item.TryGetProperty("createdWallClock", out _).Should().BeFalse("wall-clock time must never reach a participant (COR-053, XC-002)");
        item.TryGetProperty("injectId", out _).Should().BeFalse("injectId is staff/telemetry-only (XC-002)");

        // Belt-and-suspenders: the raw string never contains the distinctive provenance values either.
        body.Should().NotContain("human-should-never-appear");
        body.Should().NotContain("inject-should-never-appear");
    }

    [RequiresDockerFact]
    public async Task Feed_UnresolvedScope_Returns401_NeverEmptyOk()
    {
        var exerciseA = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(Guid.NewGuid(), exerciseA, Guid.NewGuid(), "should never be reachable", DateTimeOffset.UtcNow));
            await seed.SaveChangesAsync();
        }

        // exerciseId: null -> the test host's IExerciseContext.CurrentExerciseId is unresolved.
        await using var factory = CreateFactory(exerciseId: null);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(FeedUri);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolvable exercise scope must fail closed with 401, never a default/empty-but-200/unscoped result");
    }

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

/// <summary>Small <see cref="JsonElement"/> array-materialization helper shared by the social-api read tests.</summary>
internal static class JsonElementEnumerableExtensions
{
    public static JsonElement[] ToArrayOfElements(this JsonElement.ArrayEnumerator enumerator)
    {
        var list = new System.Collections.Generic.List<JsonElement>();
        foreach (var element in enumerator)
        {
            list.Add(element);
        }

        return list.ToArray();
    }
}
