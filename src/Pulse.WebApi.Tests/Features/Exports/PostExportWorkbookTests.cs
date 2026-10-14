namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using ClosedXML.Excel;
using FluentAssertions;
using Pulse.WebApi.Features.Exports;
using Xunit;

/// <summary>
/// The workbook layout and the pure label mappings of the post activity export (demo-feedback story 02). No database:
/// the bytes are written by <see cref="PostExportWorkbook"/> and read back with ClosedXML.
/// </summary>
public sealed class PostExportWorkbookTests
{
    private static readonly string[] ExpectedHeaders =
    [
        "Scenario time", "Wall clock (UTC)", "Author handle", "Author name", "Author type", "Posted by", "Inject #",
        "Post id", "Reply to", "Text", "Media", "Likes", "Reposts", "Replies", "Shown likes", "Shown reposts",
        "Shown replies", "Pinned for all", "Status", "Taken down at",
    ];

    [Fact]
    public void Sheet_IsPosts_WithTheFrozenColumnsInOrder_BoldFrozenHeader_AndAutofilterOverTheUsedRange()
    {
        var bytes = Write(Row("first"), Row("second"));

        using var workbook = ExportWorkbookReader.Open(bytes);
        workbook.Worksheets.Should().ContainSingle("the export is one sheet (DF-8)")
            .Which.Name.Should().Be("Posts");

        var sheet = workbook.Worksheet("Posts");
        Enumerable.Range(1, ExpectedHeaders.Length)
            .Select(c => sheet.Cell(1, c).GetString())
            .Should().Equal(ExpectedHeaders, "the columns are frozen in implementation.md, in this order");
        sheet.Cell(1, ExpectedHeaders.Length + 1).IsEmpty().Should().BeTrue("there is no column beyond Taken down at");

        for (var c = 1; c <= ExpectedHeaders.Length; c++)
        {
            sheet.Cell(1, c).Style.Font.Bold.Should().BeTrue("the header row is bold ({0})", ExpectedHeaders[c - 1]);
        }

        sheet.SheetView.SplitRow.Should().Be(1, "the header row is frozen");
        sheet.AutoFilter.IsEnabled.Should().BeTrue();
        sheet.AutoFilter.Range.RangeAddress.ToString().Should().Be("A1:T3", "the filter covers the header and every data row");
    }

    [Fact]
    public void Columns_HaveSensibleWidths_AndTextIsWrappedAboutSixtyWide()
    {
        using var workbook = ExportWorkbookReader.Open(Write(Row("x")));
        var sheet = workbook.Worksheet("Posts");

        var text = sheet.Column(10);
        text.Width.Should().BeApproximately(60, 0.5);
        sheet.Cell(2, 10).Style.Alignment.WrapText.Should().BeTrue("long post text wraps instead of running across the sheet");

        for (var c = 1; c <= ExpectedHeaders.Length; c++)
        {
            sheet.Column(c).Width.Should().BeInRange(6, 60, "column {0} has a set, readable width", ExpectedHeaders[c - 1]);
        }
    }

    [Theory]
    [InlineData("=1+1")]
    [InlineData("=HYPERLINK(\"http://evil.example\",\"click\")")]
    [InlineData("+SUM(A1:A2)")]
    [InlineData("-2+3")]
    [InlineData("@SUM(A1)")]
    [InlineData("=cmd|' /C calc'!A0")]
    public void FormulaLookingText_IsWrittenAsLiteralText_NeverAFormula(string body)
    {
        using var workbook = ExportWorkbookReader.Open(Write(Row(body) with { AuthorName = body, PostedBy = body }));
        var sheet = workbook.Worksheet("Posts");

        foreach (var column in new[] { 4, 6, 10 })
        {
            var cell = sheet.Cell(2, column);
            cell.HasFormula.Should().BeFalse("a post that starts with {0} must open as text, not run", body[0]);
            cell.FormulaA1.Should().BeEmpty();
            cell.DataType.Should().Be(XLDataType.Text);
            cell.GetString().Should().Be(body, "the literal text survives unchanged");
        }

        // No cell anywhere in the sheet carries a formula.
        sheet.CellsUsed().Should().NotContain(c => c.HasFormula);
    }

