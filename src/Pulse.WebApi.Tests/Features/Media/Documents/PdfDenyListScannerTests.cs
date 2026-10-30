namespace Pulse.WebApi.Tests.Features.Media.Documents;

using System;
using System.Diagnostics;
using System.Linq;
using System.Text;
using FluentAssertions;
using Pulse.WebApi.Features.Media.Documents;
using Xunit;

/// <summary>
/// press-room story 02 AC "Deny-list scan" — the scanner's rules one at a time (the corpus covers whole files):
/// <c>#xx</c> normalization, token boundaries, over-matching in strings/comments, the stream-body relaxation for the
/// two-character names and its false-positive guard on 20 MB of random data, the end-of-file window, and the time bound.
/// </summary>
public sealed class PdfDenyListScannerTests
{
    private const string Trailer = "\ntrailer\n<< /Size 1 >>\nstartxref\n0\n%%EOF\n";

    [Theory]
    [InlineData("/JS")]
    [InlineData("/JavaScript")]
    [InlineData("/OpenAction")]
    [InlineData("/AA")]
    [InlineData("/Launch")]
    [InlineData("/EmbeddedFile")]
    [InlineData("/EmbeddedFiles")]
    [InlineData("/XFA")]
    [InlineData("/SubmitForm")]
    [InlineData("/Encrypt")]
    [InlineData("/ImportData")]
    [InlineData("/RichMedia")]
    [InlineData("/GoToE")]
    [InlineData("/GoToR")]
    [InlineData("/EF")]
    [InlineData("/FileAttachment")]
    [InlineData("/Collection")]
    public void EveryDeniedName_IsRejected_InADictionary(string name) =>
        Scan($"1 0 obj << /Type /Catalog {name} 2 0 R >> endobj").Accepted.Should().BeFalse("{0} is on the deny list", name);

    [Theory]
    [InlineData("/J#53")]
    [InlineData("/#4A#53")]
    [InlineData("/#4a#53")]
    [InlineData("/Java#53cript")]
    [InlineData("/#4F#70#65#6E#41#63#74#69#6F#6E")]
    [InlineData("/Launc#68")]
    [InlineData("/Encryp#74")]
    public void NameEscapes_AreNormalizedBeforeMatching(string escaped) =>
        Scan($"<< {escaped} (x) >>").Accepted.Should().BeFalse("{0} decodes to a deny-listed name", escaped);

    [Theory]
    [InlineData("<</S/JavaScript/JS(app.alert(1))>>")] // no whitespace at all: every '/' is a token boundary
    [InlineData("<< /JS[")]
    [InlineData("<< /JS<feff>")]
    [InlineData("<< /AA<< /O 3 0 R >> >>")]
    [InlineData("<< /AA\0/O")] // NUL is PDF whitespace
    public void DenyListedNames_AreFound_AtEveryTokenBoundary(string fragment) =>
        Scan(fragment).Accepted.Should().BeFalse();

    [Theory]
    [InlineData("<< /JSX (x) >>")]
    [InlineData("<< /AAA 1 >>")]
    [InlineData("<< /JavaScripts 1 >>")]
    [InlineData("<< /XJS 1 >>")]
    [InlineData("<< /J#5 (x) >>")]
    [InlineData("<< /javascript 1 >>")] // names are case-sensitive (ISO 32000-1 §7.3.5); readers do not act on this
    [InlineData("<< /Type /Page /URI (https://example.invalid/) >>")]
    public void NamesThatOnlyResembleADeniedName_AreAccepted(string fragment) =>
        Scan(fragment).Should().Be(DocumentScanResult.Pass);

    [Theory]
    [InlineData("(text that mentions /JavaScript in a string)")]
    [InlineData("% a comment that mentions /OpenAction\n")]
    [InlineData("<< /Title (an /Encrypt in a title) >>")]
    public void TokensInStringsAndComments_AreStillRejected_OverMatchingIsTheSafeDirection(string fragment) =>
        Scan(fragment).Accepted.Should().BeFalse("the scan does not trust its own idea of what is 'only text'");

    [Fact]
    public void AStringThatSaysStream_DoesNotOpenAStreamBody_SoAShortNameAfterItIsStillCaught()
    {
        // The bypass the lexer exists to stop: if "stream" inside a string were taken as a stream keyword, the binary
        // context rule would apply to everything after it.
        var fragment = "(>> stream\n)" + new string('\x80', 16) + "/JS (x)";

        Scan(fragment).Accepted.Should().BeFalse();
    }

    [Fact]
    public void ACommentThatSaysStream_DoesNotOpenAStreamBody()
    {
        var fragment = "% >> stream\n" + new string('\x80', 16) + "/AA << >>";

        Scan(fragment).Accepted.Should().BeFalse();
    }

