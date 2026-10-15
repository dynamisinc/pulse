namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using ClosedXML.Excel;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Injects.Import;
using Xunit;

/// <summary>
/// demo-feedback/14 (DF-17) — the Pulse extension columns <c>Pulse Media Alt</c>, <c>Pulse Likes</c>,
/// <c>Pulse Reposts</c> and <c>Pulse Replies</c> in <see cref="MselImportPlanner"/>, pure, over tables read from real
/// Cadence-layout CSV and <c>.xlsx</c> files (<see cref="MselFixture"/>).
/// </summary>
public sealed class MselImportPulseColumnsTests
{
    private static readonly Guid FirePersona = Guid.NewGuid();
    private static readonly Guid CardAsset = Guid.NewGuid();
    private static readonly Guid VideoAsset = Guid.NewGuid();
    private static readonly Guid A = Guid.NewGuid();
    private static readonly Guid B = Guid.NewGuid();
    private static readonly Guid C = Guid.NewGuid();

    private static readonly MselImportFacts Facts = new(
        [new ImportPersona(FirePersona, "KestrelFire", "Kestrel County Fire")],
        [
            new ImportMedia(CardAsset, "pio-statement-card.png", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(VideoAsset, "scoop-viral.mp4", MediaKinds.Video, DateTimeOffset.UtcNow),
            new ImportMedia(A, "a.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(B, "b.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(C, "c.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
        ],
        []);

    // ---- headers ----

    [Fact]
    public void TheFourHeaders_MatchCaseInsensitivelyAndTrimmed()
    {
        var table = new MselTable(
            ["Inject #", "Delivery Method", "From / Source", "Description", "pulse media", " pulse MEDIA alt ", "PULSE LIKES", " Pulse reposts", "pulse replies "],
            [new MselRow(2, ["1", "Social Media", "@KestrelFire", "hello", "a.jpg", "Map of zones 3-5", "12", "3", "4"])]);

        var candidate = MselImportPlanner.Plan(table, Facts).Rows.Single().Candidate!;

        candidate.Media.Should().Equal(new PlannedMedia(A, "Map of zones 3-5"));
        (candidate.BaselineLike, candidate.BaselineRepost, candidate.BaselineReply).Should().Be((12, 3, 4));
    }

    // ---- Pulse Media Alt ----

    [Fact]
    public void PulseMediaAlt_GivesEachFileItsAlt_InTheSameOrder_EachEntryTrimmed()
    {
        var row = PlanOne(Row(media: "a.jpg, b.jpg", alt: "  Map of zones 3-5 |   Crews at the Kestrel main  "));

        row.Candidate!.Media.Should().Equal(new PlannedMedia(A, "Map of zones 3-5"), new PlannedMedia(B, "Crews at the Kestrel main"));
        row.Warnings.Should().BeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("<b></b>")]
    public void PulseMediaAlt_ABlankCell_KeepsTheFileNameStem_ForEveryFile(string alt)
    {
        var row = PlanOne(Row(media: "pio-statement-card.png,a.jpg", alt: alt));

        row.Candidate!.Media.Should().Equal(new PlannedMedia(CardAsset, "pio-statement-card"), new PlannedMedia(A, "a"));
        row.Warnings.Should().BeEmpty("a blank cell is today's behaviour, not a warning");
    }

    [Fact]
    public void PulseMediaAlt_ABlankEntry_FallsBackToTheStem_ForThatFileOnly()
    {
        var row = PlanOne(Row(media: "a.jpg,b.jpg,c.jpg", alt: "First photo|   |Third photo"));

        row.Candidate!.Media.Select(media => media.Alt).Should().Equal("First photo", "b", "Third photo");
        row.Warnings.Should().BeEmpty();

        PlanOne(Row(media: "a.jpg,b.jpg", alt: "|Second only")).Candidate!.Media.Select(media => media.Alt)
            .Should().Equal("a", "Second only");
    }

    [Theory]
    [InlineData("pio-statement-card.png", "one|two", "Pulse Media Alt has 2 entries for 1 Pulse Media file.")]
    [InlineData("a.jpg,b.jpg", "one|two|three", "Pulse Media Alt has 3 entries for 2 Pulse Media files.")]
    [InlineData("a.jpg,b.jpg", "one|two|", "Pulse Media Alt has 3 entries for 2 Pulse Media files.")]
    public void PulseMediaAlt_MoreEntriesThanFiles_FailsTheRow(string media, string alt, string expected)
    {
        var report = PlanOne(Row(media: media, alt: alt)).ToFinalReport();

        report.Status.Should().Be("failed");
        report.Message.Should().Be(expected, "a separator always starts another entry, even a trailing one");
    }

    [Fact]
    public void PulseMediaAlt_FewerEntriesThanFiles_TheRestUseTheStem_WithAWarning()
    {
        var row = PlanOne(Row(media: "a.jpg,b.jpg,c.jpg", alt: "Only the first"));

        row.Candidate!.Media.Select(media => media.Alt).Should().Equal("Only the first", "b", "c");
        row.ToReport("created", null).Message
            .Should().Be("Pulse Media Alt has 1 entry for 3 Pulse Media files; the rest use the file name.");
    }

    [Fact]
    public void PulseMediaAlt_IsSanitizedLikeEveryTextCell_StripNeverEncode()
    {
        var row = PlanOne(Row(
            media: "a.jpg,b.jpg",
            alt: "<b>Statement</b> card: Fire & EMS \"update\"<script>alert(1)</script>|<img src=x onerror=alert(1)>Second"));

        row.Candidate!.Media.Select(media => media.Alt).Should().Equal("Statement card: Fire & EMS \"update\"", "Second");
    }

    [Fact]
    public void PulseMediaAlt_AnEntryOverMaxAltLength_IsTruncatedWithAWarning_AndPassesTheValidator()
    {
        var exactly = new string('x', InjectItemValidator.MaxAltLength);
        var over = new string('y', InjectItemValidator.MaxAltLength + 1);
        var markupAround = "<b>" + new string('z', InjectItemValidator.MaxAltLength) + "</b>";

        // The validator bounds alt text in UTF-16 units: an emoji straddling the 1000th unit is dropped whole, never split.
        var emojiAtTheEdge = new string('e', InjectItemValidator.MaxAltLength - 1) + "\U0001F4F7";

        var row = PlanOne(Row(media: "a.jpg,b.jpg,c.jpg", alt: $"{exactly}|{over}|{markupAround}"));
        var emoji = PlanOne(Row(media: "a.jpg", alt: emojiAtTheEdge));

        var alts = row.Candidate!.Media.Select(media => media.Alt).ToList();
        alts[0].Should().Be(exactly, "exactly the limit is kept whole");
        alts[1].Should().Be(new string('y', InjectItemValidator.MaxAltLength));
        alts[2].Should().HaveLength(InjectItemValidator.MaxAltLength, "the limit applies after sanitizing, as on the write path");
        row.ToReport("created", null).Message.Should().Be("Pulse Media Alt entry 2 truncated to 1000 characters.");
        emoji.Candidate!.Media.Single().Alt.Should().Be(new string('e', InjectItemValidator.MaxAltLength - 1));
        emoji.Warnings.Should().Equal("Pulse Media Alt entry 1 truncated to 1000 characters.");

        foreach (var candidate in new[] { row.Candidate, emoji.Candidate })
        {
            InjectItemValidator.Parse(ImportRequests.ForCreate(candidate)).Error
                .Should().BeNull("a truncated entry always fits the write path's own alt limit");
        }
    }

    [Fact]
    public void PulseMediaAlt_WithNoPulseMedia_IsIgnoredWithAWarning()
    {
        var row = PlanOne(Row(media: "", alt: "A photo that is not attached"));

        row.Candidate!.Media.Should().BeEmpty();
        row.ToReport("created", null).Message.Should().Be("Pulse Media Alt ignored: the row has no Pulse Media.");
    }

    // ---- Pulse Likes / Reposts / Replies ----

    [Fact]
    public void PulseEngagement_BlankCells_AreNotSet()
    {
        var candidate = PlanOne(Row(likes: "", reposts: " ", replies: "")).Candidate!;

        (candidate.BaselineLike, candidate.BaselineRepost, candidate.BaselineReply).Should().Be(((int?)null, (int?)null, (int?)null));
        ImportRequests.ForCreate(candidate).Posts![0]!.EngagementBaseline.Should().BeNull("nothing set sends no baseline, as a console create");
    }

    [Theory]
    [InlineData("0", 0)]
    [InlineData("962", 962)]
    [InlineData(" 1000000 ", 1_000_000)]
    [InlineData("+7", 7)]
    [InlineData("962.0", 962)]
    [InlineData("1e3", 1000)]
    public void PulseEngagement_AWholeNumberAsText_IsParsedWithTheInvariantCulture(string cell, int expected)
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            // A culture whose '.' is the group separator: only an invariant parse reads "962.0" as 962.
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("de-DE");

            var candidate = PlanOne(Row(likes: cell, reposts: cell, replies: cell)).Candidate!;

            (candidate.BaselineLike, candidate.BaselineRepost, candidate.BaselineReply).Should().Be((expected, expected, expected));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Theory]
    [InlineData("Pulse Likes", "-1")]
    [InlineData("Pulse Likes", "2.5")]
    [InlineData("Pulse Reposts", "1000001")]
    [InlineData("Pulse Replies", "lots")]
    [InlineData("Pulse Likes", "1,000")]
    [InlineData("Pulse Likes", "1.000,5")]
    [InlineData("Pulse Reposts", "NaN")]
    [InlineData("Pulse Reposts", "Infinity")]
    [InlineData("Pulse Replies", "1E+30")]
    [InlineData("Pulse Replies", "0x10")]
    [InlineData("Pulse Likes", "962 likes")]
    public void PulseEngagement_EveryInvalidValue_FailsTheRow_NamingTheColumn(string column, string value)
    {
        var spec = column switch
        {
            "Pulse Likes" => Row(likes: value),
            "Pulse Reposts" => Row(reposts: value),
            _ => Row(replies: value),
        };

        var report = PlanOne(spec).ToFinalReport();

        report.Status.Should().Be("failed");
        report.Message.Should().Be($"{column} '{value}' is not a whole number from 0 to 1,000,000.");
    }

    [Fact]
    public void PulseEngagement_FromAnXlsx_AnIntegralNumberCellIsAccepted_AFractionalOneFails_AndATextCellIsParsed()
    {
        var rows = new[]
        {
            Row("1", likes: "962", reposts: "'41", replies: "1000000"),
            Row("2", likes: "962.5"),
            Row("3", reposts: "10000000"),
        };

        // Headers: 16 Cadence columns, then Pulse Media Alt (17), Pulse Likes (18), Pulse Reposts (19), Pulse Replies (20).
        var file = MselFixture.Xlsx(rows, pulseExtensions: true, after: sheet =>
        {
            sheet.Cell(2, 18).DataType.Should().Be(XLDataType.Number, "a typed 962 is the double 962.0 in the workbook");
            sheet.Cell(2, 18).GetDouble().Should().Be(962.0);
            sheet.Cell(2, 19).DataType.Should().Be(XLDataType.Text);
        });
        var read = InjectImportService.Read(file, "msel.xlsx", null);
        read.Error.Should().BeNull();

        var plan = MselImportPlanner.Plan(read.Table!, Facts);

        var first = plan.Rows[0].Candidate!;
        (first.BaselineLike, first.BaselineRepost, first.BaselineReply).Should().Be((962, 41, 1_000_000));
        plan.Rows[1].ToFinalReport().Message.Should().Be("Pulse Likes '962.5' is not a whole number from 0 to 1,000,000.");
        plan.Rows[2].ToFinalReport().Message.Should().Be("Pulse Reposts '10000000' is not a whole number from 0 to 1,000,000.");
    }

    [Fact]
    public void PulseEngagement_IsSanitizedBeforeItIsRead_AndTheMessageNeverCarriesMarkup()
    {
        PlanOne(Row(likes: "<b>12</b>")).Candidate!.BaselineLike.Should().Be(12);
        PlanOne(Row(likes: "<script>alert(1)</script>lots<i>")).ToFinalReport().Message
            .Should().Be("Pulse Likes 'lots' is not a whole number from 0 to 1,000,000.", "the echoed value is the sanitized cell");
    }

    // ---- helpers ----

    private static MselRowSpec Row(
        string injectNumber = "1",
        string media = "",
        string alt = "",
        string likes = "",
        string reposts = "",
        string replies = "") =>
        new(injectNumber, "Statement card", "Boil water notice for zones 3-5.", "08:00", "1", "08:00", "@KestrelFire", "Public",
            "Social Media", PulseMedia: media, PulseMediaAlt: alt, PulseLikes: likes, PulseReposts: reposts, PulseReplies: replies);

    private static PlannedImportRow PlanOne(MselRowSpec row)
    {
        var read = InjectImportService.Read(
            MselFixture.Csv([row], pulseMedia: true, pulseExtensions: true), "msel.csv", "text/csv");
        read.Error.Should().BeNull();
        var plan = MselImportPlanner.Plan(read.Table!, Facts);
        plan.Error.Should().BeNull();
        return plan.Rows.Should().ContainSingle().Subject;
    }
}
