namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// <c>GET /api/staff/exports/posts.xlsx</c> end to end over real SQL (demo-feedback story 02): the staff gate per role,
/// the content headers, the rows (replies, taken-down posts, author types, posted by, inject, counts, media, order),
/// exercise isolation A/B, telemetry and the row limit. Each workbook is read back with ClosedXML.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class PostExportEndpointTests
{
    private readonly PostExportSeed _seed;

    public PostExportEndpointTests(MsSqlContainerFixture fixture) => _seed = new PostExportSeed(fixture);

    // ---- Gate (AC 1, two worlds) -------------------------------------------------------------------------------

    [Fact]
    public void Route_IsInTheStaffWorld() =>
        PostExportEndpoints.ExportRoute.Should().StartWith("/api/staff/", "the export is staff-only (two worlds)");

    [RequiresDockerFact]
    public async Task Anonymous_Returns401_WithNoStore()
    {
        var exerciseId = await _seed.ExerciseAsync();
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetExportAsync(bearerToken: null);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        response.Headers.CacheControl!.NoStore.Should().BeTrue("refusals carry no-store too");
    }

    [RequiresDockerFact]
    public async Task ParticipantSession_Returns401_ItIsNotAStaffSession()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var token = await _seed.NonStaffSessionAsync(exerciseId, "participant");
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant never reaches a staff route");
        (await _seed.TelemetryAsync(exerciseId)).Should().BeEmpty("a refused call records no download");
    }

    [RequiresDockerFact]
    public async Task ReadOnlySession_Returns401_ItIsNotAStaffSession()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var token = await _seed.NonStaffSessionAsync(exerciseId, "readonly");
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [RequiresDockerFact]
    public async Task StaffNotAssignedToTheExercise_Returns403()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var otherExerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(otherExerciseId, "controller")]);
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
    }

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, currentExerciseId: null);

        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed");
    }

    [RequiresDockerTheory]
    [InlineData("controller")]
    [InlineData("evaluator")]
    [InlineData("planner")]
    public async Task AnyAssignedStaffRole_Gets200_WithTheXlsxHeaders(string role)
    {
        var exerciseId = await _seed.ExerciseAsync(name: "Kestrel Flood 2033");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, role)]);
        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "any assigned staff role may export, evaluators included (DF-8)");
        response.Content.Headers.ContentType!.MediaType.Should().Be(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.Headers.CacheControl!.NoStore.Should().BeTrue();

        var disposition = response.Content.Headers.ContentDisposition!.ToString();
        disposition.Should().MatchRegex(
            "^attachment; filename=\"pulse-posts-kestrel-flood-2033-\\d{8}-\\d{4}\\.xlsx\"$");

        var bytes = await response.Content.ReadAsByteArrayAsync();
        ExportWorkbookReader.Rows(bytes).Should().BeEmpty("the exercise has no posts yet");
    }

    // ---- Rows (AC 3-6) -------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task EveryPostAndReply_IncludingTakenDown_OneRowEach_OldestFirst_WithResolvedColumns()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, staffUserId) = await _seed.StaffAsync(exerciseId, [(exerciseId, "evaluator")], displayName: "Casey Controller");

        var cityFire = await _seed.PersonaAsync(exerciseId, "cityfire", "City Fire Dept");
        var resident = await _seed.PersonaAsync(exerciseId, "resident_ann", "Ann Resident");
        var accountId = await _seed.AccountAsync(exerciseId, "Pat Player");
        var injectId = await _seed.InjectItemAsync(exerciseId, "Bridge closure");

        var root = await _seed.PostAsync(exerciseId, cityFire, minute: 0, p =>
        {
            p.Origin = "controller-as-persona";
            p.ActingHumanId = staffUserId.ToString();
            p.BaselineLikeCount = 40;
            p.BaselineRepostCount = 5;
            p.BaselineReplyCount = 2;
        });

        // The reply is seeded before posts with earlier scenario times: the export sorts, not the insert order.
        var reply = await _seed.PostAsync(exerciseId, resident, minute: 10, p =>
        {
            p.Origin = "participant";
            p.ActingHumanId = accountId.ToString();
            p.Body = "=1+1 is this real?";
            p.ParentPostId = root;
        });

        var injectPost = await _seed.PostAsync(exerciseId, cityFire, minute: 5, p =>
        {
            p.Origin = "inject";
            p.ActingHumanId = staffUserId.ToString();
            p.InjectId = injectId.ToString();
        });
        var enginePost = await _seed.PostAsync(exerciseId, resident, minute: 5, p =>
        {
            p.Origin = "engine";
            p.ActingHumanId = staffUserId.ToString(); // ignored: engine posts have no acting human
            p.CreatedWallClock = PostExportSeed.WallStart.AddMinutes(6); // same scenario minute, later wall clock
        });
        var noisePost = await _seed.PostAsync(exerciseId, resident, minute: 20, p => p.Origin = "noise");
        var takenDown = await _seed.PostAsync(exerciseId, cityFire, minute: 30, p =>
        {
            p.DeletedAt = PostExportSeed.ScenarioStart.AddMinutes(45);
            p.ActingHumanId = "someone-from-nowhere";
        });

        await _seed.ReactionAsync(exerciseId, root, ReactionKinds.Like);
        await _seed.ReactionAsync(exerciseId, root, ReactionKinds.Like);
        await _seed.ReactionAsync(exerciseId, root, ReactionKinds.Like, deleted: true);
        await _seed.ReactionAsync(exerciseId, root, ReactionKinds.Repost);
        await _seed.ReactionAsync(exerciseId, root, "pin");
        await _seed.ReactionAsync(exerciseId, root, "pin");
        await _seed.MediaAsync(exerciseId, root, MediaKinds.Image, 0);
        await _seed.MediaAsync(exerciseId, root, MediaKinds.Image, 1);
        await _seed.MediaAsync(exerciseId, injectPost, MediaKinds.Video, 0);

        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetExportAsync(token);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var rows = ExportWorkbookReader.Rows(await response.Content.ReadAsByteArrayAsync());

        rows.Select(r => r["Post id"]).Should().Equal(
            new[] { root, injectPost, enginePost, reply, noisePost, takenDown }.Select(id => id.ToString()),
            "one row per post and reply, taken-down included, oldest scenario time first, ties by wall clock");

        var rootRow = rows[0];
        rootRow["Scenario time"].Should().Be("2033-09-04 08:00", "scenario time is shown in the exercise's zone (CDT)");
        rootRow["Author handle"].Should().Be("@cityfire");
        rootRow["Author name"].Should().Be("City Fire Dept");
        rootRow["Author type"].Should().Be("Controller as persona");
        rootRow["Posted by"].Should().Be("Casey Controller", "the acting staff human, resolved inside the exercise");
        rootRow["Inject #"].Should().BeEmpty();
        rootRow["Reply to"].Should().BeEmpty();
        rootRow["Media"].Should().Be("2 images");
        rootRow["Likes"].Should().Be("2", "only ACTIVE like reactions count; pin reactions never count");
        rootRow["Reposts"].Should().Be("1");
        rootRow["Replies"].Should().Be("1");
        rootRow["Shown likes"].Should().Be("42", "baseline + real, as participants saw it");
        rootRow["Shown reposts"].Should().Be("6");
        rootRow["Shown replies"].Should().Be("3");
        rootRow["Status"].Should().Be("Live");
        rootRow["Taken down at"].Should().BeEmpty();

        var injectRow = rows[1];
        injectRow["Author type"].Should().Be("Scripted inject");
        injectRow["Inject #"].Should().Be("Bridge closure", "the inject item's title until it has an external ref");
        injectRow["Media"].Should().Be("1 video");
        injectRow["Posted by"].Should().Be("Casey Controller");

        var engineRow = rows[2];
        engineRow["Author type"].Should().Be("Engine");
        engineRow["Posted by"].Should().BeEmpty("engine posts have no human behind them");

        var replyRow = rows[3];
        replyRow["Author type"].Should().Be("Participant");
        replyRow["Posted by"].Should().Be("Pat Player", "a participant's acting human is their account");
        replyRow["Reply to"].Should().Be($"@cityfire {root}");
        replyRow["Text"].Should().Be("=1+1 is this real?");

        var noiseRow = rows[4];
        noiseRow["Author type"].Should().Be("White noise");
        noiseRow["Posted by"].Should().BeEmpty();

        var takenDownRow = rows[5];
        takenDownRow["Status"].Should().Be("Taken down");
        takenDownRow["Taken down at"].Should().Be("2033-09-04 08:45");
        takenDownRow["Posted by"].Should().BeEmpty("an acting human who does not resolve in the exercise stays blank");

        using var workbook = ExportWorkbookReader.Open(await response.Content.ReadAsByteArrayAsync());
        var textCell = workbook.Worksheet("Posts").Cell(5, 10);
        textCell.HasFormula.Should().BeFalse("a participant post starting with = opens as text");
        textCell.GetString().Should().Be("=1+1 is this real?");
    }

    [RequiresDockerFact]
    public async Task MoreThanOnePage_IsWrittenCompletelyAndInOrder()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        await _seed.BulkPostsAsync(exerciseId, PostExportService.PageSize + 7);

        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var rows = ExportWorkbookReader.Rows(await response.Content.ReadAsByteArrayAsync());
        rows.Should().HaveCount(PostExportService.PageSize + 7, "every page is written");
        rows.Select(r => r["Post id"]).Should().OnlyHaveUniqueItems();
        rows.Should().OnlyContain(r => r["Author type"] == "Engine");
    }

    [RequiresDockerFact]
    public async Task MoreThanFiftyThousandPosts_Returns413_WithAReadableReason_AndNoTelemetry()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        await _seed.BulkPostsAsync(exerciseId, PostExportService.MaxRows + 1);

        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetExportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadAsStringAsync()).Should().Contain("more than 50,000 posts");
        (await _seed.TelemetryAsync(exerciseId)).Should().BeEmpty("nothing was downloaded");
    }

    // ---- Isolation (XC-001) --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ExportFromA_ContainsNoRowPersonaStaffNameOrInjectFromB()
    {
        var exerciseA = await _seed.ExerciseAsync();
        var exerciseB = await _seed.ExerciseAsync();

        // One staff human assigned to BOTH exercises; another assigned to B only, whose id A's post claims.
        var (tokenA, staffBoth) = await _seed.StaffAsync(exerciseA, [(exerciseA, "controller"), (exerciseB, "controller")], "Both Exercises");
        var (_, staffBOnly) = await _seed.StaffAsync(exerciseB, [(exerciseB, "controller")], "Bea From B");

        var personaA = await _seed.PersonaAsync(exerciseA, "alpha", "Alpha Persona");
        var personaB = await _seed.PersonaAsync(exerciseB, "bravo_secret", "Bravo Secret Persona");
        var injectB = await _seed.InjectItemAsync(exerciseB, "B secret inject");
        var accountB = await _seed.AccountAsync(exerciseB, "Bravo Player");

        var postA = await _seed.PostAsync(exerciseA, personaA, 0, p => p.ActingHumanId = staffBoth.ToString());

        // A's posts that point at B's people, persona and inject (a buggy write): none of B's names may leak.
        var leakyA = await _seed.PostAsync(exerciseA, personaB, 1, p =>
        {
            p.Origin = "inject";
            p.ActingHumanId = staffBOnly.ToString();
            p.InjectId = injectB.ToString();
            p.ParentPostId = null;
        });
        var participantLeak = await _seed.PostAsync(exerciseA, personaA, 2, p =>
        {
            p.Origin = "participant";
            p.ActingHumanId = accountB.ToString();
        });

        var postB = await _seed.PostAsync(exerciseB, personaB, 0, p => p.Body = "B-only body");
        await _seed.ReactionAsync(exerciseB, postA, ReactionKinds.Like); // a stray B reaction on A's post

        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseA);
        using var response = await host.GetExportAsync(tokenA);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var rows = ExportWorkbookReader.Rows(await response.Content.ReadAsByteArrayAsync());

        rows.Select(r => r["Post id"]).Should().BeEquivalentTo(
            new[] { postA, leakyA, participantLeak }.Select(id => id.ToString()),
            "only exercise A's posts are exported");
        rows.Should().NotContain(r => r["Post id"] == postB.ToString());

        var allText = string.Join("|", rows.SelectMany(r => r.Values));
        allText.Should().NotContain("bravo_secret").And.NotContain("Bravo Secret Persona")
            .And.NotContain("Bea From B").And.NotContain("B secret inject").And.NotContain("Bravo Player")
            .And.NotContain("B-only body");

        rows.Single(r => r["Post id"] == postA.ToString())["Posted by"].Should().Be("Both Exercises");
        rows.Single(r => r["Post id"] == postA.ToString())["Likes"].Should().Be("0", "B's stray reaction never counts in A");
        var leakyRow = rows.Single(r => r["Post id"] == leakyA.ToString());
        leakyRow["Author handle"].Should().BeEmpty();
        leakyRow["Posted by"].Should().BeEmpty();
        leakyRow["Inject #"].Should().BeEmpty();
        rows.Single(r => r["Post id"] == participantLeak.ToString())["Posted by"].Should().BeEmpty();

        (await _seed.TelemetryAsync(exerciseB)).Should().BeEmpty("A's download is recorded in A only");
    }

    // ---- Telemetry (XC-004) --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task OneDownloadedEvent_PerDownload_StaffActor_RowsOnly()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, staffUserId) = await _seed.StaffAsync(exerciseId, [(exerciseId, "evaluator")]);
        var persona = await _seed.PersonaAsync(exerciseId, "cityfire", "City Fire Dept");
        await _seed.PostAsync(exerciseId, persona, 0, p => p.Body = "secret body text");
        await _seed.PostAsync(exerciseId, persona, 1);

        await using var host = await PostExportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using (var first = await host.GetExportAsync(token))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var events = await _seed.TelemetryAsync(exerciseId);
        var downloaded = events.Should().ContainSingle(e => e.EventType == "export.posts.downloaded").Subject;
        downloaded.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        downloaded.Actor.Role.Should().Be("evaluator");
        downloaded.Actor.SessionId.Should().NotBeNullOrEmpty();
        downloaded.TimeZone.Should().Be("America/Chicago");
        downloaded.Target!.EntityId.Should().Be(exerciseId.ToString());

        using var payload = JsonDocument.Parse(downloaded.Payload!);
        payload.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(["rows"], "counts only: no text, no names");
        payload.RootElement.GetProperty("rows").GetInt32().Should().Be(2);
        downloaded.Payload.Should().NotContain("secret").And.NotContain("City Fire");

        using (var second = await host.GetExportAsync(token))
        {
            second.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        (await _seed.TelemetryAsync(exerciseId)).Count(e => e.EventType == "export.posts.downloaded")
            .Should().Be(2, "one event per download");
    }
}