    [Fact]
    public void InsideStreamData_AShortNameSurroundedByBinary_IsTreatedAsCompressedNoise()
    {
        var binary = new string('\x9C', 16);
        // NUL is PDF whitespace, so it terminates the name — but it is not text, so the relaxation applies.
        var fragment = "<< /Length 40 /Filter /FlateDecode >>\nstream\n" + binary + "/JS\0" + binary + "\nendstream";

        Scan(fragment).Should().Be(DocumentScanResult.Pass, "two random bytes spelling JS inside compressed data are not syntax");
    }

    [Fact]
    public void InsideAnUnfilteredStream_AShortNameSurroundedByBinary_IsStillRejected()
    {
        // An unencoded stream (an uncompressed object stream, say) is parsed as syntax by readers: no relaxation.
        var binary = new string('\x9C', 16);
        var fragment = "1 0 obj << /Length 40 >>\nstream\n" + binary + "/AA\0" + binary + "\nendstream\nendobj";

        Scan(fragment).Accepted.Should().BeFalse();
    }

    [Fact]
    public void AFilterInAnEarlierObject_DoesNotRelaxALaterUnfilteredStream()
    {
        var binary = new string('\x9C', 16);
        var fragment = "1 0 obj << /Filter /FlateDecode >> endobj\n2 0 obj << /Length 40 >>\nstream\n" + binary + "/JS\0"
            + "\nendstream\nendobj";

        Scan(fragment).Accepted.Should().BeFalse("a /Filter belongs to the object it appears in");
    }

    [Theory]
    [InlineData("/Filter []", false)]
    [InlineData("/Filter [ ]", false)]
    [InlineData("/Filter null", false)]
    [InlineData("/Filter 9 0 R", false)]
    [InlineData("/Filter %c\n/FlateDecode", false)]
    [InlineData("/Filter (x)", false)]
    [InlineData("/Filter <2F58>", false)]
    [InlineData("/Filter /FlateDecode", true)]
    [InlineData("/Filter/FlateDecode", true)]
    [InlineData("/Filter [/ASCII85Decode /FlateDecode]", true)]
    [InlineData("/Filter[/FlateDecode]", true)]
    public void OnlyAFilterValueThatNamesAFilter_RelaxesTheStream(string filterEntry, bool relaxed)
    {
        // "/Filter []" is legal and means NO filter: such a stream is parsed as syntax, so it must stay strict.
        var binary = new string('\x9C', 16);
        var fragment = $"1 0 obj << {filterEntry} /Length 40 >>\nstream\n" + binary + "/AA\0" + binary + "\nendstream\nendobj";

        Scan(fragment).Accepted.Should().Be(relaxed, "{0}", filterEntry);
    }

    [Fact]
    public void AFilterInACommentOrString_DoesNotRelaxTheStream()
    {
        var binary = new string('\x9C', 16);
        // The comment sits INSIDE the dictionary, so ">> stream" still opens a body — only the /Filter is not real syntax.
        var fragment = "1 0 obj << /T (/Filter) % /Filter\n /Length 40 >>\nstream\n" + binary + "/JS\0" + "\nendstream\nendobj";

        Scan(fragment).Accepted.Should().BeFalse();
    }

    [Fact]
    public void InsideStreamData_AShortNameInText_IsStillRejected()
    {
        var fragment = "<< /Length 40 >>\nstream\n7 0 obj << /S /Rendition /JS (app.alert(1)) >>\nendstream";

        Scan(fragment).Accepted.Should().BeFalse("an uncompressed object stream holding /JS as text is caught");
    }

    [Fact]
    public void InsideStreamData_ALongNameIsRejectedEvenAmongBinary()
    {
        var binary = new string('\x9C', 16);
        var fragment = "<< /Length 40 /Filter /FlateDecode >>\nstream\n" + binary + "/OpenAction\0" + binary + "\nendstream";

        Scan(fragment).Accepted.Should().BeFalse("only /JS and /AA get the binary-context relaxation");
    }

    [Fact]
    public void AfterEndstream_TheRelaxationEnds()
    {
        var binary = new string('\x9C', 16);
        var fragment = "<< /Length 4 /Filter /FlateDecode >>\nstream\nabcd\nendstream\n" + binary + "/JS\0";

        Scan(fragment).Accepted.Should().BeFalse("outside a stream body every deny-listed name counts");
    }

