namespace Pulse.WebApi.Tests.Features.Media.Documents;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Features.Media.Documents;
using Xunit;

/// <summary>
/// press-room story 02 — the document route of the upload pipeline driven through
/// <see cref="MediaUploadService.UploadDocumentAsync"/> (EF in-memory, recording store; no host, no Docker): magic
/// bytes only, the 20 MB cap (413 before anything is kept), the deny-list scan (422 with a reason code, blob deleted,
/// no row), the default-deny participant authorizer (checked before the body is read), the staff rule, and the
/// <c>{ mediaId, fileName, sizeBytes }</c> response. The HTTP, header and real-SQL halves live in
/// <see cref="DocumentEndpointTests"/> and <c>MediaIsolationTests</c>.
/// </summary>
public sealed class DocumentUploadServiceTests
{
    [Fact]
    public async Task AParticipant_IsDeniedByDefault_BeforeAnythingIsReadOrStored()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(MediaTestFiles.BenignPdf(), "release.pdf", "application/pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.Forbidden, "IDocumentUploadAuthorizer defaults to deny");
        harness.Recording.SaveAttempts.Should().BeEmpty("the gate runs before the body is read");
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task AParticipantTheAuthorizerAllows_UploadsAPdf_AndGetsMediaIdFileNameAndSizeOnly()
    {
        var authorizer = new RecordingDocumentAuthorizer(allow: true);
        using var harness = new UploadHarness(documentAuthorizer: authorizer);
        var pdf = MediaTestFiles.BenignPdf();

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(pdf, "County Release.pdf", "application/octet-stream"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created, result.Error);
        var asset = harness.AllAssets().Should().ContainSingle().Subject;
        asset.Kind.Should().Be(MediaKinds.Document);
        asset.ContentType.Should().Be("application/pdf");
        asset.BlobName.Should().EndWith(".pdf");
        asset.ExerciseId.Should().Be(harness.ExerciseId, "stamped from the resolved scope");
        asset.UploadedByHumanId.Should().Be(harness.ActingHumanId);
        harness.Recording.Blobs[asset.BlobName].Bytes.Should().Equal(pdf, "the bytes are stored verbatim");
        harness.Recording.Blobs[asset.BlobName].ContentType.Should().Be("application/pdf");

        result.View.Should().BeNull("a document has no image/video view");
        result.Document.Should().Be(new DocumentUploadView(asset.Id.ToString(), "County Release.pdf", pdf.Length));

        authorizer.Requests.Should().ContainSingle().Which.Should().Be(
            new DocumentUploadRequest(harness.ExerciseId, harness.ActingHumanId, authorizer.Requests[0].PersonaId),
            "the authorizer sees server-resolved values only");
        authorizer.Requests[0].PersonaId.Should().NotBeEmpty();
    }

    [Fact]
    public async Task AssignedStaff_UploadWithoutTheParticipantAuthorizer()
    {
        var authorizer = new RecordingDocumentAuthorizer(allow: false);
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid(), documentAuthorizer: authorizer);

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(MediaTestFiles.BenignPdf(), "sitrep.pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created, result.Error);
        authorizer.Requests.Should().BeEmpty("staff follow the existing staff media rule, not the participant gate");
    }

    [Fact]
    public async Task UnassignedStaff_AreForbidden()
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid(), staffAssigned: false);

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(MediaTestFiles.BenignPdf(), "sitrep.pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.Forbidden);
    }

