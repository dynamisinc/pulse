namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP (Gate-2 finding on BM): a media-SIGNING failure degrades the participant feed to media-less
/// posts — it never turns the feed, or the post-ingest broadcast, into a 500. A storage outage (a failed or slow
/// delegation-key fetch, RBAC not yet propagated, an unconfigured provider while media rows exist) is logged once
/// per projection and the posts are still served with their text, author, counts and <c>inReplyTo</c>. A scope
/// violation and cancellation are NOT absorbed.
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaSigningFailureTests
{
    private const string ProjectorCategory = "Pulse.WebApi.Features.Social.ParticipantPostProjector";
    private const string IngestCategory = "Pulse.WebApi.Features.Social.PostIngestService";

    private readonly MsSqlContainerFixture _fixture;

    public PostMediaSigningFailureTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerTheory]
    [InlineData("invalid-operation")]
    [InlineData("azure-request-failed")]
    [InlineData("generic")]
    public async Task ASigningFailure_ServesTheFeedWithoutMedia_StillBroadcastsTheNewPost_AndLogsOneWarning(string failureKind)
    {
        var failure = Failure(failureKind);
        var world = await SeedWorldAsync(_fixture);
        var parent = await SeedPostAsync(_fixture, world.Exercise, world.StaffPersona, BaseScenarioTime, body: "parent");
        var seededReply = await SeedPostAsync(
            _fixture, world.Exercise, world.StaffPersona, BaseScenarioTime.AddMinutes(1),
            parentPostId: parent.Id, baseline: (40, 4, 2), body: "seeded reply with media");
        var seededImage = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "h");
        await SeedMediaItemAsync(_fixture, world.Exercise, seededReply.Id, seededImage.Id, 0);
        var ownImage = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, world.ParticipantHuman);

        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!, signerFailure: failure);
        factory.Engagement.Set(seededReply.Id, like: 1, repost: 0, reply: 0);
        using var client = factory.CreateClientFor(world.Host, world.ParticipantToken);

        // Ingest: the new post commits, answers 201 and is broadcast — without its media.
        var created = await client.PostAsync(PostsUri, Json(Body(text: "new post with a photo", media: new[] { Item(ownImage.Id) })));
        created.StatusCode.Should().Be(HttpStatusCode.Created, "a storage hiccup must not fail a write ({0})", failureKind);
        var broadcast = factory.Broadcaster.Calls.Should().ContainSingle("the committed post is still broadcast").Subject.Post;
        broadcast.Text.Should().Be("new post with a photo");
        broadcast.Media.Should().BeNull("only the media is omitted");

        // Read: 200, every post present, media omitted, everything else intact.
        var response = await client.GetAsync(new Uri("/api/feed?includeReplies=true", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "one storage hiccup must not blank the participant feed ({0})", failureKind);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = document.RootElement.EnumerateArray().ToDictionary(i => i.GetProperty("text").GetString()!);

        items.Keys.Should().BeEquivalentTo(["parent", "seeded reply with media", "new post with a photo"]);
        items.Values.Should().AllSatisfy(i => i.TryGetProperty("media", out _).Should().BeFalse());
        var reply = items["seeded reply with media"];
        reply.GetProperty("inReplyTo").GetProperty("postId").GetString().Should().Be(parent.Id.ToString());
        reply.GetProperty("counts").GetProperty("like").GetInt32().Should().Be(41, "baseline + real counts still come through");
        reply.GetProperty("viewer").GetProperty("liked").GetBoolean().Should().BeFalse();

        // One warning per projection call (the ingest broadcast, then the feed read), carrying the exception.
        var signingWarnings = factory.Logs.Entries
            .Where(e => e.Category == ProjectorCategory && e.EventId.Id == 3)
            .ToArray();
        signingWarnings.Should().HaveCount(2).And.AllSatisfy(e =>
        {
            e.Level.Should().Be(LogLevel.Warning);
            e.Exception.Should().BeSameAs(failure);
            e.Message.Should().NotContain(".jpg", "no blob name is ever logged");
            e.Message.Should().NotContain("https://", "no URL is ever logged");
        });
        signingWarnings.Select(e => e.Message).Should().Satisfy(
            m => m.Contains("Signing 1 media asset(s)", StringComparison.Ordinal),
            m => m.Contains("Signing 2 media asset(s)", StringComparison.Ordinal));
        factory.Logs.Entries.Should().NotContain(
            e => e.Category == IngestCategory && e.EventId.Id == 3,
            "the projector absorbed the signing fault itself, so ingest never needed its whole-projection fallback");
    }

    [RequiresDockerFact]
    public async Task AScopeViolationFromTheSigner_IsNotAbsorbed_ItStillFailsClosed()
    {
        var (projector, posts, db) = await ProjectorWithOneMediaPostAsync(
            new ExerciseScopeViolationException("signer refused: asset outside the scope"));
        await using var _ = db;

        var project = () => projector.ProjectAsync(posts, new PostProjectionOptions(), CancellationToken.None);

        await project.Should().ThrowAsync<ExerciseScopeViolationException>(
            "a scope mismatch is an isolation signal, never a storage hiccup to degrade around");
    }

    [RequiresDockerFact]
    public async Task CancellationFromTheSigner_IsNotAbsorbed()
    {
        var (projector, posts, db) = await ProjectorWithOneMediaPostAsync(new OperationCanceledException());
        await using var _ = db;

        var project = () => projector.ProjectAsync(posts, new PostProjectionOptions(), CancellationToken.None);

        await project.Should().ThrowAsync<OperationCanceledException>();
    }

    private static Exception Failure(string kind) => kind switch
    {
        "invalid-operation" => new InvalidOperationException("Media storage is not configured."),
        "azure-request-failed" => new Azure.RequestFailedException(403, "AuthorizationPermissionMismatch"),
        _ => new TimeoutException("delegation key fetch timed out"),
    };

    private async Task<(ParticipantPostProjector Projector, Post[] Posts, PulseDbContext Db)> ProjectorWithOneMediaPostAsync(
        Exception failure)
    {
        var exerciseId = Guid.NewGuid();
        var post = await SeedPostAsync(_fixture, exerciseId, Guid.NewGuid(), BaseScenarioTime);
        var image = await SeedAssetAsync(_fixture, exerciseId, MediaKinds.Image, "h");
        await SeedMediaItemAsync(_fixture, exerciseId, post.Id, image.Id, 0);

        var scope = new ExerciseContext { CurrentExerciseId = exerciseId };
        var db = _fixture.CreateContext(scope);
        var projector = new ParticipantPostProjector(
            db, scope, new FakePostEngagementReader(), new ThrowingMediaUrlSigner(failure), new CapturingLogger<ParticipantPostProjector>());
        return (projector, [post], db);
    }
}
