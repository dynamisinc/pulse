namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Injects.Import;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback/16 on real SQL — the MSEL import's alt text and engagement columns (DF-21) through the queue's write
/// path (create / update / unchanged, dry run), and the planned-minute placement of created items (DF-22): interleaving
/// among pending items, ties, unplanned rows, non-pending items fixed in place, several rows with one minute, re-import
/// leaving positions alone, ONE queue-token bump and no item version bumped for a shift, and exercise isolation. The
/// service is driven directly (a request scope of the host wired as <c>Program.cs</c> wires it); one end-to-end test goes
/// over HTTP with an <c>.xlsx</c> and reads the run sheet back through <c>GET /api/injects</c>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectImportAltEngagementOrderTests
{
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private const string PioAlt = "Statement card: boil water notice for zones 3-5";
    private const string MapAlt = "Map of zones 3-5";

    private readonly MsSqlContainerFixture _fixture;

    public InjectImportAltEngagementOrderTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- DF-21: alt text and engagement through the write path ----

    [RequiresDockerFact]
    public async Task Create_StoresTheFilesAltTextAndEngagementBaseline()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);

        var report = await ImportAsync(host, Xlsx(PioRow(), ScoopRow()), dryRun: false);

        report.Rows.Select(row => row.Status).Should().Equal("skipped", "created", "created");
        report.Rows.Skip(1).Should().OnlyContain(row => row.Message == null, "nothing to warn about");
        await using var db = host.Db(seed.ExerciseId);
        var pio = await ChildAsync(db, "101");
        pio.Media.Select(media => (media.MediaId, media.Alt)).Should().Equal(
            (seed.Card.ToString(), PioAlt), (seed.Map.ToString(), MapAlt));
        (pio.BaselineLike, pio.BaselineRepost, pio.BaselineReply).Should().Be((120, 45, (int?)null), "a blank Pulse Replies is not set");
        var scoop = await ChildAsync(db, "102");
        scoop.Media.Should().ContainSingle().Which.Alt.Should().Be("scoop-viral", "a blank Pulse Media Alt keeps the file-name stem");
        (scoop.BaselineLike, scoop.BaselineRepost, scoop.BaselineReply).Should().Be((962, 310, 88));
    }

    [RequiresDockerFact]
    public async Task ASeededItemAndAnImportedItem_WithTheSameValues_AreIndistinguishable()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);

        // As scripts/uat/Seed-DemoContent.ps1 posts the pack's item to the console write path.
        var seeded = await host.CreateOkAsync(new
        {
            kind = "post",
            title = "Scoop: viral video",
            plannedMinute = 20,
            posts = new[]
            {
                new
                {
                    personaId = seed.Scoop.ToString(),
                    text = ScoopText,
                    media = new[] { new { mediaId = seed.Video.ToString(), alt = "Video of brown water pouring from a tap" } },
                    engagementBaseline = new { like = 962, repost = 310, reply = 88 },
                },
            },
        });
        await ImportAsync(host, Xlsx(ScoopRow() with { PulseMediaAlt = "Video of brown water pouring from a tap" }), dryRun: false);

        using var queue = await GetQueueJsonAsync(host);
        var items = queue.RootElement.GetProperty("items").EnumerateArray().ToList();
        items.Should().HaveCount(2);
        var fromSeed = items.Single(item => item.GetProperty("id").GetString() == seeded.Id).GetProperty("posts")[0];
        var fromImport = items.Single(item => item.GetProperty("id").GetString() != seeded.Id).GetProperty("posts")[0];
        foreach (var field in new[] { "personaId", "text", "media", "engagementBaseline" })
        {
            fromImport.GetProperty(field).GetRawText().Should().Be(fromSeed.GetProperty(field).GetRawText(), field);
        }
    }

    [RequiresDockerFact]
    public async Task ReImport_TheSameAltTextAndBaseline_IsUnchanged_AndWritesNothing()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var file = Xlsx(PioRow(), ScoopRow());
        await ImportAsync(host, file, dryRun: false);
        var before = await SnapshotAsync(host, seed.ExerciseId);

        var again = await ImportAsync(host, file, dryRun: false);

        again.Rows.Skip(1).Should().OnlyContain(row => row.Status == "unchanged" && row.Message == null);
        (await SnapshotAsync(host, seed.ExerciseId)).Should().Be(before, "no item, version, order, alt, baseline or token changed");
    }

    [RequiresDockerFact]
    public async Task ReImport_AChangedAltTextOrBaseline_OnAnUnfiredItem_IsAnUpdate_SayingWhatChanged()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        await ImportAsync(host, Xlsx(PioRow(), ScoopRow()), dryRun: false);
        int tokenBefore;
        await using (var db = host.Db(seed.ExerciseId))
        {
            tokenBefore = (await db.InjectQueueStates.SingleAsync()).Version;
        }

        var report = await ImportAsync(
            host,
            Xlsx(
                PioRow() with { PulseMediaAlt = PioAlt + "|Map of zones 3, 4 and 5" },
                ScoopRow() with { PulseLikes = "1000", PulseReplies = "" }),
            dryRun: false);

        (report.Rows[1].Status, report.Rows[1].Message).Should().Be(("updated", "changed: alt text"));
        (report.Rows[2].Status, report.Rows[2].Message).Should().Be(("updated", "changed: engagement"));
        await using var after = host.Db(seed.ExerciseId);
        var pio = await ChildAsync(after, "101");
        pio.Media.Select(media => media.Alt).Should().Equal(PioAlt, "Map of zones 3, 4 and 5");
        var scoop = await ChildAsync(after, "102");
        (scoop.BaselineLike, scoop.BaselineRepost, scoop.BaselineReply).Should().Be((1000, 310, (int?)null), "a blank cell is 'not set'");
        (await after.InjectItems.Where(item => item.ExternalRef != null).Select(item => item.Version).ToListAsync())
            .Should().AllBeEquivalentTo(2, "an update bumps its item's version once");
        (await after.InjectQueueStates.SingleAsync()).Version.Should().Be(tokenBefore, "updates change no membership or order");
    }

    [RequiresDockerFact]
    public async Task ReImport_AChangedAltTextOrBaseline_OnAFiredItem_IsLeftAlone()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        await ImportAsync(host, Xlsx(PioRow()), dryRun: false);
        Guid pioId;
        await using (var db = host.Db(seed.ExerciseId))
        {
            pioId = (await db.InjectItems.SingleAsync(item => item.ExternalRef == "101")).Id;
        }

        var fired = await host.ActionOkAsync(pioId, "fire");
        fired.Status.Should().Be("fired");

        var report = await ImportAsync(host, Xlsx(PioRow() with { PulseMediaAlt = "Rewritten alt|Rewritten map", PulseLikes = "5000" }), dryRun: false);

        (report.Rows[1].Status, report.Rows[1].Message).Should().Be(("unchanged", "already fired; not changed"));
        await using var after = host.Db(seed.ExerciseId);
        var pio = await ChildAsync(after, "101");
        pio.Media.Select(media => media.Alt).Should().Equal(PioAlt, MapAlt);
        pio.BaselineLike.Should().Be(120);
        (await after.InjectItems.SingleAsync(item => item.Id == pioId)).Version.Should().Be(fired.Version);
    }

    [RequiresDockerFact]
    public async Task ReImport_AFileWithNoEngagementColumns_KeepsTheConsoleSetBaseline()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var plain = PlainXlsx(PioRow());
        await ImportAsync(host, plain, dryRun: false);
        await ConsoleEditAsync(host, seed, "101", baseline: new { like = 500, reply = 3 });
        var before = await SnapshotAsync(host, seed.ExerciseId);

        var again = await ImportAsync(host, plain, dryRun: false);

        (again.Rows[1].Status, again.Rows[1].Message).Should().Be(
            ("unchanged", (string?)null), "a plain Cadence export (no Pulse Likes/Reposts/Replies header) says nothing about engagement");
        (await SnapshotAsync(host, seed.ExerciseId)).Should().Be(before);

        var retitled = await ImportAsync(host, PlainXlsx(PioRow() with { Title = "PIO: statement card (rev 2)" }), dryRun: false);

        (retitled.Rows[1].Status, retitled.Rows[1].Message).Should().Be(("updated", "changed: title"));
        await using var db = host.Db(seed.ExerciseId);
        var pio = await ChildAsync(db, "101");
        (pio.BaselineLike, pio.BaselineRepost, pio.BaselineReply).Should().Be(
            (500, (int?)null, 3), "an update from a file without engagement columns keeps the baseline, as before story 16");
    }

    [RequiresDockerFact]
    public async Task ReImport_TheEngagementColumnsPresentButBlank_ClearTheConsoleSetBaseline()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var blank = Xlsx(PioRow() with { PulseLikes = "", PulseReposts = "" });
        await ImportAsync(host, blank, dryRun: false);
        await ConsoleEditAsync(host, seed, "101", baseline: new { like = 500, reply = 3 });

        var again = await ImportAsync(host, blank, dryRun: false);

        (again.Rows[1].Status, again.Rows[1].Message).Should().Be(("updated", "changed: engagement"));
        await using (var db = host.Db(seed.ExerciseId))
        {
            var pio = await ChildAsync(db, "101");
            (pio.BaselineLike, pio.BaselineRepost, pio.BaselineReply).Should().Be(
                ((int?)null, (int?)null, (int?)null), "with the columns present the file is the source, and blank is not set");
        }

        var before = await SnapshotAsync(host, seed.ExerciseId);
        (await ImportAsync(host, blank, dryRun: false)).Rows[1].Status.Should().Be("unchanged");
        (await SnapshotAsync(host, seed.ExerciseId)).Should().Be(before);
    }

    [RequiresDockerFact]
    public async Task ReImport_WithoutThePulseMediaAltHeader_KeepsThePreStory16Rule_TheFileNameStemWins()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var plain = PlainXlsx(PioRow());
        await ImportAsync(host, plain, dryRun: false);
        await using (var db = host.Db(seed.ExerciseId))
        {
            (await ChildAsync(db, "101")).Media.Select(media => media.Alt).Should().Equal("pio-statement-card", "zones-map");
        }

        (await ImportAsync(host, plain, dryRun: false)).Rows[1].Status.Should().Be("unchanged");

        await ConsoleEditAsync(host, seed, "101", alts: ["Edited in the console", "Edited map"]);
        var again = await ImportAsync(host, plain, dryRun: false);

        // Before story 16 the importer always wrote the stem, so a console-edited alt was reset (then reported as
        // "changed: media"). Without the header that rule is kept; story 16 only names the change precisely.
        (again.Rows[1].Status, again.Rows[1].Message).Should().Be(("updated", "changed: alt text"));
        await using (var db = host.Db(seed.ExerciseId))
        {
            (await ChildAsync(db, "101")).Media.Select(media => media.Alt).Should().Equal("pio-statement-card", "zones-map");
        }

        await ConsoleEditAsync(host, seed, "101", alts: ["Edited in the console", "Edited map"]);
        var withHeader = await ImportAsync(host, Xlsx(PioRow()), dryRun: false);

        (withHeader.Rows[1].Status, withHeader.Rows[1].Message).Should().Be(("updated", "changed: alt text, engagement"));
        await using var after = host.Db(seed.ExerciseId);
        (await ChildAsync(after, "101")).Media.Select(media => media.Alt).Should().Equal([PioAlt, MapAlt], "with the header the file wins");
    }

    [RequiresDockerFact]
    public async Task DryRun_ReportsTheNewFailuresAndWarnings_AndWritesNothing_NorComputesOrder()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        await CreatePlannedAsync(host, seed, "Console T+10", 10);
        await CreatePlannedAsync(host, seed, "Console T+30", 30);
        var before = await SnapshotAsync(host, seed.ExerciseId);
        var file = Xlsx(
            Social("201", "Too many alts", "08:05", media: "pio-statement-card.png", alt: "one|two"),
            Social("202", "Fewer alts", "08:15", media: "pio-statement-card.png, zones-map.jpg", alt: "Card only"),
            Social("203", "Negative likes", "08:20", likes: "-3"),
            Social("204", "Orphan alt", "08:25", alt: "A photo nobody attached"),
            Social("205", "Fractional reposts", "08:12", reposts: "2.5"));

        var dry = await ImportAsync(host, file, dryRun: true);

        dry.DryRun.Should().BeTrue();
        dry.Rows.Select(row => row.Status).Should().Equal("skipped", "failed", "created", "failed", "created", "failed");
        dry.Rows.Skip(1).Select(row => row.Message).Should().Equal(
            "Pulse Media Alt has 2 entries for 1 Pulse Media file.",
            "Pulse Media Alt has 1 entry for 2 Pulse Media files; the rest use the file name.",
            "Pulse Likes '-3' is not a whole number from 0 to 1,000,000.",
            "Pulse Media Alt ignored: the row has no Pulse Media.",
            "Pulse Reposts '2.5' is not a whole number from 0 to 1,000,000.");
        (await SnapshotAsync(host, seed.ExerciseId)).Should().Be(before, "a dry run writes no item, no order, no token");
        await using (var db = host.Db(seed.ExerciseId))
        {
            (await db.TelemetryEvents.CountAsync(e => e.EventType == "injects.imported")).Should().Be(1, "only the dry-run event");
        }

        var real = await ImportAsync(host, file, dryRun: false);

        real.Rows.Should().BeEquivalentTo(dry.Rows, "the dry run reported exactly what the import then did");
        (await TitlesAsync(host)).Should().Equal("Console T+10", "Fewer alts", "Orphan alt", "Console T+30");
    }

    // ---- DF-22: created items slot in by planned minute ----

    [RequiresDockerFact]
    public async Task Apply_PlacesCreatedItemsByPlannedMinute_AmongThePendingItems_InOneSave()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var startEx = await CreatePlannedAsync(host, seed, "Seeded T+0 (fired)", 0);
        await CreatePlannedAsync(host, seed, "Seeded T+10", 10);
        var held = await CreatePlannedAsync(host, seed, "Seeded T+15 (held)", 15);
        await CreatePlannedAsync(host, seed, "Seeded T+20", 20);
        await CreatePlannedAsync(host, seed, "Seeded T+20 (b)", 20);
        await CreatePlannedAsync(host, seed, "Seeded T+40", 40);
        (await host.ActionOkAsync(startEx.Guid, "fire")).Status.Should().Be("fired");
        (await host.ActionOkAsync(held.Guid, "hold")).Status.Should().Be("held");
        var versionsBefore = await VersionsAsync(host, seed.ExerciseId);
        var (tokenBefore, actionsBefore) = await TokenAndActionCountAsync(host, seed.ExerciseId);

        // File rows deliberately not in time order (T+50 before T+30); the last row has no Scenario Time.
        var report = await ImportAsync(
            host,
            Xlsx(
                Social("1", "Imported T+5", "08:05"),
                Social("2", "Imported T+20", "08:20"),
                Social("3", "Imported T+20 (b)", "08:20"),
                Social("4", "Imported T+50", "08:50"),
                Social("5", "Imported T+30", "08:30"),
                Social("6", "Imported unplanned", "")),
            dryRun: false);

        report.CreatedCount.Should().Be(6);
        var queue = await host.GetQueueAsync();
        queue.Items.Select(item => item.Title).Should().Equal(
            [
                "Seeded T+0 (fired)",     // fired: never moves, never an anchor
                "Imported T+5",           // before the first pending item planned later (T+10)
                "Seeded T+10",
                "Seeded T+15 (held)",     // held: keeps its place; not an anchor for T+20
                "Seeded T+20",
                "Seeded T+20 (b)",
                "Imported T+20",          // ties go after the existing items with that minute …
                "Imported T+20 (b)",      // … and keep their file row order
                "Imported T+30",          // placed before T+40 even though the file listed T+50 first
                "Seeded T+40",
                "Imported T+50",          // no later pending item: the end
                "Imported unplanned",     // no minute: the end
            ],
            "DF-22: created items slot in by planned minute among the pending items");
        queue.Items.Select(item => item.Order).Should().Equal(Enumerable.Range(1, 12));

        (await VersionsAsync(host, seed.ExerciseId)).Should().Contain(
            versionsBefore, "a shift is presentation, not item state: no existing item's version moved (as ReorderAsync)");
        var (tokenAfter, actionsAfter) = await TokenAndActionCountAsync(host, seed.ExerciseId);
        tokenAfter.Should().Be(tokenBefore + 1, "the creates and the new order bump the queue token ONCE");
        actionsAfter.Should().Be(actionsBefore, "the placement is part of the import: no reorder action event");
        await using var db = host.Db(seed.ExerciseId);
        (await db.TelemetryEvents.CountAsync(e => e.EventType == "injects.imported")).Should().Be(1, "injects.imported is unchanged");
    }

    [RequiresDockerFact]
    public async Task ReImport_LeavesPositionsAlone_AndAnUpdatedItemIsJudgedByItsStoredMinute()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        await CreatePlannedAsync(host, seed, "Seeded T+10", 10);
        await CreatePlannedAsync(host, seed, "Seeded T+20", 20);
        var first = new[] { Social("1", "Imported T+5", "08:05"), Social("2", "Imported T+15", "08:15") };
        await ImportAsync(host, Xlsx(first), dryRun: false);
        (await TitlesAsync(host)).Should().Equal("Imported T+5", "Seeded T+10", "Imported T+15", "Seeded T+20");
        var before = await SnapshotAsync(host, seed.ExerciseId);

        await ImportAsync(host, Xlsx(first), dryRun: false);
        (await SnapshotAsync(host, seed.ExerciseId)).Should().Be(before, "re-importing the same file moves nothing");

        // One file: T+5 is re-planned to T+45 (an update), and a new T+12 row arrives.
        var report = await ImportAsync(
            host,
            Xlsx(Social("1", "Imported T+5", "08:45"), Social("2", "Imported T+15", "08:15"), Social("3", "Imported T+12", "08:12")),
            dryRun: false);

        (report.Rows[1].Status, report.Rows[1].Message).Should().Be(("updated", "changed: planned minute"));
        report.Rows[2].Status.Should().Be("unchanged");
        report.Rows[3].Status.Should().Be("created");
        var queue = await host.GetQueueAsync();
        queue.Items.Select(item => item.Title).Should().Equal(
            ["Imported T+5", "Seeded T+10", "Imported T+12", "Imported T+15", "Seeded T+20"],
            "the updated item keeps its place, and the new item is placed against the run sheet as it stood (T+5 there, "
            + "not T+45 — judged by 45 it would have jumped ahead of T+10)");
        queue.Items[0].PlannedMinute.Should().Be(45);
    }

    [RequiresDockerFact]
    public async Task Isolation_AnotherExercisesItemsNeverMove_NorAnchorThePlacement()
    {
        await using var host = await StartAsync();
        var b = await SeedAsync(host);
        await CreatePlannedAsync(host, b, "B T+6", 6);
        await CreatePlannedAsync(host, b, "B T+1", 1);
        var bBefore = await SnapshotAsync(host, b.ExerciseId);

        var a = await SeedAsync(host);
        await CreatePlannedAsync(host, a, "A T+0", 0);
        await CreatePlannedAsync(host, a, "A T+10", 10);

        await ImportAsync(host, Xlsx(Social("1", "A imported T+5", "08:05")), dryRun: false);

        var queue = await host.GetQueueAsync();
        queue.Items.Select(item => item.Title).Should().Equal(
            ["A T+0", "A imported T+5", "A T+10"], "B's pending T+6 is not in A's run sheet, so it can never anchor A's import");
        queue.Items.Select(item => item.Order).Should().Equal(1, 2, 3);
        (await SnapshotAsync(host, b.ExerciseId)).Should().Be(bBefore, "exercise B's items, orders, versions and token never move");

        await using var aDb = host.Db(a.ExerciseId);
        (await aDb.InjectItems.Select(item => item.ExerciseId).Distinct().ToListAsync()).Should().Equal(a.ExerciseId);
        (await aDb.InjectItems.IgnoreQueryFilters().CountAsync(item => item.ExerciseId == b.ExerciseId))
            .Should().Be(2, "B's rows exist; A simply never sees them");
    }

    // ---- end to end over HTTP ----

    [RequiresDockerFact]
    public async Task EndToEnd_AnXlsxWithAllFourColumns_ImportsOverHttp_AndGetInjectsReadsItBackInTimeOrder()
    {
        await using var host = await StartAsync();
        var seed = await SeedAsync(host);
        var opening = await CreatePlannedAsync(host, seed, "rs01 opening (fired)", 0);
        await CreatePlannedAsync(host, seed, "rs03 impersonator", 12);
        await CreatePlannedAsync(host, seed, "rs10 utility answer", 35);
        await host.ActionOkAsync(opening.Guid, "fire");

        var file = Xlsx(
            PioRow(),
            ScoopRow(),
            Social("103", "Resident: still brown", "08:40", likes: "'15"));
        using var upload = new MultipartFormDataContent { { Bytes(file), "file", "kestrel-msel.xlsx" } };
        host.Time.Advance(TimeSpan.FromMilliseconds(10));
        var response = await host.Client.PostAsync(new Uri(InjectImportEndpoints.ImportRoute + "?dryRun=false", UriKind.Relative), upload);
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        using var queue = await GetQueueJsonAsync(host);
        var items = queue.RootElement.GetProperty("items").EnumerateArray().ToList();
        items.Select(item => item.GetProperty("title").GetString()).Should().Equal(
            "rs01 opening (fired)", "PIO: statement card", "rs03 impersonator", "Scoop: viral video", "rs10 utility answer",
            "Resident: still brown");
        items.Select(item => item.GetProperty("plannedMinute").GetInt32()).Should().BeInAscendingOrder("Fire next now goes in time order");

        var pio = items[1].GetProperty("posts")[0];
        pio.GetProperty("media").EnumerateArray().Select(media => media.GetProperty("alt").GetString()).Should().Equal(PioAlt, MapAlt);
        Baseline(pio).Should().Be((120, 45, (int?)null));
        var scoop = items[3].GetProperty("posts")[0];
        scoop.GetProperty("media")[0].GetProperty("alt").GetString().Should().Be("scoop-viral");
        Baseline(scoop).Should().Be((962, 310, 88), "Excel stores 962 as the number 962.0");
        Baseline(items[5].GetProperty("posts")[0]).Should().Be((15, (int?)null, (int?)null), "a text cell is parsed too");
    }

    // ---- rows ----

    private const string ScoopText = "BREAKING: video shows brown water pouring from taps across Kestrel. Officials silent.";

    private static MselRowSpec StartEx() =>
        new("100", "StartEx", "Exercise starts", "08:00", "1", "08:00", "Exercise Director", "All players", "Verbal");

    private static MselRowSpec PioRow() =>
        new("101", "PIO: statement card", "Boil water notice for zones 3-5. Details in the card.", "08:05", "1", "08:05",
            "@KestrelFire", "Public", "Social Media", PulseMedia: "pio-statement-card.png, zones-map.jpg",
            PulseMediaAlt: PioAlt + " | " + MapAlt, PulseLikes: "120", PulseReposts: "45");

    private static MselRowSpec ScoopRow() =>
        new("102", "Scoop: viral video", ScoopText, "08:20", "1", "08:20", "@TheScoop", "Public", "Social Media",
            PulseMedia: "scoop-viral.mp4", PulseLikes: "962", PulseReposts: "310", PulseReplies: "88");

    private static MselRowSpec Social(
        string injectNumber,
        string title,
        string time,
        string media = "",
        string alt = "",
        string likes = "",
        string reposts = "") =>
        new(injectNumber, title, $"{title} #Kestrel", time, "1", time, "@KestrelFire", "Public", "Social Media",
            PulseMedia: media, PulseMediaAlt: alt, PulseLikes: likes, PulseReposts: reposts);

    /// <summary>A Cadence-layout workbook: the StartEx row (T+0, not social), then the rows, with every Pulse column.</summary>
    private static byte[] Xlsx(params MselRowSpec[] rows) =>
        MselFixture.Xlsx([StartEx(), .. rows], conduct: true, pulseMedia: true, pulseExtensions: true);

    /// <summary>The same, with <c>Pulse Media</c> only: none of story 16's headers (a pre-story-16 Pulse file).</summary>
    private static byte[] PlainXlsx(params MselRowSpec[] rows) =>
        MselFixture.Xlsx([StartEx(), .. rows], conduct: true, pulseMedia: true);

    // ---- host ----

    private async Task<InjectTestHost> StartAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(
            _fixture.ConnectionString!,
            configureServices: services => services.AddInjectImport(),
            mapEndpoints: endpoints => endpoints.MapInjectImport());
    }

    /// <summary>Calls the import service in a request scope of the host, as the endpoint does.</summary>
    private static async Task<InjectImportResultDto> ImportAsync(InjectTestHost host, byte[] file, bool dryRun)
    {
        host.Time.Advance(TimeSpan.FromMilliseconds(10));
        await using var scope = host.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<InjectImportService>();

        var result = await service.ImportAsync(file, "kestrel-msel.xlsx", XlsxType, dryRun);

        result.Outcome.Should().Be(InjectOutcome.Ok, result.Message);
        return result.Value!;
    }

    private static async Task<Seed> SeedAsync(InjectTestHost host)
    {
        var seeded = await host.SeedExerciseAsync(personas: 0);
        var fire = await AddPersonaAsync(host, seeded.ExerciseId, "KestrelFire", "Kestrel County Fire");
        var scoop = await AddPersonaAsync(host, seeded.ExerciseId, "@TheScoop", "The Scoop");
        var card = await AddMediaAsync(host, seeded.ExerciseId, "pio-statement-card.png", MediaKinds.Image);
        var map = await AddMediaAsync(host, seeded.ExerciseId, "zones-map.jpg", MediaKinds.Image);
        var video = await AddMediaAsync(host, seeded.ExerciseId, "scoop-viral.mp4", MediaKinds.Video);
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return new Seed(seeded.ExerciseId, seeded.StaffUserId, fire, scoop, card, map, video);
    }

    private static Task<WireItem> CreatePlannedAsync(InjectTestHost host, Seed seed, string title, int plannedMinute)
    {
        host.ActAs(seed.ExerciseId, seed.StaffUserId);
        return host.CreateOkAsync(new
        {
            kind = "post",
            title,
            plannedMinute,
            posts = new[] { new { personaId = seed.Fire.ToString(), text = $"{title} #Kestrel" } },
        });
    }

    /// <summary>
    /// A controller's console edit of an imported single post (the queue's own PUT): new alt texts and/or a new
    /// baseline, everything else echoed as it is.
    /// </summary>
    private static async Task ConsoleEditAsync(InjectTestHost host, Seed seed, string externalRef, string[]? alts = null, object? baseline = null)
    {
        InjectItem item;
        InjectItemPost child;
        await using (var db = host.Db(seed.ExerciseId))
        {
            item = await db.InjectItems.SingleAsync(row => row.ExternalRef == externalRef);
            child = await db.InjectItemPosts.SingleAsync(post => post.InjectItemId == item.Id && post.DeletedAt == null);
        }

        var media = child.Media.Select((stored, index) => new { mediaId = stored.MediaId, alt = alts?[index] ?? stored.Alt }).ToArray();
        var keptBaseline = child.BaselineLike is null && child.BaselineRepost is null && child.BaselineReply is null
            ? null
            : new { like = child.BaselineLike, repost = child.BaselineRepost, reply = child.BaselineReply };
        var response = await host.PutAsync(item.Id.ToString(), new
        {
            kind = item.Kind,
            title = item.Title,
            notes = item.Notes,
            plannedMinute = item.PlannedMinute,
            assigneeId = item.AssigneeId?.ToString(),
            version = item.Version,
            posts = new[]
            {
                new { id = child.Id.ToString(), personaId = child.PersonaId.ToString(), text = child.Text, media, engagementBaseline = baseline ?? keptBaseline },
            },
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    private static async Task<Guid> AddPersonaAsync(InjectTestHost host, Guid exerciseId, string handle, string displayName)
    {
        var id = Guid.NewGuid();
        await using var db = host.Db(exerciseId);
        db.Personas.Add(new Persona { Id = id, ExerciseId = exerciseId, DisplayName = displayName, Handle = handle, Kind = "citizen" });
        await db.SaveChangesAsync();
        return id;
    }

    private static async Task<Guid> AddMediaAsync(InjectTestHost host, Guid exerciseId, string fileName, string kind)
    {
        var id = await host.AddMediaAssetAsync(exerciseId, kind);
        await using var db = host.Db(exerciseId);
        (await db.MediaAssets.SingleAsync(asset => asset.Id == id)).OriginalFileName = fileName;
        await db.SaveChangesAsync();
        return id;
    }

    // ---- reads ----

    private static async Task<InjectItemPost> ChildAsync(PulseDbContext db, string externalRef)
    {
        var item = await db.InjectItems.SingleAsync(row => row.ExternalRef == externalRef);
        return await db.InjectItemPosts.SingleAsync(post => post.InjectItemId == item.Id && post.DeletedAt == null);
    }

    private static async Task<JsonDocument> GetQueueJsonAsync(InjectTestHost host)
    {
        var response = await host.Client.GetAsync(new Uri("/api/injects", UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }

    private static async Task<List<string>> TitlesAsync(InjectTestHost host) =>
        (await host.GetQueueAsync()).Items.Select(item => item.Title).ToList();

    private static async Task<List<string>> VersionsAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return (await db.InjectItems.ToListAsync()).Select(item => $"{item.Id}:{item.Version}").ToList();
    }

    private static async Task<(int Token, int Actions)> TokenAndActionCountAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        return (
            (await db.InjectQueueStates.SingleAsync()).Version,
            await db.TelemetryEvents.CountAsync(e => e.EventType == "inject_action"));
    }

    /// <summary>Items (id, version, order, stamp, minute), children (text, media + alt, baseline) and the queue token.</summary>
    private static async Task<string> SnapshotAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        var items = (await db.InjectItems.OrderBy(i => i.Order).ToListAsync())
            .Select(i => $"{i.Id}:{i.Version}:{i.Order}:{i.UpdatedAt:O}:{i.PlannedMinute}");
        var posts = (await db.InjectItemPosts.OrderBy(p => p.Id).ToListAsync())
            .Select(p => $"{p.Id}:{p.Text}:{string.Join(",", p.Media.Select(m => $"{m.MediaId}={m.Alt}"))}:"
                + $"{p.BaselineLike}/{p.BaselineRepost}/{p.BaselineReply}:{p.DeletedAt:O}");
        var token = await db.InjectQueueStates.Select(s => (int?)s.Version).SingleOrDefaultAsync();
        return string.Join("|", items) + "#" + string.Join("|", posts) + "#" + token;
    }

    private static (int? Like, int? Repost, int? Reply) Baseline(JsonElement post)
    {
        if (!post.TryGetProperty("engagementBaseline", out var baseline) || baseline.ValueKind == JsonValueKind.Null)
        {
            return (null, null, null);
        }

        static int? Read(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetInt32() : null;

        return (Read(baseline, "like"), Read(baseline, "repost"), Read(baseline, "reply"));
    }

    private static ByteArrayContent Bytes(byte[] file)
    {
        var content = new ByteArrayContent(file);
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(XlsxType);
        return content;
    }

    private sealed record Seed(Guid ExerciseId, Guid StaffUserId, Guid Fire, Guid Scoop, Guid Card, Guid Map, Guid Video);
}
