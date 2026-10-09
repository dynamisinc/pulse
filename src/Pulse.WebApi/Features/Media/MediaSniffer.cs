namespace Pulse.WebApi.Features.Media;

using System.Buffers.Binary;
using System.Text;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The outcome of a successful magic-byte sniff — the ONLY source of an upload's kind, MIME type and blob
/// extension.
/// </summary>
/// <param name="Kind"><see cref="MediaKinds.Image"/> or <see cref="MediaKinds.Video"/>.</param>
/// <param name="ContentType">The canonical MIME type stored on the asset and the blob.</param>
/// <param name="Extension">The blob-name extension (no dot).</param>
public sealed record SniffedMediaType(string Kind, string ContentType, string Extension);

/// <summary>
/// Decides an upload's type from its LEADING BYTES alone (demo-polish BM AC "Types by magic bytes only",
/// NFR-004). The file name, its extension and the client's <c>Content-Type</c> are never inputs — this type
/// cannot even see them. An allowlist: JPEG, PNG, GIF87a/89a, WebP, MP4 (by <c>ftyp</c> major brand) and WebM
/// (EBML + <c>webm</c> DocType). Everything else — SVG, HTML, executables, PDFs, empty or truncated headers,
/// QuickTime/3GP/HEIF/AVIF ISO-BMFF brands, Matroska — is <c>null</c> (the endpoint's 415).
/// </summary>
/// <remarks>
/// A polyglot (a valid PNG signature followed by markup) sniffs as PNG and is then stored and served STRICTLY as
/// <c>image/png</c>: the browser never treats it as a document, and the read SAS pins the response
/// <c>Content-Type</c> to the stored value.
/// </remarks>
public static class MediaSniffer
{
    /// <summary>
    /// How many leading bytes the upload pipeline reads before sniffing. Enough for every signature here,
    /// including a WebM EBML header (typically ~40 bytes).
    /// </summary>
    public const int HeadLength = 64;

