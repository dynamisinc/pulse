namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using ClosedXML.Excel;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Exports;
using Xunit;

/// <summary>
/// demo-feedback story 19 — the export's edit columns on <c>Posts</c> (<c>Edits</c>, <c>Last edited (scenario)</c>,
/// <c>Original text</c>) and the second sheet <c>Edit history</c> (DF-39): layout and formula safety (Docker-free), and
/// an end-to-end export whose version texts and times match the history read.
/// </summary>
public class PostEditWorkbookTests
{
    private static PostExportRow Row(string text) => new()
    {
        ScenarioTime = "2033-09-04 13:00",
        WallClockUtc = new DateTime(2026, 10, 14, 18, 30, 0, DateTimeKind.Utc),
        AuthorHandle = "@resident",
        AuthorName = "Ann Resident",
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

    private static byte[] Write(IEnumerable<PostExportRow> rows, IEnumerable<PostEditHistoryExportRow> history)
    {
        using var workbook = new PostExportWorkbook();
        workbook.AddRows(rows);
        workbook.AddEditHistoryRows(history);
        using var buffer = new MemoryStream();
        workbook.SaveTo(buffer);
        return buffer.ToArray();
    }

    [Fact]
    public void PostsSheet_AppendsTheThreeEditColumns_AndAFormulaLookingOriginalStaysText()
    {
        var bytes = Write([Row("now") with { Edits = 2, LastEditedAt = "2033-09-04 13:05", OriginalText = "=1+1" }], []);

        using var workbook = ExportWorkbookReader.Open(bytes);
        var sheet = workbook.Worksheet(PostExportWorkbook.SheetName);
        sheet.Cell(1, 21).GetString().Should().Be("Edits");
        sheet.Cell(1, 22).GetString().Should().Be("Last edited (scenario)");
        sheet.Cell(1, 23).GetString().Should().Be("Original text");
        sheet.Cell(2, 21).DataType.Should().Be(XLDataType.Number);
        sheet.Cell(2, 21).GetDouble().Should().Be(2);
        sheet.Cell(2, 22).GetString().Should().Be("2033-09-04 13:05");
        var original = sheet.Cell(2, 23);
        original.HasFormula.Should().BeFalse("an edit that starts with = must open as text");
        original.DataType.Should().Be(XLDataType.Text);
        original.GetString().Should().Be("=1+1");
    }

    [Fact]
    public void EditHistorySheet_HasItsColumns_BoldFrozenHeader_Autofilter_AndTextValuesNeverFormulas()
    {
        var wall = new DateTime(2026, 10, 14, 18, 31, 0, DateTimeKind.Utc);
        var bytes = Write([], [
            new PostEditHistoryExportRow { PostId = "p-1", EditNumber = 0, ScenarioTime = "2033-09-04 13:00", WallClockUtc = wall, Text = "=HYPERLINK(\"http://x\",\"y\")", Current = "no" },
            new PostEditHistoryExportRow { PostId = "p-1", EditNumber = 1, ScenarioTime = "2033-09-04 13:05", WallClockUtc = wall.AddMinutes(5), Text = "fixed", Current = "yes" },
        ]);

        using var workbook = ExportWorkbookReader.Open(bytes);
        var sheet = workbook.Worksheet(PostExportWorkbook.EditHistorySheetName);
        Enumerable.Range(1, 6).Select(c => sheet.Cell(1, c).GetString())
            .Should().Equal("Post id", "Edit number", "Scenario time", "Wall clock (UTC)", "Text", "Current");
        Enumerable.Range(1, 6).Should().OnlyContain(c => sheet.Cell(1, c).Style.Font.Bold);
        sheet.SheetView.SplitRow.Should().Be(1);
        sheet.AutoFilter.IsEnabled.Should().BeTrue();
        sheet.AutoFilter.Range.RangeAddress.ToString().Should().Be("A1:F3");

        sheet.Cell(2, 2).GetDouble().Should().Be(0);
        sheet.Cell(2, 4).DataType.Should().Be(XLDataType.DateTime);
        sheet.Cell(2, 4).GetDateTime().Should().Be(new DateTime(2026, 10, 14, 18, 31, 0));
        sheet.Cell(2, 5).HasFormula.Should().BeFalse();
        sheet.Cell(2, 5).GetString().Should().Be("=HYPERLINK(\"http://x\",\"y\")");
        sheet.Cell(3, 6).GetString().Should().Be("yes");
        sheet.CellsUsed().Should().NotContain(c => c.HasFormula);
    }

    [Fact]
    public void AnExportWithNoEdits_StillHasTheEditHistoryHeaderAndAFilter()
    {
        using var workbook = ExportWorkbookReader.Open(Write([Row("x")], []));
        var sheet = workbook.Worksheet(PostExportWorkbook.EditHistorySheetName);
        sheet.LastRowUsed()!.RowNumber().Should().Be(1);
        sheet.AutoFilter.IsEnabled.Should().BeTrue();
    }
}

/// <summary>End-to-end: edit through the real route, export through the real route, compare with the history read.</summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostEditExportEndToEndTests
{
    private readonly MsSqlContainerFixture _fixture;

    public PostEditExportEndToEndTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    private string ConnectionString => _fixture.ConnectionString
        ?? throw new InvalidOperationException("The MsSql fixture has no connection string.");

    private static List<Dictionary<string, string>> HistoryRows(byte[] content)
    {
        using var workbook = ExportWorkbookReader.Open(content);
        var sheet = workbook.Worksheet(PostExportWorkbook.EditHistorySheetName);
        var last = sheet.LastRowUsed()?.RowNumber() ?? 1;
        var rows = new List<Dictionary<string, string>>();
        for (var r = 2; r <= last; r++)
        {
            var row = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var c = 1; c <= PostExportWorkbook.EditHistoryHeaders.Count; c++)
            {
                row[PostExportWorkbook.EditHistoryHeaders[c - 1]] = sheet.Cell(r, c).GetString();
            }

            row["WallClockValue"] = sheet.Cell(r, 4).GetDateTime().ToString("O", CultureInfo.InvariantCulture);
            rows.Add(row);
        }

        return rows;
    }

