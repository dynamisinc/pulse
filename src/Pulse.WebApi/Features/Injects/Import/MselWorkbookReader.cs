namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Globalization;
using System.IO.Compression;
using ClosedXML.Excel;

/// <summary>
/// Reads a Cadence MSEL <c>.xlsx</c> export (<c>MselWorksheetBuilder.AddMselWorksheet</c>) into an
/// <see cref="MselTable"/> (demo-feedback story 03), with ClosedXML (seam S-1).
/// </summary>
/// <remarks>
/// <para>
/// <b>Sheet.</b> The worksheet named <c>MSEL</c> (case-insensitive) when the workbook has one, else the first
/// worksheet. Its first non-blank row is the header; every later non-blank row is a data row, numbered as Excel numbers
/// it. A workbook with no worksheets, or whose chosen sheet is empty, has no usable sheet (400).
/// </para>
/// <para>
/// <b>No formula is ever evaluated (NFR-004).</b> Every cell is read through <see cref="IXLCell.CachedValue"/> — the
/// value Excel last saved, or blank — never <see cref="IXLCell.Value"/>, which would run the formula. Formulas are not
/// recalculated on load either (ClosedXML's default).
/// </para>
/// <para>
/// <b>Bounded before it is parsed.</b> The endpoint caps the file at 2 MiB; before ClosedXML expands it, the zip's
/// declared uncompressed sizes are summed and a workbook that would expand past
/// <see cref="MselLimits.MaxWorkbookUncompressedBytes"/> is refused (a zip bomb). Only the first
/// <see cref="MselLimits.MaxColumns"/> columns are read and every cell is bounded to
/// <see cref="MselLimits.MaxCellLength"/> characters.
/// </para>
/// <para>
/// <b>Typed cells become the text Cadence would have written.</b> Cadence writes <c>Inject #</c> as a number and the
/// times as <c>HH:mm</c> text, but a workbook edited in Excel may hold real numbers, dates and times, so a number is
/// written in invariant shortest form (<c>12</c>, not <c>12.0</c>), a time of day as <c>HH:mm:ss</c>, a date-time as
/// <c>yyyy-MM-dd HH:mm:ss</c>, and an error cell as blank.
/// </para>
/// </remarks>
public static class MselWorkbookReader
{
    /// <summary>The worksheet name Cadence writes the MSEL to.</summary>
    public const string MselSheetName = "MSEL";

    /// <summary>The refusal for a workbook with nothing to read.</summary>
    public const string NoUsableSheetMessage = "the workbook has no usable sheet (no MSEL sheet with a header row, and the first sheet is empty).";

    /// <summary>The refusal for a zip that is not a readable workbook.</summary>
    public const string UnreadableMessage = "the file is not a readable .xlsx workbook.";

    /// <summary>The refusal for a workbook that would expand past the bound.</summary>
    public const string TooLargeUnpackedMessage = "the workbook is too large once unpacked.";

    /// <summary>Reads the workbook bytes (already size-bounded and starting with the zip magic).</summary>
    /// <param name="content">The file bytes.</param>
    /// <returns>The table, or the readable refusal.</returns>
    public static MselReadResult Read(byte[] content)
    {
        ArgumentNullException.ThrowIfNull(content);

        if (CheckExpansion(content) is { } refusal)
        {
            return MselReadResult.Fail(refusal);
        }

        XLWorkbook workbook;
        try
        {
            workbook = new XLWorkbook(new MemoryStream(content, writable: false));
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // A corrupt zip, a non-workbook zip (a .docx, a plain archive), an encrypted or strict-OOXML file: all
            // simply "not a readable workbook" to the controller. Nothing has been written, so the 400 is the whole story.
            return MselReadResult.Fail(UnreadableMessage);
        }

        using (workbook)
        {
            var sheet = ChooseSheet(workbook);
            return sheet is null ? MselReadResult.Fail(NoUsableSheetMessage) : ReadSheet(sheet);
        }
    }

