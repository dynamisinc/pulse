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
/// 10-and-1.5x rule. The exercise is UTC; <see cref="PostExportSeed.ScenarioStart"/> is 13:00.
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

    private static JsonElement PairOf(JsonElement[] pairs, string verifiedHandle) =>
        pairs.Should().ContainSingle(pair => pair.GetProperty("verified").GetProperty("handle").GetString() == verifiedHandle).Subject;

    private static async Task<JsonDocument> GetJsonAsync(ExerciseReportTestHost host, string token, string query)
    {
        using var response = await host.GetReportAsync(token, query);
        response.StatusCode.Should().Be(HttpStatusCode.OK, query);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }
}
