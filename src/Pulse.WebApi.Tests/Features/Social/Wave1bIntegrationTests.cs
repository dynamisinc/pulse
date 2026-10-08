namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Engagement;
using Pulse.WebApi.Features.Social.Threads;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Media;
using Xunit;

/// <summary>
/// demo-polish Wave 1b Gate-2 composition guard (plain <see cref="FactAttribute"/>s, no database): the INTEGRATED
/// <c>Program</c> host — BP, B2, B3, B6 and BM wired together — resolves every seam BP consumes to its real
/// implementation, never one of BP's <c>TryAdd</c> fallbacks, and builds with <c>ValidateScopes</c> +
/// <c>ValidateOnBuild</c> with no singleton capturing a scoped seam (Wave 1b checklist items 1, 2, 19, 25).
/// </summary>
public sealed class Wave1bIntegrationCompositionTests
{
    /// <summary>The three seams whose real implementations are Scoped and must never be captured by a singleton.</summary>
    private static readonly Type[] ScopedSeams = [typeof(IPostEngagementReader), typeof(IParticipantPostProjector), typeof(IMediaUrlSigner)];

    [Theory]
    [InlineData("Local")]
    [InlineData("Azure")]
    public void IntegratedHost_ResolvesEverySeamToItsRealImplementation_NeverABpFallback(string configuredProvider)
    {
        // Local: Development + appsettings.Development.json. Azure: the UAT shape after I1 (keyless, https ServiceUri).
        var (environment, settings, expectedSigner, expectedStore) = configuredProvider == "Local"
            ? (Environments.Development, new Dictionary<string, string?>(), typeof(LocalMediaUrlSigner), typeof(LocalFileMediaStore))
            : (Environments.Production,
                new Dictionary<string, string?>
                {
                    ["Azure:BlobStorage:Provider"] = "Azure",
                    ["Azure:BlobStorage:ServiceUri"] = "https://stpulseuat.blob.core.windows.net",
                },
                typeof(BlobMediaUrlSigner),
                typeof(AzureBlobMediaStore));

        using var factory = new ValidatingProbe(environment, settings);
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        var signer = provider.GetRequiredService<IMediaUrlSigner>();
        signer.Should().BeOfType(expectedSigner, "a configured provider must mint real read URLs");
        signer.Should().NotBeOfType<UnconfiguredMediaUrlSigner>(
            "neither BP's signer fallback nor BM's provider-None signer may win when a provider is configured (checklist 1, 25)");
        provider.GetRequiredService<IMediaStore>().Should().BeOfType(expectedStore);

        provider.GetRequiredService<IReplyParentResolver>().Should().BeOfType<ReplyParentResolver>(
            "B2's real resolver, never BP's UnavailableReplyParentResolver, or every reply is refused");
        provider.GetRequiredService<IPostEngagementReader>().Should().BeOfType<PostEngagementReader>(
            "B3's real reader, never BP's ZeroPostEngagementReader, or every count is baseline-only");
        provider.GetRequiredService<IParticipantPostProjector>().Should().BeOfType<ParticipantPostProjector>();

        factory.Registrations.Count(descriptor => descriptor.ServiceType == typeof(IMediaStore)).Should().Be(
            1, "exactly one IMediaStore is registered (checklist 25)");
    }

    [Fact]
    public void IntegratedHost_BuildsWithScopeValidation_AndNoSingletonCapturesAScopedSeam()
    {
        // ValidateOnBuild + ValidateScopes: building the host already fails if any constructor-built singleton
        // (the broadcaster, the engine publish funnel, the addressing observer, ...) depends, even transitively, on
        // a scoped service. Reaching factory.Services at all is the first assertion.
        using var factory = new ValidatingProbe(Environments.Development);
        var root = factory.Services;

        foreach (var seam in ScopedSeams)
        {
            // The LAST registration is the one the container resolves; the real one is Scoped, so with scope
            // validation on, resolving it from the ROOT provider throws. A singleton fallback would not.
            factory.Registrations.Last(descriptor => descriptor.ServiceType == seam).Lifetime.Should().Be(
                ServiceLifetime.Scoped, "the resolved {0} is the real, request-scoped implementation", seam.Name);
            root.Invoking(provider => provider.GetService(seam)).Should().Throw<InvalidOperationException>(
                "{0} is Scoped and the host validates scopes, so no root (singleton) resolution can capture it", seam.Name);
        }

        var captors = factory.Registrations
            .Where(descriptor => descriptor.Lifetime == ServiceLifetime.Singleton)
            .Select(descriptor => descriptor.IsKeyedService ? descriptor.KeyedImplementationType : descriptor.ImplementationType)
            .Where(type => type is { IsGenericTypeDefinition: false })
            .Where(type => type!.GetConstructors().Any(ctor => ctor.GetParameters().Any(parameter => ScopedSeams.Contains(parameter.ParameterType))))
            .Select(type => type!.FullName)
            .ToList();
        captors.Should().BeEmpty("no singleton may take IPostEngagementReader, IParticipantPostProjector or IMediaUrlSigner (checklist 19)");
    }