    private static string? CheckExpansion(byte[] content)
    {
        try
        {
            using var zip = new ZipArchive(new MemoryStream(content, writable: false), ZipArchiveMode.Read);
            long total = 0;
            foreach (var entry in zip.Entries)
            {
                total += entry.Length;
                if (total > MselLimits.MaxWorkbookUncompressedBytes)
                {
                    return TooLargeUnpackedMessage;
                }
            }

            return null;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Any malformed zip (InvalidDataException, IOException, NotSupportedException, ArgumentException …) is the
            // readable 400, never a 500 (Gate-1 L-7).
            return UnreadableMessage;
        }
    }

    private static IXLWorksheet? ChooseSheet(XLWorkbook workbook)
    {
        var named = workbook.Worksheets.FirstOrDefault(
            sheet => string.Equals(sheet.Name.Trim(), MselSheetName, StringComparison.OrdinalIgnoreCase));
        if (named is not null && named.FirstRowUsed() is not null)
        {
            return named;
        }

        var first = workbook.Worksheets.FirstOrDefault();
        return first?.FirstRowUsed() is not null ? first : null;
    }

    private static MselReadResult ReadSheet(IXLWorksheet sheet)
    {
        IReadOnlyList<string>? headers = null;
        var width = 0;
        var rows = new List<MselRow>();

        foreach (var row in sheet.RowsUsed())
        {
            if (headers is null)
            {
                var lastColumn = row.LastCellUsed()?.Address.ColumnNumber ?? 0;
                width = Math.Min(lastColumn, MselLimits.MaxColumns);
                var headerCells = ReadCells(row, width);
                if (headerCells.TrueForAll(string.IsNullOrWhiteSpace))
                {
                    continue; // formatted but empty
                }

                headers = headerCells;
                continue;
            }

            var cells = ReadCells(row, width);
            if (cells.TrueForAll(string.IsNullOrWhiteSpace))
            {
                continue;
            }

            if (rows.Count == MselLimits.MaxDataRows)
            {
                return MselReadResult.Fail(MselCsvReader.TooManyRowsMessage());
            }

            rows.Add(new MselRow(row.RowNumber(), cells));
        }

        return headers is null
            ? MselReadResult.Fail(NoUsableSheetMessage)
            : MselReadResult.Ok(new MselTable(headers, rows));
    }

    private static List<string> ReadCells(IXLRow row, int width)
    {
        var cells = new List<string>(width);
        for (var column = 1; column <= width; column++)
        {
            cells.Add(MselFileFormat.BoundCell(CellText(row.Cell(column))));
        }

        return cells;
    }

    /// <summary>The cell's cached value as text — never evaluating a formula.</summary>
    private static string CellText(IXLCell cell)
    {
        var value = cell.CachedValue;
        return value.Type switch
        {
            XLDataType.Blank => string.Empty,
            XLDataType.Text => value.GetText(),
            XLDataType.Number => value.GetNumber().ToString(CultureInfo.InvariantCulture),
            XLDataType.Boolean => value.GetBoolean() ? "TRUE" : "FALSE",
            XLDataType.DateTime => FormatDateTime(value.GetDateTime()),
            XLDataType.TimeSpan => FormatTimeSpan(value.GetTimeSpan()),
            _ => string.Empty, // XLDataType.Error: #REF!, #N/A … read as blank
        };
    }

    private static string FormatDateTime(DateTime value)
    {
        // Excel stores a bare time of day as a date-time on its epoch day (1899-12-30, or 12-31 in 1900 mode).
        return value.Date <= new DateTime(1900, 1, 1)
            ? value.ToString("HH:mm:ss", CultureInfo.InvariantCulture)
            : value.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
    }

    private static string FormatTimeSpan(TimeSpan value) =>
        value >= TimeSpan.Zero && value < TimeSpan.FromDays(1)
            ? value.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture)
            : value.ToString("c", CultureInfo.InvariantCulture);
}
