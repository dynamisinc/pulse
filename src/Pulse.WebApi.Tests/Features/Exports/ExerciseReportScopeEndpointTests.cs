namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// <c>GET /api/staff/exports/report</c> over real SQL for demo-feedback story 31: the time window scopes every section
/// (DF-45) while the sources stay record-only, inject delivery and response around the window, the MSEL-only
/// <c>ref</c>, <c>exercise.latestDay</c> and <c>exercise.spansMultipleDays</c>, and threading of the listed record
/// (DF-47). <see cref="PostExportSeed.ScenarioStart"/> is 13:00 UTC, 08:00 CDT.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseReportScopeEndpointTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;
    private readonly PostExportSeed _seed;
    private readonly ExerciseReportSeed _report;

    public ExerciseReportScopeEndpointTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _seed = new PostExportSeed(fixture);
        _report = new ExerciseReportSeed(fixture);
    }

    // ---- DF-45: the window scopes every section ------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task TimeWindow_ScopesEverySection_HeaderSummaryChartInjectsLookalikesAndNoise()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var cityFire = await _report.PersonaAsync(exerciseId, "cityfire", "City Fire", verified: true);
        var alerts = await _report.PersonaAsync(exerciseId, "CityFire_Alerts", "City Fire Alerts");
        var police = await _report.PersonaAsync(exerciseId, "police", "Police", verified: true);
        var policeTips = await _report.PersonaAsync(exerciseId, "police_tips", "Police Tips");
        var resident = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var early = await _report.InjectAsync(exerciseId, "Early advisory", externalRef: "INJ-001", firedMinute: 0);
        var bridge = await _report.InjectAsync(exerciseId, "Bridge closure", firedMinute: 75);

        // Outside the window (08:30 .. 09:30 CDT): the day before, 08:00 .. 08:12, and 09:35 onwards.
        await _seed.PostAsync(exerciseId, resident, -1440, p => p.Origin = "participant");
        var earlyPost = await _seed.PostAsync(exerciseId, cityFire, 0, p =>
        {
            p.Origin = "inject";
            p.InjectId = early.ToString();
            p.BaselineLikeCount = 100;
        });
        await _seed.ReactionAsync(exerciseId, earlyPost, ReactionKinds.Like);
        await _seed.PostAsync(exerciseId, resident, 5, p => { p.Origin = "participant"; p.ParentPostId = earlyPost; });
        await _seed.PostAsync(exerciseId, police, 10, p => p.Origin = "engine");
        await _seed.PostAsync(exerciseId, policeTips, 12, p => p.Origin = "engine");
        await _seed.PostAsync(exerciseId, resident, 95, p => { p.Origin = "participant"; p.Body = "@cityfire which bridge?"; });
        await _seed.PostAsync(exerciseId, resident, 100, p => p.Origin = "noise");
        await _seed.PostAsync(exerciseId, resident, 120, p => p.Origin = "participant");

        // Inside the window.
        await _seed.PostAsync(exerciseId, resident, 30, p => p.Origin = "participant");
        await _seed.PostAsync(exerciseId, alerts, 40, p => { p.Origin = "controller-as-persona"; p.BaselineLikeCount = 10; });
        await _seed.PostAsync(exerciseId, resident, 45, p => p.Origin = "noise");
        await _seed.PostAsync(exerciseId, resident, 50, p =>
        {
            p.Origin = "engine";
            p.DeletedAt = PostExportSeed.ScenarioStart.AddMinutes(55);
        });
        await _seed.PostAsync(exerciseId, resident, 70, p =>
        {
            p.Origin = "participant";
            p.EditCount = 1;
            p.LastEditedScenarioTime = PostExportSeed.ScenarioStart.AddMinutes(72);
        });
        await _seed.PostAsync(exerciseId, cityFire, 75, p =>
        {
            p.Origin = "inject";
            p.InjectId = bridge.ToString();
            p.BaselineLikeCount = 7;
        });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, "?from=2033-09-04%2008:30&to=2033-09-04%2009:30");
        var root = json.RootElement;

        var exercise = root.GetProperty("exercise");
        exercise.GetProperty("scenarioStart").GetString().Should().Be("2033-09-04 08:30", "the header shows the window's posts");
        exercise.GetProperty("scenarioEnd").GetString().Should().Be("2033-09-04 09:15");
        exercise.GetProperty("conductedDate").GetString().Should().Be("2033-09-04", "the day-before post is outside the window");
        exercise.GetProperty("spansMultipleDays").GetBoolean().Should().BeFalse("every in-window time is on 2033-09-04");

        var summary = root.GetProperty("summary");
        summary.GetProperty("posts").GetInt32().Should().Be(6);
        summary.GetProperty("replies").GetInt32().Should().Be(0, "the only reply is at 08:05");
        summary.GetProperty("injectsDelivered").GetInt32().Should().Be(1, "INJ-001's first post is before the window");
        summary.GetProperty("medianResponseMinutes").GetDouble().Should().Be(20);
        summary.GetProperty("postsEdited").GetInt32().Should().Be(1);
        summary.GetProperty("postsTakenDown").GetInt32().Should().Be(1);
        summary.GetProperty("busiestWindow").GetProperty("start").GetString().Should().Be("2033-09-04 08:30");
        summary.GetProperty("busiestWindow").GetProperty("posts").GetInt32().Should().Be(1);
        var bySource = summary.GetProperty("bySource");
        bySource.GetProperty("participant").GetInt32().Should().Be(3);
        bySource.GetProperty("scripted").GetInt32().Should().Be(1);
        bySource.GetProperty("engine").GetInt32().Should().Be(1);
        bySource.GetProperty("noise").GetInt32().Should().Be(1, "noise in the window still counts (DF-41)");

        var activity = root.GetProperty("activity");
        activity.GetProperty("binMinutes").GetInt32().Should().Be(5, "the chart spans 45 minutes, not a day and a half");
        var bins = activity.GetProperty("bins").EnumerateArray().ToArray();
        bins.Should().HaveCount(10, "08:30 .. 09:15");
        bins[0].GetProperty("start").GetString().Should().Be("2033-09-04 08:30");
        bins.Sum(b => b.GetProperty("participant").GetInt32() + b.GetProperty("scripted").GetInt32()
            + b.GetProperty("engine").GetInt32() + b.GetProperty("noise").GetInt32()).Should().Be(6);
        var marker = activity.GetProperty("injectMarkers").EnumerateArray().Should().ContainSingle().Subject;
        marker.GetProperty("title").GetString().Should().Be("Bridge closure");
        marker.GetProperty("ref").ValueKind.Should().Be(JsonValueKind.Null);
        marker.GetProperty("binIndex").GetInt32().Should().Be(9);

        var response = root.GetProperty("injectResponses").EnumerateArray().Should().ContainSingle().Subject;
        response.GetProperty("title").GetString().Should().Be("Bridge closure");
        response.GetProperty("deliveredAt").GetString().Should().Be("2033-09-04 09:15");
        response.GetProperty("firstResponseAt").GetString().Should().Be("2033-09-04 09:35", "found past the window's end");

        var pair = root.GetProperty("lookalikes").EnumerateArray().Should().ContainSingle("police_tips posted only outside the window").Subject;
        pair.GetProperty("verified").GetProperty("handle").GetString().Should().Be("@cityfire");
        pair.GetProperty("verified").GetProperty("likes").GetInt64().Should().Be(7, "the 08:00 post's 101 likes are outside the window");
        pair.GetProperty("lookalike").GetProperty("likes").GetInt64().Should().Be(10);

        root.GetProperty("omittedNoiseCount").GetInt32().Should().Be(1, "only the in-window noise post");
        root.GetProperty("posts").GetArrayLength().Should().Be(5);
        root.GetProperty("postRecord").GetProperty("matching").GetInt32().Should().Be(5);

        // Without the window the same exercise reports everything, as before.
        using var open = await GetJsonAsync(host, token, string.Empty);
        open.RootElement.GetProperty("summary").GetProperty("posts").GetInt32().Should().Be(14);
        open.RootElement.GetProperty("exercise").GetProperty("conductedDate").GetString().Should().Be("2033-09-03");
        open.RootElement.GetProperty("exercise").GetProperty("spansMultipleDays").GetBoolean().Should().BeTrue();
        open.RootElement.GetProperty("lookalikes").GetArrayLength().Should().Be(2);
        open.RootElement.GetProperty("omittedNoiseCount").GetInt32().Should().Be(2);
    }

    [RequiresDockerFact]
    public async Task NoWindow_IsTheSameReport_AsAWindowEnclosingEveryPost()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var cityFire = await _report.PersonaAsync(exerciseId, "cityfire", "City Fire", verified: true);
        var alerts = await _report.PersonaAsync(exerciseId, "cityfire_alerts", "City Fire Alerts");
        var resident = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        await _report.AccountAsync(exerciseId, "participant", signedIn: true);
        var withRef = await _report.InjectAsync(exerciseId, "Bridge closure", externalRef: "INJ-001", firedMinute: 0);
        var noRef = await _report.InjectAsync(exerciseId, "Shelter opens", firedMinute: 20);

        var injectPost = await _seed.PostAsync(exerciseId, cityFire, 0, p => { p.Origin = "inject"; p.InjectId = withRef.ToString(); });
        var reply = await _seed.PostAsync(exerciseId, resident, 4, p => { p.Origin = "participant"; p.ParentPostId = injectPost; });
        await _seed.PostAsync(exerciseId, resident, 6, p => { p.Origin = "participant"; p.ParentPostId = reply; });
        var fake = await _seed.PostAsync(exerciseId, alerts, 8, p => { p.Origin = "engine"; p.BaselineRepostCount = 3; });
        await _seed.ReactionAsync(exerciseId, fake, ReactionKinds.Like);
        await _seed.PostAsync(exerciseId, resident, 9, p => p.Origin = "noise");
        await _seed.PostAsync(exerciseId, cityFire, 20, p => { p.Origin = "inject"; p.InjectId = noRef.ToString(); });
        await _seed.PostAsync(exerciseId, resident, 30, p =>
        {
            p.Origin = "participant";
            p.Body = "@cityfire shelter?";
            p.EditCount = 1;
            p.LastEditedScenarioTime = PostExportSeed.ScenarioStart.AddMinutes(31);
        });
        var taken = await _seed.PostAsync(exerciseId, resident, 1500, p =>
        {
            p.Origin = "participant";
            p.DeletedAt = PostExportSeed.ScenarioStart.AddMinutes(1510);
        });
        var image = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        await _report.AttachAsync(exerciseId, taken, image, 0, "photo");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        foreach (var sources in new[] { string.Empty, "includeNoise=true&" })
        {
            using var none = await GetJsonAsync(host, token, "?" + sources);
            using var enclosing = await GetJsonAsync(host, token, "?" + sources + "from=2033-09-03%2000:00&to=2033-09-06%2023:59");

            enclosing.RootElement.GetProperty("postRecord").GetProperty("from").GetString().Should().Be("2033-09-03 00:00");
            WithoutWindowEcho(none).Should().Be(
                WithoutWindowEcho(enclosing),
                "with no window the report equals one whose window encloses every post, except postRecord.from/to ({0})",
                sources);
        }
    }

    // ---- Injects around the window (DF-45 / DF-42) ---------------------------------------------------------------

    [RequiresDockerFact]
    public async Task AnInject_IsInTheWindowWhenItsFirstPostIs_AndItsResponseIsFoundPastTo()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var utility = await _report.PersonaAsync(exerciseId, "utility", "Utility", verified: true);
        var resident = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var startsBefore = await _report.InjectAsync(exerciseId, "Starts before", externalRef: "E-1", firedMinute: 5);
        var inside = await _report.InjectAsync(exerciseId, "Inside", firedMinute: 35);
        var after = await _report.InjectAsync(exerciseId, "After", externalRef: "A-1", firedMinute: 45);

        await _seed.PostAsync(exerciseId, utility, 5, p => { p.Origin = "inject"; p.InjectId = startsBefore.ToString(); });
        await _seed.PostAsync(exerciseId, utility, 15, p => { p.Origin = "inject"; p.InjectId = startsBefore.ToString(); });
        var insidePost = await _seed.PostAsync(exerciseId, utility, 35, p => { p.Origin = "inject"; p.InjectId = inside.ToString(); });
        await _seed.PostAsync(exerciseId, utility, 45, p => { p.Origin = "inject"; p.InjectId = after.ToString(); });
        await _seed.PostAsync(exerciseId, resident, 50, p => { p.Origin = "participant"; p.ParentPostId = insidePost; });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, "?from=2033-09-04%2013:10&to=2033-09-04%2013:40");
        var root = json.RootElement;

        var row = root.GetProperty("injectResponses").EnumerateArray().Should().ContainSingle(
            "E-1 started before the window (its second post inside does not bring it in); A-1 starts after it").Subject;
        row.GetProperty("title").GetString().Should().Be("Inside");
        row.GetProperty("ref").ValueKind.Should().Be(JsonValueKind.Null, "no MSEL number: null, never the title");
        row.GetProperty("deliveredAt").GetString().Should().Be("2033-09-04 13:35");
        row.GetProperty("firstResponseAt").GetString().Should().Be("2033-09-04 13:50", "the response search runs 30 minutes past to");
        row.GetProperty("responseMinutes").GetDouble().Should().Be(15);
        root.GetProperty("summary").GetProperty("injectsDelivered").GetInt32().Should().Be(1);
        root.GetProperty("summary").GetProperty("medianResponseMinutes").GetDouble().Should().Be(15);
        root.GetProperty("activity").GetProperty("injectMarkers").EnumerateArray().Should().ContainSingle()
            .Which.GetProperty("title").GetString().Should().Be("Inside");

        var listed = root.GetProperty("posts").EnumerateArray().Single(p => p.GetProperty("id").GetString() == insidePost.ToString());
        listed.GetProperty("injectRef").GetString().Should().Be("Inside", "posts[].injectRef keeps its title fallback");

        using var open = await GetJsonAsync(host, token, string.Empty);
        open.RootElement.GetProperty("injectResponses").EnumerateArray().Select(r => r.GetProperty("ref").GetString())
            .Should().Equal(["E-1", null, "A-1"], "ordered by first post; the ref is the MSEL number or null");
    }

    // ---- latestDay / spansMultipleDays -----------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task LatestDay_IsTheLatestPostsScenarioDate_InTheExerciseZone_OverEveryPost()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");

        // 13:00Z = 08:00 CDT on the 4th; 03:30Z on the 5th = 22:30 CDT on the 4th.
        await _seed.PostAsync(exerciseId, persona, 0, p => p.Origin = "participant");
        await _seed.PostAsync(exerciseId, persona, 0, p =>
        {
            p.Origin = "engine";
            p.CreatedScenarioTime = new DateTimeOffset(2033, 9, 5, 3, 30, 0, TimeSpan.Zero);
        });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        foreach (var query in new[] { string.Empty, "?sources=participant&from=2033-09-04%2008:00&to=2033-09-04%2008:00" })
        {
            using var json = await GetJsonAsync(host, token, query);
            var exercise = json.RootElement.GetProperty("exercise");
            var latest = exercise.GetProperty("latestDay");
            latest.GetProperty("from").GetString().Should().Be("2033-09-04 00:00", "03:30Z on the 5th is the 4th in Chicago ({0})", query);
            latest.GetProperty("to").GetString().Should().Be("2033-09-04 23:59");
            exercise.GetProperty("spansMultipleDays").GetBoolean().Should().BeFalse("both posts print on the 4th in the exercise zone");
        }

        // A noise post at 01:00 CDT on the 5th: latestDay counts every source, noise included.
        await _seed.PostAsync(exerciseId, persona, 0, p =>
        {
            p.Origin = "noise";
            p.CreatedScenarioTime = new DateTimeOffset(2033, 9, 5, 6, 0, 0, TimeSpan.Zero);
        });

        using var later = await GetJsonAsync(host, token, string.Empty);
        var laterExercise = later.RootElement.GetProperty("exercise");
        laterExercise.GetProperty("latestDay").GetProperty("from").GetString().Should().Be("2033-09-05 00:00");
        laterExercise.GetProperty("latestDay").GetProperty("to").GetString().Should().Be("2033-09-05 23:59");
        laterExercise.GetProperty("spansMultipleDays").GetBoolean().Should().BeTrue("in-scope posts now print on the 4th and the 5th");
    }

    [RequiresDockerFact]
    public async Task ScenarioNow_IsTheStoredScenarioTime_OrTheLatestPostWhenLater_InTheExerciseZone()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        using (var empty = await GetJsonAsync(host, token, string.Empty))
        {
            empty.RootElement.GetProperty("exercise").GetProperty("scenarioNow").ValueKind
                .Should().Be(JsonValueKind.Null, "no clock, no stored time and no posts");
        }

        // 13:00Z = 08:00 CDT. No stored scenario time: the latest post is "now".
        await _seed.PostAsync(exerciseId, persona, 0, p => p.Origin = "participant");
        using (var postsOnly = await GetJsonAsync(host, token, string.Empty))
        {
            postsOnly.RootElement.GetProperty("exercise").GetProperty("scenarioNow").GetString().Should().Be("2033-09-04 08:00");
        }

        // The persisted scenario time (the clock's fallback) is later: it wins, whatever the window.
        await SetStoredScenarioTimeAsync(exerciseId, PostExportSeed.ScenarioStart.AddHours(3));
        foreach (var query in new[] { string.Empty, "?from=2033-09-04%2008:00&to=2033-09-04%2008:05" })
        {
            using var stored = await GetJsonAsync(host, token, query);
            stored.RootElement.GetProperty("exercise").GetProperty("scenarioNow").GetString().Should().Be("2033-09-04 11:00", query);
        }

        // A post dated after the stored time is never hidden by the default end.
        await _seed.PostAsync(exerciseId, persona, 240, p => p.Origin = "engine");
        using var later = await GetJsonAsync(host, token, string.Empty);
        later.RootElement.GetProperty("exercise").GetProperty("scenarioNow").GetString().Should().Be("2033-09-04 12:00");
    }

    [RequiresDockerFact]
    public async Task LatestDay_OnTheLastRepresentableDay_DoesNotOverflow_AndAWindowExcludingItStillBuilds()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");

        await _seed.PostAsync(exerciseId, persona, 0, p => p.Origin = "participant");
        await _seed.PostAsync(exerciseId, persona, 0, p =>
        {
            p.Origin = "participant";
            p.CreatedScenarioTime = new DateTimeOffset(9999, 12, 31, 12, 0, 0, TimeSpan.Zero);
        });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        foreach (var query in new[] { string.Empty, "?from=2033-09-04%2000:00&to=2033-09-04%2023:59" })
        {
            using var json = await GetJsonAsync(host, token, query);
            var latest = json.RootElement.GetProperty("exercise").GetProperty("latestDay");
            latest.GetProperty("from").GetString().Should().Be("9999-12-31 00:00", "the latest post is on the last day ({0})", query);
            latest.GetProperty("to").GetString().Should().Be("9999-12-31 23:59");
        }
    }

    [RequiresDockerFact]
    public async Task SpansMultipleDays_CountsListedTakedownAndEditTimes_ForTheWindowInEffect()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var nextDay = new DateTimeOffset(2033, 9, 5, 1, 0, 0, TimeSpan.Zero);

        await _seed.PostAsync(exerciseId, persona, 0, p =>
        {
            p.Origin = "participant";
            p.EditCount = 1;
            p.LastEditedScenarioTime = nextDay;
        });
        await _seed.PostAsync(exerciseId, persona, 60, p =>
        {
            p.Origin = "engine";
            p.DeletedAt = nextDay;
        });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        async Task<bool> SpansAsync(string query)
        {
            using var json = await GetJsonAsync(host, token, query);
            return json.RootElement.GetProperty("exercise").GetProperty("spansMultipleDays").GetBoolean();
        }

        (await SpansAsync(string.Empty)).Should().BeTrue("both listed posts print a time on the 5th");
        (await SpansAsync("?sources=participant")).Should().BeTrue("the listed edit time is on the 5th");
        (await SpansAsync("?sources=engine")).Should().BeTrue("the listed takedown time is on the 5th");
        (await SpansAsync("?sources=scripted")).Should().BeFalse("nothing listed: only the posts' own times, both on the 4th");
        (await SpansAsync("?sources=engine&from=2033-09-04%2013:00&to=2033-09-04%2013:30")).Should().BeFalse(
            "the window holds only the 13:00 post, and it is not listed");
    }

    [RequiresDockerFact]
    public async Task SpansMultipleDays_CountsAFirstResponseAfterMidnight_PastTheWindow()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var utility = await _report.PersonaAsync(exerciseId, "utility", "Utility", verified: true);
        var resident = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var item = await _report.InjectAsync(exerciseId, "Late advisory", firedMinute: 650);

        // 23:50Z on the 4th, answered at 00:10Z on the 5th.
        var injectPost = await _seed.PostAsync(exerciseId, utility, 650, p => { p.Origin = "inject"; p.InjectId = item.ToString(); });
        await _seed.PostAsync(exerciseId, resident, 670, p => { p.Origin = "participant"; p.ParentPostId = injectPost; });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, "?from=2033-09-04%2023:00&to=2033-09-04%2023:59");
        var root = json.RootElement;

        root.GetProperty("summary").GetProperty("posts").GetInt32().Should().Be(1);
        root.GetProperty("injectResponses")[0].GetProperty("firstResponseAt").GetString().Should().Be("2033-09-05 00:10");
        root.GetProperty("exercise").GetProperty("spansMultipleDays").GetBoolean().Should().BeTrue(
            "the inject table prints a response time on the 5th");
    }

    // ---- DF-47: threads ------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task Threads_NestedRepliesFollowTheirRoot_AtDepthOne_AReplyToAnUnlistedParentIsARoot()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var scoop = await _report.PersonaAsync(exerciseId, "thescoop", "The Scoop");
        var resident = await _report.PersonaAsync(exerciseId, "resident", "Resident");

        var outside = await _seed.PostAsync(exerciseId, scoop, 0, p => p.Origin = "participant");
        var root = await _seed.PostAsync(exerciseId, scoop, 10, p => p.Origin = "participant");
        var orphan = await _seed.PostAsync(exerciseId, resident, 11, p => { p.Origin = "participant"; p.ParentPostId = outside; });
        var child = await _seed.PostAsync(exerciseId, resident, 12, p => { p.Origin = "participant"; p.ParentPostId = root; });
        var other = await _seed.PostAsync(exerciseId, resident, 13, p => p.Origin = "participant");
        var grandchild = await _seed.PostAsync(exerciseId, scoop, 15, p => { p.Origin = "participant"; p.ParentPostId = child; });
        var sibling = await _seed.PostAsync(exerciseId, resident, 16, p => { p.Origin = "participant"; p.ParentPostId = root; });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, "?from=2033-09-04%2013:05");
        var posts = json.RootElement.GetProperty("posts").EnumerateArray().ToArray();

        posts.Select(Id).Should().Equal(
            [Str(root), Str(child), Str(grandchild), Str(sibling), Str(orphan), Str(other)],
            "roots by scenario time, each followed by its listed descendants by scenario time");
        posts.Select(p => p.GetProperty("depth").GetInt32()).Should().Equal([0, 1, 1, 1, 0, 0], "never more than one level");
        posts.Select(p => p.GetProperty("threadRootId").GetString()).Should().Equal(
            [Str(root), Str(root), Str(root), Str(root), Str(orphan), Str(other)], "the grandchild's root is the top post");

        var orphanDto = posts[4];
        orphanDto.GetProperty("parentPostId").GetString().Should().Be(Str(outside), "the parent still resolves in the exercise");
        orphanDto.GetProperty("replyToHandle").GetString().Should().Be("@thescoop", "Replying to @x is kept");

        using var open = await GetJsonAsync(host, token, string.Empty);
        var openPosts = open.RootElement.GetProperty("posts").EnumerateArray().ToArray();
        openPosts.Select(Id).Should().Equal(
            [Str(outside), Str(orphan), Str(root), Str(child), Str(grandchild), Str(sibling), Str(other)],
            "with its parent listed, the reply threads under it");
        openPosts[1].GetProperty("threadRootId").GetString().Should().Be(Str(outside));
        openPosts[1].GetProperty("depth").GetInt32().Should().Be(1);
    }

    [RequiresDockerFact]
    public async Task Threads_AReplyToNoise_IsARootWhenNoiseIsExcluded_AndThreadsWhenIncluded()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var noise = await _seed.PostAsync(exerciseId, persona, 0, p => p.Origin = "noise");
        var reply = await _seed.PostAsync(exerciseId, persona, 1, p => { p.Origin = "participant"; p.ParentPostId = noise; });
        var later = await _seed.PostAsync(exerciseId, persona, 2, p => p.Origin = "participant");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        using (var excluded = await GetJsonAsync(host, token, string.Empty))
        {
            var posts = excluded.RootElement.GetProperty("posts").EnumerateArray().ToArray();
            posts.Select(Id).Should().Equal(Str(reply), Str(later));
            posts[0].GetProperty("threadRootId").GetString().Should().Be(Str(reply), "its noise parent is not listed");
            posts[0].GetProperty("depth").GetInt32().Should().Be(0);
        }

        using var included = await GetJsonAsync(host, token, "?includeNoise=true");
        var all = included.RootElement.GetProperty("posts").EnumerateArray().ToArray();
        all.Select(Id).Should().Equal(Str(noise), Str(reply), Str(later));
        all[1].GetProperty("threadRootId").GetString().Should().Be(Str(noise));
        all[1].GetProperty("depth").GetInt32().Should().Be(1);
    }

    private static string? Id(JsonElement post) => post.GetProperty("id").GetString();

    private static string Str(Guid id) => id.ToString();

    private static string WithoutWindowEcho(JsonDocument document)
    {
        var node = JsonNode.Parse(document.RootElement.GetRawText())!.AsObject();
        var record = node["postRecord"]!.AsObject();
        record.Remove("from");
        record.Remove("to");
        return node.ToJsonString();
    }

    private async Task SetStoredScenarioTimeAsync(Guid exerciseId, DateTimeOffset scenarioTime)
    {
        await using var context = _fixture.CreateContext();
        var exercise = await context.Exercises.SingleAsync(row => row.Id == exerciseId);
        exercise.CurrentScenarioTime = scenarioTime;
        await context.SaveChangesAsync();
    }

    private static async Task<JsonDocument> GetJsonAsync(ExerciseReportTestHost host, string token, string query)
    {
        using var response = await host.GetReportAsync(token, query);
        response.StatusCode.Should().Be(HttpStatusCode.OK, query);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }
}
