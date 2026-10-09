namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// The always-Critical cross-exercise cases for the B2 thread read and reply-parent resolver (COR-001, XC-001, DP-16;
/// story AC-5). Extends the standing isolation suite alongside <c>FeedThreadIsolationTests</c> (which is left
/// unedited). Every case drives the REAL host composition (<c>Program.cs</c>'s <c>AddSocialThreads()</c> and
/// <c>MapSocialThreadEndpoints()</c>) against real SQL Server and asserts the request FAILS CLOSED: a focused id, a
/// reply, an ancestor or a reply parent from another exercise behaves exactly like an id that does not exist.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class ThreadReplyIsolationTests
{
    private const string NotFoundBody = """{"ancestors":[],"focused":null,"replies":[]}""";

    private readonly MsSqlContainerFixture _fixture;

    public ThreadReplyIsolationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task CrossExerciseFocusedId_IsByteIdenticalToUnknown_Unparseable_AndSoftDeleted()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postB = ThreadSeed.NewPost(exerciseB, "SECRET-B-FOCUSED", ThreadSeed.Anchor);
        var replyB = ThreadSeed.NewPost(exerciseB, "SECRET-B-REPLY", ThreadSeed.Anchor.AddMinutes(1), postB.Id);
        var deletedA = ThreadSeed.NewPost(exerciseA, "A-DELETED-FOCUSED", ThreadSeed.Anchor, deletedAt: ThreadSeed.Anchor.AddMinutes(2));
        await SeedAsync(postB, replyB, deletedA);

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var unknown = await GetThreadAsync(client, Guid.NewGuid().ToString());
        var crossExercise = await GetThreadAsync(client, postB.Id.ToString());
        var unparseable = await GetThreadAsync(client, "not-a-guid");
        var softDeleted = await GetThreadAsync(client, deletedA.Id.ToString());

        unknown.Body.Should().Be(NotFoundBody);
        crossExercise.Should().BeEquivalentTo(unknown, "exercise B's real post id must answer exactly like an unknown id under scope A");
        unparseable.Should().BeEquivalentTo(unknown, "an unparseable id takes the same not-found path, never a 4xx/5xx");
        softDeleted.Should().BeEquivalentTo(unknown, "a soft-deleted focused id takes the same not-found path");

        crossExercise.Body.Should().NotContain("SECRET-B").And.NotContain(postB.Id.ToString()).And.NotContain(replyB.Id.ToString());

        await using var unfiltered = _fixture.CreateContext();
        (await unfiltered.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseB)).Should().Be(
            2, "B's thread does exist, so the not-found is the scope filter closing the door, not an empty table");
    }

    [RequiresDockerFact]
    public async Task ExerciseBSession_GetsTheNotFoundForExerciseAThread_WhileAStillSeesIt()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var rootA = ThreadSeed.NewPost(exerciseA, "SECRET-A-ROOT", ThreadSeed.Anchor);
        var focusedA = ThreadSeed.NewPost(exerciseA, "SECRET-A-FOCUSED", ThreadSeed.Anchor.AddMinutes(1), rootA.Id);
        var replyA = ThreadSeed.NewPost(exerciseA, "SECRET-A-REPLY", ThreadSeed.Anchor.AddMinutes(2), focusedA.Id);
        await SeedAsync(rootA, focusedA, replyA);

        await using (var factoryA = CreateFactory(exerciseA))
        {
            using var clientA = factoryA.CreateClient();
            var own = await GetThreadAsync(clientA, focusedA.Id.ToString());
            own.Body.Should().Contain("SECRET-A-FOCUSED", "positive control: A's own scope resolves its thread");
            own.Body.Should().Contain("SECRET-A-ROOT").And.Contain("SECRET-A-REPLY");
        }

        await using var factoryB = CreateFactory(exerciseB);
        using var clientB = factoryB.CreateClient();

        foreach (var id in new[] { rootA.Id, focusedA.Id, replyA.Id })
        {
            var crossed = await GetThreadAsync(clientB, id.ToString());
            var unknown = await GetThreadAsync(clientB, Guid.NewGuid().ToString());

            crossed.Should().BeEquivalentTo(unknown, "exercise B's session gets the byte-identical not-found for A's post {0}", id);
            crossed.Body.Should().NotContain("SECRET-A");
        }
    }

    [RequiresDockerFact]
    public async Task ReplyFromAnotherExercise_NamingThisPostAsParent_IsNeverListed()
    {
        // DP-16: the single-column self-FK lets a malformed row in B name A's post as its parent. A's thread must
        // not list it.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var focusedA = ThreadSeed.NewPost(exerciseA, "A-FOCUSED", ThreadSeed.Anchor);
        var replyA = ThreadSeed.NewPost(exerciseA, "A-REPLY", ThreadSeed.Anchor.AddMinutes(1), focusedA.Id);
        var replyB = ThreadSeed.NewPost(exerciseB, "SECRET-B-CROSS-REPLY", ThreadSeed.Anchor.AddMinutes(2), focusedA.Id);
        await SeedAsync(focusedA, replyA, replyB);

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var thread = await GetThreadAsync(client, focusedA.Id.ToString());

        var replyIds = JsonNode.Parse(thread.Body)!["replies"]!.AsArray().Select(r => r!["id"]!.GetValue<string>());
        replyIds.Should().Equal(new[] { replyA.Id.ToString() }, "only A's own replies are listed");
        thread.Body.Should().NotContain("SECRET-B").And.NotContain(replyB.Id.ToString());
    }

    [RequiresDockerFact]
    public async Task AncestorChainCrossingIntoAnotherExercise_StopsAtTheBoundary()
    {
        // A's reply → B's post → A's post. The walk must stop at B and never resurface on A's side of it.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var farAncestorA = ThreadSeed.NewPost(exerciseA, "A-BEYOND-THE-BOUNDARY", ThreadSeed.Anchor);
        var parentB = ThreadSeed.NewPost(exerciseB, "SECRET-B-ANCESTOR", ThreadSeed.Anchor.AddMinutes(1), farAncestorA.Id);
        var focusedA = ThreadSeed.NewPost(exerciseA, "A-FOCUSED-CHILD-OF-B", ThreadSeed.Anchor.AddMinutes(2), parentB.Id);
        await SeedAsync(farAncestorA, parentB, focusedA);

        await using var factory = CreateFactory(exerciseA);
        using var client = factory.CreateClient();

        var thread = await GetThreadAsync(client, focusedA.Id.ToString());
        var root = JsonNode.Parse(thread.Body)!;

        root["ancestors"]!.AsArray().Should().BeEmpty("the chain ends at the first parent outside the scope");
        root["focused"]!["id"]!.GetValue<string>().Should().Be(focusedA.Id.ToString());
        thread.Body.Should().NotContain("SECRET-B").And.NotContain(parentB.Id.ToString());
        thread.Body.Should().NotContain("A-BEYOND-THE-BOUNDARY", "the walk never crosses B to reach A's far ancestor");
    }

    [RequiresDockerFact]
    public async Task ExerciseBRealPostAsReplyParent_UnderScopeA_IsTheSameNotFoundAsAnUnknownId_AndWritesNothing()
    {
        // DP-16 at the seam BP calls: resolved through the REAL host's DI (Program.cs → AddSocialThreads), scoped A.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var postB = ThreadSeed.NewPost(exerciseB, "SECRET-B-PARENT", ThreadSeed.Anchor);
        var postA = ThreadSeed.NewPost(exerciseA, "A-PARENT", ThreadSeed.Anchor);
        await SeedAsync(postB, postA);

        var before = await CountAllAsync(exerciseA, exerciseB);

        await using var factory = CreateFactory(exerciseA);
        using var scope = factory.Services.CreateScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IReplyParentResolver>();

        resolver.Should().BeOfType<ReplyParentResolver>("the real resolver must win over any fallback in the real host");

        var crossExercise = await resolver.ResolveAsync(postB.Id.ToString(), CancellationToken.None);
        var unknown = await resolver.ResolveAsync(Guid.NewGuid().ToString(), CancellationToken.None);
        var own = await resolver.ResolveAsync(postA.Id.ToString(), CancellationToken.None);

        crossExercise.Should().Be(unknown, "B's real id must be indistinguishable from an unknown id");
        crossExercise.Should().Be(new ReplyParentResult(ReplyParentOutcome.NotFound, null));
        own.Outcome.Should().Be(ReplyParentOutcome.Resolved, "positive control: A's own post resolves");

        (await CountAllAsync(exerciseA, exerciseB)).Should().Be(before, "resolving a parent writes no rows in either exercise");
    }

    private async Task<(int A, int B)> CountAllAsync(Guid exerciseA, Guid exerciseB)
    {
        await using var context = _fixture.CreateContext();
        var posts = context.Posts.IgnoreQueryFilters();
        return (await posts.CountAsync(p => p.ExerciseId == exerciseA), await posts.CountAsync(p => p.ExerciseId == exerciseB));
    }

    private static async Task<ThreadHttpResult> GetThreadAsync(HttpClient client, string postId)
    {
        using var response = await client.GetAsync(new Uri($"/api/threads/{Uri.EscapeDataString(postId)}", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the thread read always answers 200 for a live session (the frozen client throws on non-2xx)");
        ThreadReplyDtoShapeTests.IsValidThreadResponse(JsonNode.Parse(body)).Should().BeTrue(
            "every thread response must satisfy the frozen client's isValidThreadResponse guard");

        return new ThreadHttpResult(response.StatusCode, response.Content.Headers.ContentType?.ToString(), body);
    }

    private ThreadApiWebApplicationFactory CreateFactory(Guid exerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull("the SQL fixture must be provisioned");
        return new ThreadApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
    }

    private async Task SeedAsync(params Post[] posts)
    {
        await using var seed = _fixture.CreateContext();
        seed.Posts.AddRange(posts);
        await seed.SaveChangesAsync();
    }

    /// <summary>Everything a client can observe about one thread response.</summary>
    private sealed record ThreadHttpResult(HttpStatusCode Status, string? ContentType, string Body);
}