    [Fact]
    public void WallClock_IsAnExcelDateTimeCell_AndCountsAreNumbers()
    {
        var wall = new DateTime(2026, 10, 14, 18, 30, 15, DateTimeKind.Utc);
        using var workbook = ExportWorkbookReader.Open(Write(Row("x") with { WallClockUtc = wall, Likes = 3, ShownLikes = 12 }));
        var sheet = workbook.Worksheet("Posts");

        var cell = sheet.Cell(2, 2);
        cell.DataType.Should().Be(XLDataType.DateTime);
        cell.GetDateTime().Should().Be(new DateTime(2026, 10, 14, 18, 30, 15));
        cell.Style.NumberFormat.Format.Should().Be(PostExportWorkbook.WallClockNumberFormat);

        sheet.Cell(2, 12).DataType.Should().Be(XLDataType.Number);
        sheet.Cell(2, 12).GetDouble().Should().Be(3);
        sheet.Cell(2, 15).GetDouble().Should().Be(12);

        // The scenario-time columns are text in the exercise's zone, exactly as formatted.
        sheet.Cell(2, 1).DataType.Should().Be(XLDataType.Text);
        sheet.Cell(2, 1).GetString().Should().Be("2033-09-04 13:00");
    }

    [Fact]
    public void AnEmptyExport_StillHasTheHeaderAndAFilter()
    {
        using var workbook = ExportWorkbookReader.Open(Write());
        var sheet = workbook.Worksheet("Posts");
        sheet.Cell(1, 1).GetString().Should().Be("Scenario time");
        sheet.LastRowUsed()!.RowNumber().Should().Be(1);
        sheet.AutoFilter.IsEnabled.Should().BeTrue();
    }

    [Fact]
    public void CleanText_DropsCharactersXmlCannotCarry_AndKeepsEverythingElse()
    {
        PostExportWorkbook.CleanText("a\u0001b\u0008c\td\ne\rf").Should().Be("abc\td\ne\rf");
        PostExportWorkbook.CleanText("emoji \U0001F525 ok").Should().Be("emoji \U0001F525 ok", "a valid surrogate pair is kept");
        PostExportWorkbook.CleanText("lone \uD83D high").Should().Be("lone  high");
        PostExportWorkbook.CleanText("lone \uDC25 low").Should().Be("lone  low");
        PostExportWorkbook.CleanText("￾x￿").Should().Be("x");
        PostExportWorkbook.CleanText(null).Should().BeEmpty();
        PostExportWorkbook.CleanText(new string('a', 40_000)).Should().HaveLength(PostExportWorkbook.MaxCellTextLength);

        // The file still opens with a control character in a post.
        using var workbook = ExportWorkbookReader.Open(Write(Row("bell\u0007here")));
        workbook.Worksheet("Posts").Cell(2, 10).GetString().Should().Be("bellhere");
    }

    [Theory]
    [InlineData("participant", "Participant")]
    [InlineData("controller-as-persona", "Controller as persona")]
    [InlineData("inject", "Scripted inject")]
    [InlineData("engine", "Engine")]
    [InlineData("noise", "White noise")]
    [InlineData("rumor-v2", "rumor-v2")]
    [InlineData("", "")]
    public void AuthorType_MapsEveryOrigin_AndWritesAnUnknownOneRaw(string origin, string expected)
    {
        PostExportLabels.AuthorType(origin).Should().Be(expected);
    }

    [Fact]
    public void AuthorType_OfNull_IsBlank_AndNeverThrows() =>
        PostExportLabels.AuthorType(null).Should().BeEmpty();

