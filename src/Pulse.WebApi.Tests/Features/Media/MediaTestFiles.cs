namespace Pulse.WebApi.Tests.Features.Media;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;

/// <summary>
/// Byte-level fixtures for the media pipeline: one well-formed head per allowed type, the disallowed look-alikes,
/// and a multipart body builder. Sizes are padded with a non-magic filler so the bytes stay a valid sniff.
/// </summary>
internal static class MediaTestFiles
{
    private const byte Filler = 0x5A;

    public static byte[] Jpeg(int size = 256) => Pad([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, .. "JFIF"u8.ToArray(), 0x00], size);

    public static byte[] Png(int size = 256) => Pad(
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, .. "IHDR"u8.ToArray()], size);

    public static byte[] Gif87(int size = 256) => Pad("GIF87a"u8.ToArray(), size);

    public static byte[] Gif89(int size = 256) => Pad("GIF89a"u8.ToArray(), size);

    public static byte[] WebP(int size = 256, string chunk = "VP8 ") =>
        Pad([.. "RIFF"u8.ToArray(), 0x24, 0x00, 0x00, 0x00, .. "WEBP"u8.ToArray(), .. Encoding.ASCII.GetBytes(chunk)], size);

    /// <summary>An ISO-BMFF file whose <c>ftyp</c> box carries <paramref name="majorBrand"/>.</summary>
    public static byte[] IsoBmff(string majorBrand, int size = 512) => Pad(
        [0x00, 0x00, 0x00, 0x20, .. "ftyp"u8.ToArray(), .. Encoding.ASCII.GetBytes(majorBrand), 0x00, 0x00, 0x02, 0x00,
         .. "isomiso2avc1mp41"u8.ToArray(), 0x00, 0x00, 0x00, 0x08, .. "mdat"u8.ToArray()],
        size);

    public static byte[] Mp4(int size = 512) => IsoBmff("isom", size);

    /// <summary>An EBML header (as Chrome's MediaRecorder writes it) with the given DocType.</summary>
    public static byte[] Ebml(string docType, int size = 512)
    {
        var doc = Encoding.ASCII.GetBytes(docType);
        byte[] body =
        [
            0x42, 0x86, 0x81, 0x01, // EBMLVersion 1
            0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion 1
            0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength 4
            0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength 8
            0x42, 0x82, (byte)(0x80 | doc.Length), .. doc, // DocType
            0x42, 0x87, 0x81, 0x04, // DocTypeVersion 4
            0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion 2
        ];
        return Pad([0x1A, 0x45, 0xDF, 0xA3, (byte)(0x80 | body.Length), .. body, 0x18, 0x53, 0x80, 0x67], size);
    }

    public static byte[] WebM(int size = 512) => Ebml("webm", size);

    public static byte[] Svg() => Encoding.UTF8.GetBytes(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"alert(1)\"><script>alert(1)</script></svg>");

    public static byte[] SvgWithXmlProlog() => Encoding.UTF8.GetBytes(
        "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");

    public static byte[] Html() => Encoding.UTF8.GetBytes("<!DOCTYPE html><html><script>alert(document.cookie)</script></html>");

    public static byte[] WindowsExe() => Pad([.. "MZ"u8.ToArray(), 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00], 256);

    public static byte[] Elf() => Pad([0x7F, .. "ELF"u8.ToArray(), 0x02, 0x01, 0x01], 256);

    public static byte[] Pdf() => Pad("%PDF-1.7\n"u8.ToArray(), 256);

    /// <summary>A small, well-formed, benign PDF (header, two objects, trailer, <c>%%EOF</c>) — accepted by the scan.</summary>
    public static byte[] BenignPdf() => Encoding.Latin1.GetBytes(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
        + "trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n");

    /// <summary>A PDF whose catalog runs JavaScript on open — rejected by the deny-list scan.</summary>
    public static byte[] JavaScriptPdf() => Encoding.Latin1.GetBytes(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>\nendobj\n"
        + "trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n");

    /// <summary>An Office Open XML (zip) container — a .docx by its bytes.</summary>
    public static byte[] Docx() => Pad([.. "PK"u8.ToArray(), 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, .. "[Content_Types].xml"u8.ToArray()], 256);

    /// <summary>A legacy Office (OLE2 compound file) header — a .doc/.xls by its bytes.</summary>
    public static byte[] OleCompoundFile() => Pad([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 256);

    /// <summary>Markup first, then a PDF header — an HTML/PDF polyglot; never typed as a document.</summary>
    public static byte[] HtmlThenPdf() => [.. "<html><body>"u8.ToArray(), .. BenignPdf()];

    /// <summary>A Windows executable header, then a PDF header inside the first 1024 bytes.</summary>
    public static byte[] ExeThenPdf() => [.. WindowsExe().Take(64), .. BenignPdf()];

    /// <summary>A PNG signature followed by markup — must sniff (and be stored) strictly as image/png.</summary>
    public static byte[] PngScriptPolyglot() =>
        [.. Png(32), .. "<html><script>alert(document.domain)</script></html>"u8.ToArray()];

    /// <summary>Every allowed type with its expected sniff.</summary>
    public static IEnumerable<object[]> AllowedTypes() =>
    [
        ["jpeg", Jpeg(), "image", "image/jpeg", "jpg"],
        ["png", Png(), "image", "image/png", "png"],
        ["gif87a", Gif87(), "image", "image/gif", "gif"],
        ["gif89a", Gif89(), "image", "image/gif", "gif"],
        ["webp-lossy", WebP(), "image", "image/webp", "webp"],
        ["webp-lossless", WebP(chunk: "VP8L"), "image", "image/webp", "webp"],
        ["webp-extended", WebP(chunk: "VP8X"), "image", "image/webp", "webp"],
        ["mp4-isom", Mp4(), "video", "video/mp4", "mp4"],
        ["mp4-mp42", IsoBmff("mp42"), "video", "video/mp4", "mp4"],
        ["mp4-avc1", IsoBmff("avc1"), "video", "video/mp4", "mp4"],
        ["mp4-m4v", IsoBmff("M4V "), "video", "video/mp4", "mp4"],
        ["webm", WebM(), "video", "video/webm", "webm"],
        ["pdf", Pdf(), "document", "application/pdf", "pdf"],
        ["pdf-benign", BenignPdf(), "document", "application/pdf", "pdf"],
    ];

    /// <summary>Every disallowed, empty or truncated input.</summary>
    public static IEnumerable<object[]> DisallowedTypes() =>
    [
        ["empty", Array.Empty<byte>()],
        ["svg", Svg()],
        ["svg-xml-prolog", SvgWithXmlProlog()],
        ["html", Html()],
        ["windows-exe", WindowsExe()],
        ["elf", Elf()],
        ["docx", Docx()],
        ["ole-doc", OleCompoundFile()],
        ["html-then-pdf", HtmlThenPdf()],
        ["exe-then-pdf", ExeThenPdf()],
        ["pdf-without-version", Pad("%PDF-x"u8.ToArray(), 64)],
        ["plain-text", Encoding.UTF8.GetBytes("hello world, this is not an image")],
        ["truncated-jpeg", new byte[] { 0xFF, 0xD8 }],
        ["truncated-png", Png().Take(5).ToArray()],
        ["truncated-gif", "GIF8"u8.ToArray()],
        ["truncated-webp", WebP().Take(11).ToArray()],
        ["riff-not-webp", Pad([.. "RIFF"u8.ToArray(), 0x24, 0, 0, 0, .. "WAVEfmt "u8.ToArray()], 64)],
        ["webp-unknown-chunk", WebP(chunk: "XXXX")],
        ["truncated-mp4", Mp4().Take(14).ToArray()],
        ["quicktime-mov", IsoBmff("qt  ")],
        ["3gp", IsoBmff("3gp4")],
        ["avif-image", IsoBmff("avif")],
        ["heic-image", IsoBmff("heic")],
        ["truncated-ebml", WebM().Take(12).ToArray()],
        ["matroska", Ebml("matroska")],
    ];

    /// <summary>A multipart/form-data body for <c>POST /api/media</c>.</summary>
    /// <param name="file">The file bytes, or <c>null</c> to omit the file part.</param>
    /// <param name="fileName">The part's filename (never used for typing).</param>
    /// <param name="fileContentType">The part's Content-Type header (never used for typing).</param>
    /// <param name="fields">Text fields, in order. Fields listed BEFORE the file go first when <paramref name="fieldsFirst"/>.</param>
    /// <param name="fieldsFirst">Whether the text fields precede the file part.</param>
    public static MultipartFormDataContent Form(
        byte[]? file,
        string fileName = "photo.jpg",
        string fileContentType = "application/octet-stream",
        IEnumerable<KeyValuePair<string, string>>? fields = null,
        bool fieldsFirst = false)
    {
        var form = new MultipartFormDataContent($"media-test-{Guid.NewGuid():N}");

        void AddFields()
        {
            foreach (var (name, value) in fields ?? [])
            {
                form.Add(new StringContent(value), name);
            }
        }

        if (fieldsFirst)
        {
            AddFields();
        }

        if (file is not null)
        {
            var part = new ByteArrayContent(file);
            part.Headers.ContentType = MediaTypeHeaderValue.Parse(fileContentType);
            form.Add(part, "file", fileName);
        }

        if (!fieldsFirst)
        {
            AddFields();
        }

        return form;
    }

    /// <summary>Serializes a form into (contentType, body) for driving the service directly.</summary>
    public static async Task<(string ContentType, Stream Body)> Serialize(MultipartFormDataContent form)
    {
        var bytes = await form.ReadAsByteArrayAsync();
        return (form.Headers.ContentType!.ToString(), new MemoryStream(bytes));
    }

    public static KeyValuePair<string, string> Field(string name, string value) => new(name, value);

    private static byte[] Pad(byte[] head, int size)
    {
        if (head.Length >= size)
        {
            return head;
        }

        var bytes = new byte[size];
        head.CopyTo(bytes, 0);
        bytes.AsSpan(head.Length).Fill(Filler);
        return bytes;
    }
}
