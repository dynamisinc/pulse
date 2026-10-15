namespace Pulse.WebApi.Features.Injects.Import;

using System.Collections.Generic;
using System.Globalization;
using System.Text;

/// <summary>
/// Reads a Cadence MSEL <c>.csv</c> export (<c>MselWorksheetBuilder.GenerateCsv</c>) into an <see cref="MselTable"/>
/// (demo-feedback story 03). A pure function over already-decoded text (the endpoint has bounded the size and the
/// service has checked it is strict UTF-8 with any BOM dropped).
/// </summary>
/// <remarks>
/// <para>
/// <b>Shape (RFC 4180, as Cadence writes it).</b> Comma-separated; a cell wrapped in double quotes may hold commas, line
/// breaks (CRLF, LF or CR) and doubled quotes (<c>""</c>). Records end at CRLF, LF or CR. The first non-blank record is
/// the header. Blank records (nothing, or nothing but commas and spaces) are skipped and never counted as data rows.
/// </para>
/// <para>
/// <b>Row numbers</b> count every record from 1, blank ones included, so they match the row Excel shows when it opens
/// the file (a quoted multi-line cell is still one row).
/// </para>
/// <para>
/// <b>Fails closed</b> (400, nothing written): no header, more than <see cref="MselLimits.MaxDataRows"/> data rows, or a
/// quoted cell that never closes. Every cell is bounded to <see cref="MselLimits.MaxCellLength"/> characters as it is
/// read, and only the first <see cref="MselLimits.MaxColumns"/> cells of a record are kept.
/// </para>
/// </remarks>
public static class MselCsvReader
{
    /// <summary>The refusal for a file with no header row.</summary>
    public const string NoHeaderMessage = "the file has no header row.";

    /// <summary>Reads the CSV text.</summary>
    /// <param name="text">The decoded file text (no BOM).</param>
    /// <returns>The table, or the readable refusal.</returns>
    public static MselReadResult Read(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        IReadOnlyList<string>? headers = null;
        var rows = new List<MselRow>();
        var record = new List<string>();
        var field = new StringBuilder();
        var recordNumber = 1;
        var inQuotes = false;
        var quotedRecordStart = 0;
        var index = 0;

        // Returns a refusal when the record broke a limit, else null.
        string? EndRecord()
        {
            EndField();
            var cells = record;
            record = new List<string>();

            if (cells.TrueForAll(string.IsNullOrWhiteSpace))
            {
                return null;
            }

            if (headers is null)
            {
                headers = cells;
                return null;
            }

            if (rows.Count == MselLimits.MaxDataRows)
            {
                return TooManyRowsMessage();
            }

            rows.Add(new MselRow(recordNumber, cells));
            return null;
        }

        void EndField()
        {
            if (record.Count < MselLimits.MaxColumns)
            {
                record.Add(field.ToString());
            }

            field.Clear();
        }

        void Append(char c)
        {
            if (field.Length < MselLimits.MaxCellLength)
            {
                field.Append(c);
            }
        }

        while (index < text.Length)
        {
            var c = text[index];

            if (inQuotes)
            {
                if (c == '"')
                {
                    if (index + 1 < text.Length && text[index + 1] == '"')
                    {
                        Append('"');
                        index += 2;
                        continue;
                    }

                    inQuotes = false;
                    index++;
                    continue;
                }

                Append(c);
                index++;
                continue;
            }

            switch (c)
            {
                case '"' when field.Length == 0:
                    inQuotes = true;
                    quotedRecordStart = recordNumber;
                    index++;
                    break;

                case ',':
                    EndField();
                    index++;
                    break;

                case '\r':
                case '\n':
                    if (EndRecord() is { } refusal)
                    {
                        return MselReadResult.Fail(refusal);
                    }

                    // CRLF is one break.
                    index += c == '\r' && index + 1 < text.Length && text[index + 1] == '\n' ? 2 : 1;
                    recordNumber++;
                    break;

                default:
                    Append(c);
                    index++;
                    break;
            }
        }

        if (inQuotes)
        {
            return MselReadResult.Fail(string.Create(
                CultureInfo.InvariantCulture,
                $"the CSV has a quoted cell that never closes (it starts on row {quotedRecordStart})."));
        }

        // The last record, when the file does not end with a line break.
        if (field.Length > 0 || record.Count > 0)
        {
            if (EndRecord() is { } refusal)
            {
                return MselReadResult.Fail(refusal);
            }
        }

        return headers is null
            ? MselReadResult.Fail(NoHeaderMessage)
            : MselReadResult.Ok(new MselTable(headers, rows));
    }

    /// <summary>The refusal for a file over the row cap (shared with the workbook reader).</summary>
    /// <returns>The message.</returns>
    internal static string TooManyRowsMessage() => string.Create(
        CultureInfo.InvariantCulture,
        $"the file has more than {MselLimits.MaxDataRows} data rows.");
}
