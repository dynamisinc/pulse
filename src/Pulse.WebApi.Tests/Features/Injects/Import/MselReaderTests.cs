namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using ClosedXML.Excel;
using FluentAssertions;
using Pulse.WebApi.Features.Injects.Import;
using Xunit;

/// <summary>
/// demo-feedback/03 (AC-2 upload validation; NFR-004 cached values only) — <see cref="MselCsvReader"/>,
/// <see cref="MselWorkbookReader"/> and the by-content format decision in <see cref="InjectImportService.Read"/>, over
/// real Cadence-layout files built by <see cref="MselFixture"/>. Pure, so plain facts.
/// </summary>
public sealed class MselReaderTests
{
    private static readonly MselRowSpec[] TwoRows =
    [
        new("1", "StartEx", "Exercise starts", "08:00", "1", "08:00", "Director", "All", "Verbal"),
        new("2", "Boil water", "BOIL WATER NOTICE", "08:05", "1", "08:05", "@KestrelCoEM", "Public", "Social Media"),
    ];

    // ---- CSV ----

    [Fact]
    public void Csv_CadenceExport_ReadsHeaderAndRows_WithSpreadsheetRowNumbers_AndTheBomDropped()
    {
        var read = InjectImportService.Read(MselFixture.Csv(TwoRows, bom: true), "msel.csv", "text/csv");

        read.Error.Should().BeNull();
        read.Table!.Headers.Should().Equal(MselFixture.CadenceHeaders, "the BOM must not stick to 'Inject #'");
        read.Table.Rows.Select(row => row.RowNumber).Should().Equal([2, 3], "the header is row 1, as Excel shows it");
        read.Table.Rows[1].Cells[6].Should().Be("@KestrelCoEM");
    }

    [Fact]
    public void Csv_QuotedCellsWithCommasLineBreaksAndQuotes_AreOneCell()
    {
        var rows = new[]
        {
            new MselRowSpec("7", "Quote, comma", "Line one,\r\nline \"two\"\nline three", "08:00", "1", "08:00", "@a", "b", "Social"),
        };

        var read = InjectImportService.Read(MselFixture.Csv(rows), "msel.csv", "text/csv");

        var cells = read.Table!.Rows.Should().ContainSingle().Subject.Cells;
        cells[1].Should().Be("Quote, comma");
        cells[2].Should().Be("Line one,\r\nline \"two\"\nline three");
        cells[8].Should().Be("Social");
    }

    [Fact]
    public void Csv_BlankLinesAndCommaOnlyLines_AreSkipped_ButStillCountTowardsRowNumbers()
    {
        var text = "Inject #,Description\n\n1,first\n,,\n\n2,second\n";

        var read = MselCsvReader.Read(text);

        read.Table!.Rows.Select(row => (row.RowNumber, row.Cells[1]))
            .Should().Equal([(3, "first"), (6, "second")]);
    }

    [Fact]
    public void Csv_AQuotedCellThatNeverCloses_IsRefused()
    {
        var read = MselCsvReader.Read("Inject #,Description\n1,\"never closes\n2,x\n");

        read.Error.Should().Contain("never closes").And.Contain("row 2");
    }

    [Fact]
    public void Csv_NoHeader_IsRefused()
    {
        MselCsvReader.Read("\n\n,,\n").Error.Should().Be(MselCsvReader.NoHeaderMessage);
    }

    [Fact]
    public void Csv_MoreThan2000DataRows_IsRefused_And2000IsAccepted()
    {
        static string File(int rows) =>
            "Inject #,Description\n" + string.Concat(Enumerable.Range(1, rows).Select(i => $"{i},post {i}\n"));

        MselCsvReader.Read(File(2000)).Table!.Rows.Should().HaveCount(2000);
        MselCsvReader.Read(File(2001)).Error.Should().Contain("more than 2000 data rows");
    }

    [Fact]
    public void Csv_EveryCellIsLengthBounded()
    {
        var huge = new string('x', 100_000);

        var read = MselCsvReader.Read($"Inject #,Description\n1,{huge}\n");

        read.Table!.Rows[0].Cells[1].Length.Should().Be(MselLimits.MaxCellLength);
    }

    // ---- XLSX ----

