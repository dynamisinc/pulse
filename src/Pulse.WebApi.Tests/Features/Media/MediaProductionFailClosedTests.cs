namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// demo-polish BM AC "No account key, ever" — the PRODUCTION posture, through the real <c>Program</c> pipeline and
/// real SQL. With no usable provider the upload answers <c>503 {"error"}</c> while every other endpoint keeps
/// working; that includes the Gate-2 M-2 case — the live UAT App Service still carries the PRE-I1 settings
/// (<c>Provider=Azure</c>, an empty <c>ConnectionString</c>, no <c>ServiceUri</c>), which must boot, 503 the upload
/// and serve <c>/api/feed</c>. <c>Local</c> and <c>/dev-media</c> do not exist outside Development. And with a
/// usable Azure provider the whole upload→SAS path composes (the SDK runs against <see cref="FakeBlobService"/>).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class MediaProductionFailClosedTests
{
    private const string Production = "Production";

    private readonly MsSqlContainerFixture _fixture;

    public MediaProductionFailClosedTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    public static TheoryData<string, Dictionary<string, string?>> UnusableProviders() => new()
    {
        { "provider unset (committed default None)", new Dictionary<string, string?>() },
        { "provider None", new Dictionary<string, string?> { ["Azure:BlobStorage:Provider"] = "None" } },
        {
            "M-2: pre-I1 UAT settings (Azure, empty ConnectionString, no ServiceUri)",
            new Dictionary<string, string?>
            {
                ["Azure:BlobStorage:Provider"] = "Azure",
                ["Azure:BlobStorage:ConnectionString"] = string.Empty,
                ["Azure:BlobStorage:PhotoContainerName"] = "photos",
            }
        },
        {
            "Azure with an empty ServiceUri",
            new Dictionary<string, string?> { ["Azure:BlobStorage:Provider"] = "Azure", ["Azure:BlobStorage:ServiceUri"] = string.Empty }
        },
        { "Local outside Development", new Dictionary<string, string?> { ["Azure:BlobStorage:Provider"] = "Local" } },
    };

    [RequiresDockerTheory]
    [MemberData(nameof(UnusableProviders))]
    public async Task WithNoUsableProvider_UploadIs503_WhileTheFeedStillServes200(string label, Dictionary<string, string?> settings)
    {
        var (exercise, participant) = await SeedAsync();
        await using var host = new MediaTestHost(_fixture.ConnectionString!, Production, settings);
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var upload = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));
        using var feed = await client.GetAsync(new Uri("/api/feed", UriKind.Relative));

        upload.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, "{0}: no usable store, so uploads fail closed", label);
        JsonDocument.Parse(await upload.Content.ReadAsStringAsync()).RootElement.GetProperty("error").GetString()
            .Should().Be("media-store-unavailable");
        feed.StatusCode.Should().Be(HttpStatusCode.OK, "{0}: the rest of the API is unaffected — the host booted and serves the feed", label);

        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<IMediaStore>().IsConfigured.Should().BeFalse("{0}", label);
        scope.ServiceProvider.GetRequiredService<IMediaUrlSigner>().Should().BeOfType<UnconfiguredMediaUrlSigner>(
            "{0}: a signer is ALWAYS registered (the post projector resolves it on every feed read)", label);
        Directory.Exists(host.LocalRoot).Should().BeFalse("{0}: nothing was written anywhere", label);
    }

    [RequiresDockerFact]
    public async Task LocalProviderOutsideDevelopment_IsNotRegistered_AndDevMediaIs404()
    {
        var (exercise, participant) = await SeedAsync();
        await using var host = new MediaTestHost(
            _fixture.ConnectionString!, Production, new Dictionary<string, string?> { ["Azure:BlobStorage:Provider"] = "Local" });

        // A real file sits where the Local store WOULD have put it — Production must still not serve it.
        var blobName = MediaBlobNames.Build(exercise.ExerciseId, Guid.NewGuid(), "png");
        var path = Path.Combine(host.LocalRoot, blobName.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, MediaTestFiles.Png());

        using var authenticated = host.CreateClientFor(exercise.Host, participant.Token);
        using var anonymous = host.CreateClientFor(exercise.Host, bearerToken: null);
        using var withSession = await authenticated.GetAsync(new Uri($"/dev-media/{blobName}", UriKind.Relative));
        using var withoutSession = await anonymous.GetAsync(new Uri($"/dev-media/{blobName}", UriKind.Relative));

        withSession.StatusCode.Should().Be(HttpStatusCode.NotFound, "/dev-media is unmapped outside Development");
        withoutSession.StatusCode.Should().Be(
            HttpStatusCode.NotFound, "anonymously too — an unmapped path is routing's 404 (the gate passes non-endpoints through), never the file");
        host.Services.GetRequiredService<IMediaStore>().Should().NotBeOfType<LocalFileMediaStore>();
    }

    [RequiresDockerFact]
    public async Task LibraryWithNoProvider_StillServes200_ForAnEmptyLibrary_And503RatherThanAFakeUrlOtherwise()
    {
        MediaSeed.SeededExercise empty;
        MediaSeed.SeededExercise withMedia;
        MediaSeed.SeededSession staffEmpty;
        MediaSeed.SeededSession staffWithMedia;
        await using (var db = _fixture.CreateContext())
        {
            empty = MediaSeed.NewExercise(db);
            withMedia = MediaSeed.NewExercise(db);
            staffEmpty = MediaSeed.Staff(db, empty);
            staffWithMedia = MediaSeed.Staff(db, withMedia);
            MediaSeed.Asset(db, withMedia);
            await db.SaveChangesAsync();
        }

        await using var host = new MediaTestHost(_fixture.ConnectionString!, Production);
        using var emptyClient = host.CreateClientFor(empty.Host, staffEmpty.Token);
        using var mediaClient = host.CreateClientFor(withMedia.Host, staffWithMedia.Token);

        using var emptyList = await emptyClient.GetAsync(new Uri("/api/staff/media", UriKind.Relative));
        using var unsignable = await mediaClient.GetAsync(new Uri("/api/staff/media", UriKind.Relative));

        emptyList.StatusCode.Should().Be(HttpStatusCode.OK);
        (await emptyList.Content.ReadAsStringAsync()).Should().Be("[]");
        unsignable.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable, "with no store, an existing row is never given a fabricated URL");
    }

    [RequiresDockerFact]
    public async Task UsableAzureProvider_UploadsWithTheManagedIdentity_AndReturnsAReadOnlyUserDelegationSas()
    {
        var (exercise, participant) = await SeedAsync();
        var blobService = new FakeBlobService();
        await using var host = new MediaTestHost(
            _fixture.ConnectionString!,
            Production,
            new Dictionary<string, string?>
            {
                ["Azure:BlobStorage:Provider"] = "Azure",
                ["Azure:BlobStorage:ServiceUri"] = FakeBlobService.ServiceUri,
            },
            services => services.AddSingleton(new MediaAzureClientSettings(new FakeTokenCredential(), blobService.ClientOptions())));
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.WebP(), "w.webp"));

        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        var url = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!;
        var sas = SasUrl.Query(url);
        new Uri(url).AbsolutePath.Should().StartWith($"/post-media/{exercise.ExerciseId:D}/").And.EndWith(".webp");
        sas["sp"].Should().Be("r");
        sas["sr"].Should().Be("b");
        sas["spr"].Should().Be("https");
        sas["rsct"].Should().Be("image/webp");
        sas.Should().ContainKey("skoid");
        blobService.Requests.Should().OnlyContain(request => request.AuthorizationScheme == "Bearer", "no account key on any call");
        blobService.Committed.Keys.Should().ContainSingle(key => key.StartsWith($"/post-media/{exercise.ExerciseId:D}/", StringComparison.Ordinal));
        host.Services.GetRequiredService<IMediaStore>().Should().BeOfType<AzureBlobMediaStore>();
    }

    private async Task<(MediaSeed.SeededExercise Exercise, MediaSeed.SeededSession Participant)> SeedAsync()
    {
        await using var db = _fixture.CreateContext();
        var exercise = MediaSeed.NewExercise(db);
        var participant = MediaSeed.Participant(db, exercise);
        await db.SaveChangesAsync();
        return (exercise, participant);
    }
}
