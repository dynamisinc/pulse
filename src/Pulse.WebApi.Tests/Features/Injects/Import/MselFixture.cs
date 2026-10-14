namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using ClosedXML.Excel;

/// <summary>
/// Builds a real Cadence-layout MSEL file the way Cadence's <c>MselWorksheetBuilder</c> writes it: the 16 MSEL columns
/// in order (+ optional conduct columns and the Pulse <c>Pulse Media</c> extension), sheet <c>MSEL</c>, <c>Inject #</c>
/// as a NUMBER cell, times as <c>HH:mm</c> text; and the same rows as CSV with Cadence's own field escaping.
/// </summary>
internal static class MselFixture
{
    public static readonly string[] CadenceHeaders =
    [
        "Inject #", "Title", "Description", "Scheduled Time", "Scenario Day", "Scenario Time", "From / Source",
        "To / Target", "Delivery Method", "Track", "Phase", "Expected Action", "Notes", "Priority", "Location",
        "Responsible Controller",
    ];

    public static readonly string[] ConductHeaders = ["Status", "Fired At", "Fired By"];

    public const string PulseMediaHeader = "Pulse Media";

    /// <summary>The Kestrel-style demo rows: three social posts and two non-social injects, StartEx at day 1 08:00.</summary>
    public static List<MselRowSpec> KestrelRows(string handle1, string handle2, string displayName2, string controller) =>
    [
        new(1, "StartEx", "Exercise starts", "08:00", "1", "08:00", "Exercise Director", "All players", "Verbal"),
        new(2, "Boil water notice", "BOIL WATER NOTICE for #Kestrel County zones 3-5.", "08:05", "1", "08:05",
            "@" + handle1, "Public", "Social Media", Notes: "Beat 1", Controller: controller),
        new(3, "Phone call from mayor", "Mayor calls the EOC.", "08:10", "1", "08:10", "Mayor", "EOC", "Phone"),
        new(4, "Resident photo", "Is anyone else's water brown?", "08:20", "1", "08:20", displayName2, "Public",
            "social"),
        new(5, "Day two", "Day two: still brown.", "08:00", "2", "08:30", handle2, "Public", "Pulse"),
    ];

    public static byte[] Xlsx(
        IReadOnlyList<MselRowSpec> rows,
        bool conduct = false,
        bool pulseMedia = false,
        string sheetName = "MSEL",
        Action<XLWorkbook>? before = null,
        Action<IXLWorksheet>? after = null)
    {
        using var workbook = new XLWorkbook();
        before?.Invoke(workbook);
        var sheet = workbook.Worksheets.Add(sheetName);
        var headers = Headers(conduct, pulseMedia);
        for (var column = 0; column < headers.Count; column++)
        {
            sheet.Cell(1, column + 1).Value = headers[column];
        }

        var rowNumber = 2;
        foreach (var row in rows)
        {
            var values = Values(row, conduct, pulseMedia);
            sheet.Cell(rowNumber, 1).Value = row.InjectNumber; // a NUMBER cell, as Cadence writes it
            for (var column = 1; column < values.Count; column++)
            {
                sheet.Cell(rowNumber, column + 1).Value = values[column];
            }

            rowNumber++;
        }

        after?.Invoke(sheet);
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }

    public static byte[] Csv(IReadOnlyList<MselRowSpec> rows, bool conduct = false, bool pulseMedia = false, bool bom = true)
    {
        var builder = new StringBuilder();
        builder.Append(string.Join(",", Headers(conduct, pulseMedia).Select(Escape))).Append("\r\n");
        foreach (var row in rows)
        {
            builder.Append(string.Join(",", Values(row, conduct, pulseMedia).Select(Escape))).Append("\r\n");
        }

        var text = Encoding.UTF8.GetBytes(builder.ToString());
        return bom ? [.. Encoding.UTF8.GetPreamble(), .. text] : text;
    }

    /// <summary>Cadence's <c>ExcelFormattingHelper.EscapeCsvField</c>.</summary>
    public static string Escape(string field)
    {
        if (string.IsNullOrEmpty(field))
        {
            return "\"\"";
        }

        return field.Contains(',') || field.Contains('"') || field.Contains('\n') || field.Contains('\r')
            ? $"\"{field.Replace("\"", "\"\"")}\""
            : field;
    }

    private static List<string> Headers(bool conduct, bool pulseMedia)
    {
        var headers = CadenceHeaders.ToList();
        if (conduct)
        {
            headers.AddRange(ConductHeaders);
        }

        if (pulseMedia)
        {
            headers.Add(PulseMediaHeader);
        }

        return headers;
    }

    private static List<string> Values(MselRowSpec row, bool conduct, bool pulseMedia)
    {
        var values = new List<string>
        {
            row.InjectNumber.ToString(CultureInfo.InvariantCulture),
            row.Title,
            row.Description,
            row.ScheduledTime,
            row.ScenarioDay,
            row.ScenarioTime,
            row.Source,
            row.Target,
            row.DeliveryMethod,
            "Track A",
            "Phase 1",
            "Expected action",
            row.Notes,
            "1",
            "Kestrel EOC",
            row.Controller,
        };

        if (conduct)
        {
            values.AddRange(["Pending", "", ""]);
        }

        if (pulseMedia)
        {
            values.Add(row.PulseMedia);
        }

        return values;
    }
}

/// <summary>One MSEL data row as Cadence models it.</summary>
internal sealed record MselRowSpec(
    int InjectNumber,
    string Title,
    string Description,
    string ScheduledTime,
    string ScenarioDay,
    string ScenarioTime,
    string Source,
    string Target,
    string DeliveryMethod,
    string Notes = "",
    string Controller = "",
    string PulseMedia = "");