    [Fact]
    public void TwentyMegabytesOfRandomStreamData_IsAccepted_InUnderAFewSeconds()
    {
        // The false-positive guard behind the stream relaxation, at the full document ceiling: compressed image data
        // is effectively random. Seeded, so the outcome is deterministic.
        var random = new Random(20261029);
        var data = new byte[20 * 1024 * 1024];
        random.NextBytes(data);
        var head = Encoding.Latin1.GetBytes("%PDF-1.7\n1 0 obj << /Length 20971520 /Filter /FlateDecode >>\nstream\n");
        var tail = Encoding.Latin1.GetBytes("\nendstream\nendobj" + Trailer);

        var stopwatch = Stopwatch.StartNew();
        var scan = new PdfDenyListScanner().Begin();
        scan.Append(head);
        for (var offset = 0; offset < data.Length; offset += 16 * 1024)
        {
            scan.Append(data.AsSpan(offset, 16 * 1024));
        }

        scan.Append(tail);
        var verdict = scan.Complete();
        stopwatch.Stop();

        verdict.Should().Be(DocumentScanResult.Pass);
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(10), "one bounded pass over the largest allowed file");
    }

    [Fact]
    public void AMissingEofMarker_IsTruncated()
    {
        var verdict = PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes("%PDF-1.7\n1 0 obj << >> endobj\n"));

        verdict.Should().Be(DocumentScanResult.Reject(DocumentRejectionReasons.Truncated));
    }

    [Fact]
    public void AnEofMarkerFollowedByMoreThan1024Bytes_IsTruncated_AndWithin1024BytesIsAccepted()
    {
        // Ends exactly at "%%EOF" (no trailing newline), so the padding is the whole distance from the marker's end.
        var pdf = "%PDF-1.7\n1 0 obj << >> endobj" + Trailer.TrimEnd('\n');

        PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes(pdf + new string(' ', PdfDenyListScanner.EofWindowBytes)))
            .Should().Be(DocumentScanResult.Pass, "readers tolerate trailing bytes within 1024 of the end");
        PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes(pdf + new string(' ', PdfDenyListScanner.EofWindowBytes + 1)))
            .Should().Be(DocumentScanResult.Reject(DocumentRejectionReasons.Truncated), "an appended payload is a polyglot");
    }

    [Theory]
    [InlineData("<html></html>")]
    [InlineData("PK")]
    [InlineData("x")]
    public void AnythingButWhitespaceAfterTheLastEofMarker_IsATrailingPayload(string payload)
    {
        var pdf = "%PDF-1.7\n1 0 obj << >> endobj" + Trailer;

        PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes(pdf + payload))
            .Should().Be(DocumentScanResult.Reject(DocumentRejectionReasons.Truncated), "a short appended payload is a polyglot too");
    }

    [Fact]
    public void AnIncrementalUpdate_EndsAtItsOwnEofMarker_AndIsAccepted()
    {
        // Trailing CR/LF, NULs and a DOS end-of-file (0x1A) are not a payload.
        var pdf = "%PDF-1.7\n1 0 obj << >> endobj" + Trailer + "2 0 obj << >> endobj" + Trailer + "\r\n\0\0\x1A";

        PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes(pdf)).Should().Be(DocumentScanResult.Pass);
    }

    [Fact]
    public void IsRejected_TurnsTrueAtTheFirstDeniedToken_BeforeTheFileEnds()
    {
        var scan = new PdfDenyListScanner().Begin();

        scan.Append(Encoding.Latin1.GetBytes("%PDF-1.7\n<< /OpenAction "));

        scan.IsRejected.Should().BeTrue("the upload can stop streaming here");
    }

    [Fact]
    public void AnOverlongName_CannotMatch_AndDoesNotGrowState()
    {
        var name = "/" + new string('J', 100_000) + "S";

        Scan($"<< {name} 1 >>").Should().Be(DocumentScanResult.Pass);
    }

    [Fact]
    public void DeeplyNestedStringsAndDictionaries_DoNotHang()
    {
        var nested = new string('(', 200_000) + new string(')', 200_000) + string.Concat(Enumerable.Repeat("<<", 100_000));
        var stopwatch = Stopwatch.StartNew();

        Scan(nested).Should().Be(DocumentScanResult.Pass);
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void AppendAfterComplete_Throws()
    {
        var scan = new PdfDenyListScanner().Begin();
        scan.Append(Encoding.Latin1.GetBytes("%PDF-1.7" + Trailer));
        scan.Complete();

        var append = () => scan.Append(new byte[] { 0x20 });

        append.Should().Throw<InvalidOperationException>();
    }

    private static DocumentScanResult Scan(string body) =>
        PdfDenyListScanner.Scan(Encoding.Latin1.GetBytes("%PDF-1.7\n" + body + Trailer));
}