    /// <summary>
    /// The real <c>Program</c> host with a never-connecting database and explicit <c>ValidateScopes</c> +
    /// <c>ValidateOnBuild</c> (whatever the environment). It captures the final service collection so the
    /// registrations themselves can be inspected.
    /// </summary>
    private sealed class ValidatingProbe : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly string _environment;
        private readonly IReadOnlyDictionary<string, string?> _settings;
        private IServiceCollection? _registrations;

        public ValidatingProbe(string environment, IReadOnlyDictionary<string, string?>? settings = null)
        {
            _environment = environment;
            _settings = settings ?? new Dictionary<string, string?>();
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        /// <summary>The host's final service collection (Program.cs plus the framework), once the host is built.</summary>
        public IServiceCollection Registrations
        {
            get
            {
                _ = Services;
                return _registrations ?? throw new InvalidOperationException("the host did not run ConfigureTestServices");
            }
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.UseEnvironment(_environment);
            foreach (var (key, value) in _settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
            builder.ConfigureTestServices(services => _registrations = services);
        }

        protected override IHost CreateHost(IHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.UseDefaultServiceProvider(options =>
            {
                options.ValidateScopes = true;
                options.ValidateOnBuild = true;
            });
            return base.CreateHost(builder);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}

/// <summary>
/// demo-polish Wave 1b Gate-2 end-to-end checks across the five 1b stories, on the REAL <c>Program</c> host
/// (<see cref="MediaTestHost"/>: Development, the <c>Local</c> media store in a temp directory, real seeded sessions
/// and bearer tokens, no seam replaced) against real SQL Server. Each test crosses at least two stories' code:
/// B3's reaction write and engagement reader through BP's projector (counts parity), BM's upload and signer through
/// BP's post write and feed (media), and B6's takedown through B3's reactions and B2's thread (tombstones).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class Wave1bIntegrationTests
{
    private static readonly Uri PostsUri = new("/api/posts", UriKind.Relative);
    private static readonly Uri MediaUri = new("/api/media", UriKind.Relative);
    private static readonly Uri FeedUri = new("/api/feed", UriKind.Relative);
    private static readonly Uri FeedWithRepliesUri = new("/api/feed?includeReplies=true", UriKind.Relative);
    private static readonly DateTimeOffset PostTime = new(2033, 9, 4, 12, 0, 0, TimeSpan.FromHours(-5));

    private readonly MsSqlContainerFixture _fixture;

    public Wave1bIntegrationTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>Checklist 7 + 20: the PUT response's counts are exactly what the next feed (and thread) read shows.</summary>
    [RequiresDockerFact]
    public async Task LikeThenFeed_CountsEqualTheReactionResponse_ViewerLiked_AndIncludeRepliesChangesNothing()
    {
        var world = await SeedWorldAsync();
        var post = NewPost(world.Exercise.ExerciseId, world.AuthorPersona, "baseline post", baselineLike: 5, baselineRepost: 2, baselineReply: 3);
        var reply = NewPost(world.Exercise.ExerciseId, world.OtherPersona, "a real reply", parentPostId: post.Id, minutesAfter: 1);
        await using (var db = _fixture.CreateContext())
        {
            db.Posts.AddRange(post, reply);
            db.PostReactions.Add(NewReaction(world.Exercise.ExerciseId, post.Id, world.OtherPersona, deleted: false));
            db.PostReactions.Add(NewReaction(world.Exercise.ExerciseId, post.Id, world.AuthorPersona, deleted: true));
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var client = host.CreateClientFor(world.Exercise.Host, world.Participant.Token);

        using var liked = await client.PutAsync(ReactionUri(post.Id, "like"), content: null);
        liked.StatusCode.Should().Be(HttpStatusCode.OK, await liked.Content.ReadAsStringAsync());
        var state = JsonNode.Parse(await liked.Content.ReadAsStringAsync())!;
        var putCounts = Counts(state["counts"]!);
        putCounts.Should().Be(
            new WireCounts(Reply: 3 + 1, Repost: 2, Like: 5 + 1 + 1),
            "baseline + real: the other persona's like and mine, never the soft-deleted one; one non-deleted direct reply");
        state["viewer"]!["liked"]!.GetValue<bool>().Should().BeTrue();

        var feedPost = FindPost(await GetJsonAsync(client, FeedUri), post.Id);
        Counts(feedPost["counts"]!).Should().Be(putCounts, "the PUT response and the next feed read use the same reader");
        feedPost["viewer"]!["liked"]!.GetValue<bool>().Should().BeTrue();
        feedPost["viewer"]!["reposted"]!.GetValue<bool>().Should().BeFalse();

        var withReplies = await GetJsonAsync(client, FeedWithRepliesUri);
        Counts(FindPost(withReplies, post.Id)["counts"]!).Should().Be(putCounts, "includeReplies changes which posts are listed, never their counts");
        FindPost(withReplies, post.Id)["viewer"]!["liked"]!.GetValue<bool>().Should().BeTrue();
        withReplies.AsArray().Select(Id).Should().Contain(reply.Id.ToString());

        var thread = await GetJsonAsync(client, ThreadUri(post.Id));
        Counts(thread["focused"]!["counts"]!).Should().Be(putCounts, "the thread projects through the same projector (B2 M-2)");

        using var unliked = await client.DeleteAsync(ReactionUri(post.Id, "like"));
        unliked.StatusCode.Should().Be(HttpStatusCode.OK);
        var unlikedCounts = Counts(JsonNode.Parse(await unliked.Content.ReadAsStringAsync())!["counts"]!);
        unlikedCounts.Should().Be(putCounts with { Like = putCounts.Like - 1 });
        var afterUnlike = FindPost(await GetJsonAsync(client, FeedUri), post.Id);
        Counts(afterUnlike["counts"]!).Should().Be(unlikedCounts);
        afterUnlike["viewer"]!["liked"]!.GetValue<bool>().Should().BeFalse();
    }

    /// <summary>
    /// Checklist 3 + 24: BM's upload is attributed to the same acting human BP's ownership rule checks, the feed carries
    /// a real signed (Local) URL and the alt text, and another participant's or another exercise's id is the unknown-id
    /// 400 with nothing written.
    /// </summary>
    [RequiresDockerFact]
    public async Task UploadThenPost_FeedCarriesAWorkingSignedUrlAndAlt_AndAReusedIdIsTheUnknownId400()
    {
        var world = await SeedWorldAsync();
        var worldB = await SeedWorldAsync();

        await using var host = NewHost();
        using var participant = host.CreateClientFor(world.Exercise.Host, world.Participant.Token);
        using var other = host.CreateClientFor(world.Exercise.Host, world.Other.Token);
        using var participantB = host.CreateClientFor(worldB.Exercise.Host, worldB.Participant.Token);

        var bytes = MediaTestFiles.Png(4000);
        var mediaId = await UploadAsync(participant, bytes);
        var mediaIdInB = await UploadAsync(participantB, MediaTestFiles.Png(3000));

        // Another participant in the SAME exercise, an unknown id, and exercise B's real id: one indistinguishable 400.
        using var stolen = await other.PostAsync(PostsUri, Json(PostBody("steal", media: [MediaItem(mediaId, "alt")])));
        using var unknown = await other.PostAsync(PostsUri, Json(PostBody("unknown", media: [MediaItem(Guid.NewGuid().ToString(), "alt")])));
        using var crossExercise = await participant.PostAsync(PostsUri, Json(PostBody("cross", media: [MediaItem(mediaIdInB, "alt")])));

        var unknownBody = await unknown.Content.ReadAsStringAsync();
        unknown.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        stolen.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await stolen.Content.ReadAsStringAsync()).Should().Be(unknownBody, "another participant's upload reads as an unknown id (DP-3)");
        crossExercise.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await crossExercise.Content.ReadAsStringAsync()).Should().Be(unknownBody, "exercise B's real id reads as an unknown id (DP-16)");
        var exerciseId = world.Exercise.ExerciseId;
        var assetId = Guid.Parse(mediaId);
        await using (var check = _fixture.CreateContext())
        {
            (await check.Posts.IgnoreQueryFilters().CountAsync(p => p.ExerciseId == exerciseId)).Should().Be(0, "a refused post writes nothing");
            (await check.PostMediaItems.IgnoreQueryFilters().CountAsync(i => i.ExerciseId == exerciseId || i.MediaAssetId == assetId))
                .Should().Be(0, "no PostMediaItem row is written for a refused attachment");
        }

        // The uploader attaches their own asset: 201, and every surface carries the signed URL and the alt text.
        using var created = await participant.PostAsync(PostsUri, Json(PostBody("Flooding on Main", media: [MediaItem(mediaId, "<b>Flooded</b> street")])));
        created.StatusCode.Should().Be(HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        var postId = Guid.Parse(JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>());

        string blobName;
        await using (var check = _fixture.CreateContext())
        {
            blobName = (await check.MediaAssets.IgnoreQueryFilters().SingleAsync(asset => asset.Id == assetId)).BlobName;
        }

        foreach (var reader in new[] { participant, other })
        {
            var media = FindPost(await GetJsonAsync(reader, FeedUri), postId)["media"]!.AsArray().Should().ContainSingle().Subject!;
            media["id"]!.GetValue<string>().Should().Be(mediaId);
            media["kind"]!.GetValue<string>().Should().Be("image");
            media["alt"]!.GetValue<string>().Should().Be("Flooded street", "alt is sanitized on ingest and always present (NFR-001)");
            media["url"]!.GetValue<string>().Should().Be(
                $"http://{world.Exercise.Host}/dev-media/{blobName}",
                "the REAL Local signer minted it (the read URL carries the blob path by design, DP-11)");
        }

        var url = new Uri(FindPost(await GetJsonAsync(participant, FeedUri), postId)["media"]![0]!["url"]!.GetValue<string>());
        using var browser = host.CreateClientFor(world.Exercise.Host, bearerToken: null);
        using var fetched = await browser.GetAsync(new Uri(url.PathAndQuery, UriKind.Relative));
        fetched.StatusCode.Should().Be(HttpStatusCode.OK, "a browser can GET the signed URL with no credential");
        (await fetched.Content.ReadAsByteArrayAsync()).Should().Equal(bytes);
    }

    /// <summary>
    /// Checklist 24 (Gate-2 S-4), over the wire: the SignalR <c>PostReceived</c> push of a post with media carries the
    /// REAL signer's URL and the alt text, through the real <c>SignalRFeedBroadcaster</c> and <c>ExerciseRealtimeHub</c>,
    /// and never a <c>viewer</c> (one payload goes to the whole exercise).
    /// </summary>
    [RequiresDockerFact]
    public async Task PostReceived_CarriesTheRealSignedMediaUrlAndAlt_AndNoViewer()
    {
        var world = await SeedWorldAsync();

        await using var host = NewHost();
        using var participant = host.CreateClientFor(world.Exercise.Host, world.Participant.Token);
        await using var listener = await HubRecorder.ConnectAsync(host, world.Exercise.Host, world.Other.Token);
        await listener.WaitUntilInGroupAsync(host, $"exercise:{world.Exercise.ExerciseId}");

        var mediaId = await UploadAsync(participant, MediaTestFiles.Png(3000));
        using var created = await participant.PostAsync(PostsUri, Json(PostBody("live photo", media: [MediaItem(mediaId, "<i>Levee</i> breach")])));
        created.StatusCode.Should().Be(HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        var postId = JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>();

        string blobName;
        await using (var check = _fixture.CreateContext())
        {
            var assetId = Guid.Parse(mediaId);
            blobName = (await check.MediaAssets.IgnoreQueryFilters().SingleAsync(asset => asset.Id == assetId)).BlobName;
        }

        var pushed = await listener.WaitForPostAsync(postId);
        pushed.AsObject().ContainsKey("viewer").Should().BeFalse("a broadcast never carries viewer state");
        var media = pushed["media"]!.AsArray().Should().ContainSingle().Subject!;
        media["id"]!.GetValue<string>().Should().Be(mediaId);
        media["alt"]!.GetValue<string>().Should().Be("Levee breach");
        media["url"]!.GetValue<string>().Should().Be(
            $"http://{world.Exercise.Host}/dev-media/{blobName}", "the push is projected through the REAL signer, like the feed");
    }

    /// <summary>
    /// Checklist 8 + 21: after B6 takes a reply down, B3 answers 404 exactly as for an unknown id, the parent's reply
    /// count drops by one, the feed (even with replies) omits it, and B2's thread shows it as a tombstone.
    /// </summary>
    [RequiresDockerFact]
    public async Task TakenDownReply_ReactionIsTheUnknownId404_ParentReplyCountDrops_AndTheThreadShowsATombstone()
    {
        var world = await SeedWorldAsync();
        var parent = NewPost(world.Exercise.ExerciseId, world.AuthorPersona, "the parent");
        await using (var db = _fixture.CreateContext())
        {
            db.Posts.Add(parent);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var participant = host.CreateClientFor(world.Exercise.Host, world.Participant.Token);
        using var staff = host.CreateClientFor(world.Exercise.Host, world.Staff.Token);

        var replyIds = new List<Guid>();
        foreach (var text in new[] { "first reply", "second reply" })
        {
            using var created = await participant.PostAsync(PostsUri, Json(PostBody(text, parentPostId: parent.Id.ToString())));
            created.StatusCode.Should().Be(HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
            replyIds.Add(Guid.Parse(JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>()));
        }

        var takenDown = replyIds[0];
        using (var like = await participant.PutAsync(ReactionUri(takenDown, "like"), content: null))
        {
            like.StatusCode.Should().Be(HttpStatusCode.OK, "a live reply can be liked");
        }

        Counts(FindPost(await GetJsonAsync(participant, FeedUri), parent.Id)["counts"]!).Reply.Should().Be(2);

        using (var removed = await staff.DeleteAsync(new Uri($"/api/staff/posts/{takenDown}?category=other", UriKind.Relative)))
        {
            removed.StatusCode.Should().Be(HttpStatusCode.NoContent, await removed.Content.ReadAsStringAsync());
        }

        // B3 x B6: a taken-down post is indistinguishable from an unknown id, for PUT and DELETE alike.
        var unknownId = Guid.NewGuid();
        await AssertSameResponseAsync(
            await participant.PutAsync(ReactionUri(takenDown, "like"), content: null),
            await participant.PutAsync(ReactionUri(unknownId, "like"), content: null),
            HttpStatusCode.NotFound);
        await AssertSameResponseAsync(
            await participant.DeleteAsync(ReactionUri(takenDown, "like")),
            await participant.DeleteAsync(ReactionUri(unknownId, "like")),
            HttpStatusCode.NotFound);

        // B3 x B2 x BP: the parent's reply count drops by one on every read surface.
        Counts(FindPost(await GetJsonAsync(participant, FeedUri), parent.Id)["counts"]!).Reply.Should().Be(1, "RealReply excludes a taken-down reply");
        var withReplies = await GetJsonAsync(participant, FeedWithRepliesUri);
        withReplies.AsArray().Select(Id).Should().Contain(replyIds[1].ToString()).And.NotContain(takenDown.ToString(), "includeReplies never lists a taken-down post");

        var thread = await GetJsonAsync(participant, ThreadUri(parent.Id));
        thread["focused"]!["counts"]!["reply"]!.GetValue<int>().Should().Be(1);
        var replies = thread["replies"]!.AsArray();
        replies.Select(Id).Should().BeEquivalentTo(replyIds.Select(id => id.ToString()), "the taken-down reply stays in the thread");
        var tombstone = replies.Single(reply => Id(reply) == takenDown.ToString())!.AsObject();
        tombstone["status"]!.GetValue<string>().Should().Be("taken-down");
        tombstone["text"]!.GetValue<string>().Should().BeEmpty();
        Counts(tombstone["counts"]!).Should().Be(new WireCounts(0, 0, 0), "a tombstone never reads the taken-down post's engagement");
        tombstone.ContainsKey("media").Should().BeFalse();
        tombstone.ContainsKey("viewer").Should().BeFalse();
        tombstone.ContainsKey("inReplyTo").Should().BeFalse();
        replies.Single(reply => Id(reply) == replyIds[1].ToString())!["status"]!.GetValue<string>().Should().Be("visible");

        // The taken-down reply's own thread is the not-found shape, byte-identical to an unknown id's.
        (await participant.GetStringAsync(ThreadUri(takenDown))).Should().Be(await participant.GetStringAsync(ThreadUri(unknownId)));
    }

    /// <summary>
    /// Checklist 8, orchestrator decision: a reply to a taken-down PARENT keeps <c>inReplyTo</c> with the parent's id
    /// and handle (as X does: the reply still reads "Replying to @handle"; the parent itself is the tombstone). The
    /// taken-down parent never comes back: it is out of every feed, omitted from the reply's ancestors, and its own
    /// thread is the not-found shape.
    /// </summary>
    [RequiresDockerFact]
    public async Task TakenDownParent_ItsReplyKeepsInReplyTo_WithTheParentsHandle_InTheFeedAndTheThread()
    {
        var world = await SeedWorldAsync();
        var parent = NewPost(world.Exercise.ExerciseId, world.AuthorPersona, "the parent");
        await using (var db = _fixture.CreateContext())
        {
            db.Posts.Add(parent);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var participant = host.CreateClientFor(world.Exercise.Host, world.Participant.Token);
        using var staff = host.CreateClientFor(world.Exercise.Host, world.Staff.Token);

        using var created = await participant.PostAsync(PostsUri, Json(PostBody("my reply", parentPostId: parent.Id.ToString())));
        created.StatusCode.Should().Be(HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        var replyId = Guid.Parse(JsonNode.Parse(await created.Content.ReadAsStringAsync())!["id"]!.GetValue<string>());

        using (var removed = await staff.DeleteAsync(new Uri($"/api/staff/posts/{parent.Id}?category=other", UriKind.Relative)))
        {
            removed.StatusCode.Should().Be(HttpStatusCode.NoContent, await removed.Content.ReadAsStringAsync());
        }

        var parentHandle = $"p_{world.AuthorPersona:N}";

        var withReplies = await GetJsonAsync(participant, FeedWithRepliesUri);
        withReplies.AsArray().Select(Id).Should().NotContain(parent.Id.ToString(), "the taken-down parent is out of every feed");
        var feedReply = FindPost(withReplies, replyId);
        feedReply["inReplyTo"]!["postId"]!.GetValue<string>().Should().Be(parent.Id.ToString(), "the reply still says what it replied to");
        feedReply["inReplyTo"]!["authorHandle"]!.GetValue<string>().Should().Be(parentHandle);
        feedReply["text"]!.GetValue<string>().Should().Be("my reply");

        (await GetJsonAsync(participant, FeedUri)).AsArray().Select(Id).Should().NotContain(
            new[] { parent.Id.ToString(), replyId.ToString() }, "the default feed is top-level only, and the parent is down");

        var thread = await GetJsonAsync(participant, ThreadUri(replyId));
        thread["focused"]!["id"]!.GetValue<string>().Should().Be(replyId.ToString());
        thread["focused"]!["inReplyTo"]!["postId"]!.GetValue<string>().Should().Be(parent.Id.ToString());
        thread["focused"]!["inReplyTo"]!["authorHandle"]!.GetValue<string>().Should().Be(parentHandle);
        thread["ancestors"]!.AsArray().Should().BeEmpty("a taken-down ancestor is omitted from the chain");

        (await participant.GetStringAsync(ThreadUri(parent.Id))).Should().Be(
            await participant.GetStringAsync(ThreadUri(Guid.NewGuid())), "the taken-down parent's own thread is the not-found shape");
    }

    private static async Task AssertSameResponseAsync(HttpResponseMessage actual, HttpResponseMessage unknown, HttpStatusCode expected)
    {
        using (actual)
        using (unknown)
        {
            unknown.StatusCode.Should().Be(expected);
            actual.StatusCode.Should().Be(unknown.StatusCode);
            actual.Content.Headers.ContentType?.ToString().Should().Be(unknown.Content.Headers.ContentType?.ToString());
            (await actual.Content.ReadAsStringAsync()).Should().Be(await unknown.Content.ReadAsStringAsync(), "byte-identical to an unknown id");
        }
    }

    private static WireCounts Counts(JsonNode counts) =>
        new(counts["reply"]!.GetValue<int>(), counts["repost"]!.GetValue<int>(), counts["like"]!.GetValue<int>());

    private static JsonNode FindPost(JsonNode feed, Guid postId) =>
        feed.AsArray().Should().ContainSingle(post => Id(post) == postId.ToString(), "post {0} is in the feed", postId).Subject!;

    private static string Id(JsonNode? post) => post!["id"]!.GetValue<string>();

    private static async Task<JsonNode> GetJsonAsync(HttpClient client, Uri uri)
    {
        using var response = await client.GetAsync(uri);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return JsonNode.Parse(body)!;
    }

    private static async Task<string> UploadAsync(HttpClient client, byte[] bytes)
    {
        using var response = await client.PostAsync(MediaUri, MediaTestFiles.Form(bytes, "photo.png"));
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, body);
        return JsonNode.Parse(body)!["id"]!.GetValue<string>();
    }

    private static Uri ReactionUri(Guid postId, string kind) => new($"/api/posts/{postId}/reactions/{kind}", UriKind.Relative);

    private static Uri ThreadUri(Guid postId) => new($"/api/threads/{postId}", UriKind.Relative);

    private static StringContent Json(object body) => new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static Dictionary<string, object?> MediaItem(string mediaId, string alt) => new() { ["mediaId"] = mediaId, ["alt"] = alt };

    private static Dictionary<string, object?> PostBody(
        string text, IReadOnlyList<Dictionary<string, object?>>? media = null, string? parentPostId = null)
    {
        var body = new Dictionary<string, object?>
        {
            ["authorPersonaId"] = Guid.NewGuid().ToString(),
            ["text"] = text,
            ["scenarioTime"] = "2033-09-04T14:30:00-05:00",
            ["timeZone"] = "America/Chicago",
            ["origin"] = "participant",
        };
        if (media is not null)
        {
            body["media"] = media;
        }

        if (parentPostId is not null)
        {
            body["parentPostId"] = parentPostId;
        }

        return body;
    }

    private static Post NewPost(
        Guid exerciseId,
        Guid authorPersonaId,
        string body,
        Guid? parentPostId = null,
        int minutesAfter = 0,
        int baselineLike = 0,
        int baselineRepost = 0,
        int baselineReply = 0) => new()
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            AuthorPersonaId = authorPersonaId,
            Body = body,
            CreatedScenarioTime = PostTime.AddMinutes(minutesAfter),
            CreatedWallClock = DateTimeOffset.UtcNow,
            Origin = "inject",
            ActingHumanId = "wave1b-seed",
            ParentPostId = parentPostId,
            BaselineLikeCount = baselineLike,
            BaselineRepostCount = baselineRepost,
            BaselineReplyCount = baselineReply,
        };

    private static PostReaction NewReaction(Guid exerciseId, Guid postId, Guid personaId, bool deleted) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = exerciseId,
        PostId = postId,
        PersonaId = personaId,
        Kind = "like",
        CreatedScenarioTime = PostTime.AddMinutes(5),
        DeletedAt = deleted ? PostTime.AddMinutes(6) : null,
    };

    private static Persona NewPersona(Guid id, Guid exerciseId) => new()
    {
        Id = id,
        ExerciseId = exerciseId,
        DisplayName = $"Persona {id:N}",
        Handle = $"p_{id:N}",
        Kind = "human",
        Verified = false,
    };

    private MediaTestHost NewHost() => new(_fixture.ConnectionString!);

    /// <summary>
    /// One live exercise with a provisioned host: two persona-bound participant sessions (with persona rows), an
    /// author persona, and an assigned controller staff session.
    /// </summary>
    private async Task<World> SeedWorldAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull("the SQL fixture must be provisioned");

        await using var db = _fixture.CreateContext();
        var exercise = MediaSeed.NewExercise(db);
        var participant = MediaSeed.Participant(db, exercise);
        var other = MediaSeed.Participant(db, exercise);
        var staff = MediaSeed.Staff(db, exercise);
        var authorPersona = Guid.NewGuid();

        db.Personas.Add(NewPersona(participant.Session.PersonaId!.Value, exercise.ExerciseId));
        db.Personas.Add(NewPersona(other.Session.PersonaId!.Value, exercise.ExerciseId));
        db.Personas.Add(NewPersona(authorPersona, exercise.ExerciseId));
        await db.SaveChangesAsync();

        return new World(exercise, participant, other, staff, authorPersona, other.Session.PersonaId!.Value);
    }

    /// <summary>
    /// A started hub connection (long polling — the only transport <c>TestServer</c> supports end to end) recording
    /// every raw <c>PostReceived</c> payload. Group membership is proven with a nonce probe, as B6's live-removal suite
    /// does, because <c>StartAsync</c> can return before the hub's <c>OnConnectedAsync</c> has joined the group.
    /// </summary>
    private sealed class HubRecorder : IAsyncDisposable
    {
        private const string PostReceived = "PostReceived";
        private const string Probe = "Wave1bProbe";
        private static readonly TimeSpan DeliveryTimeout = TimeSpan.FromSeconds(10);

        private readonly HubConnection _connection;
        private readonly ConcurrentQueue<string> _posts = new();
        private readonly ConcurrentDictionary<string, byte> _probes = new(StringComparer.Ordinal);

        private HubRecorder(HubConnection connection)
        {
            _connection = connection;
            _connection.On<JsonElement>(PostReceived, payload => _posts.Enqueue(payload.GetRawText()));
            _connection.On<string>(Probe, nonce => _probes.TryAdd(nonce, 0));
        }

        public static async Task<HubRecorder> ConnectAsync(MediaTestHost host, string hostname, string token)
        {
            var connection = new HubConnectionBuilder()
                .WithUrl(new Uri($"http://{hostname}/hubs/exercise"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => host.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                    options.AccessTokenProvider = () => Task.FromResult<string?>(token);
                })
                .Build();
            var recorder = new HubRecorder(connection);
            await connection.StartAsync();
            return recorder;
        }

        public async Task WaitUntilInGroupAsync(MediaTestHost host, string groupName)
        {
            var hubContext = host.Services.GetRequiredService<IHubContext<ExerciseRealtimeHub>>();
            var nonce = Guid.NewGuid().ToString();
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline && !_probes.ContainsKey(nonce))
            {
                await hubContext.Clients.Group(groupName).SendAsync(Probe, nonce);
                await Task.Delay(100);
            }

            _probes.ContainsKey(nonce).Should().BeTrue($"the connection should join {groupName} within {DeliveryTimeout}");
        }

        public async Task<JsonNode> WaitForPostAsync(string postId)
        {
            var deadline = DateTime.UtcNow + DeliveryTimeout;
            while (DateTime.UtcNow < deadline)
            {
                var match = _posts.Select(raw => JsonNode.Parse(raw)!).FirstOrDefault(post => Id(post) == postId);
                if (match is not null)
                {
                    return match;
                }

                await Task.Delay(50);
            }

            throw new TimeoutException($"PostReceived for {postId} did not arrive within {DeliveryTimeout}.");
        }

        public ValueTask DisposeAsync() => _connection.DisposeAsync();
    }

    /// <summary>A wire <c>counts</c> object, read back for value comparison.</summary>
    private sealed record WireCounts(int Reply, int Repost, int Like);

    private sealed record World(
        MediaSeed.SeededExercise Exercise,
        MediaSeed.SeededSession Participant,
        MediaSeed.SeededSession Other,
        MediaSeed.SeededSession Staff,
        Guid AuthorPersona,
        Guid OtherPersona);
}
