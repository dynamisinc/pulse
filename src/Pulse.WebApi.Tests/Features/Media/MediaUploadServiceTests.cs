namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Xunit;

/// <summary>
/// demo-polish BM — the upload pipeline driven through <see cref="MediaUploadService"/> directly (EF in-memory
/// provider, recording store, fake signer; no host, no Docker). Covers AC "Types by magic bytes only" (extension,
/// client MIME and kind hint never decide), AC "Streaming with per-kind limits" (413 + partial blob deleted, the
/// counting-stream buffering bound) and the server-stamping half of AC "Stored scoped, returned signed". The HTTP
/// and real-SQL halves live in <see cref="MediaEndpointTests"/> and <see cref="MediaIsolationTests"/>.
/// </summary>
public sealed class MediaUploadServiceTests
{
    // ---- AC "Types by magic bytes only" ---------------------------------------------------------------------

    [Fact]
    public async Task PngRenamedMp4_WithAVideoMimeHeader_IsStoredStrictlyAsPng()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "clip.mp4", "video/mp4"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        var asset = harness.AllAssets().Should().ContainSingle().Subject;
        asset.Kind.Should().Be(MediaKinds.Image, "the bytes are a PNG — the .mp4 name and video/mp4 header are ignored");
        asset.ContentType.Should().Be("image/png");
        asset.BlobName.Should().EndWith(".png", "the blob extension comes from the sniff");
        harness.Recording.Blobs[asset.BlobName].ContentType.Should().Be("image/png", "the blob is written with the SNIFFED type");
        result.View!.Kind.Should().Be(MediaKinds.Image);
    }

    [Fact]
    public async Task ExeRenamedJpg_WithAnImageMimeHeader_Is415_AndNothingIsStoredOrWritten()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.WindowsExe(), "holiday.jpg", "image/jpeg"));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType);
        harness.Recording.SaveAttempts.Should().BeEmpty("a rejected sniff never reaches the store");
        harness.AllAssets().Should().BeEmpty();
    }

    [Theory]
    [InlineData("svg")]
    [InlineData("html")]
    [InlineData("pdf")]
    [InlineData("elf")]
    public async Task DisallowedContent_Is415_WhateverItIsNamedOrLabelled(string label)
    {
        using var harness = new UploadHarness();
        var bytes = label switch
        {
            "svg" => MediaTestFiles.Svg(),
            "html" => MediaTestFiles.Html(),
            "pdf" => MediaTestFiles.Pdf(),
            _ => MediaTestFiles.Elf(),
        };

        var result = await harness.UploadAsync(MediaTestFiles.Form(bytes, "image.png", "image/png"));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType, "{0} is not an allowed type by its bytes ({1})", label, result.Error);
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task PngScriptPolyglot_IsStoredStrictlyAsItsSniffedPngType()
    {
        using var harness = new UploadHarness();
        var polyglot = MediaTestFiles.PngScriptPolyglot();

        var result = await harness.UploadAsync(MediaTestFiles.Form(polyglot, "page.html", "text/html"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        var asset = harness.AllAssets().Single();
        asset.ContentType.Should().Be("image/png", "a polyglot is stored strictly as its sniffed type, never as markup");
        asset.BlobName.Should().EndWith(".png");
        harness.Recording.Blobs[asset.BlobName].Bytes.Should().Equal(polyglot, "the bytes are stored verbatim, typed as PNG");
    }

    [Fact]
    public async Task EmptyFile_Is415()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form([], "empty.png", "image/png"));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType);
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task KindHintThatDisagrees_SentAfterTheFile_Is415_TheBlobIsDeleted_AndNoRowIsWritten()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Png(), "photo.png", "image/png", [MediaTestFiles.Field("kind", "video")], fieldsFirst: false));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType);
        harness.Recording.SaveAttempts.Should().ContainSingle("the file streamed before the hint arrived");
        harness.Recording.Deletes.Should().Equal(harness.Recording.SaveAttempts, "the already-streamed blob must not be left behind");
        harness.Recording.Blobs.Should().BeEmpty();
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task KindHintThatDisagrees_SentBeforeTheFile_Is415_BeforeAnythingIsStored()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Mp4(), "clip.mp4", "video/mp4", [MediaTestFiles.Field("kind", "image")], fieldsFirst: true));

        result.Outcome.Should().Be(MediaUploadOutcome.UnsupportedMediaType);
        harness.Recording.SaveAttempts.Should().BeEmpty("the mismatch is known from the head, before streaming");
        harness.AllAssets().Should().BeEmpty();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task KindHintThatAgrees_IsAccepted_InEitherPartOrder(bool fieldsFirst)
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.WebM(), "clip.webm", "video/webm", [MediaTestFiles.Field("kind", "video")], fieldsFirst));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        harness.AllAssets().Single().ContentType.Should().Be("video/webm");
    }

    // ---- AC "Streaming with per-kind limits" ---------------------------------------------------------------

    [Fact]
    public async Task OversizeImage_Is413_ThePartialBlobIsDeleted_AndNoRowIsWritten()
    {
        using var harness = new UploadHarness(options: new MediaUploadOptions { ImageMaxBytes = 1000, VideoMaxBytes = 100_000 });

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(1001), "big.png", "image/png"));

        result.Outcome.Should().Be(MediaUploadOutcome.TooLarge);
        harness.Recording.SaveAttempts.Should().ContainSingle();
        harness.Recording.Deletes.Should().Contain(harness.Recording.SaveAttempts.Single(), "the partial blob is deleted");
        harness.Recording.Blobs.Should().BeEmpty();
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task OversizeVideo_Is413_UnderTheVideoCeiling_NotTheImageOne()
    {
        using var harness = new UploadHarness(options: new MediaUploadOptions { ImageMaxBytes = 100_000, VideoMaxBytes = 2000 });

        var tooBig = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Mp4(2001), "big.mp4", "video/mp4"));
        var image = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Jpeg(50_000), "ok.jpg", "image/jpeg"));

        tooBig.Outcome.Should().Be(MediaUploadOutcome.TooLarge, "a video is held to the VIDEO ceiling");
        image.Outcome.Should().Be(MediaUploadOutcome.Created, "an image is held to the IMAGE ceiling, which is larger here");
        harness.AllAssets().Should().ContainSingle().Which.Kind.Should().Be(MediaKinds.Image);
    }

    [Fact]
    public async Task FileExactlyAtTheCeiling_IsAccepted()
    {
        using var harness = new UploadHarness(options: new MediaUploadOptions { ImageMaxBytes = 4096 });

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Gif89(4096), "edge.gif", "image/gif"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        harness.AllAssets().Single().Bytes.Should().Be(4096);
    }

    /// <summary>
    /// The buffering bound: a 3 MiB upload is pulled from a counting source while the store consumes it, and at no
    /// point does the pipeline hold more than one read chunk of payload that the store has not yet received. A
    /// pipeline that buffered the body (IFormFile, ReadAsByteArray, EnableBuffering) would show ~3 MiB outstanding.
    /// </summary>
    [Fact]
    public async Task UploadIsStreamed_PeakBufferingNeverExceedsOneChunk()
    {
        const int payloadBytes = 3 * 1024 * 1024;
        var boundary = $"counting-{Guid.NewGuid():N}";
        using var source = new CountingMultipartStream(boundary, MediaTestFiles.Png(64), payloadBytes);
        var probe = new BufferingProbeStore(source);
        using var harness = new UploadHarness(store: probe);

        var result = await harness.Service.UploadAsync($"multipart/form-data; boundary={boundary}", source);

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        probe.Delivered.Should().Be(payloadBytes, "the whole payload reached the store");
        probe.SourceProgressAtFirstChunk.Should().BeLessThan(
            payloadBytes / 2, "the store received data long before the body had been read — streaming, not buffering");
        probe.PeakOutstanding.Should().BeLessThanOrEqualTo(
            MediaUploadService.ReadBufferBytes,
            "peak buffering (payload pulled from the request but not yet handed to the store) is at most one chunk");
    }

    // ---- AC "Stored scoped, returned signed" — server stamping ---------------------------------------------

    [Fact]
    public async Task ParticipantUpload_IsStampedFromTheScopeAndSession_NeverTheBody()
    {
        using var harness = new UploadHarness();
        var otherExercise = Guid.NewGuid();

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Jpeg(),
            "C:\\Users\\me\\Pictures\\<script>alert(1)</script>flood <b>main</b> st.jpg",
            "image/jpeg",
            [
                MediaTestFiles.Field("exerciseId", otherExercise.ToString()),
                MediaTestFiles.Field("uploadedByHumanId", "forged-human"),
                MediaTestFiles.Field("width", "1200"),
                MediaTestFiles.Field("height", "800"),
            ]));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        var asset = harness.AllAssets().Single();
        asset.ExerciseId.Should().Be(harness.ExerciseId, "scope comes ONLY from IExerciseContext; a body exerciseId is ignored");
        asset.UploadedByHumanId.Should().Be(harness.ActingHumanId, "the uploader is the session's acting human, not a form field");
        asset.BlobName.Should().Be($"{harness.ExerciseId:D}/{asset.Id:N}.jpg");
        asset.CreatedScenarioTime.Should().Be(UploadHarness.ExerciseScenarioTime, "scenario time falls back to the exercise's persisted time when the clock is idle");
        asset.CreatedWallClock.Should().Be(UploadHarness.WallClockNow, "wall clock is the server's");
        asset.OriginalFileName.Should().Be("flood main st.jpg", "path and markup are stripped (strip, never encode)");
        asset.Width.Should().Be(1200);
        asset.Height.Should().Be(800);
        asset.DurationSec.Should().BeNull();
        result.View!.Id.Should().Be(asset.Id.ToString());
        result.View.Url.Should().Be($"https://signed.test/{asset.BlobName}", "the response carries the signed read URL");
    }

    [Fact]
    public async Task ScenarioTime_ComesFromTheRunningExerciseClock_WhenThereIsOne()
    {
        using var harness = new UploadHarness();
        var clockStart = new DateTimeOffset(2033, 9, 5, 6, 0, 0, TimeSpan.Zero);
        harness.Clock.Start(harness.ExerciseId, clockStart, TimeZoneInfo.Utc);

        await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        harness.AllAssets().Single().CreatedScenarioTime.Should().Be(clockStart, "the native exercise clock wins (COR-050/053)");
    }

    [Fact]
    public async Task StaffUpload_IsAttributedToTheStaffUser()
    {
        var staffUserId = Guid.NewGuid();
        using var harness = new UploadHarness(participantKind: null, staffUserId: staffUserId);

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        harness.AllAssets().Single().UploadedByHumanId.Should().Be(
            staffUserId.ToString(), "a staff upload is attributed to the staff user — PostAttributionResolver's staff ActingHumanId");
    }

    [Fact]
    public async Task UnresolvedScope_Is401_AndTheBodyIsNotRead()
    {
        using var harness = new UploadHarness(scopeResolved: false);
        using var body = new MemoryStream(Encoding.ASCII.GetBytes("not even multipart"));

        var result = await harness.Service.UploadAsync("multipart/form-data; boundary=x", body);

        result.Outcome.Should().Be(MediaUploadOutcome.ScopeUnresolved);
        body.Position.Should().Be(0, "nothing is read for a caller with no scope");
    }

    [Theory]
    [InlineData("readonly")]
    [InlineData("staff")]
    [InlineData("observer")]
    public async Task APersonaBoundSessionThatIsNotAParticipant_AndNotStaff_Is403(string kind)
    {
        using var harness = new UploadHarness(participantKind: kind);

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"));

        result.Outcome.Should().Be(MediaUploadOutcome.Forbidden, "participant uploads are a POSITIVE allowlist on kind 'participant'");
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task NoPersonaAndNoStaff_Is403()
    {
        using var harness = new UploadHarness(participantKind: null);

        (await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"))).Outcome
            .Should().Be(MediaUploadOutcome.Forbidden);
    }

    [Fact]
    public async Task UnconfiguredStore_Is503()
    {
        using var harness = new UploadHarness(storeConfigured: false);

        (await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png"))).Outcome
            .Should().Be(MediaUploadOutcome.StoreUnavailable);
        harness.AllAssets().Should().BeEmpty();
    }

    // ---- hint validation -----------------------------------------------------------------------------------

    [Theory]
    [InlineData("width", "0")]
    [InlineData("width", "16385")]
    [InlineData("height", "-5")]
    [InlineData("height", "12.5")]
    [InlineData("width", "wide")]
    public async Task OutOfRangeDimensions_Are400_AndTheBlobIsDeleted(string field, string value)
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png", fields: [MediaTestFiles.Field(field, value)]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
        harness.Recording.Blobs.Should().BeEmpty();
        harness.AllAssets().Should().BeEmpty();
    }

    [Theory]
    [InlineData("0")]
    [InlineData("3600.5")]
    [InlineData("NaN")]
    [InlineData("Infinity")]
    public async Task InvalidDuration_Is400(string value)
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Mp4(), "v.mp4", fields: [MediaTestFiles.Field("durationSec", value)]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
        harness.AllAssets().Should().BeEmpty();
    }

    [Fact]
    public async Task DurationOnAnImage_Is400()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Png(), "p.png", fields: [MediaTestFiles.Field("durationSec", "12")]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid, "durationSec applies to videos only");
    }

    [Fact]
    public async Task VideoWithValidDuration_RecordsIt()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(MediaTestFiles.Mp4(), "v.mp4", fields: [MediaTestFiles.Field("durationSec", "29.97")]));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        harness.AllAssets().Single().DurationSec.Should().Be(29.97);
        result.View!.DurationSec.Should().Be(29.97);
    }

    [Fact]
    public async Task PosterOnAnImage_Is400()
    {
        using var harness = new UploadHarness();
        var poster = SeedImage(harness, harness.ActingHumanId);

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Png(), "p.png", fields: [MediaTestFiles.Field("posterMediaId", poster.Id.ToString())]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid, "posterMediaId is accepted only for a video");
    }

    [Fact]
    public async Task VideoWithItsOwnImageAsPoster_RecordsThePoster_AndReturnsItsSignedUrl()
    {
        using var harness = new UploadHarness();
        var poster = SeedImage(harness, harness.ActingHumanId);

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Mp4(), "v.mp4", fields: [MediaTestFiles.Field("posterMediaId", poster.Id.ToString())]));

        result.Outcome.Should().Be(MediaUploadOutcome.Created);
        harness.AllAssets().Single(asset => asset.Kind == MediaKinds.Video).PosterMediaAssetId.Should().Be(poster.Id);
        result.View!.PosterUrl.Should().Be($"https://signed.test/{poster.BlobName}");
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("not-a-guid")]
    [InlineData("someone-elses")]
    [InlineData("a-video")]
    public async Task PosterThatIsNotTheCallersImageInThisExercise_IsTheSame400_AndNothingIsWritten(string variant)
    {
        using var harness = new UploadHarness();
        var posterId = variant switch
        {
            "unknown" => Guid.NewGuid().ToString(),
            "not-a-guid" => "poster",
            "someone-elses" => SeedImage(harness, "another-human").Id.ToString(),
            _ => SeedImage(harness, harness.ActingHumanId, MediaKinds.Video).Id.ToString(),
        };
        var before = harness.AllAssets().Count;

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Mp4(), "v.mp4", fields: [MediaTestFiles.Field("posterMediaId", posterId)]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
        result.Error.Should().Be(
            "posterMediaId does not name an image you uploaded in this exercise.",
            "every poster rejection reads the same, so the message never confirms an id exists (DP-16)");
        harness.AllAssets().Should().HaveCount(before, "zero rows written");
        harness.Recording.Blobs.Should().BeEmpty("the streamed video is deleted");
    }

    // ---- malformed requests --------------------------------------------------------------------------------

    [Fact]
    public async Task MissingFilePart_Is400()
    {
        using var harness = new UploadHarness();

        (await harness.UploadAsync(MediaTestFiles.Form(null, fields: [MediaTestFiles.Field("kind", "image")]))).Outcome
            .Should().Be(MediaUploadOutcome.Invalid);
    }

    [Fact]
    public async Task TwoFileParts_Are400_AndTheFirstBlobIsDeleted()
    {
        using var harness = new UploadHarness();
        var form = MediaTestFiles.Form(MediaTestFiles.Png(), "a.png");
        form.Add(new System.Net.Http.ByteArrayContent(MediaTestFiles.Png()), "file", "b.png");

        var result = await harness.UploadAsync(form);

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
        harness.Recording.Blobs.Should().BeEmpty();
        harness.AllAssets().Should().BeEmpty();
    }

    [Theory]
    [InlineData("application/json")]
    [InlineData("multipart/form-data")]
    [InlineData(null)]
    public async Task NonMultipartOrBoundarylessBody_Is400(string? contentType)
    {
        using var harness = new UploadHarness();
        using var body = new MemoryStream(MediaTestFiles.Png());

        (await harness.Service.UploadAsync(contentType, body)).Outcome.Should().Be(MediaUploadOutcome.Invalid);
    }

    [Fact]
    public async Task OverlongTextField_Is400()
    {
        using var harness = new UploadHarness();

        var result = await harness.UploadAsync(MediaTestFiles.Form(
            MediaTestFiles.Png(), "p.png", fields: [MediaTestFiles.Field("width", new string('9', MediaUploadService.MaxTextFieldBytes + 1))]));

        result.Outcome.Should().Be(MediaUploadOutcome.Invalid);
    }

    [Theory]
    [InlineData(null, "upload.png")]
    [InlineData("", "upload.png")]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData("<img src=x onerror=alert(1)>", "upload.png")]
    [InlineData("a\u0000b\u0007c.png", "abc.png")]
    public void SanitizeFileName_StripsPathsMarkupAndControlCharacters(string? input, string expected) =>
        MediaUploadService.SanitizeFileName(input, "png").Should().Be(expected);

    [Fact]
    public void SanitizeFileName_BoundsTheLengthToTheColumn() =>
        MediaUploadService.SanitizeFileName(new string('a', 400) + ".png", "png")
            .Should().HaveLength(MediaAsset.MaxOriginalFileNameLength);

    private static MediaAsset SeedImage(UploadHarness harness, string uploader, string kind = MediaKinds.Image)
    {
        var id = Guid.NewGuid();
        var extension = kind == MediaKinds.Image ? "png" : "mp4";
        var asset = new MediaAsset
        {
            Id = id,
            ExerciseId = harness.ExerciseId,
            Kind = kind,
            ContentType = kind == MediaKinds.Image ? "image/png" : "video/mp4",
            BlobName = MediaBlobNames.Build(harness.ExerciseId, id, extension),
            Bytes = 100,
            OriginalFileName = $"seed.{extension}",
            UploadedByHumanId = uploader,
            CreatedScenarioTime = UploadHarness.ExerciseScenarioTime,
            CreatedWallClock = UploadHarness.WallClockNow,
        };
        harness.Seed(asset);
        return asset;
    }

    /// <summary>
    /// A store that consumes the upload in small reads and, after each, measures how much PAYLOAD the pipeline has
    /// pulled from the request source but not yet handed over — the bytes the pipeline is holding.
    /// </summary>
    private sealed class BufferingProbeStore : IMediaStore
    {
        private readonly CountingMultipartStream _source;

        public BufferingProbeStore(CountingMultipartStream source) => _source = source;

        public bool IsConfigured => true;

        public long Delivered { get; private set; }

        public long PeakOutstanding { get; private set; }

        public long SourceProgressAtFirstChunk { get; private set; } = -1;

        public async Task<long> SaveAsync(string blobName, string contentType, Stream content, long maxBytes, CancellationToken cancellationToken)
        {
            var limited = new MaxLengthReadStream(content, maxBytes);
            var buffer = new byte[4096];
            int read;
            while ((read = await limited.ReadAsync(buffer, cancellationToken)) > 0)
            {
                Delivered += read;
                if (SourceProgressAtFirstChunk < 0)
                {
                    SourceProgressAtFirstChunk = _source.PayloadBytesEmitted;
                }

                PeakOutstanding = Math.Max(PeakOutstanding, _source.PayloadBytesEmitted - Delivered);
            }

            return limited.BytesRead;
        }

        public Task DeleteAsync(string blobName, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    /// <summary>
    /// A lazily generated multipart body (headers + a <paramref name="head"/>-prefixed payload + closing boundary)
    /// that counts how many PAYLOAD bytes it has emitted. The payload is never materialised.
    /// </summary>
    private sealed class CountingMultipartStream : Stream
    {
        private readonly byte[] _prefix;
        private readonly byte[] _head;
        private readonly long _payloadLength;
        private readonly byte[] _suffix;
        private long _position;

        public CountingMultipartStream(string boundary, byte[] head, long payloadLength)
        {
            _prefix = Encoding.ASCII.GetBytes(
                $"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"big.png\"\r\n"
                + "Content-Type: image/png\r\n\r\n");
            _head = head;
            _payloadLength = payloadLength;
            _suffix = Encoding.ASCII.GetBytes($"\r\n--{boundary}--\r\n");
        }

        public long PayloadBytesEmitted =>
            Math.Clamp(_position - _prefix.Length, 0, _payloadLength);

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            var total = _prefix.Length + _payloadLength + _suffix.Length;
            var written = 0;
            while (written < buffer.Length && _position < total)
            {
                buffer[written++] = ByteAt(_position++);
            }

            return written;
        }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Read(buffer.Span));

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            Task.FromResult(Read(buffer, offset, count));

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        private byte ByteAt(long position)
        {
            if (position < _prefix.Length)
            {
                return _prefix[position];
            }

            var payloadIndex = position - _prefix.Length;
            if (payloadIndex < _payloadLength)
            {
                return payloadIndex < _head.Length ? _head[payloadIndex] : (byte)0x5A;
            }

            return _suffix[payloadIndex - _payloadLength];
        }
    }
}
