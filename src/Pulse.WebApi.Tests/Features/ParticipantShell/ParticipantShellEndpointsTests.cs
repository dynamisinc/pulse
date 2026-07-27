namespace Pulse.WebApi.Tests.Features.ParticipantShell;

using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Social;

/// <summary>
/// Integration tests for the six participant-shell config GET endpoints
/// (<c>src/Pulse.WebApi/Features/ParticipantShell</c>). Boots the real host through the shared
/// <see cref="SocialApiWebApplicationFactory"/> harness (the same one <c>FeedReadEndpointTests</c> uses —
/// it feeds the Testcontainers connection string and overrides the request's scoped
/// <see cref="Data.IExerciseContext"/>) and drives each endpoint over HTTP.
/// </summary>
/// <remarks>
/// Proves, per endpoint: with a resolved exercise scope the endpoint returns <c>200</c> with the exact
/// frozen JSON body the frontend shell seams' runtime type-guards expect (camelCase keys, the exact
/// enum-like string literals, <c>brand-tokens</c> carrying NO <c>logo</c> key); with NO resolved scope it
/// FAILS CLOSED with <c>401</c>, never a default/empty-but-200 config (COR-001). The consequential case is
/// <c>shell-state</c> returning <c>variant == "full"</c> — the value that restores the participant realtime
/// feed + "new posts" pill on UAT.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public class ParticipantShellEndpointsTests
{
    private static readonly string[] AllRoutes =
    [
        "/api/shell-state",
        "/api/chrome-config",
        "/api/brand-tokens",
        "/api/channel-nav-config",
        "/api/alerts",
        "/api/overlay-state",
    ];

    private readonly MsSqlContainerFixture _fixture;

    public ParticipantShellEndpointsTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// <c>/api/shell-state</c> serves the interactive <c>full</c> variant for a participant-accessible world.
    /// </summary>
    /// <remarks>
    /// <b>This test seeds a <c>live</c> exercise row; it used to seed nothing.</b> When it was written,
    /// <c>IShellVariantProjection</c> was 01b's <c>ConstantShellVariantProjection</c> and every resolved scope
    /// answered <c>full</c> regardless of the database. Wiring exercise-configuration story 03 into
    /// <c>Program.cs</c> Replace()s that with <c>LifecycleShellVariantProjection</c>, so the variant is now
    /// COR-032's lifecycle state — and a scope whose exercise ROW DOES NOT EXIST resolves to
    /// <c>ExerciseShellConfigSource.Unconfigured</c>, whose <c>Status</c> is <c>build</c>, which correctly
    /// projects to <c>preview</c>. Seeding the row restores this test's actual premise ("a participant-facing,
    /// participant-accessible exercise") rather than weakening its assertion: the point being pinned is still
    /// that <c>full</c> — the only variant <c>mountContract.ts</c>'s <c>affordancesAvailable()</c> grants — is
    /// what a live world serves.
    /// </remarks>
    [RequiresDockerFact]
    public async Task ShellState_ResolvedScope_Returns200_WithVariantFull()
    {
        var exerciseId = await SeedLiveExerciseAsync();

        var root = await GetOkRootAsync("/api/shell-state", exerciseId);

        root.GetProperty("variant").GetString().Should().Be(
            "full",
            "a resolved participant shell on a LIVE exercise must get the interactive 'full' variant — the "
            + "value that re-enables the realtime feed stream + 'new posts' pill (the UAT feed-not-updating fix)");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_ResolvedScope_Returns200_WithEnabledChromeAndBanners()
    {
        var root = await GetOkRootAsync("/api/chrome-config");

        root.GetProperty("enabled").GetBoolean().Should().BeTrue();

        var top = root.GetProperty("top");
        top.GetProperty("text").GetString().Should().Be(
            "UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED");
        top.GetProperty("fg").GetString().Should().Be("#eaf5e6");
        top.GetProperty("bg").GetString().Should().Be("#2e6b2e");

        var bottom = root.GetProperty("bottom");
        bottom.GetProperty("text").GetString().Should().Be(
            "PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE — NOT REAL NEWS");
        bottom.GetProperty("fg").GetString().Should().Be("#eaf5e6");
        bottom.GetProperty("bg").GetString().Should().Be("#2e6b2e");
    }

    [RequiresDockerFact]
    public async Task BrandTokens_ResolvedScope_Returns200_WithColors_AndNoLogoKey()
    {
        var (root, body) = await GetOkRootAndBodyAsync("/api/brand-tokens");

        root.GetProperty("name").GetString().Should().Be("Sample Exercise Network");

        var colors = root.GetProperty("colors");
        colors.GetProperty("primary").GetString().Should().Be("#2b5f75");
        colors.GetProperty("accent").GetString().Should().Be("#d97706");
        colors.GetProperty("surface").GetString().Should().Be("#ffffff");
        colors.GetProperty("onSurface").GetString().Should().Be(
            "#1c1c1c", "OnSurface must serialize to the camelCase wire key 'onSurface'");

        root.TryGetProperty("logo", out _).Should().BeFalse(
            "the optional logo slot is ABSENT — the response must never carry a 'logo' key (a \"logo\": null is not contract-valid)");
        body.Should().NotContain("\"logo\"", "belt-and-suspenders: the raw wire JSON has no logo key at all");
    }

    [RequiresDockerFact]
    public async Task ChannelNavConfig_ResolvedScope_Returns200_WithCatalog_OnlySocialEnabled()
    {
        var root = await GetOkRootAsync("/api/channel-nav-config");

        root.GetProperty("currentChannelId").GetString().Should().Be("social");
        root.GetProperty("hideWhenSingleChannel").GetBoolean().Should().BeFalse();

        var channels = root.GetProperty("channels");
        channels.ValueKind.Should().Be(JsonValueKind.Array);
        channels.GetArrayLength().Should().Be(5, "the full five-channel catalog ships even though only Social is enabled");

        AssertChannel(channels[0], id: "social", label: "Social", icon: "social", enabled: true);
        AssertChannel(channels[1], id: "portal", label: "Portal", icon: "portal", enabled: false);
        AssertChannel(channels[2], id: "news", label: "News", icon: "news", enabled: false);
        AssertChannel(channels[3], id: "press", label: "Press Room", icon: "press", enabled: false);
        AssertChannel(channels[4], id: "weather", label: "Weather", icon: "weather", enabled: false);
    }

    [RequiresDockerFact]
    public async Task Alerts_ResolvedScope_Returns200_WithEmptyAlertsArray()
    {
        var root = await GetOkRootAsync("/api/alerts");

        root.TryGetProperty("alerts", out var alerts).Should().BeTrue("the 'alerts' property must always be present");
        alerts.ValueKind.Should().Be(JsonValueKind.Array);
        alerts.GetArrayLength().Should().Be(0, "Phase-1 has no active alerts");
    }

    [RequiresDockerFact]
    public async Task OverlayState_ResolvedScope_Returns200_WithNoneInFictionEmpty()
    {
        var root = await GetOkRootAsync("/api/overlay-state");

        root.GetProperty("state").GetString().Should().Be("none");
        root.GetProperty("register").GetString().Should().Be(
            "in-fiction", "the register must be the exact hyphenated literal 'in-fiction', not a C# enum name");
        root.GetProperty("message").GetString().Should().Be(string.Empty);
    }

    [RequiresDockerFact]
    public async Task AllEndpoints_UnresolvedScope_Return401_NeverEmptyOkConfig()
    {
        await using var factory = CreateFactory(exerciseId: null);
        using var client = factory.CreateClient();

        foreach (var route in AllRoutes)
        {
            var response = await client.GetAsync(new Uri(route, UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "{0} must fail closed with 401 on an unresolved exercise scope — never a default/empty-but-200 config (COR-001)",
                route);
        }
    }

    private static void AssertChannel(JsonElement channel, string id, string label, string icon, bool enabled)
    {
        channel.GetProperty("id").GetString().Should().Be(id);
        channel.GetProperty("label").GetString().Should().Be(label);
        channel.GetProperty("icon").GetString().Should().Be(icon);
        channel.GetProperty("enabled").GetBoolean().Should().Be(enabled);
    }

    /// <summary>
    /// Seeds an exercise in the <c>live</c> lifecycle state with every config column left <c>null</c> (i.e.
    /// "not configured"), so the projections still serve the shipped Phase-1 constants while the exercise is
    /// genuinely participant-accessible.
    /// </summary>
    private async Task<Guid> SeedLiveExerciseAsync()
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");

        var exerciseId = Guid.NewGuid();

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(new Exercise
        {
            Id = exerciseId,
            Name = "Participant shell contract exercise",
            TimeZone = "UTC",
            Status = "live",
        });
        await context.SaveChangesAsync();

        return exerciseId;
    }

    private async Task<JsonElement> GetOkRootAsync(string route, Guid? exerciseId = null)
    {
        var (root, _) = await GetOkRootAndBodyAsync(route, exerciseId);
        return root;
    }

    private async Task<(JsonElement Root, string Body)> GetOkRootAndBodyAsync(string route, Guid? exerciseId = null)
    {
        await using var factory = CreateFactory(exerciseId ?? Guid.NewGuid());
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 on a resolved scope", route);

        var body = await response.Content.ReadAsStringAsync();
        var document = JsonDocument.Parse(body);
        return (document.RootElement.Clone(), body);
    }

    private SocialApiWebApplicationFactory CreateFactory(Guid? exerciseId)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return new SocialApiWebApplicationFactory(_fixture.ConnectionString!, exerciseId);
    }
}