    [Fact]
    public async Task AHostilePdf_Is422WithAReasonCodeOnly_TheStreamedBlobIsDeleted_AndNoRowIsWritten()
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(MediaTestFiles.JavaScriptPdf(), "release.pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.Rejected);
        result.Reason.Should().Be(DocumentRejectionReasons.ActiveContent);
        result.Error.Should().BeNull("no scanner detail (token, offset) is ever returned");
        harness.Recording.SaveAttempts.Should().ContainSingle("the file was scanned while it streamed");
        harness.Recording.Deletes.Should().Equal(harness.Recording.SaveAttempts, "the streamed blob is deleted");
        harness.Recording.Blobs.Should().BeEmpty();
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task APdfOverTheDocumentCap_Is413WithAReadableMessage_AndNothingIsKept()
    {
        var options = new MediaUploadOptions { DocumentMaxBytes = 1024 };
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid(), options: options);
        var oversize = MediaTestFiles.BenignPdf().Concat(Enumerable.Repeat((byte)' ', 2048)).ToArray();

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(oversize, "big.pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.TooLarge);
        result.Error.Should().StartWith("The PDF is too large.");
        harness.Recording.Blobs.Should().BeEmpty("the store deletes its own partial");
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public void TheDocumentCap_DefaultsTo20MB_AndRaisesTheRequestLimitOnlyIfLarger()
    {
        var options = new MediaUploadOptions();

        options.DocumentMaxBytes.Should().Be(20L * 1024 * 1024);
        options.MaxRequestBodyBytes().Should().Be(options.VideoMaxBytes + MediaUploadOptions.MultipartOverheadBytes,
            "the 100 MB video ceiling still dominates");
        new MediaUploadOptions { DocumentMaxBytes = 200L * 1024 * 1024 }.MaxRequestBodyBytes()
            .Should().Be(200L * 1024 * 1024 + MediaUploadOptions.MultipartOverheadBytes);
    }

    [Theory]
    [InlineData("png")]
    [InlineData("mp4")]
    [InlineData("svg")]
    [InlineData("html-then-pdf")]
    [InlineData("docx")]
    public async Task AnythingButAPdf_Is415OnTheDocumentRoute_WhateverItIsNamed(string label)
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());
        var bytes = label switch
        {
            "png" => MediaTestFiles.Png(),
            "mp4" => MediaTestFiles.Mp4(),
            "svg" => MediaTestFiles.Svg(),
            "html-then-pdf" => MediaTestFiles.HtmlThenPdf(),
            _ => MediaTestFiles.Docx(),
        };

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(bytes, "release.pdf", "application/pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType, "{0} is not a PDF by its bytes", label);
        result.Error.Should().Be("Unsupported file type. Allowed: PDF documents.");
        harness.Recording.SaveAttempts.Should().BeEmpty();
    }

    [Fact]
    public async Task APdf_IsStill415OnTheImageVideoRoute_EvenForStaff()
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.BenignPdf(), "release.pdf", "application/pdf"));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType, "only POST /api/media/documents takes a document");
        harness.AllAssets().Should().BeEmpty();
    }

    [Theory]
    [InlineData("width", "100")]
    [InlineData("height", "100")]
    [InlineData("durationSec", "3")]
    [InlineData("posterMediaId", "6f1c2a8e-0000-4000-8000-000000000001")]
    public async Task ImageAndVideoHints_AreRefusedOnADocument(string field, string value)
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(
            MediaTestFiles.BenignPdf(), "release.pdf", fields: [MediaTestFiles.Field(field, value)]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
        harness.AllAssets().Should().BeEmpty();
        harness.Recording.Blobs.Should().BeEmpty();
    }

    [Theory]
    [InlineData("document", MediaUploadOutcome.Created)]
    [InlineData("image", MediaUploadOutcome.UnsupportedMediaType)]
    public async Task AKindHint_MustAgreeWithTheSniff(string hint, MediaUploadOutcome expected)
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(
            MediaTestFiles.BenignPdf(), "release.pdf", fields: [MediaTestFiles.Field("kind", hint)]));

        result.Outcome.Should().Be(expected);
    }

    [Theory]
    [InlineData("evil.exe", "evil.exe.pdf")]
    [InlineData("release.PDF", "release.PDF")]
    [InlineData("invoice‮fdp.exe", "invoicefdp.exe.pdf")]
    [InlineData("..\\..\\windows\\notes", "notes.pdf")]
    [InlineData("<b>.pdf", "document.pdf")]
    public async Task TheStoredDownloadName_AlwaysEndsInPdf_AndCarriesNoBidiOverride(string clientName, string stored)
    {
        using var harness = new UploadHarness(staffUserId: Guid.NewGuid());

        var result = await harness.UploadDocumentAsync(MediaTestFiles.Form(MediaTestFiles.BenignPdf(), clientName));

        result.Outcome.Should().Be(MediaUploadOutcome.Created, result.Error);
        result.Document!.FileName.Should().Be(stored, "a PDF/executable polyglot can never be saved under an executable name");
        harness.AllAssets().Single().OriginalFileName.Should().Be(stored);
    }
}
