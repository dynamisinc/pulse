namespace Pulse.WebApi.Tests.Features.Media.Documents;

using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media.Documents;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Media;
using Xunit;

/// <summary>
/// press-room story 02 — <c>POST /api/media/documents</c> and <c>GET /api/media/documents/{id}</c> through the REAL
/// <c>Program</c> pipeline against real SQL (Development host, <c>Local</c> store): the participant default-deny and
/// the rate-limited route, the 201 shape, the 422 body (a reason code and nothing else), the 413, the download-only
/// headers on the served file, and the document read path's isolation — another exercise's id, another participant's
/// id, an image id and an unknown id are one indistinguishable 404 (XC-001, DP-16).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class DocumentEndpointTests
{
    private readonly MsSqlContainerFixture _fixture;

    public DocumentEndpointTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task AParticipant_IsForbiddenByTheDefaultAuthorizer_AndNothingIsWritten()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var client = host.CreateClientFor(exercise.Host, participant.Token);

        using var response = await PostDocumentAsync(client, MediaTestFiles.BenignPdf());

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, "IDocumentUploadAuthorizer defaults to deny");
        await AssertNothingWrittenAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task AnAllowedParticipant_Gets201_WithExactlyMediaIdFileNameAndSize_AndTheFileDownloadsSandboxed()
    {
        var (exercise, participant) = await SeedParticipantAsync();
        await using var host = AllowingHost();
        using var client = host.CreateClientFor(exercise.Host, participant.Token);
        var pdf = MediaTestFiles.BenignPdf();

        using var response = await PostDocumentAsync(client, pdf, "Fulton release.pdf");

        response.StatusCode.Should().Be(HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.EnumerateObject().Select(member => member.Name)
            .Should().BeEquivalentTo(["mediaId", "fileName", "sizeBytes"], "no URL, page count or extracted text");
        json.RootElement.GetProperty("fileName").GetString().Should().Be("Fulton release.pdf");
        json.RootElement.GetProperty("sizeBytes").GetInt64().Should().Be(pdf.Length);

        // The read path hands back a download URL; on the Development store it is served from the API's own origin,
        // so the response must be an attachment, nosniff and CSP-sandboxed.
        var id = json.RootElement.GetProperty("mediaId").GetString();
        using var read = await client.GetAsync(new Uri($"/api/media/documents/{id}", UriKind.Relative));
        read.StatusCode.Should().Be(HttpStatusCode.OK);
        using var readJson = JsonDocument.Parse(await read.Content.ReadAsStringAsync());
        var url = new Uri(readJson.RootElement.GetProperty("url").GetString()!);

        using var download = await client.GetAsync(new Uri(url.PathAndQuery, UriKind.Relative));
        download.StatusCode.Should().Be(HttpStatusCode.OK);
        download.Content.Headers.ContentType!.MediaType.Should().Be("application/pdf");
        download.Content.Headers.ContentDisposition!.DispositionType.Should().Be("attachment", "never inline in our origin");
        download.Headers.GetValues("X-Content-Type-Options").Should().Equal("nosniff");
        download.Headers.GetValues("Content-Security-Policy").Should().Equal("sandbox");
        (await download.Content.ReadAsByteArrayAsync()).Should().Equal(pdf);
    }

    [RequiresDockerFact]
    public async Task AHostilePdf_Is422WithOnlyAReasonCode_AndNothingIsWritten()
    {
        var (exercise, staff) = await SeedStaffAsync();
        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var response = await PostDocumentAsync(client, MediaTestFiles.JavaScriptPdf());

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        json.RootElement.EnumerateObject().Select(member => member.Name).Should().BeEquivalentTo(["error", "reason"]);
        json.RootElement.GetProperty("error").GetString().Should().Be("document-rejected");
        json.RootElement.GetProperty("reason").GetString().Should().Be(DocumentRejectionReasons.ActiveContent);
        (await response.Content.ReadAsStringAsync()).Should().NotContain("JavaScript").And.NotContain("OpenAction",
            "the raw scanner detail never reaches the client");
        await AssertNothingWrittenAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task APdfOverTheCap_Is413_AndNothingIsWritten()
    {
        var (exercise, staff) = await SeedStaffAsync();
        await using var host = new MediaTestHost(
            _fixture.ConnectionString!, settings: new System.Collections.Generic.Dictionary<string, string?> { ["Media:Upload:DocumentMaxBytes"] = "2048" });
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var response = await PostDocumentAsync(client, [.. MediaTestFiles.BenignPdf(), .. Enumerable.Repeat((byte)' ', 4096)]);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadAsStringAsync()).Should().Contain("The PDF is too large.");
        await AssertNothingWrittenAsync(exercise, host);
    }

    [RequiresDockerFact]
    public async Task APdfOnTheImageVideoRoute_IsStill415()
    {
        var (exercise, staff) = await SeedStaffAsync();
        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var client = host.CreateClientFor(exercise.Host, staff.Token);

        using var response = await client.PostAsync(
            new Uri("/api/media", UriKind.Relative), MediaTestFiles.Form(MediaTestFiles.BenignPdf(), "release.pdf", "application/pdf"));

        response.StatusCode.Should().Be(HttpStatusCode.UnsupportedMediaType);
        await AssertNothingWrittenAsync(exercise, host);
    }

    /// <summary>
    /// XC-001 / DP-16: the document read path. Exercise B's real document id, another participant's document in the
    /// SAME exercise, an image id and an unknown id are byte-identical 404s — nothing confirms another exercise's
    /// asset exists — while the uploader and assigned staff can read their own.
    /// </summary>
    [RequiresDockerFact]
    public async Task TheDocumentReadPath_AnswersOneIdentical404_ForEveryIdTheCallerMayNotRead()
    {
        MediaSeed.SeededExercise exerciseA;
        MediaSeed.SeededExercise exerciseB;
        MediaSeed.SeededSession participantA;
        MediaSeed.SeededSession staffA;
        MediaAsset ownDocument;
        MediaAsset otherParticipantsDocument;
        MediaAsset imageInA;
        MediaAsset documentInB;
        await using (var db = _fixture.CreateContext())
        {
            exerciseA = MediaSeed.NewExercise(db);
            exerciseB = MediaSeed.NewExercise(db);
            participantA = MediaSeed.Participant(db, exerciseA);
            staffA = MediaSeed.Staff(db, exerciseA);
            ownDocument = MediaSeed.Asset(db, exerciseA, MediaKinds.Document, uploadedBy: participantA.Session.ActingHumanId);
            otherParticipantsDocument = MediaSeed.Asset(db, exerciseA, MediaKinds.Document, uploadedBy: "someone-else");
            imageInA = MediaSeed.Asset(db, exerciseA, uploadedBy: participantA.Session.ActingHumanId);

            // Same acting human in B, so only the exercise boundary can be what refuses it.
            documentInB = MediaSeed.Asset(db, exerciseB, MediaKinds.Document, uploadedBy: participantA.Session.ActingHumanId);
            await db.SaveChangesAsync();
        }

        await using var host = new MediaTestHost(_fixture.ConnectionString!);
        using var participant = host.CreateClientFor(exerciseA.Host, participantA.Token);
        using var staff = host.CreateClientFor(exerciseA.Host, staffA.Token);

        async Task<(HttpStatusCode Status, string Body)> Read(HttpClient client, string id)
        {
            using var response = await client.GetAsync(new Uri($"/api/media/documents/{id}", UriKind.Relative));
            return (response.StatusCode, await response.Content.ReadAsStringAsync());
        }

        var unknown = await Read(participant, Guid.NewGuid().ToString());
        unknown.Status.Should().Be(HttpStatusCode.NotFound);
        (await Read(participant, documentInB.Id.ToString())).Should().Be(unknown, "another exercise's REAL document id is indistinguishable from an unknown id");
        (await Read(staff, documentInB.Id.ToString())).Should().Be(unknown, "staff of A cannot read B's either");
        (await Read(participant, otherParticipantsDocument.Id.ToString())).Should().Be(unknown, "a participant reads only their own uploads");
        (await Read(participant, imageInA.Id.ToString())).Should().Be(unknown, "an image is not a document");
        (await Read(participant, "not-a-guid")).Should().Be(unknown);

        (await Read(participant, ownDocument.Id.ToString())).Status.Should().Be(HttpStatusCode.OK);
        (await Read(staff, otherParticipantsDocument.Id.ToString())).Status.Should().Be(HttpStatusCode.OK, "assigned staff read any document in their exercise");
    }

    private static Task<HttpResponseMessage> PostDocumentAsync(HttpClient client, byte[] file, string fileName = "release.pdf") =>
        client.PostAsync(new Uri("/api/media/documents", UriKind.Relative), MediaTestFiles.Form(file, fileName, "application/pdf"));

    private MediaTestHost AllowingHost() => new(
        _fixture.ConnectionString!,
        configureServices: services => services.AddScoped<IDocumentUploadAuthorizer>(_ => new RecordingDocumentAuthorizer(allow: true)));

    private async Task<(MediaSeed.SeededExercise Exercise, MediaSeed.SeededSession Participant)> SeedParticipantAsync()
    {
        await using var db = _fixture.CreateContext();
        var exercise = MediaSeed.NewExercise(db);
        var participant = MediaSeed.Participant(db, exercise);
        await db.SaveChangesAsync();
        return (exercise, participant);
    }

    private async Task<(MediaSeed.SeededExercise Exercise, MediaSeed.SeededSession Staff)> SeedStaffAsync()
    {
        await using var db = _fixture.CreateContext();
        var exercise = MediaSeed.NewExercise(db);
        var staff = MediaSeed.Staff(db, exercise);
        await db.SaveChangesAsync();
        return (exercise, staff);
    }

    private async Task AssertNothingWrittenAsync(MediaSeed.SeededExercise exercise, MediaTestHost host)
    {
        await using var db = _fixture.CreateContext();
        (await db.MediaAssets.IgnoreQueryFilters().CountAsync(asset => asset.ExerciseId == exercise.ExerciseId))
            .Should().Be(0, "no MediaAsset row is written");
        (Directory.Exists(host.LocalRoot) ? Directory.EnumerateFiles(host.LocalRoot, "*", SearchOption.AllDirectories) : [])
            .Should().BeEmpty("and no blob is left behind");
    }
}
