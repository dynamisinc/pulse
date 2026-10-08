namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using static Pulse.WebApi.Tests.Features.Social.PostMediaSeed;

/// <summary>
/// demo-polish BP (Gate-2 finding on BM): a media-SIGNING failure degrades the participant feed to media-less
/// posts — it never turns the feed, or the post-ingest broadcast, into a 500. A storage outage (a failed or slow
/// delegation-key fetch, RBAC not yet propagated, an unconfigured provider while media rows exist) is logged once
/// per projection and the posts are still served with their text, author, counts and <c>inReplyTo</c>. A scope
/// violation and cancellation are NOT absorbed. The persona read (<c>GET /api/personas</c>, participant and staff,
/// and the staff single read) follows the same rule for avatars and banners (Wave 1b Gate-2 item 26).
/// </summary>
[Collection(MsSqlCollection.Name)]
public class PostMediaSigningFailureTests
{
    private const string ProjectorCategory = "Pulse.WebApi.Features.Social.ParticipantPostProjector";
    private const string IngestCategory = "Pulse.WebApi.Features.Social.PostIngestService";
    private const string PersonaReadCategory = "Pulse.WebApi.Features.Social.PersonaReadService";
    private static readonly Uri PersonasUri = new("/api/personas", UriKind.Relative);

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

    [RequiresDockerTheory]
    [InlineData("invalid-operation")]
    [InlineData("azure-request-failed")]
    [InlineData("generic")]
    [InlineData("unconfigured-fallback")]
    public async Task ASigningFailure_ServesThePersonas_WithoutAvatarOrBannerUrls_AndLogsOneWarningPerRead(string failureKind)
    {
        var world = await SeedWorldAsync(_fixture);
        var (avatar, banner) = await GiveStaffPersonaImagesAsync(world);

        // "unconfigured-fallback" is BP's fallback registration (BM's provider-None signer): an in-scope asset with no
        // storage throws MediaStoreUnavailableException, exactly what a UAT host without I1 would do.
        var failure = failureKind == "unconfigured-fallback" ? null : Failure(failureKind);
        await using var factory = failure is null
            ? new PostMediaWebApplicationFactory(_fixture.ConnectionString!, keepFallbackSigner: true)
            : new PostMediaWebApplicationFactory(_fixture.ConnectionString!, signerFailure: failure);

        // GET /api/personas as a participant (participant shape) and as staff (staff shape): 200, every persona
        // present, the images omitted, everything else intact.
        foreach (var token in new[] { world.ParticipantToken, world.StaffToken })
        {
            using var client = factory.CreateClientFor(world.Host, token);
            using var response = await client.GetAsync(PersonasUri);
            response.StatusCode.Should().Be(HttpStatusCode.OK, "one storage hiccup must not 500 the persona roster ({0})", failureKind);

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var personas = document.RootElement.EnumerateArray().ToArray();
            personas.Select(p => p.GetProperty("id").GetString()).Should().Contain(
                [world.StaffPersona.ToString(), world.ParticipantPersona.ToString(), world.OtherParticipantPersona.ToString()]);
            var withImages = personas.Single(p => p.GetProperty("id").GetString() == world.StaffPersona.ToString());
            withImages.TryGetProperty("avatarUrl", out _).Should().BeFalse("the avatar URL is omitted; the persona is not");
            withImages.TryGetProperty("bannerUrl", out _).Should().BeFalse();
            withImages.GetProperty("handle").GetString().Should().NotBeNullOrEmpty("handle lookups keep working");
            withImages.GetProperty("location").GetString().Should().Be("Fairhaven, OH");
        }

        // The staff single read (the persona-edit read-back) degrades the same way.
        using (var scope = factory.Services.CreateScope())
        {
            ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = world.Exercise;
            var single = await scope.ServiceProvider.GetRequiredService<PersonaReadService>()
                .GetStaffPersonaAsync(world.StaffPersona, CancellationToken.None);
            single.Should().NotBeNull();
            single!.AvatarUrl.Should().BeNull();
            single.BannerUrl.Should().BeNull();
            single.Location.Should().Be("Fairhaven, OH");
        }

        // One warning per read (participant roster, staff roster, staff single), with the exception and the asset
        // count — never a URL, blob name or asset id.
        var warnings = factory.Logs.Entries
            .Where(e => e.Category == PersonaReadCategory && e.EventId.Id == 1)
            .ToArray();
        warnings.Should().HaveCount(3).And.AllSatisfy(e =>
        {
            e.Level.Should().Be(LogLevel.Warning);
            e.Message.Should().Contain("Signing 2 profile image asset(s)");
            e.Message.Should().NotContain(".jpg", "no blob name is ever logged");
            e.Message.Should().NotContain("https://", "no URL is ever logged");
            e.Message.Should().NotContain(avatar.Id.ToString("N")).And.NotContain(banner.Id.ToString("N"));
            if (failure is null)
            {
                e.Exception.Should().BeOfType<MediaStoreUnavailableException>();
            }
            else
            {
                e.Exception.Should().BeSameAs(failure);
            }
        });
    }

    [RequiresDockerTheory]
    [InlineData("scope-violation")]
    [InlineData("cancellation")]
    public async Task PersonaRead_AScopeViolationOrCancellationFromTheSigner_IsNotAbsorbed(string failureKind)
    {
        Exception failure = failureKind == "scope-violation"
            ? new ExerciseScopeViolationException("signer refused: asset outside the scope")
            : new OperationCanceledException();
        var world = await SeedWorldAsync(_fixture);
        await GiveStaffPersonaImagesAsync(world);

        await using var factory = new PostMediaWebApplicationFactory(_fixture.ConnectionString!, signerFailure: failure);
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = world.Exercise;
        var service = scope.ServiceProvider.GetRequiredService<PersonaReadService>();

        var reads = new Func<Task>[]
        {
            () => service.GetParticipantPersonasAsync(CancellationToken.None),
            () => service.GetStaffPersonasAsync(CancellationToken.None),
            () => service.GetStaffPersonaAsync(world.StaffPersona, CancellationToken.None),
        };
        foreach (var read in reads)
        {
            (await read.Should().ThrowAsync<Exception>()).Which.Should().BeSameAs(
                failure, "a scope mismatch fails closed and cancellation propagates; neither is a storage hiccup ({0})", failureKind);
        }

        factory.Logs.Entries.Should().NotContain(e => e.Category == PersonaReadCategory, "nothing was absorbed, so nothing was logged");
    }

    private async Task<(MediaAsset Avatar, MediaAsset Banner)> GiveStaffPersonaImagesAsync(MediaWorld world)
    {
        var avatar = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "staff-uploader");
        var banner = await SeedAssetAsync(_fixture, world.Exercise, MediaKinds.Image, "staff-uploader");

        await using var seed = _fixture.CreateContext();
        var persona = await seed.Personas.IgnoreQueryFilters().SingleAsync(p => p.Id == world.StaffPersona);
        persona.AvatarMediaId = avatar.Id;
        persona.BannerMediaId = banner.Id;
        persona.Location = "Fairhaven, OH";
        await seed.SaveChangesAsync();
        return (avatar, banner);
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