    [Theory]
    [InlineData("engine", true)]
    [InlineData("noise", true)]
    [InlineData("participant", false)]
    [InlineData("controller-as-persona", false)]
    [InlineData("inject", false)]
    public void PostedBy_IsBlankOnlyForEngineAndWhiteNoise(string origin, bool blank) =>
        PostExportLabels.HasNoActingHuman(origin).Should().Be(blank);

    [Theory]
    [InlineData(0, 0, "")]
    [InlineData(1, 0, "1 image")]
    [InlineData(2, 0, "2 images")]
    [InlineData(0, 1, "1 video")]
    [InlineData(1, 1, "1 image, 1 video")]
    public void Media_IsSummarisedReadably(int images, int videos, string expected) =>
        PostExportLabels.Media(images, videos).Should().Be(expected);

    [Fact]
    public void ReplyTo_IsHandleAndPostId_OrTheIdAlone_OrBlank()
    {
        var parent = Guid.Parse("0f8fad5b-d9cb-469f-a165-70867728950e");
        PostExportLabels.ReplyTo("cityfire", parent).Should().Be("@cityfire 0f8fad5b-d9cb-469f-a165-70867728950e");
        PostExportLabels.ReplyTo("@cityfire", parent).Should().Be("@cityfire 0f8fad5b-d9cb-469f-a165-70867728950e");
        PostExportLabels.ReplyTo(null, parent).Should().Be("0f8fad5b-d9cb-469f-a165-70867728950e");
        PostExportLabels.ReplyTo("cityfire", null).Should().BeEmpty();
    }

    [Fact]
    public void ScenarioTime_IsFormattedInTheExercisesZone()
    {
        var instant = new DateTimeOffset(2033, 9, 4, 13, 5, 0, TimeSpan.Zero);
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

        PostExportLabels.ScenarioTime(instant, TimeZoneInfo.Utc).Should().Be("2033-09-04 13:05");
        PostExportLabels.ScenarioTime(instant, chicago).Should().Be("2033-09-04 08:05", "CDT is UTC-5 in September");
        PostExportLabels.ScenarioTime(null, TimeZoneInfo.Utc).Should().BeEmpty();
    }

    [Theory]
    [InlineData("Kestrel Flood 2033", "kestrel-flood-2033")]
    [InlineData("  Ünïcode / Exercise!! ", "n-code-exercise")]
    [InlineData("!!!", "exercise")]
    [InlineData(null, "exercise")]
    public void FileName_UsesTheExerciseSlug_AndTheUtcMinute(string? name, string slug)
    {
        var now = new DateTimeOffset(2026, 10, 20, 9, 7, 59, TimeSpan.FromHours(-5));
        PostExportLabels.FileName(name, now).Should().Be($"pulse-posts-{slug}-20261020-1407.xlsx");
    }

    private static PostExportRow Row(string text) => new()
    {
        ScenarioTime = "2033-09-04 13:00",
        WallClockUtc = new DateTime(2026, 10, 14, 18, 30, 0, DateTimeKind.Utc),
        AuthorHandle = "@cityfire",
        AuthorName = "City Fire",
        AuthorType = "Participant",
        PostedBy = "Pat Player",
        InjectRef = string.Empty,
        PostId = Guid.NewGuid().ToString(),
        ReplyTo = string.Empty,
        Text = text,
        Media = string.Empty,
        Likes = 0,
        Reposts = 0,
        Replies = 0,
        ShownLikes = 0,
        ShownReposts = 0,
        ShownReplies = 0,
        PinnedForAll = string.Empty,
        Status = "Live",
        TakenDownAt = string.Empty,
    };

    private static byte[] Write(params PostExportRow[] rows)
    {
        using var workbook = new PostExportWorkbook();
        workbook.AddRows(rows);
        using var buffer = new MemoryStream();
        workbook.SaveTo(buffer);
        return buffer.ToArray();
    }
}
