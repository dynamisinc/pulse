namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// demo-polish BM — <c>POST /api/media</c> and <c>GET /api/staff/media</c> through the REAL <c>Program</c> pipeline
/// against real SQL (Development host, <c>Local</c> store in a temp directory). Covers the HTTP halves of every
/// upload/library AC: 201 <c>MediaAssetView</c> (participant-safe), the per-kind 413, magic-byte 415s, read-only 403,
/// lifecycle 403, the per-ACCOUNT 429 + <c>Retry-After</c>, the staff library's scope/ordering/poster rules and its
/// 401/403 gate, and the Development-only <c>/dev-media</c> mapping with range support.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class MediaEndpointTests
{
    private static readonly string[] ParticipantViewMembers = ["id", "kind", "url", "posterUrl", "width", "height", "durationSec"];

    private readonly MsSqlContainerFixture _fixture;

    public MediaEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    // ---- AC "Stored scoped, returned signed" ---------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ParticipantUpload_Is201_WithAParticipantSafeView_AndAScopedRowStampedFromTheSession()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);
        var otherExercise = Guid.NewGuid();

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(
            MediaTestFiles.Png(4000), "renamed.mp4", "video/mp4",
            [MediaTestFiles.Field("exerciseId", otherExercise.ToString()), MediaTestFiles.Field("width", "320"), MediaTestFiles.Field("height", "240")]));

        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.EnumerateObject().Select(member => member.Name).Should().BeSubsetOf(
            ParticipantViewMembers, "the participant view never carries blobName, contentType, bytes, originalFileName or uploader (XC-002)");
        json.RootElement.GetProperty("kind").GetString().Should().Be("image", "typed by magic bytes, not the .mp4 name");
        json.RootElement.TryGetProperty("durationSec", out _).Should().BeFalse("null members are omitted, never null");

        var id = Guid.Parse(json.RootElement.GetProperty("id").GetString()!);
        await using var db = _fixture.CreateContext();
        var row = await db.MediaAssets.IgnoreQueryFilters().SingleAsync(asset => asset.Id == id);
        row.ExerciseId.Should().Be(exercise.ExerciseId, "scope comes from the resolved session, never the body");
        row.UploadedByHumanId.Should().Be(participant.Session.ActingHumanId, "the session's acting human");
        row.CreatedScenarioTime.Should().Be(MediaSeed.ScenarioTime, "the exercise clock (persisted fallback), not the wall clock");
        row.ContentType.Should().Be("image/png");
        row.BlobName.Should().Be($"{exercise.ExerciseId:D}/{id:N}.png");
        row.Width.Should().Be(320);
        row.Height.Should().Be(240);
        row.Bytes.Should().Be(4000);
        row.OriginalFileName.Should().Be("renamed.mp4");
        json.RootElement.GetProperty("url").GetString().Should().Be($"http://{exercise.Host}/dev-media/{row.BlobName}");
        File.Exists(Path.Combine(host.LocalRoot, row.BlobName)).Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task StaffUpload_Is201_AttributedToTheStaffUser_AndAVideoKeepsItsPoster()
    {
        Guid exerciseId;
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession staff;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            staff = MediaSeed.Staff(db, exercise);
            exerciseId = exercise.ExerciseId;
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var posterResponse = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Jpeg(), "poster.jpg"));
        posterResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var posterId = JsonDocument.Parse(await posterResponse.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetString()!;

        using var videoResponse = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(
            MediaTestFiles.Mp4(5000), "clip.mp4", "video/mp4",
            [MediaTestFiles.Field("kind", "video"), MediaTestFiles.Field("durationSec", "28.5"), MediaTestFiles.Field("posterMediaId", posterId)]));

        videoResponse.StatusCode.Should().Be(HttpStatusCode.Created, await videoResponse.Content.ReadAsStringAsync());
        var video = JsonDocument.Parse(await videoResponse.Content.ReadAsStringAsync()).RootElement;
        video.GetProperty("posterUrl").GetString().Should().EndWith(".jpg");
        video.GetProperty("durationSec").GetDouble().Should().Be(28.5);

        await using var check = _fixture.CreateContext();
        var rows = await check.MediaAssets.IgnoreQueryFilters().Where(asset => asset.ExerciseId == exerciseId).ToListAsync();
        rows.Should().HaveCount(2).And.OnlyContain(
            asset => asset.UploadedByHumanId == staff.Session.StaffUserId!.Value.ToString(),
            "a staff upload is attributed to the staff user (COR-018)");
        rows.Single(asset => asset.Kind == MediaKinds.Video).PosterMediaAssetId.Should().Be(Guid.Parse(posterId));
    }

    // ---- AC "Types by magic bytes only" (HTTP) -------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ExeRenamedJpg_Is415_AndNothingIsWritten()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(
            new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.WindowsExe(), "cat.jpg", "image/jpeg"));

        response.StatusCode.Should().Be(HttpStatusCode.UnsupportedMediaType);
        await AssertNoMediaAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task KindHintThatDisagreesWithTheBytes_Is415()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(
            MediaTestFiles.Png(), "p.png", "image/png", [MediaTestFiles.Field("kind", "video")]));

        response.StatusCode.Should().Be(HttpStatusCode.UnsupportedMediaType);
        await AssertNoMediaAsync(exercise, host);
    }

    // ---- AC "Streaming with per-kind limits" (HTTP) --------------------------------------------------------

    [RequiresDockerFact]
    public async Task OversizeImage_Is413_AndThePartialFileIsDeleted()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = NewHost(new Dictionary<string, string?> { ["Media:Upload:ImageMaxBytes"] = "1000" });
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(
            new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(50_000), "big.png", "image/png"));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        await AssertNoMediaAsync(exercise, host);
    }

    // ---- AC "Abuse resistance and gating (NFR-009)" --------------------------------------------------------

    [RequiresDockerFact]
    public async Task ReadOnlySession_Is403_BeforeAnythingIsStored()
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession readOnly;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            readOnly = MediaSeed.ReadOnly(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, readOnly.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "POST /api/media is mapped inside DenyReadOnlySessions() (COR-015)");
        await AssertNoMediaAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task ParticipantWithNoBoundPersona_Is403()
    {
        var (exercise, participant) = await SeedParticipantAsync(withPersona: false);
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "participant uploads require a persona-bound session");
        await AssertNoMediaAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task AnonymousUpload_Is401()
    {
        var (exercise, _) = await SeedParticipantAsync();
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, bearerToken: null);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerTheory]
    [InlineData("archived")]
    [InlineData("build")]
    public async Task ParticipantUpload_InAClosedLifecycleState_Is403(string status)
    {
        var (exercise, participant) = await SeedParticipantAsync(status: status);
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "/api/media is on ExerciseLifecycleGatedRoutes (COR-032)");
        await AssertNoMediaAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task RateLimit_IsPerAccount_SoAFreshSignInDoesNotResetIt_AndAnswers429WithRetryAfter()
    {
        var accountId = Guid.NewGuid().ToString();
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession first;
        MediaSeed.SeededSession freshSignIn;
        MediaSeed.SeededSession otherAccount;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            first = MediaSeed.Participant(db, exercise, accountId);
            freshSignIn = MediaSeed.Participant(db, exercise, accountId);
            otherAccount = MediaSeed.Participant(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost(new Dictionary<string, string?> { ["Media:Upload:PermitPerMinute"] = "2" });
        using var firstClient = host.CreateClientFor(exercise.Host, first.Token);
        using var freshClient = host.CreateClientFor(exercise.Host, freshSignIn.Token);
        using var otherClient = host.CreateClientFor(exercise.Host, otherAccount.Token);

        async Task<HttpResponseMessage> Upload(HttpClient client) =>
            await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        (await Upload(firstClient)).StatusCode.Should().Be(HttpStatusCode.Created);
        (await Upload(firstClient)).StatusCode.Should().Be(HttpStatusCode.Created);

        using var limited = await Upload(firstClient);
        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        limited.Headers.RetryAfter.Should().NotBeNull("a 429 always says when to retry");
        JsonDocument.Parse(await limited.Content.ReadAsStringAsync()).RootElement.GetProperty("error").GetString()
            .Should().Be("rate-limited");

        using var afterFreshSignIn = await Upload(freshClient);
        afterFreshSignIn.StatusCode.Should().Be(
            HttpStatusCode.TooManyRequests, "the quota is per ACCOUNT — a new session for the same account must not reset it (NFR-009)");

        (await Upload(otherClient)).StatusCode.Should().Be(HttpStatusCode.Created, "another account has its own quota");
    }

    // ---- AC "Staff library" --------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Library_ReturnsTheExercisesAssetsNewestFirst_HidesPosters_AndSignsPosterUrls()
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession staff;
        MediaAsset older;
        MediaAsset newer;
        MediaAsset poster;
        MediaAsset video;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            staff = MediaSeed.Staff(db, exercise, role: "evaluator");
            older = MediaSeed.Asset(db, exercise, scenarioTime: MediaSeed.ScenarioTime.AddMinutes(-30), fileName: "older.png");
            newer = MediaSeed.Asset(db, exercise, scenarioTime: MediaSeed.ScenarioTime.AddMinutes(10), fileName: "newer.png");
            poster = MediaSeed.Asset(db, exercise, scenarioTime: MediaSeed.ScenarioTime.AddMinutes(19));
            await db.SaveChangesAsync();
            video = MediaSeed.Asset(db, exercise, MediaKinds.Video, scenarioTime: MediaSeed.ScenarioTime.AddMinutes(20), posterId: poster.Id);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        var all = await GetLibraryAsync(client, "/api/staff/media");
        var videos = await GetLibraryAsync(client, "/api/staff/media?kind=video");
        var top = await GetLibraryAsync(client, "/api/staff/media?take=1");

        all.Select(item => item.GetProperty("id").GetString()).Should().Equal(
            [video.Id.ToString(), newer.Id.ToString(), older.Id.ToString()],
            "newest first by scenario time, and the poster image is hidden because it is a video's poster (DP-3)");
        var videoItem = all[0];
        videoItem.GetProperty("posterUrl").GetString().Should().EndWith($"/dev-media/{poster.BlobName}");
        videoItem.GetProperty("uploadedAtScenario").GetString().Should().Be(MediaSeed.ScenarioTime.AddMinutes(20).ToString("O"));
        all[1].GetProperty("fileName").GetString().Should().Be("newer.png");
        all[1].TryGetProperty("posterUrl", out _).Should().BeFalse();
        all[1].GetProperty("url").GetString().Should().EndWith($"/dev-media/{newer.BlobName}");
        videos.Should().ContainSingle().Which.GetProperty("kind").GetString().Should().Be("video");
        top.Should().ContainSingle().Which.GetProperty("id").GetString().Should().Be(video.Id.ToString());
    }

    [RequiresDockerTheory]
    [InlineData("?kind=audio")]
    [InlineData("?take=0")]
    [InlineData("?take=201")]
    [InlineData("?take=ten")]
    public async Task Library_RejectsABadKindOrTake_With400(string query)
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession staff;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            staff = MediaSeed.Staff(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var response = await client.GetAsync(new Uri($"/api/staff/media{query}", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [RequiresDockerFact]
    public async Task Library_Is401ForParticipantReadOnlyAndAnonymous_And403ForUnassignedStaff()
    {
        MediaSeed.SeededExercise exercise;
        MediaSeed.SeededSession participant;
        MediaSeed.SeededSession readOnly;
        MediaSeed.SeededSession unassigned;
        await using (var db = _fixture.CreateContext())
        {
            exercise = MediaSeed.NewExercise(db);
            participant = MediaSeed.Participant(db, exercise);
            readOnly = MediaSeed.ReadOnly(db, exercise);
            unassigned = MediaSeed.Staff(db, exercise, assigned: false);
            MediaSeed.Asset(db, exercise);
            await db.SaveChangesAsync();
        }

        await using var host = NewHost();

        async Task<HttpStatusCode> Status(string? token)
        {
            using var client = host.CreateClientFor(exercise.Host, token);
            using var response = await client.GetAsync(new Uri("/api/staff/media", UriKind.Relative));
            return response.StatusCode;
        }

        (await Status(participant.Token)).Should().Be(HttpStatusCode.Unauthorized, "a participant has no staff session");
        (await Status(readOnly.Token)).Should().Be(HttpStatusCode.Unauthorized, "a shared read-only session has no staff session");
        (await Status(null)).Should().Be(HttpStatusCode.Unauthorized);
        (await Status(unassigned.Token)).Should().Be(HttpStatusCode.Forbidden, "staff not assigned to the resolved exercise (COR-005)");
    }

    // ---- AC "No account key, ever" — the Development-only /dev-media mapping ----------------------------------

    [RequiresDockerFact]
    public async Task DevMedia_ServesTheUploadedFileAnonymously_WithRangeSupport_InDevelopment()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = NewHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);
        var bytes = MediaTestFiles.Mp4(4096);

        using var upload = await client.PostAsync(new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(bytes, "clip.mp4", "video/mp4"));
        upload.StatusCode.Should().Be(HttpStatusCode.Created);
        var url = new Uri(JsonDocument.Parse(await upload.Content.ReadAsStringAsync()).RootElement.GetProperty("url").GetString()!);

        using var browser = host.CreateClientFor(exercise.Host, bearerToken: null);
        using var request = new HttpRequestMessage(HttpMethod.Get, url.PathAndQuery);
        request.Headers.Range = new RangeHeaderValue(100, 199);
        using var ranged = await browser.SendAsync(request);

        ranged.StatusCode.Should().Be(HttpStatusCode.PartialContent, "a <video> must be able to seek (206)");
        ranged.Content.Headers.ContentType!.MediaType.Should().Be("video/mp4");
        (await ranged.Content.ReadAsByteArrayAsync()).Should().Equal(bytes.Skip(100).Take(100));
        ranged.Headers.GetValues("X-Content-Type-Options").Should().Contain("nosniff");
    }

    private MediaTestHost NewHost(IReadOnlyDictionary<string, string?>? settings = null) =>
        new(_fixture.ConnectionString!, "Development", settings);

    private async Task<(MediaSeed.SeededExercise Exercise, MediaSeed.SeededSession Participant)> SeedParticipantAsync(
        string status = "live", bool withPersona = true)
    {
        await using var db = _fixture.CreateContext();
        var exercise = MediaSeed.NewExercise(db, status);
        var participant = MediaSeed.Participant(db, exercise, withPersona: withPersona);
        await db.SaveChangesAsync();
        return (exercise, participant);
    }

    private async Task AssertNoMediaAsync(MediaSeed.SeededExercise exercise, MediaTestHost host)
    {
        await using var db = _fixture.CreateContext();
        (await db.MediaAssets.IgnoreQueryFilters().CountAsync(asset => asset.ExerciseId == exercise.ExerciseId))
            .Should().Be(0, "no MediaAsset row is written");
        (Directory.Exists(host.LocalRoot) ? Directory.EnumerateFiles(host.LocalRoot, "*", SearchOption.AllDirectories) : [])
            .Should().BeEmpty("no blob is left behind");
    }

    private static async Task<List<JsonElement>> GetLibraryAsync(HttpClient client, string path)
    {
        using var response = await client.GetAsync(new Uri(path, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.EnumerateArray().Select(element => element.Clone()).ToList();
    }
}
