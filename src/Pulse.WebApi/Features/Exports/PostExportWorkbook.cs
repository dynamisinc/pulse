namespace Pulse.WebApi.Features.Exports;

using System.Collections.Generic;
using System.IO;
using System.Text;
using ClosedXML.Excel;

/// <summary>
/// Writes the post activity export workbook (demo-feedback story 02, DF-8): one sheet, <c>Posts</c>, with the frozen
/// columns in order, a bold frozen header row, an autofilter over the used range and fixed column widths (<c>Text</c>
/// wrapped, 60 wide). Rows are appended a page at a time, so the caller never holds every post at once. Pure: no
/// database, no HTTP, so the layout and formula-safety rules are unit-testable.
/// </summary>
/// <remarks>
/// <para>
/// <b>Formula safety.</b> Every cell is assigned through <see cref="IXLCell.Value"/> with a text, number or date
/// value. Nothing is ever written through <c>FormulaA1</c> / <c>FormulaR1C1</c>, and ClosedXML stores a string value
/// as a text cell, so a post that starts with <c>=</c>, <c>+</c>, <c>-</c> or <c>@</c> opens in Excel as that literal
/// text and is never evaluated.
/// </para>
/// <para>
/// <b>Valid XML.</b> Characters XML 1.0 cannot carry (C0 controls other than tab, line feed and carriage return,
/// unpaired surrogates, U+FFFE/U+FFFF) are removed from text, so one odd post can never produce a file Excel refuses
/// to open. Text longer than Excel's 32,767-character cell limit is cut to it.
/// </para>
/// </remarks>
public sealed class PostExportWorkbook : IDisposable
{
    /// <summary>The one sheet's name.</summary>
    public const string SheetName = "Posts";

    /// <summary>The Excel number format of the <c>Wall clock (UTC)</c> column.</summary>
    public const string WallClockNumberFormat = "yyyy-mm-dd hh:mm:ss";

    /// <summary>Excel's per-cell text limit.</summary>
    public const int MaxCellTextLength = 32_767;

    /// <summary>The frozen column headers, in order (<c>implementation.md</c> → "Export columns").</summary>
    public static readonly IReadOnlyList<string> Headers =
    [
        "Scenario time",
        "Wall clock (UTC)",
        "Author handle",
        "Author name",
        "Author type",
        "Posted by",
        "Inject #",
        "Post id",
        "Reply to",
        "Text",
        "Media",
        "Likes",
        "Reposts",
        "Replies",
        "Shown likes",
        "Shown reposts",
        "Shown replies",
        "Pinned for all",
        "Status",
        "Taken down at",
    ];

    /// <summary>The fixed column widths, by header position (in Excel character units).</summary>
    private static readonly double[] Widths =
    [
        17, 20, 20, 22, 22, 22, 16, 38, 50, 60, 16, 8, 9, 9, 12, 14, 14, 14, 11, 17,
    ];

    private const int TextColumn = 10;
    private const int WallClockColumn = 2;

    private readonly XLWorkbook _workbook;
    private readonly IXLWorksheet _sheet;
    private int _lastRow = 1;

    /// <summary>Creates the workbook with its header row and column layout.</summary>
    public PostExportWorkbook()
    {
        _workbook = new XLWorkbook();
        _sheet = _workbook.Worksheets.Add(SheetName);

        for (var column = 1; column <= Headers.Count; column++)
        {
            _sheet.Cell(1, column).Value = Headers[column - 1];
            _sheet.Column(column).Width = Widths[column - 1];
        }

        // Column-level styles, not per-cell ones: a per-cell style on 50,000 rows bloats memory and the file.
        _sheet.Column(TextColumn).Style.Alignment.WrapText = true;
        _sheet.Column(WallClockColumn).Style.NumberFormat.Format = WallClockNumberFormat;

        var header = _sheet.Range(1, 1, 1, Headers.Count);
        header.Style.Font.Bold = true;
        header.Style.Alignment.WrapText = false;
        _sheet.SheetView.FreezeRows(1);
    }

    /// <summary>The number of data rows written so far.</summary>
    public int RowCount => _lastRow - 1;

    /// <summary>Appends rows below the ones already written.</summary>
    /// <param name="rows">The rows, in export order.</param>
    public void AddRows(IEnumerable<PostExportRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        foreach (var row in rows)
        {
            var r = ++_lastRow;
            SetText(r, 1, row.ScenarioTime);
            _sheet.Cell(r, 2).Value = DateTime.SpecifyKind(row.WallClockUtc, DateTimeKind.Unspecified);
            SetText(r, 3, row.AuthorHandle);
            SetText(r, 4, row.AuthorName);
            SetText(r, 5, row.AuthorType);
            SetText(r, 6, row.PostedBy);
            SetText(r, 7, row.InjectRef);
            SetText(r, 8, row.PostId);
            SetText(r, 9, row.ReplyTo);
            SetText(r, 10, row.Text);
            SetText(r, 11, row.Media);
            _sheet.Cell(r, 12).Value = row.Likes;
            _sheet.Cell(r, 13).Value = row.Reposts;
            _sheet.Cell(r, 14).Value = row.Replies;
            _sheet.Cell(r, 15).Value = row.ShownLikes;
            _sheet.Cell(r, 16).Value = row.ShownReposts;
            _sheet.Cell(r, 17).Value = row.ShownReplies;
            SetText(r, 18, row.PinnedForAll);
            SetText(r, 19, row.Status);
            SetText(r, 20, row.TakenDownAt);
        }
    }

    /// <summary>Applies the autofilter over the used range and writes the <c>.xlsx</c> to <paramref name="stream"/>.</summary>
    /// <param name="stream">A writable stream (a seekable one: ClosedXML packages the zip in place).</param>
    public void SaveTo(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        // Header row plus every data row; with no posts the filter still sits on the header so the sheet is usable.
        _sheet.Range(1, 1, _lastRow, Headers.Count).SetAutoFilter();
        _workbook.SaveAs(stream);
    }

    /// <inheritdoc />
    public void Dispose() => _workbook.Dispose();

    /// <summary>
    /// Removes the characters XML 1.0 cannot carry and caps the length at Excel's cell limit. Exposed for tests.
    /// </summary>
    /// <param name="value">The raw text.</param>
    /// <returns>Text that is always safe to store in a cell.</returns>
    public static string CleanText(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        StringBuilder? builder = null;
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            bool keep;
            if (char.IsHighSurrogate(c))
            {
                keep = i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]);
                if (keep)
                {
                    builder?.Append(c).Append(value[i + 1]);
                    i++;
                    continue;
                }
            }
            else
            {
                keep = !char.IsLowSurrogate(c)
                    && (c >= 0x20 || c == '\t' || c == '\n' || c == '\r')
                    && c != '￾' && c != '￿';
            }

            if (keep)
            {
                builder?.Append(c);
            }
            else if (builder is null)
            {
                builder = new StringBuilder(value.Length);
                builder.Append(value, 0, i);
            }
        }

        var cleaned = builder?.ToString() ?? value;
        return cleaned.Length > MaxCellTextLength ? cleaned[..MaxCellTextLength] : cleaned;
    }

    /// <summary>Writes a text VALUE (never a formula); a blank value leaves the cell empty.</summary>
    private void SetText(int row, int column, string? value)
    {
        var text = CleanText(value);
        if (text.Length > 0)
        {
            _sheet.Cell(row, column).Value = text;
        }
    }
}
