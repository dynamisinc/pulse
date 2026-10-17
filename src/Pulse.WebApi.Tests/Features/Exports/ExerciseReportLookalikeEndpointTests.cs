namespace Pulse.WebApi.Tests.Features.Exports;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// <c>GET /api/staff/exports/report</c> over real SQL for demo-feedback story 32 (DF-48): a lookalike pair needs both
/// personas posting inside the window, each account carries its in-window post count, and <c>outdrew</c> follows the
/// 10-and-1.5x rule; and for story 33 (DF-49) controller-named pairs join the handle matches, replace a lookalike's
/// handle match, and are skipped when their target does not resolve to a verified author. The exercise is UTC; <see cref="PostExportSeed.ScenarioStart"/> is 13:00.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ExerciseReportLookalikeEndpointTests
{
    private const string Window = "?from=2033-09-04%2013:30&to=2033-09-04%2014:00";

    private static readonly DateTimeOffset Now = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);

    private readonly PostExportSeed _seed;
    private readonly ExerciseReportSeed _report;

    public ExerciseReportLookalikeEndpointTests(MsSqlContainerFixture fixture)
    {
        _seed = new PostExportSeed(fixture);
        _report = new ExerciseReportSeed(fixture);
    }

    [RequiresDockerFact]
    public async Task APair_NeedsBothPersonasPostingInsideTheWindow()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var water = await _report.PersonaAsync(exerciseId, "FairhavenWater", "Fairhaven Water Utility", verified: true);
        var waterUpd = await _report.PersonaAsync(exerciseId, "FairhavenWaterUpd", "Fairhaven Water Update");
        var police = await _report.PersonaAsync(exerciseId, "police", "Police", verified: true);
        var policeTips = await _report.PersonaAsync(exerciseId, "police_tips", "Police Tips");

        // FairhavenWater posts only before the window; its lookalike only inside it.
        await _seed.PostAsync(exerciseId, water, 0, p => p.Origin = "inject");
        await _seed.PostAsync(exerciseId, waterUpd, 40, p => p.Origin = "controller-as-persona");

        // police posts inside the window; its lookalike only after it.
        await _seed.PostAsync(exerciseId, police, 45, p => p.Origin = "engine");
        await _seed.PostAsync(exerciseId, policeTips, 90, p => p.Origin = "controller-as-persona");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        using var windowed = await GetJsonAsync(host, token, Window);
        windowed.RootElement.GetProperty("lookalikes").GetArrayLength()
            .Should().Be(0, "in each pair one side posted only outside the window");

        using var open = await GetJsonAsync(host, token, string.Empty);
        open.RootElement.GetProperty("lookalikes").EnumerateArray()
            .Select(pair => pair.GetProperty("lookalike").GetProperty("handle").GetString())
            .Should().Equal("@FairhavenWaterUpd", "@police_tips");
    }

    [RequiresDockerFact]
    public async Task APair_IsMatchedOverTheWholeExercise_SoAShorterPrefixNeverStandsInForTheRealAccount()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var kestrel = await _report.PersonaAsync(exerciseId, "Kestrel", "Kestrel Times", verified: true);
        var kestrelEm = await _report.PersonaAsync(exerciseId, "KestrelCoEM", "Kestrel County EM", verified: true);
        var alerts = await _report.PersonaAsync(exerciseId, "KestrelCoEM_Alerts", "Kestrel EM Alerts");

        // The real account posts only before the window; the shorter verified prefix and the lookalike post inside it.
        await _seed.PostAsync(exerciseId, kestrelEm, 0, p => p.Origin = "inject");
        await _seed.PostAsync(exerciseId, kestrel, 35, p => p.Origin = "engine");
        await _seed.PostAsync(exerciseId, alerts, 40, p => { p.Origin = "controller-as-persona"; p.BaselineRepostCount = 50; });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        using var windowed = await GetJsonAsync(host, token, Window);
        windowed.RootElement.GetProperty("lookalikes").GetArrayLength()
            .Should().Be(0, "@KestrelCoEM_Alerts imitates @KestrelCoEM, which posted only outside the window, not @Kestrel");

        using var open = await GetJsonAsync(host, token, string.Empty);
        var pair = open.RootElement.GetProperty("lookalikes").EnumerateArray().Should().ContainSingle().Subject;
        pair.GetProperty("verified").GetProperty("handle").GetString().Should().Be("@KestrelCoEM");
    }

    [RequiresDockerFact]
    public async Task EachAccount_CarriesItsInWindowPosts_AndOutdrewFollowsTheTenAndOneAndAHalfRule()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var water = await _report.PersonaAsync(exerciseId, "FairhavenWater", "Fairhaven Water Utility", verified: true);
        var waterUpd = await _report.PersonaAsync(exerciseId, "FairhavenWaterUpd", "Fairhaven Water Update");
        var fire = await _report.PersonaAsync(exerciseId, "cityfire", "City Fire", verified: true);
        var fireAlerts = await _report.PersonaAsync(exerciseId, "cityfire_alerts", "City Fire Alerts");

        // Water: 0 vs 1 (the 10/16 UAT case): no verdict. 100 likes before the window are not counted.
        await _seed.PostAsync(exerciseId, water, 0, p => { p.Origin = "inject"; p.BaselineLikeCount = 100; });
        await _seed.PostAsync(exerciseId, water, 35, p => p.Origin = "inject");
        await _seed.PostAsync(exerciseId, water, 50, p => p.Origin = "inject");
        await _seed.PostAsync(exerciseId, waterUpd, 40, p => { p.Origin = "controller-as-persona"; p.BaselineRepostCount = 1; });

        // Fire: 10 vs 15 (exactly 1.5x, at the floor 10 and above it): a verdict.
        await _seed.PostAsync(exerciseId, fire, 32, p => { p.Origin = "engine"; p.BaselineLikeCount = 6; p.BaselineRepostCount = 4; });
        await _seed.PostAsync(exerciseId, fireAlerts, 44, p => { p.Origin = "controller-as-persona"; p.BaselineRepostCount = 15; });

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, Window);
        var pairs = json.RootElement.GetProperty("lookalikes").EnumerateArray().ToArray();
        pairs.Should().HaveCount(2);

        var firePair = PairOf(pairs, "@cityfire");
        firePair.GetProperty("verified").GetProperty("posts").GetInt32().Should().Be(1);
        firePair.GetProperty("lookalike").GetProperty("posts").GetInt32().Should().Be(1);
        firePair.GetProperty("outdrew").GetBoolean().Should().BeTrue("15 is at least 10 and at least 1.5 x 10");

        var waterPair = PairOf(pairs, "@FairhavenWater");
        waterPair.GetProperty("verified").GetProperty("posts").GetInt32().Should().Be(2, "the 13:00 post is outside the window");
        waterPair.GetProperty("verified").GetProperty("likes").GetInt64().Should().Be(0);
        waterPair.GetProperty("lookalike").GetProperty("posts").GetInt32().Should().Be(1);
        waterPair.GetProperty("lookalike").GetProperty("reposts").GetInt64().Should().Be(1);
        waterPair.GetProperty("outdrew").GetBoolean().Should().BeFalse("1 repost against 0 is below the floor of 10");
    }

    // ---- Named pairs (story 33, DF-49) ---------------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ANamedPairThatSharesNoPrefix_IsListed_WithNamedTrue_AndFollowsTheStory32Rules()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var kestrel = await _report.PersonaAsync(exerciseId, "KestrelCoEM", "Kestrel County EM", verified: true);
        var official = await _report.PersonaAsync(
            exerciseId, "KestrelEM_Official", "Kestrel EM Official", imitatesPersonaId: kestrel);

        await _seed.PostAsync(exerciseId, kestrel, 35, p => { p.Origin = "inject"; p.BaselineLikeCount = 4; });
        await _seed.PostAsync(exerciseId, official, 40, p => { p.Origin = "controller-as-persona"; p.BaselineRepostCount = 12; });
        await _seed.PostAsync(exerciseId, official, 50, p => p.Origin = "controller-as-persona");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, Window);

        var pair = json.RootElement.GetProperty("lookalikes").EnumerateArray().Should().ContainSingle().Subject;
        pair.GetProperty("named").GetBoolean().Should().BeTrue("a controller named the pair; the handles share no prefix");
        pair.GetProperty("verified").GetProperty("handle").GetString().Should().Be("@KestrelCoEM");
        pair.GetProperty("lookalike").GetProperty("handle").GetString().Should().Be("@KestrelEM_Official");
        pair.GetProperty("lookalike").GetProperty("posts").GetInt32().Should().Be(2);
        pair.GetProperty("outdrew").GetBoolean().Should().BeTrue("12 reposts is at least 10 and at least 1.5 x 4");
    }

    [RequiresDockerFact]
    public async Task ANamedPair_ReplacesItsLookalikesHandleMatch_AndOtherHandleMatchesStay()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var police = await _report.PersonaAsync(exerciseId, "police", "Police", verified: true);
        var county = await _report.PersonaAsync(exerciseId, "CountyEM", "County EM", verified: true);
        var policeNews = await _report.PersonaAsync(exerciseId, "police_news", "Police News", imitatesPersonaId: county);
        var policeTips = await _report.PersonaAsync(exerciseId, "police_tips", "Police Tips");

        foreach (var (persona, minute) in new[] { (police, 32), (county, 34), (policeNews, 36), (policeTips, 38) })
        {
            await _seed.PostAsync(exerciseId, persona, minute, p => p.Origin = "controller-as-persona");
        }

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, Window);

        json.RootElement.GetProperty("lookalikes").EnumerateArray()
            .Select(pair => (
                Verified: pair.GetProperty("verified").GetProperty("handle").GetString(),
                Lookalike: pair.GetProperty("lookalike").GetProperty("handle").GetString(),
                Named: pair.GetProperty("named").GetBoolean()))
            .Should().Equal(
                ("@CountyEM", "@police_news", true),
                ("@police", "@police_tips", false));
    }

    [RequiresDockerFact]
    public async Task ADanglingOrCrossExerciseOrNoLongerVerifiedTarget_IsSkipped_WithNoError()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var otherExerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);

        // Written straight to the table (the PATCH would refuse each): the report must still skip them safely.
        var otherVerified = await _report.PersonaAsync(otherExerciseId, "OtherCounty", "Other County", verified: true);
        var demoted = await _report.PersonaAsync(exerciseId, "FormerlyVerified", "Formerly Verified");
        var dangling = await _report.PersonaAsync(exerciseId, "Impostor_A", "Impostor A", imitatesPersonaId: Guid.NewGuid());
        var crossExercise = await _report.PersonaAsync(exerciseId, "Impostor_B", "Impostor B", imitatesPersonaId: otherVerified);
        var namesDemoted = await _report.PersonaAsync(exerciseId, "Impostor_C", "Impostor C", imitatesPersonaId: demoted);

        foreach (var (persona, minute) in new[] { (demoted, 32), (dangling, 34), (crossExercise, 36), (namesDemoted, 38) })
        {
            await _seed.PostAsync(exerciseId, persona, minute, p => p.Origin = "controller-as-persona");
        }

        await _seed.PostAsync(otherExerciseId, otherVerified, 33, p => p.Origin = "inject");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);
        using var json = await GetJsonAsync(host, token, Window);

        json.RootElement.GetProperty("lookalikes").GetArrayLength().Should().Be(
            0, "no target resolves to a verified author in this exercise; another exercise's persona never does (COR-001)");
    }

    [RequiresDockerFact]
    public async Task ANamedPair_StillNeedsBothSidesPostingInsideTheWindow()
    {
        var exerciseId = await _seed.ExerciseAsync();
        var (token, _) = await _seed.StaffAsync(exerciseId, [(exerciseId, "controller")]);
        var kestrel = await _report.PersonaAsync(exerciseId, "KestrelCoEM", "Kestrel County EM", verified: true);
        var official = await _report.PersonaAsync(
            exerciseId, "KestrelEM_Official", "Kestrel EM Official", imitatesPersonaId: kestrel);
        var water = await _report.PersonaAsync(exerciseId, "FairhavenWater", "Fairhaven Water", verified: true);
        await _report.PersonaAsync(exerciseId, "Water_Updates", "Water Updates", imitatesPersonaId: water);

        // Kestrel posts only before the window, its lookalike inside it. The water impostor never posts at all.
        await _seed.PostAsync(exerciseId, kestrel, 0, p => p.Origin = "inject");
        await _seed.PostAsync(exerciseId, official, 40, p => p.Origin = "controller-as-persona");
        await _seed.PostAsync(exerciseId, water, 45, p => p.Origin = "inject");

        await using var host = await ExerciseReportTestHost.StartAsync(_seed.ConnectionString, exerciseId, utcNow: Now);

        using var windowed = await GetJsonAsync(host, token, Window);
        windowed.RootElement.GetProperty("lookalikes").GetArrayLength()
            .Should().Be(0, "a named pair follows story 32: both sides must post inside the window, and both must be authors");

        using var open = await GetJsonAsync(host, token, string.Empty);
        var pair = open.RootElement.GetProperty("lookalikes").EnumerateArray().Should().ContainSingle().Subject;
        pair.GetProperty("lookalike").GetProperty("handle").GetString().Should().Be("@KestrelEM_Official");
        pair.GetProperty("named").GetBoolean().Should().BeTrue();
    }

    private static JsonElement PairOf(JsonElement[] pairs, string verifiedHandle) =>
        pairs.Should().ContainSingle(pair => pair.GetProperty("verified").GetProperty("handle").GetString() == verifiedHandle).Subject;

    private static async Task<JsonDocument> GetJsonAsync(ExerciseReportTestHost host, string token, string query)
    {
        using var response = await host.GetReportAsync(token, query);
        response.StatusCode.Should().Be(HttpStatusCode.OK, query);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }
}
