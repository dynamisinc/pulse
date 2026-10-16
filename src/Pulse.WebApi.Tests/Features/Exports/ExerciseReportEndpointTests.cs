namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Features.Media;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;
using Xunit;

/// <summary>
/// <c>GET /api/staff/exports/report</c> end to end over real SQL (demo-feedback story 29): the staff gate and the
/// fail-closed scope, every section of the frozen contract, the noise toggle (DF-41), DF-42, media signing and its
/// degradation, cross-exercise isolation, telemetry and the 5,000-post limit.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseReportEndpointTests
{
    private readonly PostExportSeed _seed;
    private readonly ExerciseReportSeed _report;

    public ExerciseReportEndpointTests(MsSqlContainerFixture fixture)
    {
        _seed = new PostExportSeed(fixture);
        _report = new ExerciseReportSeed(fixture);
    }

    // ---- Gate & scope (AC isolation) -----------------------------------------------------------------------------

    [Fact]
    public void Route_IsInTheStaffWorld() =>
        ExerciseReportEndpoints.ReportRoute.Should().Be("/api/staff/exports/report");

    [RequiresDockerFact]
    public async Task UnresolvedScope_Returns401_AndRecordsNothing()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, currentExerciseId: null);

        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved scope fails closed");
        (await _seed.TelemetryAsync(exerciseId)).Should().BeEmpty();
    }

    [RequiresDockerFact]
    public async Task Anonymous_And_Participant_Return401_UnassignedStaff403()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var otherExerciseId = await _seed.ExerciseAsync();
        var participant = await _seed.NonStaffSessionAsync(exerciseId, "participant");
        var (unassigned, _) = await _seed.StaffAsync(exerciseId, [(otherExerciseId, "controller")]);
        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using (var anonymous = await host.GetReportAsync(bearerToken: null))
        {
            anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            anonymous.Headers.CacheControl!.NoStore.Should().BeTrue();
        }

        using (var asParticipant = await host.GetReportAsync(participant))
        {
            asParticipant.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "a participant never reaches a staff route");
        }

        using var asUnassigned = await host.GetReportAsync(unassigned);
        asUnassigned.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [RequiresDockerFact]
    public async Task EmptyExercise_Returns200_WithEmptySections()
    {
        var exerciseId = await _seed.ExerciseAsync(name: "Empty Run");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "evaluator")]);
        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl!.NoStore.Should().BeTrue();
        using var json = await ReadAsync(response);
        var root = json.RootElement;
        root.GetProperty("exercise").GetProperty("name").GetString().Should().Be("Empty Run");
        root.GetProperty("exercise").GetProperty("scenarioStart").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("summary").GetProperty("posts").GetInt32().Should().Be(0);
        root.GetProperty("summary").GetProperty("busiestWindow").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("summary").GetProperty("medianResponseMinutes").ValueKind.Should().Be(JsonValueKind.Null);
        root.GetProperty("activity").GetProperty("binMinutes").GetInt32().Should().Be(5);
        root.GetProperty("activity").GetProperty("bins").GetArrayLength().Should().Be(0);
        root.GetProperty("posts").GetArrayLength().Should().Be(0);
    }

    // ---- The report (AC endpoint, posts, media, activity, DF-42, lookalikes, editCount) --------------------------

    [RequiresDockerFact]
    public async Task Report_CarriesEverySection_PerTheFrozenContract()
    {
        var exerciseId = await _seed.ExerciseAsync(name: "Kestrel Flood 2033", timeZone: "America/Chicago");
        var (token, staffUserId) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")], displayName: "Casey Controller");

        var avatar = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        var cityFire = await _report.PersonaAsync(exerciseId, "cityfire", "City Fire Dept", verified: true, avatarMediaId: avatar);
        var lookalike = await _report.PersonaAsync(exerciseId, "CityFire_Alerts", "City Fire Alerts");
        var resident = await _report.PersonaAsync(exerciseId, "resident_ann", "Ann Resident");

        await _report.AccountAsync(exerciseId, "participant", signedIn: true);
        await _report.AccountAsync(exerciseId, "pio", signedIn: true);
        await _report.AccountAsync(exerciseId, "participant", signedIn: false);

        var bridge = await _report.InjectAsync(exerciseId, "Bridge closure", externalRef: "INJ-007", firedMinute: 0);
        var shelter = await _report.InjectAsync(exerciseId, "Shelter opens", firedMinute: 20);
        var unfired = await _report.InjectAsync(exerciseId, "Never fired", firedMinute: null);
        var deleted = await _report.InjectAsync(exerciseId, "Deleted item", firedMinute: 1, deleted: true);

        var injectPost = await _seed.PostAsync(exerciseId, cityFire, 0, p =>
        {
            p.Origin = "inject";
            p.InjectId = bridge.ToString();
            p.ActingHumanId = staffUserId.ToString();
            p.BaselineLikeCount = 40;
            p.PinnedForAllAt = PostExportSeed.ScenarioStart.AddMinutes(1);
        });
        var reply = await _seed.PostAsync(exerciseId, resident, 6, p =>
        {
            p.Origin = "participant";
            p.ParentPostId = injectPost;
            p.Body = "Which bridge?";
        });
        var lookalikePost = await _seed.PostAsync(exerciseId, lookalike, 8, p =>
        {
            p.Origin = "controller-as-persona";
            p.BaselineLikeCount = 10;
            p.BaselineRepostCount = 3;
        });
        var noise = await _seed.PostAsync(exerciseId, resident, 12, p => p.Origin = "noise");
        var engine = await _seed.PostAsync(exerciseId, resident, 13, p =>
        {
            p.Origin = "engine";
            p.DeletedAt = PostExportSeed.ScenarioStart.AddMinutes(15);
        });
        var shelterPost = await _seed.PostAsync(exerciseId, cityFire, 20, p =>
        {
            p.Origin = "inject";
            p.InjectId = shelter.ToString();
        });
        await _seed.PostAsync(exerciseId, cityFire, 21, p => { p.Origin = "inject"; p.InjectId = unfired.ToString(); });
        await _seed.PostAsync(exerciseId, cityFire, 22, p => { p.Origin = "inject"; p.InjectId = deleted.ToString(); });

        // A participant @mention 31 minutes after the shelter post: outside DF-42's window.
        await _seed.PostAsync(exerciseId, resident, 51, p => { p.Origin = "participant"; p.Body = "@cityfire where is the shelter"; });

        await _seed.ReactionAsync(exerciseId, injectPost, ReactionKinds.Like);
        await _seed.ReactionAsync(exerciseId, lookalikePost, ReactionKinds.Like);
        await _seed.ReactionAsync(exerciseId, lookalikePost, ReactionKinds.Repost);

        // Media on the inject post, inserted out of slot order: a video with the ASSET's poster, then an image.
        var assetPoster = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        var video = await _report.AssetAsync(exerciseId, MediaKinds.Video, a =>
        {
            a.PosterMediaAssetId = assetPoster;
            a.DurationSec = 42.5;
            a.Width = 1280;
            a.Height = 720;
        });
        var image = await _report.AssetAsync(exerciseId, MediaKinds.Image, a => { a.Width = 800; a.Height = 600; });
        await _report.AttachAsync(exerciseId, injectPost, video, order: 1, alt: "Flooded bridge video");
        await _report.AttachAsync(exerciseId, injectPost, image, order: 0, alt: "Bridge closed sign");

        // The shelter post: one video whose ITEM poster overrides the asset's, one with no poster at all.
        var itemPoster = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        var videoWithOverride = await _report.AssetAsync(exerciseId, MediaKinds.Video, a => a.PosterMediaAssetId = assetPoster);
        var posterless = await _report.AssetAsync(exerciseId, MediaKinds.Video, a => a.DurationSec = 9);
        await _report.AttachAsync(exerciseId, shelterPost, videoWithOverride, order: 0, alt: "Shelter tour", posterId: itemPoster);
        await _report.AttachAsync(exerciseId, shelterPost, posterless, order: 1, alt: "No poster clip");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetReportAsync(token);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = await ReadAsync(response);
        var root = json.RootElement;

        // Header: scenario times in the exercise zone (CDT = UTC-5).
        var exercise = root.GetProperty("exercise");
        exercise.GetProperty("name").GetString().Should().Be("Kestrel Flood 2033");
        exercise.GetProperty("timeZone").GetString().Should().Be("America/Chicago");
        exercise.GetProperty("scenarioStart").GetString().Should().Be("2033-09-04 08:00");
        exercise.GetProperty("scenarioEnd").GetString().Should().Be("2033-09-04 08:51");
        exercise.GetProperty("conductedDate").GetString().Should().Be("2033-09-04");
        exercise.GetProperty("preparedAt").GetString().Should().MatchRegex(@"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$");
        exercise.TryGetProperty("preparedAtUtc", out _).Should().BeFalse("the field was renamed (W-003)");

        // Summary: every post counted, noise included (DF-41).
        var summary = root.GetProperty("summary");
        summary.GetProperty("participants").GetInt32().Should().Be(2, "signed-in participant-world accounts only");
        summary.GetProperty("posts").GetInt32().Should().Be(9);
        summary.GetProperty("replies").GetInt32().Should().Be(1);
        summary.GetProperty("injectsDelivered").GetInt32().Should().Be(2, "unfired and deleted items are not delivered");
        summary.GetProperty("medianResponseMinutes").GetDouble().Should().Be(6, "only responded injects count");
        summary.GetProperty("postsEdited").GetInt32().Should().Be(0, "nothing in this seed was edited");
        summary.GetProperty("postsTakenDown").GetInt32().Should().Be(1);
        var bySource = summary.GetProperty("bySource");
        bySource.GetProperty("participant").GetInt32().Should().Be(3, "participant + controller-as-persona");
        bySource.GetProperty("scripted").GetInt32().Should().Be(4);
        bySource.GetProperty("engine").GetInt32().Should().Be(1);
        bySource.GetProperty("noise").GetInt32().Should().Be(1);
        var busiest = summary.GetProperty("busiestWindow");
        busiest.GetProperty("start").GetString().Should().Be("2033-09-04 08:20");
        busiest.GetProperty("posts").GetInt32().Should().Be(3);

        // Activity: 08:00 .. 08:50, eleven bins; noise counted in its bin.
        var activity = root.GetProperty("activity");
        var bins = activity.GetProperty("bins").EnumerateArray().ToArray();
        bins.Should().HaveCount(11);
        bins[0].GetProperty("start").GetString().Should().Be("2033-09-04 08:00");
        bins[2].GetProperty("noise").GetInt32().Should().Be(1, "noise is in the numbers even when out of the list");
        bins[1].GetProperty("participant").GetInt32().Should().Be(2);
        var markers = activity.GetProperty("injectMarkers").EnumerateArray().ToArray();
        markers.Select(m => m.GetProperty("ref").GetString()).Should().Equal("INJ-007", "Shelter opens");
        markers.Select(m => m.GetProperty("binIndex").GetInt32()).Should().Equal(0, 4);
        markers[1].GetProperty("at").GetString().Should().Be("2033-09-04 08:20");

        // DF-42.
        var responses = root.GetProperty("injectResponses").EnumerateArray().ToArray();
        responses.Should().HaveCount(2);
        responses[0].GetProperty("ref").GetString().Should().Be("INJ-007");
        responses[0].GetProperty("title").GetString().Should().Be("Bridge closure");
        responses[0].GetProperty("deliveredAt").GetString().Should().Be("2033-09-04 08:00");
        responses[0].GetProperty("firstResponseAt").GetString().Should().Be("2033-09-04 08:06");
        responses[0].GetProperty("responseMinutes").GetDouble().Should().Be(6);
        responses[0].GetProperty("respondedAsHandle").GetString().Should().Be("@resident_ann");
        responses[1].GetProperty("ref").GetString().Should().Be("Shelter opens", "no external ref: the title");
        responses[1].GetProperty("firstResponseAt").ValueKind.Should().Be(JsonValueKind.Null, "the @mention came after 30 minutes");
        responses[1].GetProperty("responseMinutes").ValueKind.Should().Be(JsonValueKind.Null);
        responses[1].GetProperty("respondedAsHandle").ValueKind.Should().Be(JsonValueKind.Null);

        // Lookalikes: shown likes and reposts summed over the persona's posts.
        var pair = root.GetProperty("lookalikes").EnumerateArray().Should().ContainSingle().Subject;
        pair.GetProperty("verified").GetProperty("handle").GetString().Should().Be("@cityfire");
        pair.GetProperty("verified").GetProperty("verified").GetBoolean().Should().BeTrue();
        pair.GetProperty("verified").GetProperty("likes").GetInt32().Should().Be(41, "40 baseline + 1 real on the inject post");
        pair.GetProperty("lookalike").GetProperty("handle").GetString().Should().Be("@CityFire_Alerts");
        pair.GetProperty("lookalike").GetProperty("verified").GetBoolean().Should().BeFalse();
        pair.GetProperty("lookalike").GetProperty("likes").GetInt32().Should().Be(11);
        pair.GetProperty("lookalike").GetProperty("reposts").GetInt32().Should().Be(4);

        // Posts: scenario order, noise left out by default.
        var posts = root.GetProperty("posts").EnumerateArray().ToArray();
        posts.Should().HaveCount(8);
        posts.Select(p => p.GetProperty("id").GetString()).Should().NotContain(noise.ToString());
        root.GetProperty("omittedNoiseCount").GetInt32().Should().Be(1);
        posts.Take(3).Select(p => p.GetProperty("id").GetString()).Should().Equal(
            injectPost.ToString(), reply.ToString(), lookalikePost.ToString());

        var first = posts[0];
        first.GetProperty("scenarioAt").GetString().Should().Be("2033-09-04 08:00");
        first.GetProperty("scenarioTime").GetString().Should().Be("08:00");
        first.GetProperty("source").GetString().Should().Be("scripted", "origin inject maps to scripted");
        first.GetProperty("postedBy").GetString().Should().Be("Casey Controller");
        first.GetProperty("injectRef").GetString().Should().Be("INJ-007");
        first.GetProperty("likes").GetInt32().Should().Be(41, "shown = baseline + real");
        first.GetProperty("replies").GetInt32().Should().Be(1);
        first.GetProperty("pinnedForAll").GetBoolean().Should().BeTrue();
        first.GetProperty("takenDownAt").ValueKind.Should().Be(JsonValueKind.Null);
        first.GetProperty("editCount").GetInt32().Should().Be(0);
        first.GetProperty("lastEditedAt").ValueKind.Should().Be(JsonValueKind.Null, "never edited");
        first.GetProperty("replyToHandle").ValueKind.Should().Be(JsonValueKind.Null);
        var author = first.GetProperty("author");
        author.GetProperty("handle").GetString().Should().Be("@cityfire");
        author.GetProperty("verified").GetBoolean().Should().BeTrue();
        author.GetProperty("avatarUrl").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(avatar));

        var media = first.GetProperty("media").EnumerateArray().ToArray();
        media.Should().HaveCount(2);
        media[0].GetProperty("kind").GetString().Should().Be("image", "media are in slot order");
        media[0].GetProperty("url").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(image));
        media[0].GetProperty("alt").GetString().Should().Be("Bridge closed sign");
        media[0].GetProperty("durationSec").ValueKind.Should().Be(JsonValueKind.Null);
        media[0].GetProperty("width").GetInt32().Should().Be(800);
        media[1].GetProperty("kind").GetString().Should().Be("video");
        media[1].GetProperty("url").GetString().Should().Be(FakeMediaUrlSigner.UrlFor(assetPoster), "a video carries its poster");
        media[1].GetProperty("alt").GetString().Should().Be("Flooded bridge video");
        media[1].GetProperty("durationSec").GetDouble().Should().Be(42.5);
        media[1].GetProperty("height").GetInt32().Should().Be(720);

        var replyDto = posts[1];
        replyDto.GetProperty("source").GetString().Should().Be("participant");
        replyDto.GetProperty("replyToHandle").GetString().Should().Be("@cityfire");
        replyDto.GetProperty("parentPostId").GetString().Should().Be(injectPost.ToString());
        replyDto.GetProperty("author").GetProperty("avatarUrl").ValueKind.Should().Be(JsonValueKind.Null);
        replyDto.GetProperty("text").GetString().Should().Be("Which bridge?");

        posts[2].GetProperty("source").GetString().Should().Be("controller-as-persona");

        var engineDto = posts.Single(p => p.GetProperty("id").GetString() == engine.ToString());
        engineDto.GetProperty("source").GetString().Should().Be("engine");
        engineDto.GetProperty("postedBy").ValueKind.Should().Be(JsonValueKind.Null);
        engineDto.GetProperty("takenDownAt").GetString().Should().Be("2033-09-04 08:15", "taken-down posts are listed with their takedown time");

        var shelterMedia = posts.Single(p => p.GetProperty("id").GetString() == shelterPost.ToString())
            .GetProperty("media").EnumerateArray().ToArray();
        shelterMedia[0].GetProperty("url").GetString().Should().Be(
            FakeMediaUrlSigner.UrlFor(itemPoster), "the post item's poster wins over the asset's");
        shelterMedia[1].GetProperty("url").ValueKind.Should().Be(JsonValueKind.Null, "a video with no poster has a null url");
        shelterMedia[1].GetProperty("alt").GetString().Should().Be("No poster clip");
        shelterMedia[1].GetProperty("durationSec").GetDouble().Should().Be(9);
    }

    [RequiresDockerFact]
    public async Task PreparedAt_IsTheServerClock_InTheExerciseZone_NotUtc()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);

        // 02:30 UTC on the 16th is 21:30 CDT on the 15th: a US evening print must not read as tomorrow (W-003).
        var now = new DateTimeOffset(2026, 10, 16, 2, 30, 0, TimeSpan.Zero);
        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: now);
        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = await ReadAsync(response);
        json.RootElement.GetProperty("exercise").GetProperty("preparedAt").GetString().Should().Be("2026-10-15 21:30");
    }

    // ---- Edits (DF-29 Post.EditCount / LastEditedScenarioTime) --------------------------------------------------

    [RequiresDockerFact]
    public async Task Edits_CarryTheCountAndLastEditTime_AndPostsEditedCountsTakenDownPosts()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        var edited = await _seed.PostAsync(exerciseId, persona, 0, p =>
        {
            p.Origin = "participant";
            p.EditCount = 2;
            p.LastEditedAt = PostExportSeed.ScenarioStart.AddHours(9);
            p.LastEditedScenarioTime = PostExportSeed.ScenarioStart.AddMinutes(5);
        });
        var editedThenTakenDown = await _seed.PostAsync(exerciseId, persona, 1, p =>
        {
            p.Origin = "participant";
            p.EditCount = 1;
            p.LastEditedScenarioTime = PostExportSeed.ScenarioStart.AddMinutes(2);
            p.DeletedAt = PostExportSeed.ScenarioStart.AddMinutes(3);
        });
        var neverEdited = await _seed.PostAsync(exerciseId, persona, 2, p => p.Origin = "participant");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var json = await ReadAsync(response);
        var root = json.RootElement;
        root.GetProperty("summary").GetProperty("postsEdited").GetInt32().Should().Be(2, "a taken-down post still counts");

        var byId = root.GetProperty("posts").EnumerateArray().ToDictionary(post => post.GetProperty("id").GetString()!);
        var first = byId[edited.ToString()];
        first.GetProperty("editCount").GetInt32().Should().Be(2);
        first.GetProperty("lastEditedAt").GetString().Should().Be("2033-09-04 08:05", "scenario time in the exercise zone, never the wall clock");
        byId[editedThenTakenDown.ToString()].GetProperty("editCount").GetInt32().Should().Be(1);
        byId[neverEdited.ToString()].GetProperty("editCount").GetInt32().Should().Be(0);
        byId[neverEdited.ToString()].GetProperty("lastEditedAt").ValueKind.Should().Be(JsonValueKind.Null);
    }

    // ---- Noise toggle (DF-41) ------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task IncludeNoise_ListsNoise_AndTheMetricsAreIdentical()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident");
        await _seed.PostAsync(exerciseId, persona, 0, p => p.Origin = "participant");
        var noise = await _seed.PostAsync(exerciseId, persona, 1, p => { p.Origin = "noise"; p.Body = "noise body"; });
        var noiseImage = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        await _report.AttachAsync(exerciseId, noise, noiseImage, 0, "noise alt");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);

        using var without = await host.GetReportAsync(token, "?includeNoise=false");
        using var withNoise = await host.GetReportAsync(token, "?includeNoise=true");
        using var byDefault = await host.GetReportAsync(token);
        without.StatusCode.Should().Be(HttpStatusCode.OK);
        withNoise.StatusCode.Should().Be(HttpStatusCode.OK);

        using var a = await ReadAsync(without);
        using var b = await ReadAsync(withNoise);
        using var c = await ReadAsync(byDefault);

        a.RootElement.GetProperty("posts").GetArrayLength().Should().Be(1);
        a.RootElement.GetProperty("omittedNoiseCount").GetInt32().Should().Be(1);
        c.RootElement.GetProperty("posts").GetArrayLength().Should().Be(1, "noise is out of the list by default");

        var listedNoise = b.RootElement.GetProperty("posts").EnumerateArray()
            .Single(p => p.GetProperty("id").GetString() == noise.ToString());
        listedNoise.GetProperty("source").GetString().Should().Be("noise");
        listedNoise.GetProperty("text").GetString().Should().Be("noise body");
        listedNoise.GetProperty("media")[0].GetProperty("alt").GetString().Should().Be("noise alt");
        b.RootElement.GetProperty("omittedNoiseCount").GetInt32().Should().Be(0);

        a.RootElement.GetProperty("summary").GetRawText().Should().Be(
            b.RootElement.GetProperty("summary").GetRawText(), "metrics are identical either way (DF-41)");
        a.RootElement.GetProperty("activity").GetRawText().Should().Be(b.RootElement.GetProperty("activity").GetRawText());
    }

    // ---- Media degradation ---------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ASigningFailure_DegradesToNullUrls_NotA500()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var avatar = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        var persona = await _report.PersonaAsync(exerciseId, "resident", "Resident", avatarMediaId: avatar);
        var post = await _seed.PostAsync(exerciseId, persona, 0);
        var image = await _report.AssetAsync(exerciseId, MediaKinds.Image);
        await _report.AttachAsync(exerciseId, post, image, 0, "kept alt");

        await using var host = await ExerciseReportTestHost.StartAsync(
            _seed.ConnectionString, exerciseId, signingFailure: new MediaStoreUnavailableException());
        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.OK, "a storage fault degrades the report, never fails it");
        using var json = await ReadAsync(response);
        var dto = json.RootElement.GetProperty("posts")[0];
        dto.GetProperty("author").GetProperty("avatarUrl").ValueKind.Should().Be(JsonValueKind.Null);
        dto.GetProperty("media")[0].GetProperty("url").ValueKind.Should().Be(JsonValueKind.Null);
        dto.GetProperty("media")[0].GetProperty("alt").GetString().Should().Be("kept alt", "the item still prints its alt text");
    }

    // ---- Isolation (XC-001 / COR-001) ------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ReportFromA_NeverShowsBsPostsPersonasMediaOrInjects()
    {
        var exerciseA = await _seed.ExerciseAsync();
        var exerciseB = await _seed.ExerciseAsync();
        var (tokenA, _) = await _seed.StaffAsync(exerciseA, [(exerciseA, "controller"), (exerciseB, "controller")]);
        var (_, staffBOnly) = await _seed.StaffAsync(exerciseB, [(exerciseB, "controller")], "Bea From B");

        var avatarB = await _report.AssetAsync(exerciseB, MediaKinds.Image);
        var personaA = await _report.PersonaAsync(exerciseA, "alpha", "Alpha Persona", verified: true, avatarMediaId: avatarB);
        var personaB = await _report.PersonaAsync(exerciseB, "alpha_secret", "Bravo Secret Persona");
        var injectB = await _report.InjectAsync(exerciseB, "B secret inject", externalRef: "B-INJ");
        await _report.AccountAsync(exerciseB, "participant", signedIn: true);

        var postB = await _seed.PostAsync(exerciseB, personaB, 0, p => { p.Body = "B-only body"; p.Origin = "participant"; });
        var injectPostB = await _seed.PostAsync(exerciseB, personaB, 1, p => { p.Origin = "inject"; p.InjectId = injectB.ToString(); });
        var imageB = await _report.AssetAsync(exerciseB, MediaKinds.Image);
        await _report.AttachAsync(exerciseB, postB, imageB, 0, "B secret alt");

        // A's own posts, some pointing at B's rows (a buggy write): none of B's content may surface.
        var postA = await _seed.PostAsync(exerciseA, personaA, 0, p => p.Origin = "participant");
        var leaky = await _seed.PostAsync(exerciseA, personaB, 2, p =>
        {
            p.Origin = "inject";
            p.InjectId = injectB.ToString();
            p.ActingHumanId = staffBOnly.ToString();
            p.ParentPostId = postB;
        });
        await _report.AttachAsync(exerciseA, postA, imageB, 0, "cross-exercise attach");
        await _seed.ReactionAsync(exerciseB, postA, ReactionKinds.Like);

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseA);
        using var response = await host.GetReportAsync(tokenA, "?includeNoise=true");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(raw);
        var root = json.RootElement;

        root.GetProperty("posts").EnumerateArray().Select(p => p.GetProperty("id").GetString())
            .Should().BeEquivalentTo([postA.ToString(), leaky.ToString()], "only exercise A's posts are listed");
        root.GetProperty("summary").GetProperty("posts").GetInt32().Should().Be(2, "B's posts never count in A");
        root.GetProperty("summary").GetProperty("participants").GetInt32().Should().Be(0, "B's account never counts in A");
        root.GetProperty("summary").GetProperty("injectsDelivered").GetInt32().Should().Be(0, "B's inject is not A's");
        root.GetProperty("injectResponses").GetArrayLength().Should().Be(0);
        root.GetProperty("lookalikes").GetArrayLength().Should().Be(0, "B's persona is never paired with A's");

        raw.Should().NotContain("alpha_secret").And.NotContain("Bravo Secret Persona").And.NotContain("Bea From B")
            .And.NotContain("B secret inject").And.NotContain("B-INJ").And.NotContain("B-only body")
            .And.NotContain("B secret alt").And.NotContain(postB.ToString()).And.NotContain(injectPostB.ToString())
            .And.NotContain(imageB.ToString("N")).And.NotContain(avatarB.ToString("N"));

        var a = root.GetProperty("posts").EnumerateArray().Single(p => p.GetProperty("id").GetString() == postA.ToString());
        a.GetProperty("media").GetArrayLength().Should().Be(0, "an asset from B cannot join to A's item");
        a.GetProperty("author").GetProperty("avatarUrl").ValueKind.Should().Be(JsonValueKind.Null, "B's asset is never signed for A");
        a.GetProperty("likes").GetInt32().Should().Be(0, "B's stray reaction never counts in A");

        var l = root.GetProperty("posts").EnumerateArray().Single(p => p.GetProperty("id").GetString() == leaky.ToString());
        l.GetProperty("author").GetProperty("handle").GetString().Should().BeEmpty();
        l.GetProperty("postedBy").ValueKind.Should().Be(JsonValueKind.Null);
        l.GetProperty("injectRef").ValueKind.Should().Be(JsonValueKind.Null);
        l.GetProperty("parentPostId").ValueKind.Should().Be(JsonValueKind.Null, "a parent outside A is not printed");
        l.GetProperty("replyToHandle").ValueKind.Should().Be(JsonValueKind.Null);

        (await _seed.TelemetryAsync(exerciseB)).Should().BeEmpty("A's report is recorded in A only");
    }

    // ---- Telemetry (XC-004) --------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task OneViewedEvent_PerRequest_StaffActor_PostsOnly()
    {
        var exerciseId = await _seed.ExerciseAsync(timeZone: "America/Chicago");
        var (token, staffUserId) = await _seed.StaffAsync(exerciseId, [(exerciseId, "evaluator")]);
        var persona = await _report.PersonaAsync(exerciseId, "cityfire", "City Fire Dept");
        await _seed.PostAsync(exerciseId, persona, 0, p => p.Body = "secret body text");
        await _seed.PostAsync(exerciseId, persona, 1);
        await _seed.PostAsync(exerciseId, persona, 2, p => p.Origin = "noise");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using (var first = await host.GetReportAsync(token))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var viewed = (await _seed.TelemetryAsync(exerciseId)).Should().ContainSingle(e => e.EventType == "export.report.viewed").Subject;
        viewed.Actor.ActingHumanId.Should().Be(staffUserId.ToString());
        viewed.Actor.Role.Should().Be("evaluator");
        viewed.Actor.SessionId.Should().NotBeNullOrEmpty();
        viewed.TimeZone.Should().Be("America/Chicago");
        viewed.Target!.EntityId.Should().Be(exerciseId.ToString());

        using var payload = JsonDocument.Parse(viewed.Payload!);
        payload.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(["posts"], "counts only: no text, no names");
        payload.RootElement.GetProperty("posts").GetInt32().Should().Be(2, "the listed posts (noise left out)");
        viewed.Payload.Should().NotContain("secret").And.NotContain("City Fire");

        using (var second = await host.GetReportAsync(token, "?includeNoise=true"))
        {
            second.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var events = (await _seed.TelemetryAsync(exerciseId)).Where(e => e.EventType == "export.report.viewed").ToList();
        events.Should().HaveCount(2, "one event per request");
    }

    // ---- Limit -------------------------------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task MoreThanFiveThousandListedPosts_Returns413_WithAReadableReason_AndNoTelemetry()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        await _seed.BulkPostsAsync(exerciseId, ExerciseReportService.MaxListedPosts + 1);

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId);
        using var response = await host.GetReportAsync(token);

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadAsStringAsync()).Should().Contain("more than the printable report can hold");
        (await _seed.TelemetryAsync(exerciseId)).Should().BeEmpty();
    }

    private static async Task<JsonDocument> ReadAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync());
}
