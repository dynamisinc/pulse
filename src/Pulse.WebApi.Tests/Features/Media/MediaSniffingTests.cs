namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Media;
using Xunit;

/// <summary>
/// demo-polish BM AC "Types by magic bytes only" — the sniffer matrix (written first, per the story's Tests
/// section). Pure, no host and no database. The HTTP/service-level halves of the same AC (extension, client
/// <c>Content-Type</c> and <c>kind</c> hint ignored or 415) live in <see cref="MediaUploadServiceTests"/> and
/// <see cref="MediaEndpointTests"/>.
/// </summary>
public sealed class MediaSniffingTests
{
    [Theory]
    [MemberData(nameof(MediaTestFiles.AllowedTypes), MemberType = typeof(MediaTestFiles))]
    public void Sniff_RecognisesEveryAllowedType_ByItsLeadingBytes(
        string label, byte[] bytes, string kind, string contentType, string extension)
    {
        var head = bytes.AsSpan(0, Math.Min(bytes.Length, MediaSniffer.HeadLength));

        var sniffed = MediaSniffer.Sniff(head);

        sniffed.Should().NotBeNull("{0} is an allowed type and its magic bytes are well-formed", label);
        sniffed!.Kind.Should().Be(kind, "{0}'s kind is decided by its bytes", label);
        sniffed.ContentType.Should().Be(contentType, "{0} is stored under its canonical sniffed MIME type", label);
        sniffed.Extension.Should().Be(extension, "{0}'s blob extension comes from the sniff, never the file name", label);
    }

    [Theory]
    [MemberData(nameof(MediaTestFiles.DisallowedTypes), MemberType = typeof(MediaTestFiles))]
    public void Sniff_RejectsEveryDisallowedEmptyOrTruncatedInput(string label, byte[] bytes)
    {
        var head = bytes.AsSpan(0, Math.Min(bytes.Length, MediaSniffer.HeadLength));

        MediaSniffer.Sniff(head).Should().BeNull(
            "{0} is not an allowed media type by its leading bytes — the endpoint answers 415 for it", label);
    }

    [Fact]
    public void Sniff_TypesAPngScriptPolyglot_StrictlyAsPng()
    {
        var sniffed = MediaSniffer.Sniff(MediaTestFiles.PngScriptPolyglot().AsSpan(0, MediaSniffer.HeadLength));

        sniffed.Should().NotBeNull();
        sniffed!.ContentType.Should().Be(
            "image/png",
            "a PNG-header/<script> polyglot is stored and served strictly as its sniffed type, never as markup");
        sniffed.Extension.Should().Be("png");
    }

    [Fact]
    public void Sniff_TakesTheLeadingBytesAndNothingElse_SoNoFileNameOrMimeHeaderCanInfluenceIt()
    {
        // Structural guarantee: the sniffer's only input is the byte span. A file name, extension or client
        // Content-Type cannot be passed to it at all, so they cannot be "trusted" by it.
        var publicMethods = typeof(MediaSniffer).GetMethods()
            .Where(method => method.DeclaringType == typeof(MediaSniffer))
            .ToList();

        publicMethods.Should().ContainSingle(method => method.Name == nameof(MediaSniffer.Sniff));
        publicMethods.Single(method => method.Name == nameof(MediaSniffer.Sniff))
            .GetParameters()
            .Select(parameter => parameter.ParameterType)
            .Should().Equal([typeof(ReadOnlySpan<byte>)], "the decision is made from the bytes alone");
    }

    [Fact]
    public void HeadLength_IsLargeEnoughForAWebMEbmlHeader()
    {
        // The Chrome MediaRecorder EBML header is ~40 bytes; the head must hold it whole or WebM would 415.
        MediaTestFiles.WebM().AsSpan(0, MediaSniffer.HeadLength).ToArray()
            .Should().HaveCount(MediaSniffer.HeadLength);
        MediaSniffer.Sniff(MediaTestFiles.WebM().AsSpan(0, MediaSniffer.HeadLength))!.Kind.Should().Be("video");
    }
}