    [Fact]
    public void Xlsx_CadenceExport_ReadsTheMselSheet_WithTheNumericInjectNumberAsText()
    {
        var bytes = MselFixture.Xlsx(TwoRows, conduct: true, before: workbook => workbook.Worksheets.Add("Instructions").Cell(1, 1).Value = "Read me");

        var read = InjectImportService.Read(bytes, "msel.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        read.Error.Should().BeNull();
        read.Table!.Headers.Should().StartWith(MselFixture.CadenceHeaders).And.EndWith(MselFixture.ConductHeaders);
        read.Table.Rows.Select(row => row.RowNumber).Should().Equal(2, 3);
        read.Table.Rows[0].Cells[0].Should().Be("1", "Cadence writes Inject # as a number; it reads back as '1', never '1.0'");
        read.Table.Rows[1].Cells[8].Should().Be("Social Media");
    }

    [Fact]
    public void Xlsx_WithoutAnMselSheet_UsesTheFirstSheet()
    {
        var bytes = MselFixture.Xlsx(TwoRows, sheetName: "Injects");

        InjectImportService.Read(bytes, "x.xlsx", null).Table!.Rows.Should().HaveCount(2);
    }

    [Fact]
    public void Xlsx_WithNoUsableSheet_IsRefused()
    {
        using var workbook = new XLWorkbook();
        workbook.Worksheets.Add("Empty");
        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        InjectImportService.Read(stream.ToArray(), "x.xlsx", null).Error.Should().Be(MselWorkbookReader.NoUsableSheetMessage);
    }

    [Fact]
    public void Xlsx_NeverEvaluatesAFormula_ItReadsTheCachedValueOnly()
    {
        var bytes = MselFixture.Xlsx(TwoRows, after: sheet =>
        {
            sheet.Cell(3, 3).FormulaA1 = "\"EVALUATED\"&\"!\"";
            sheet.Cell(3, 2).FormulaA1 = "1+1";
        });

        var row = InjectImportService.Read(bytes, "x.xlsx", null).Table!.Rows[1];

        row.Cells[2].Should().NotContain("EVALUATED", "a formula is never run (NFR-004); only a saved cached value is read");
        row.Cells[1].Should().NotBe("2");
    }

    [Fact]
    public void Xlsx_RealTimeCells_ReadAsTimesOfDay()
    {
        var bytes = MselFixture.Xlsx(TwoRows, after: sheet =>
        {
            sheet.Cell(2, 6).Value = new TimeSpan(9, 30, 0);
            sheet.Cell(3, 6).Value = 0.375; // an Excel time serial: 09:00
        });

        var rows = InjectImportService.Read(bytes, "x.xlsx", null).Table!.Rows;

        rows[0].Cells[5].Should().Be("09:30:00");
        MselImportPlanner.ParseTimeOfDay(rows[1].Cells[5]).Should().Be(9 * 60);
    }

    [Fact]
    public void Xlsx_MoreThan2000DataRows_IsRefused()
    {
        var rows = Enumerable.Range(1, 2001)
            .Select(i => new MselRowSpec(i.ToString(System.Globalization.CultureInfo.InvariantCulture), "t", "d", "08:00", "1", "08:00", "@a", "b", "Phone"))
            .ToList();

        InjectImportService.Read(MselFixture.Xlsx(rows), "x.xlsx", null).Error.Should().Contain("more than 2000 data rows");
    }

    [Fact]
    public void Xlsx_AZipThatIsNotAWorkbook_IsRefusedAsUnreadable()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var writer = new StreamWriter(zip.CreateEntry("hello.txt").Open());
            writer.Write("not a workbook");
        }

        InjectImportService.Read(stream.ToArray(), "x.xlsx", null).Error.Should().Be(MselWorkbookReader.UnreadableMessage);
    }

    [Theory]
    [InlineData(new byte[] { 0x50, 0x4B, 0x03, 0x04 })]
    [InlineData(new byte[] { 0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0x01, 0x02 })]
    public void Xlsx_AMalformedZip_IsTheUnreadable400_NeverAnException(byte[] content)
    {
        var read = () => InjectImportService.Read(content, "x.xlsx", null);

        read.Should().NotThrow().Which.Error.Should().Be(MselWorkbookReader.UnreadableMessage);
    }

    [Fact]
    public void Xlsx_AZipBomb_IsRefusedBeforeClosedXmlExpandsIt()
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var entry = zip.CreateEntry("xl/sharedStrings.xml", System.IO.Compression.CompressionLevel.Optimal).Open();
            var zeros = new byte[1024 * 1024];
            for (var i = 0; i < 20; i++)
            {
                entry.Write(zeros);
            }
        }

        stream.Length.Should().BeLessThan(1024 * 1024, "20 MiB of zeros (past the 16 MiB bound) compresses to well under the upload cap");
        InjectImportService.Read(stream.ToArray(), "x.xlsx", null).Error.Should().Be(MselWorkbookReader.TooLargeUnpackedMessage);
    }

    // ---- format by content ----

    [Fact]
    public void ARenamedTextFile_IsNotAWorkbook_MagicBytesDecide()
    {
        var text = Encoding.UTF8.GetBytes("Inject #,Description\n1,hello\n");

        var read = InjectImportService.Read(
            text, "msel.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        read.Error.Should().Be(MselFileFormat.NotAWorkbookMessage, "the bytes do not start with PK\\x03\\x04");
    }

    [Fact]
    public void AWorkbookNamedCsv_IsStillReadAsAWorkbook()
    {
        InjectImportService.Read(MselFixture.Xlsx(TwoRows), "msel.csv", "text/csv").Table!.Rows.Should().HaveCount(2);
    }

    [Theory]
    [InlineData(new byte[] { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00 })] // a legacy .xls (OLE2)
    [InlineData(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })] // a PNG
    [InlineData(new byte[] { 0xFF, 0xFE, 0x49, 0x00, 0x6E, 0x00 })] // UTF-16 text
    [InlineData(new byte[] { 0x49, 0x00, 0x6E })] // a NUL in "text"
    public void BinaryOrNonUtf8Content_IsRefused(byte[] content)
    {
        InjectImportService.Read(content, "msel.csv", "text/csv").Error.Should().Be(MselFileFormat.NotXlsxOrCsvMessage);
    }

    [Fact]
    public void AnEmptyFile_AndAnOversizedFile_AreRefused()
    {
        InjectImportService.Read([], "msel.csv", null).Error.Should().Be("the file is empty.");
        InjectImportService.Read(new byte[MselLimits.MaxFileBytes + 1], "msel.csv", null).Error
            .Should().Be(InjectImportService.TooLargeMessage);
    }
}
