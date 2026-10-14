namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects;
using Pulse.WebApi.Features.Injects.Import;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// demo-feedback/03 end to end — <c>POST /api/injects/import</c> on a host wired as <c>Program.cs</c> will wire it
/// (<c>AddInjects()</c> + <c>AddInjectImport()</c>, <c>MapInjects()</c> + <c>MapInjectImport()</c>) behind the SHIPPED
/// staff and controller-role filters, against real SQL, with real Cadence-layout <c>.xlsx</c> and <c>.csv</c> files:
/// dry run writes nothing (AC-1), upload validation (AC-2), filter + mapping in file order (AC-3/4), row failures
/// (AC-5), idempotent re-import (AC-6, DF-10), one save + the queue token (AC-7), isolation (XC-001), the role gate,
/// and the one <c>injects.imported</c> event (XC-004).
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class InjectImportEndpointTests
{
    private const string XlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private readonly MsSqlContainerFixture _fixture;

    public InjectImportEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- AC-1: dry run ----

    [RequiresDockerFact]
    public async Task DryRun_ReturnsTheReport_AndWritesNothingButTheDryRunEvent()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);

        var response = await UploadAsync(host, Kestrel(seeded).Xlsx, "kestrel-msel.xlsx", XlsxType, dryRun: "true");

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        var report = (await response.Content.ReadFromJsonAsync<WireImportResult>())!;
        report.DryRun.Should().BeTrue();
        report.TotalRows.Should().Be(5);
        report.SocialRows.Should().Be(3);
        (report.CreatedCount, report.UpdatedCount, report.UnchangedCount, report.SkippedCount, report.FailedCount)
            .Should().Be((3, 0, 0, 2, 0));
        report.Rows.Select(row => row.Status).Should().Equal("skipped", "created", "skipped", "created", "created");

        await using var db = host.Db(seeded.ExerciseId);
        (await db.InjectItems.CountAsync()).Should().Be(0, "a dry run writes no item");
        (await db.InjectQueueStates.CountAsync()).Should().Be(0, "nor bumps the queue version");
        var events = await db.TelemetryEvents.ToListAsync();
        events.Should().ContainSingle("the dry-run event is the only write").Which.EventType.Should().Be("injects.imported");
        Payload(events[0]).Should().Be(new ImportedPayload(3, 0, 0, 2, 0, true));
    }

    [RequiresDockerFact]
    public async Task DryRunFalse_ReturnsTheSameReport_AndCreatesTheItems()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var file = Kestrel(seeded).Xlsx;

        var dry = await ImportOkAsync(host, file, dryRun: true);
        var real = await ImportOkAsync(host, file, dryRun: false);

        real.DryRun.Should().BeFalse();
        real.Rows.Should().BeEquivalentTo(dry.Rows, "the dry run reports exactly what the import then does");
        (await host.GetQueueAsync()).Items.Should().HaveCount(3);
    }

    [RequiresDockerFact]
    public async Task DryRunParameter_MissingRepeatedOrNotABool_Is400_AndNothingIsWritten()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var file = Kestrel(seeded).Xlsx;

        foreach (var query in new[] { string.Empty, "?dryRun=", "?dryRun=yes", "?dryRun=true&dryRun=false", "?dryrun=1" })
        {
            var response = await host.Client.PostAsync(
                new Uri(InjectImportEndpoints.ImportRoute + query, UriKind.Relative),
                Multipart(file, "kestrel.xlsx", XlsxType));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "query '{0}'", query);
            (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be(InjectImportEndpoints.DryRunMessage);
        }

        await AssertNothingWrittenAsync(host, seeded.ExerciseId);
    }

    // ---- AC-2: upload validation ----

    [RequiresDockerFact]
    public async Task UploadValidation_Refusals_Are400WithAReadableReason_AndWriteNothing()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var renamedText = Encoding.UTF8.GetBytes("Inject #,Description\n1,hello\n");
        var missingColumns = Encoding.UTF8.GetBytes("Inject #,Title,Description\n1,a,b\n");

        var cases = new (byte[] Content, string Name, string Type, string Expected)[]
        {
            (renamedText, "kestrel.xlsx", XlsxType, MselFileFormat.NotAWorkbookMessage),
            ([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], "old.xls", "application/vnd.ms-excel", MselFileFormat.NotAWorkbookMessage),
            ([0xFF, 0xD8, 0xFF, 0xE0, 0x00], "photo.csv", "text/csv", MselFileFormat.NotXlsxOrCsvMessage),
            (missingColumns, "msel.csv", "text/csv", "the header row is missing the required column(s): Delivery Method, From / Source."),
            (new byte[MselLimits.MaxFileBytes + 1], "big.csv", "text/csv", InjectImportService.TooLargeMessage),
        };

        foreach (var (content, name, type, expected) in cases)
        {
            var response = await UploadAsync(host, content, name, type, dryRun: "false");
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, name);
            (await InjectTestHost.ReadProblemAsync(response)).Detail.Should().Be(expected);
        }

        var empty = await UploadAsync(host, [], "empty.csv", "text/csv", dryRun: "false");
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await InjectTestHost.ReadProblemAsync(empty)).Detail.Should().Be(InjectImportEndpoints.NoFileMessage);

        var noFile = await host.Client.PostAsync(
            new Uri(InjectImportEndpoints.ImportRoute + "?dryRun=false", UriKind.Relative),
            new StringContent("{}", Encoding.UTF8, "application/json"));
        noFile.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await AssertNothingWrittenAsync(host, seeded.ExerciseId);
    }

    // ---- AC-3/4/7: filter, mapping, order, one save ----

    [RequiresDockerFact]
    public async Task Apply_AppendsOneSinglePostItemPerSocialRow_InFileOrder_AfterTheExistingItems()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var existing = await host.CreateOkAsync(InjectTestHost.PostItem(seeded.FirePersona));
        int queueVersionBefore;
        await using (var db = host.Db(seeded.ExerciseId))
        {
            queueVersionBefore = (await db.InjectQueueStates.SingleAsync()).Version;
        }

        var report = await ImportOkAsync(host, Kestrel(seeded).Xlsx, dryRun: false);

        report.Rows.Where(row => row.Status == "created").Select(row => row.PlannedMinute).Should().Equal(5, 20, 1470);
        var queue = await host.GetQueueAsync();
        queue.Items.Select(item => item.Title).Should().Equal(existing.Title, "Boil water notice", "Resident photo", "Day two");
        queue.Items.Select(item => item.Order).Should().Equal(1, 2, 3, 4);

        var boil = queue.Items[1];
        boil.Kind.Should().Be("post");
        boil.Status.Should().Be("pending");
        boil.PlannedMinute.Should().Be(5);
        boil.Notes.Should().Be("Beat 1");
        boil.AssigneeId.Should().Be(seeded.StaffUserId.ToString(), "Responsible Controller matched the staff display name");
        boil.Posts.Should().ContainSingle().Which.PersonaId.Should().Be(seeded.FirePersona.ToString());
        boil.Posts[0].Text.Should().Be("BOIL WATER NOTICE for #Kestrel County zones 3-5.");
        queue.Items[2].Posts[0].PersonaId.Should().Be(seeded.ResidentPersona.ToString(), "matched by display name");
        queue.Items[3].PlannedMinute.Should().Be(1470);

        await using var after = host.Db(seeded.ExerciseId);
        (await after.InjectItems.Where(item => item.ExternalRef != null).Select(item => item.ExternalRef).ToListAsync())
            .Should().BeEquivalentTo(["2", "4", "5"]);
        (await after.InjectQueueStates.SingleAsync()).Version.Should().Be(queueVersionBefore + 1, "the creates bump the queue token once");
        var imported = await after.TelemetryEvents.Where(e => e.EventType == "injects.imported").ToListAsync();
        imported.Should().ContainSingle();
        Payload(imported[0]).Should().Be(new ImportedPayload(3, 0, 0, 2, 0, false));
        imported[0].Actor!.ActingHumanId.Should().Be(seeded.StaffUserId.ToString());
        (await after.TelemetryEvents.CountAsync(e => e.EventType == "inject_action"))
            .Should().Be(1, "only the console create emits an item action; the import emits its one event");
    }

    [RequiresDockerFact]
    public async Task Apply_TheCsvExport_ImportsExactlyLikeTheXlsx()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var files = Kestrel(seeded);

        var fromXlsx = await ImportOkAsync(host, files.Xlsx, dryRun: true);
        var fromCsv = await ImportOkAsync(host, files.Csv, dryRun: true, name: "kestrel.csv", type: "text/csv");

        fromCsv.Should().BeEquivalentTo(fromXlsx);
    }

    // ---- AC-5: row failures ----

    [RequiresDockerFact]
    public async Task RowFailures_AreReported_AndTheOtherRowsStillApply()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var photo = await AddMediaAsync(host, seeded.ExerciseId, "brown-water.jpg", MediaKinds.Image);
        var rows = new List<MselRowSpec>
        {
            new(10, "Good", "With a photo", "08:00", "1", "08:00", "@KestrelFire", "Public", "Social Media", PulseMedia: "brown-water.jpg"),
            new(11, "Unknown persona", "x", "08:01", "1", "08:01", "@Nobody", "Public", "Social Media"),
            new(12, "Unknown media", "x", "08:02", "1", "08:02", "@KestrelFire", "Public", "Social Media", PulseMedia: "missing.png"),
            new(13, "Too long", new string('w', 281), "08:03", "1", "08:03", "@KestrelFire", "Public", "Social Media"),
            new(10, "Duplicate", "x", "08:04", "1", "08:04", "@KestrelFire", "Public", "Social Media"),
            new(14, "Unknown controller", "fine", "08:05", "1", "08:05", "@KestrelFire", "Public", "Social Media", Controller: "Pat Nobody"),
        };

        var report = await ImportOkAsync(host, MselFixture.Xlsx(rows, pulseMedia: true), dryRun: false);

        report.Rows.Select(row => row.Status).Should().Equal("created", "failed", "failed", "failed", "failed", "created");
        report.Rows[1].Message.Should().StartWith("unknown persona 'Nobody'");
        report.Rows[2].Message.Should().StartWith("unknown Pulse Media file 'missing.png'");
        report.Rows[3].Message.Should().Be("Description is 281 characters after cleaning; a post is at most 280.");
        report.Rows[4].Message.Should().Be("duplicate of row 2");
        report.Rows[5].Message.Should().Be("Responsible Controller 'Pat Nobody' is not a staff member of this exercise; left unassigned.");

        var queue = await host.GetQueueAsync();
        queue.Items.Select(item => item.Title).Should().Equal("Good", "Unknown controller");
        queue.Items[1].AssigneeId.Should().BeNull();
        await using var db = host.Db(seeded.ExerciseId);
        var good = await db.InjectItemPosts.SingleAsync(post => post.Text == "With a photo");
        good.Media.Should().ContainSingle().Which.MediaId.Should().Be(photo.ToString());
    }

    // ---- AC-6: idempotent re-import (DF-10) ----

    [RequiresDockerFact]
    public async Task ReImportingTheSameFile_IsAllUnchanged_AndWritesNothing()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var file = Kestrel(seeded).Xlsx;
        await ImportOkAsync(host, file, dryRun: false);
        var before = await SnapshotAsync(host, seeded.ExerciseId);

        var again = await ImportOkAsync(host, file, dryRun: false);

        again.Rows.Where(row => row.Status != "skipped").Should().OnlyContain(row => row.Status == "unchanged" && row.Message == null);
        (again.CreatedCount, again.UpdatedCount, again.UnchangedCount).Should().Be((0, 0, 3));
        (await SnapshotAsync(host, seeded.ExerciseId)).Should().Be(before, "no item, version or queue token changed");
    }

    [RequiresDockerFact]
    public async Task AChangedPendingRow_IsUpdated_WithTheVersionBumped_AndSaysWhatChanged()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        await ImportOkAsync(host, Kestrel(seeded).Xlsx, dryRun: false);
        var rows = KestrelRows(seeded);
        rows[1] = rows[1] with { Title = "Boil water notice (rev 2)", Description = "BOIL WATER NOTICE: zones 3-6." };

        var report = await ImportOkAsync(host, MselFixture.Xlsx(rows), dryRun: false);

        var row = report.Rows[1];
        row.Status.Should().Be("updated");
        row.Message.Should().Be("changed: title, text");
        (report.UpdatedCount, report.UnchangedCount).Should().Be((1, 2));

        await using var db = host.Db(seeded.ExerciseId);
        var item = await db.InjectItems.Include(i => i.Posts).SingleAsync(i => i.ExternalRef == "2");
        item.Version.Should().Be(2);
        item.Title.Should().Be("Boil water notice (rev 2)");
        item.Posts.Where(p => p.DeletedAt == null).Should().ContainSingle().Which.Text.Should().Be("BOIL WATER NOTICE: zones 3-6.");
        (await db.InjectItems.CountAsync()).Should().Be(3, "an update never duplicates");
    }

    [RequiresDockerFact]
    public async Task AChangedRowWhoseItemAlreadyFired_IsLeftAlone()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        await ImportOkAsync(host, Kestrel(seeded).Xlsx, dryRun: false);
        Guid boilId;
        await using (var db = host.Db(seeded.ExerciseId))
        {
            boilId = (await db.InjectItems.SingleAsync(i => i.ExternalRef == "2")).Id;
        }

        var fired = await host.ActionOkAsync(boilId, "fire");
        fired.Status.Should().Be("fired");
        var rows = KestrelRows(seeded);
        rows[1] = rows[1] with { Description = "Rewritten after it went out." };

        var report = await ImportOkAsync(host, MselFixture.Xlsx(rows), dryRun: false);

        report.Rows[1].Status.Should().Be("unchanged");
        report.Rows[1].Message.Should().Be("already fired; not changed");
        await using var after = host.Db(seeded.ExerciseId);
        var item = await after.InjectItems.Include(i => i.Posts).SingleAsync(i => i.Id == boilId);
        item.Version.Should().Be(fired.Version);
        item.Posts.Single(p => p.DeletedAt == null).Text.Should().Be("BOIL WATER NOTICE for #Kestrel County zones 3-5.");
    }

    [RequiresDockerFact]
    public async Task ADeletedItemsInjectNumber_CanBeImportedAgain()
    {
        await using var host = await StartAsync();
        var seeded = await SeedKestrelAsync(host);
        var file = Kestrel(seeded).Xlsx;
        await ImportOkAsync(host, file, dryRun: false);
        var boil = (await host.GetQueueAsync()).Items.Single(item => item.Title == "Boil water notice");
        (await host.DeleteAsync(boil.Id, boil.Version)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var report = await ImportOkAsync(host, file, dryRun: false);

        report.Rows[1].Status.Should().Be("created", "the filtered unique index frees a deleted item's ExternalRef");
        (await host.GetQueueAsync()).Items.Select(item => item.Title).Should().Equal("Resident photo", "Day two", "Boil water notice");
    }

    // ---- XC-001: isolation ----

    [RequiresDockerFact]
    public async Task Isolation_PersonasAndMediaResolveOnlyInTheCallersExercise_AndItemsAreStampedFromScope()
    {
        await using var host = await StartAsync();
        var a = await SeedKestrelAsync(host);
        await AddMediaAsync(host, a.ExerciseId, "only-in-a.jpg", MediaKinds.Image);
        var b = await host.SeedExerciseAsync(personas: 0);
        await AddPersonaAsync(host, b.ExerciseId, "BCountyEM", "B County EM");
        host.ActAs(b.ExerciseId, b.StaffUserId);
        var rows = new List<MselRowSpec>
        {
            new(1, "A's handle", "x", "08:00", "1", "08:00", "@KestrelFire", "Public", "Social Media"),
            new(2, "Unknown handle", "x", "08:01", "1", "08:01", "@NeverExisted", "Public", "Social Media"),
            new(3, "A's media", "x", "08:02", "1", "08:02", "@BCountyEM", "Public", "Social Media", PulseMedia: "only-in-a.jpg"),
            new(4, "B's own", "x", "08:03", "1", "08:03", "@BCountyEM", "Public", "Social Media"),
        };

        var report = await ImportOkAsync(host, MselFixture.Xlsx(rows, pulseMedia: true), dryRun: false);

        report.Rows.Select(row => row.Status).Should().Equal("failed", "failed", "failed", "created");
        report.Rows[0].Message!.Replace("KestrelFire", "X", StringComparison.Ordinal)
            .Should().Be(report.Rows[1].Message!.Replace("NeverExisted", "X", StringComparison.Ordinal),
                "a handle that exists only in exercise A fails exactly like an unknown handle (COR-001)");
        report.Rows[2].Message.Should().StartWith("unknown Pulse Media file 'only-in-a.jpg'");

        await using (var bDb = host.Db(b.ExerciseId))
        {
            (await bDb.InjectItems.SingleAsync()).ExerciseId.Should().Be(b.ExerciseId, "stamped from IExerciseContext");
        }

        await using var aDb = host.Db(a.ExerciseId);
        (await aDb.InjectItems.CountAsync()).Should().Be(0, "exercise A's run sheet is untouched");
        (await aDb.TelemetryEvents.CountAsync()).Should().Be(0);
    }

    // ---- authorization ----

    [RequiresDockerFact]
    public async Task OnlyAController_MayImport_EvaluatorAndPlannerAre403_AndAnUnassignedStaffIs403()
    {
        await using var host = await StartAsync();
        var controller = await SeedKestrelAsync(host);
        var file = Kestrel(controller).Xlsx;

        foreach (var role in new[] { "evaluator", "planner" })
        {
            var staff = await host.AddStaffAsync(controller.ExerciseId, role, $"A {role}");
            host.ActAs(controller.ExerciseId, staff);
            (await UploadAsync(host, file, "k.xlsx", XlsxType, "false")).StatusCode.Should().Be(HttpStatusCode.Forbidden, role);
        }

        var other = await host.SeedExerciseAsync();
        host.ActAs(controller.ExerciseId, other.StaffUserId);
        (await UploadAsync(host, file, "k.xlsx", XlsxType, "false")).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        host.ActAs(controller.ExerciseId, staffUserId: null);
        (await UploadAsync(host, file, "k.xlsx", XlsxType, "false")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        await AssertNothingWrittenAsync(host, controller.ExerciseId);
    }

    // ---- helpers ----

    private async Task<InjectTestHost> StartAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull();
        return await InjectTestHost.StartAsync(
            _fixture.ConnectionString!,
            configureServices: services => services.AddInjectImport(),
            mapEndpoints: endpoints => endpoints.MapInjectImport());
    }

    private static async Task<KestrelSeed> SeedKestrelAsync(InjectTestHost host)
    {
        var seeded = await host.SeedExerciseAsync(personas: 0);
        var fire = await AddPersonaAsync(host, seeded.ExerciseId, "KestrelFire", "Kestrel County Fire");
        var resident = await AddPersonaAsync(host, seeded.ExerciseId, "@river_rae", "Rae on the River");
        host.ActAs(seeded.ExerciseId, seeded.StaffUserId);
        return new KestrelSeed(seeded.ExerciseId, seeded.StaffUserId, fire, resident);
    }

    private static List<MselRowSpec> KestrelRows(KestrelSeed seeded) =>
        MselFixture.KestrelRows("KestrelFire", "river_rae", "Rae on the River", "Casey Controller");

    private static (byte[] Xlsx, byte[] Csv) Kestrel(KestrelSeed seeded)
    {
        var rows = KestrelRows(seeded);
        return (MselFixture.Xlsx(rows, conduct: true), MselFixture.Csv(rows, conduct: true));
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

    private static MultipartFormDataContent Multipart(byte[] content, string fileName, string contentType)
    {
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        return new MultipartFormDataContent { { file, "file", fileName } };
    }

    private static Task<HttpResponseMessage> UploadAsync(InjectTestHost host, byte[] content, string fileName, string contentType, string dryRun) =>
        host.Client.PostAsync(
            new Uri($"{InjectImportEndpoints.ImportRoute}?dryRun={dryRun}", UriKind.Relative),
            Multipart(content, fileName, contentType));

    private static async Task<WireImportResult> ImportOkAsync(
        InjectTestHost host,
        byte[] content,
        bool dryRun,
        string name = "kestrel-msel.xlsx",
        string type = XlsxType)
    {
        host.Time.Advance(TimeSpan.FromMilliseconds(10));
        var response = await UploadAsync(host, content, name, type, dryRun ? "true" : "false");
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return (await response.Content.ReadFromJsonAsync<WireImportResult>())!;
    }

    private static async Task AssertNothingWrittenAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        (await db.InjectItems.CountAsync()).Should().Be(0);
        (await db.InjectQueueStates.CountAsync()).Should().Be(0);
        (await db.TelemetryEvents.CountAsync(e => e.EventType == "injects.imported")).Should().Be(0);
    }

    private static async Task<string> SnapshotAsync(InjectTestHost host, Guid exerciseId)
    {
        await using var db = host.Db(exerciseId);
        var items = (await db.InjectItems.OrderBy(i => i.Order).ToListAsync())
            .Select(i => $"{i.Id}:{i.Version}:{i.Order}:{i.UpdatedAt:O}");
        var posts = (await db.InjectItemPosts.OrderBy(p => p.Id).ToListAsync())
            .Select(p => $"{p.Id}:{p.Text}:{p.DeletedAt:O}");
        var token = await db.InjectQueueStates.Select(s => s.Version).SingleAsync();
        return string.Join("|", items) + "#" + string.Join("|", posts) + "#" + token;
    }

    private static ImportedPayload Payload(TelemetryEvent telemetry) =>
        JsonSerializer.Deserialize<ImportedPayload>(telemetry.Payload!, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    private sealed record ImportedPayload(int Created, int Updated, int Unchanged, int Skipped, int Failed, bool DryRun);

    private sealed record KestrelSeed(Guid ExerciseId, Guid StaffUserId, Guid FirePersona, Guid ResidentPersona);

    private sealed record WireImportResult(
        bool DryRun,
        int TotalRows,
        int SocialRows,
        int CreatedCount,
        int UpdatedCount,
        int UnchangedCount,
        int SkippedCount,
        int FailedCount,
        List<WireImportRow> Rows);

    private sealed record WireImportRow(
        int RowNumber,
        string? InjectNumber,
        string? Title,
        string? PersonaHandle,
        int? PlannedMinute,
        string Status,
        string? Message);
}