    [RequiresDockerFact]
    public async Task Export_CarriesTheEditColumns_AndOneEditHistoryRowPerVersion_MatchingTheHistoryRead()
    {
        await using var edits = await PostEditTestHost.StartAsync(ConnectionString);
        var exerciseId = await edits.SeedExerciseAsync();
        var personaId = await edits.SeedPersonaAsync(exerciseId);
        var edited = await edits.SeedPostAsync(exerciseId, personaId, body: "v0 typo");
        var untouched = await edits.SeedPostAsync(exerciseId, personaId, body: "never edited");
        edits.Clock.Start(exerciseId, PostEditTestHost.StoredScenarioTime, TimeZoneInfo.Utc);
        edits.ActAsParticipant(exerciseId, personaId);

        foreach (var text in new[] { "v1", "=2+2 v2" })
        {
            edits.Time.Advance(TimeSpan.FromMinutes(1));
            (await edits.EditAsync(edited, text)).StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var historyResponse = await edits.HistoryAsync(edited);
        var history = JsonNode.Parse(await historyResponse.Content.ReadAsStringAsync())!["versions"]!.AsArray()
            .Select(v => v!.AsObject())
            .OrderBy(v => v["editNumber"]!.GetValue<int>())
            .ToList();

        var seed = new PostExportSeed(_fixture);
        var (token, _) = await seed.StaffAsync(exerciseId, [(exerciseId, "evaluator")]);
        await using var exportHost = await PostExportTestHost.StartAsync(ConnectionString, exerciseId);
        using var export = await exportHost.GetExportAsync(token);
        export.StatusCode.Should().Be(HttpStatusCode.OK);
        var bytes = await export.Content.ReadAsByteArrayAsync();

        // Posts sheet: the three columns.
        var posts = ExportWorkbookReader.Rows(bytes).ToDictionary(r => r["Post id"]);
        posts[edited.ToString()]["Edits"].Should().Be("2");
        posts[edited.ToString()]["Original text"].Should().Be("v0 typo");
        posts[edited.ToString()]["Last edited (scenario)"].Should().Be(
            DateTimeOffset.Parse(history[2]["scenarioTime"]!.GetValue<string>(), CultureInfo.InvariantCulture)
                .UtcDateTime.ToString(PostExportLabels.ScenarioTimeFormat, CultureInfo.InvariantCulture));
        posts[edited.ToString()]["Text"].Should().Be("=2+2 v2");
        posts[untouched.ToString()]["Edits"].Should().Be("0");
        posts[untouched.ToString()]["Original text"].Should().BeEmpty();
        posts[untouched.ToString()]["Last edited (scenario)"].Should().BeEmpty();

        // Edit history sheet: one row per version of the edited post only, matching the history read.
        var rows = HistoryRows(bytes);
        rows.Should().HaveCount(3, "versions 0, 1 and 2 of the one edited post; never-edited posts have no rows");
        rows.Should().OnlyContain(r => r["Post id"] == edited.ToString());
        rows.Select(r => r["Edit number"]).Should().Equal("0", "1", "2");
        rows.Select(r => r["Text"]).Should().Equal(history.Select(v => v["text"]!.GetValue<string>()));
        rows.Select(r => r["Scenario time"]).Should().Equal(history.Select(v =>
            DateTimeOffset.Parse(v["scenarioTime"]!.GetValue<string>(), CultureInfo.InvariantCulture)
                .UtcDateTime.ToString(PostExportLabels.ScenarioTimeFormat, CultureInfo.InvariantCulture)));
        rows.Select(r => r["Current"]).Should().Equal("no", "no", "yes");

        var editRows = await edits.ReadEditsAsync(edited);
        var post = await edits.ReadPostAsync(edited);
        DateTime.Parse(rows[0]["WallClockValue"], CultureInfo.InvariantCulture)
            .Should().BeCloseTo(post.CreatedWallClock.UtcDateTime, TimeSpan.FromSeconds(1));
        DateTime.Parse(rows[2]["WallClockValue"], CultureInfo.InvariantCulture)
            .Should().BeCloseTo(editRows[1].EditedAt.UtcDateTime, TimeSpan.FromSeconds(1));
    }
}
