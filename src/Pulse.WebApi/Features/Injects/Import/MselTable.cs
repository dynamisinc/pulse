namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Text;

/// <summary>
/// A Cadence MSEL file read into plain text cells (demo-feedback story 03): the header row and every non-blank data row,
/// whether it came from the <c>.xlsx</c> (<see cref="MselWorkbookReader"/>) or the <c>.csv</c> (<see cref="MselCsvReader"/>).
/// Nothing here is sanitized yet; every cell is length-bounded to <see cref="MselLimits.MaxCellLength"/> by the reader.
/// </summary>
/// <param name="Headers">The header row's cells, in column order.</param>
/// <param name="Rows">The non-blank data rows, in file order.</param>
public sealed record MselTable(IReadOnlyList<string> Headers, IReadOnlyList<MselRow> Rows);

/// <summary>One non-blank data row of an MSEL file.</summary>
/// <param name="RowNumber">The row number as the spreadsheet shows it (see <see cref="InjectImportRowDto.RowNumber"/>).</param>
/// <param name="Cells">The cells, in column order (a short row has fewer cells than the header).</param>
public sealed record MselRow(int RowNumber, IReadOnlyList<string> Cells);

/// <summary>The outcome of reading an upload: a table, or a readable reason for the <c>400</c>.</summary>
public sealed class MselReadResult
{
    private MselReadResult(MselTable? table, string? error)
    {
        Table = table;
        Error = error;
    }

    /// <summary>The table when the file was readable.</summary>
    public MselTable? Table { get; }

    /// <summary>The readable reason the file was refused, else <c>null</c>.</summary>
    public string? Error { get; }

    /// <summary>A readable file.</summary>
    /// <param name="table">The table.</param>
    /// <returns>The result.</returns>
    public static MselReadResult Ok(MselTable table) => new(table, null);

    /// <summary>A refused file.</summary>
    /// <param name="error">The readable reason.</param>
    /// <returns>The result.</returns>
    public static MselReadResult Fail(string error) => new(null, error);
}

/// <summary>The upload limits of the MSEL import (frozen in <c>implementation.md</c> → MSEL columns).</summary>
public static class MselLimits
{
    /// <summary>The most bytes an import file may have (2 MiB).</summary>
    public const int MaxFileBytes = 2 * 1024 * 1024;

    /// <summary>The request-body cap: the file plus room for the multipart envelope (2 MiB + 64 KiB).</summary>
    public const long MaxRequestBytes = MaxFileBytes + (64 * 1024);

    /// <summary>The most non-blank data rows one file may carry.</summary>
    public const int MaxDataRows = 2000;

    /// <summary>
    /// The most characters kept from any one cell before it is sanitized. Every field the import uses is far shorter
    /// (post text 280, notes 500), so this only bounds the work a hostile cell can cause; it never changes a valid row.
    /// </summary>
    public const int MaxCellLength = 4000;

    /// <summary>The most header columns read; an MSEL has 19 (+ the Pulse extension), so this is generous.</summary>
    public const int MaxColumns = 256;

    /// <summary>
    /// The most bytes a workbook may expand to (the sum of its parts' declared uncompressed sizes) before ClosedXML loads
    /// it — the zip-bomb bound (16 MiB, Gate-1 M-1). A 2,000-row MSEL is a few MB unpacked.
    /// </summary>
    public const long MaxWorkbookUncompressedBytes = 16L * 1024 * 1024;
}

/// <summary>Decides what an upload is by its bytes, never by its name or MIME type alone.</summary>
public static class MselFileFormat
{
    /// <summary>The refusal for a file that is neither an <c>.xlsx</c> workbook nor UTF-8 CSV text.</summary>
    public const string NotXlsxOrCsvMessage = "the file must be an Excel workbook (.xlsx) or a UTF-8 CSV file.";

    /// <summary>The refusal for a file named or typed as a workbook whose bytes are not one.</summary>
    public const string NotAWorkbookMessage =
        "the file is named or typed as an Excel workbook but its content is not an .xlsx workbook.";

    private static readonly byte[] ZipMagic = [0x50, 0x4B, 0x03, 0x04];

    private static readonly string[] WorkbookExtensions = [".xlsx", ".xlsm", ".xls", ".xlsb"];

    /// <summary>Whether <paramref name="content"/> starts with the zip local-file-header magic (<c>PK\x03\x04</c>).</summary>
    /// <param name="content">The file bytes.</param>
    /// <returns><c>true</c> for a zip container (an <c>.xlsx</c> candidate).</returns>
    public static bool HasXlsxMagic(ReadOnlySpan<byte> content) => content.StartsWith(ZipMagic);

    /// <summary>
    /// Whether the client CLAIMS a workbook (by extension or MIME type). Used only to refuse a claim the bytes contradict
    /// (a renamed text file) instead of reading it as CSV; a claim never makes a file an <c>.xlsx</c>.
    /// </summary>
    /// <param name="fileName">The uploaded file name, if any.</param>
    /// <param name="contentType">The part's content type, if any.</param>
    /// <returns><c>true</c> when the name or type says spreadsheet workbook.</returns>
    public static bool ClaimsWorkbook(string? fileName, string? contentType)
    {
        var extension = Path.GetExtension(fileName ?? string.Empty);
        if (WorkbookExtensions.Any(candidate => string.Equals(candidate, extension, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        var type = contentType?.Trim() ?? string.Empty;
        return type.StartsWith("application/vnd.openxmlformats-officedocument.spreadsheetml", StringComparison.OrdinalIgnoreCase)
            || type.StartsWith("application/vnd.ms-excel", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Decodes strict UTF-8 (a leading BOM tolerated and dropped). Returns <c>null</c> for anything that is not text:
    /// invalid UTF-8 (a legacy <c>.xls</c>, an image, a UTF-16 file) or a NUL character.
    /// </summary>
    /// <param name="content">The file bytes.</param>
    /// <returns>The text, or <c>null</c>.</returns>
    public static string? DecodeUtf8Text(byte[] content)
    {
        ArgumentNullException.ThrowIfNull(content);

        var strict = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
        string text;
        try
        {
            text = strict.GetString(content);
        }
        catch (DecoderFallbackException)
        {
            return null;
        }

        if (text.Length > 0 && text[0] == '﻿')
        {
            text = text[1..];
        }

        return text.Contains('\0', StringComparison.Ordinal) ? null : text;
    }

    /// <summary>Bounds one raw cell to <see cref="MselLimits.MaxCellLength"/> characters (never splitting a surrogate pair).</summary>
    /// <param name="value">The raw cell text.</param>
    /// <returns>The bounded text.</returns>
    public static string BoundCell(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        if (value.Length <= MselLimits.MaxCellLength)
        {
            return value;
        }

        var cut = MselLimits.MaxCellLength;
        if (char.IsHighSurrogate(value[cut - 1]))
        {
            cut--;
        }

        return value[..cut];
    }
}