    private static readonly SniffedMediaType Jpeg = new(MediaKinds.Image, "image/jpeg", "jpg");
    private static readonly SniffedMediaType Png = new(MediaKinds.Image, "image/png", "png");
    private static readonly SniffedMediaType Gif = new(MediaKinds.Image, "image/gif", "gif");
    private static readonly SniffedMediaType WebP = new(MediaKinds.Image, "image/webp", "webp");
    private static readonly SniffedMediaType Mp4 = new(MediaKinds.Video, "video/mp4", "mp4");
    private static readonly SniffedMediaType WebM = new(MediaKinds.Video, "video/webm", "webm");

    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] EbmlMagic = [0x1A, 0x45, 0xDF, 0xA3];

    /// <summary>
    /// MP4 major brands accepted as <c>video/mp4</c>. Deliberately an allowlist: the ISO base media file format
    /// also carries QuickTime (<c>qt  </c>), 3GPP, HEIF/HEIC and AVIF (<c>avif</c> is an IMAGE), none of which is an
    /// MP4 video a browser is guaranteed to play.
    /// </summary>
    private static readonly HashSet<string> Mp4MajorBrands = new(StringComparer.Ordinal)
    {
        "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP", "dash", "mmp4", "MSNV",
    };

    private static readonly HashSet<string> WebPChunkTypes = new(StringComparer.Ordinal) { "VP8 ", "VP8L", "VP8X" };

    /// <summary>Sniffs <paramref name="head"/> (the file's first bytes).</summary>
    /// <param name="head">Up to <see cref="HeadLength"/> leading bytes of the upload.</param>
    /// <returns>The sniffed type, or <c>null</c> when the bytes are not an allowed media type.</returns>
    public static SniffedMediaType? Sniff(ReadOnlySpan<byte> head)
    {
        if (head.Length >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF)
        {
            return Jpeg;
        }

        if (head.StartsWith(PngSignature))
        {
            return Png;
        }

        if (head.Length >= 6 && (head[..6].SequenceEqual("GIF87a"u8) || head[..6].SequenceEqual("GIF89a"u8)))
        {
            return Gif;
        }

        if (IsWebP(head))
        {
            return WebP;
        }

        if (IsMp4(head))
        {
            return Mp4;
        }

        if (IsWebM(head))
        {
            return WebM;
        }

        return null;
    }

    /// <summary><c>RIFF</c> + size + <c>WEBP</c> + a <c>VP8 </c>/<c>VP8L</c>/<c>VP8X</c> first chunk.</summary>
    private static bool IsWebP(ReadOnlySpan<byte> head) =>
        head.Length >= 16
        && head[..4].SequenceEqual("RIFF"u8)
        && head.Slice(8, 4).SequenceEqual("WEBP"u8)
        && WebPChunkTypes.Contains(Encoding.ASCII.GetString(head.Slice(12, 4)));

    /// <summary>
    /// An ISO-BMFF <c>ftyp</c> box at offset 0 — a sane 32-bit size (at least the 16-byte size/type/major/minor
    /// header, and present in full in the head) and an allowlisted major brand.
    /// </summary>
    private static bool IsMp4(ReadOnlySpan<byte> head)
    {
        if (head.Length < 16 || !head.Slice(4, 4).SequenceEqual("ftyp"u8))
        {
            return false;
        }

        var boxSize = BinaryPrimitives.ReadUInt32BigEndian(head[..4]);
        if (boxSize < 16 || boxSize > 4096)
        {
            return false;
        }

        return Mp4MajorBrands.Contains(Encoding.ASCII.GetString(head.Slice(8, 4)));
    }

    /// <summary>The EBML magic followed by an EBML header whose <c>DocType</c> (0x4282) is exactly <c>webm</c>.</summary>
    private static bool IsWebM(ReadOnlySpan<byte> head)
    {
        if (!head.StartsWith(EbmlMagic))
        {
            return false;
        }

        var position = EbmlMagic.Length;
        if (!TryReadVint(head, position, out var headerSize, out var sizeLength))
        {
            return false;
        }

        position += sizeLength;
        var end = position + headerSize;

        while (position < end && position < head.Length)
        {
            if (!TryReadElementId(head, position, out var elementId, out var idLength))
            {
                return false;
            }

            position += idLength;
            if (!TryReadVint(head, position, out var elementSize, out var elementSizeLength))
            {
                return false;
            }

            position += elementSizeLength;
            if (elementId == 0x4282)
            {
                if (position + elementSize > head.Length)
                {
                    // Truncated header — the DocType is not all there. Fail closed.
                    return false;
                }

                var docType = Encoding.ASCII.GetString(head.Slice(position, (int)elementSize)).TrimEnd('\0');
                return string.Equals(docType, "webm", StringComparison.Ordinal);
            }

            position += (int)elementSize;
        }

        return false;
    }

    /// <summary>Reads an EBML element id (1–4 bytes, marker bits kept, as the spec writes ids).</summary>
    private static bool TryReadElementId(ReadOnlySpan<byte> data, int position, out long id, out int length)
    {
        id = 0;
        length = 0;
        if (position >= data.Length)
        {
            return false;
        }

        var first = data[position];
        length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
        if (length == 0 || position + length > data.Length)
        {
            return false;
        }

        for (var i = 0; i < length; i++)
        {
            id = (id << 8) | data[position + i];
        }

        return true;
    }

    /// <summary>
    /// Reads an EBML variable-length size (1–8 bytes, marker bit removed). An "unknown size" (all value bits set)
    /// or anything implausibly large for a header is rejected.
    /// </summary>
    private static bool TryReadVint(ReadOnlySpan<byte> data, int position, out int value, out int length)
    {
        value = 0;
        length = 0;
        if (position >= data.Length)
        {
            return false;
        }

        var first = data[position];
        if (first == 0)
        {
            return false;
        }

        length = 1;
        var mask = 0x80;
        while ((first & mask) == 0)
        {
            mask >>= 1;
            length++;
        }

        if (position + length > data.Length)
        {
            return false;
        }

        long result = first & (mask - 1);
        var allOnes = result == mask - 1;
        for (var i = 1; i < length; i++)
        {
            var next = data[position + i];
            allOnes &= next == 0xFF;
            result = (result << 8) | next;
        }

        if (allOnes || result > 4096)
        {
            return false;
        }

        value = (int)result;
        return true;
    }
}
