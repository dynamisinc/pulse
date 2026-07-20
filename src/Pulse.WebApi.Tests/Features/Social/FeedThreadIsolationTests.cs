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
/// Cross-exercise isolation cases for <c>GET /api/feed</c> and <c>GET /api/threads/{postId}</c> (story
/// <c>social-api/01-feed-read-api</c>, #270) — the standing isolation suite's first two entries for this
/// endpoint pair (<c>exercise-isolation/07-isolation-test-suite</c>, COR-007). Both endpoints inherit the
/// central exercise-scoping read filter (<c>exercise-isolation/01</c>), so these tests attempt
/// cross-exercise access and assert it fails closed — a request scoped to exercise A must never see, list,
/// or resolve exercise B's content, and a cross-exercise <c>postId</c> must be indistinguishable from an
/// unknown one (the story's own [Tier-2] design note in <c>ThreadEndpoints.cs</c>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class FeedThreadIsolationTests
{
    private readonly MsSqlContainerFixture _fixture;

    public FeedThreadIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task Feed_ScopedToExerciseA_ExcludesExerciseBPosts()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postA = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postA, exerciseA, "exercise A's own post"));
            seed.Posts.Add(NewPost(postB, exerciseB, "SECRET-EXERCISE-B-CONTENT"));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/feed", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        using var document = JsonDocument.Parse(body);
        var ids = new System.Collections.Generic.List<string>();
        foreach (var item in document.RootElement.EnumerateArray())
        {
            ids.Add(item.GetProperty("id").GetString()!);
        }

        ids.Should().Contain(postA.ToString(), "exercise A's scope must still see its own post");
        ids.Should().NotContain(postB.ToString(), "exercise A's scope must never see exercise B's post id");
        body.Should().NotContain("SECRET-EXERCISE-B-CONTENT", "exercise B's post text must never appear in an exercise-A response body");
    }

    [RequiresDockerFact]
    public async Task Thread_CrossExercisePostId_ScopedToExerciseA_ReturnsFocusedNull_NeverExerciseBContent()
    {
        // The [Tier-2] case named explicitly in the story AC: a postId KNOWN to belong to exercise B,
        // requested under exercise A's scope. ThreadEndpoints.cs's own design note explains why this is
        // 200-with-nulls rather than 404: the central query filter makes a cross-exercise id
        // indistinguishable from an unknown one, so a byte-identical not-found response leaks nothing, not
        // even existence — the same guarantee QueryFilterIsolationTests.IdorAttempt_* proves at the DbContext
        // layer, exercised here end-to-end over HTTP.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postB = Guid.NewGuid();

        await using (var seed = _fixture.CreateContext())
        {
            seed.Posts.Add(NewPost(postB, exerciseB, "SECRET-EXERCISE-B-THREAD-CONTENT"));
            await seed.SaveChangesAsync();
        }

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri($"/api/threads/{postB}", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the frozen client throws on any non-2xx and accepts focused:null — a 404 here would crash the participant view");

        using var document = JsonDocument.Parse(body);
        var root = document.RootElement;

        root.GetProperty("focused").ValueKind.Should().Be(
            JsonValueKind.Null, "a postId known to belong to exercise B must never resolve under exercise A's scope");
        root.GetProperty("ancestors").GetArrayLength().Should().Be(0);
        root.GetProperty("replies").GetArrayLength().Should().Be(0);

        body.Should().NotContain(
            "SECRET-EXERCISE-B-THREAD-CONTENT", "exercise B's post text must never appear in an exercise-A-scoped response body");
        body.Should().NotContain(
            postB.ToString(), "exercise B's real post id must never appear in an exercise-A-scoped response body — not even to confirm existence");
    }

    private SocialApiWebApplicationFactory CreateFactory(Guid? exerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new SocialApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
    }

    private static Post NewPost(Guid id, Guid exerciseId, string body) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        AuthorPersonaId = Guid.NewGuid(),
        Body = body,
        CreatedScenarioTime = DateTimeOffset.UtcNow,
        Origin = "participant",
        ActingHumanId = "human-test",
        CreatedWallClock = new DateTimeOffset(2033, 9, 4, 13, 15, 0, TimeSpan.Zero),
    };
}
