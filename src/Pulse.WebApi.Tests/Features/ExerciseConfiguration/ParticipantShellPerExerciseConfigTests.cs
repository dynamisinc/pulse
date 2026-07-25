namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Tests.Data;
using Xunit;

/// <summary>
/// The story-01b half of the participant-shell contract: the six config GETs now serve PER-EXERCISE data
/// (COR-030) through the UNCHANGED frozen wire shapes, they still fail closed with <c>401</c> on an
/// unresolved scope, and one exercise's configuration never reaches another's participants (XC-001).
/// </summary>
/// <remarks>
/// <c>Features/ParticipantShell/ParticipantShellEndpointsTests</c> keeps the wire-shape contract for an
/// exercise with nothing configured (the constants are preserved byte-for-byte); this suite adds the
/// configured cases, the isolation cases, and the fail-closed cases the settings refactor introduces.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ParticipantShellPerExerciseConfigTests
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

    public ParticipantShellPerExerciseConfigTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task BrandTokens_ConfiguredExercise_ServesThatExercisesBrand_InTheFrozenShape()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseId;
            exercise.BrandName = "Cobb County Connect";
            exercise.BrandPrimary = "#123456";
            exercise.BrandAccent = "#abcdef";
            exercise.BrandSurface = "#fefefe";
            exercise.BrandOnSurface = "#101010";
        });

        await using var host = await StartHostAsync(exerciseId);
        var (root, body) = await GetOkAsync(host, "/api/brand-tokens");

        root.GetProperty("name").GetString().Should().Be(
            "Cobb County Connect", "the hardcoded constant is gone — the exercise's configured brand is served");

        var colors = root.GetProperty("colors");
        colors.GetProperty("primary").GetString().Should().Be("#123456");
        colors.GetProperty("accent").GetString().Should().Be("#abcdef");
        colors.GetProperty("surface").GetString().Should().Be("#fefefe");
        colors.GetProperty("onSurface").GetString().Should().Be(
            "#101010", "OnSurface must still serialize to the camelCase wire key 'onSurface'");

        body.Should().NotContain(
            "\"logo\"", "the optional logo slot stays structurally absent — a \"logo\": null is not contract-valid");
    }

    [RequiresDockerFact]
    public async Task BrandTokens_PartiallyConfiguredExercise_FallsBackPerFieldToTheShippedConstants()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseId;
            exercise.BrandName = "Half Configured";
        });

        await using var host = await StartHostAsync(exerciseId);
        var (root, _) = await GetOkAsync(host, "/api/brand-tokens");

        root.GetProperty("name").GetString().Should().Be("Half Configured");
        root.GetProperty("colors").GetProperty("primary").GetString().Should().Be(
            ParticipantShellDefaults.BrandPrimary,
            "an unconfigured (null) column means 'not configured' and keeps serving the shipped constant");
    }

    [RequiresDockerFact]
    public async Task BrandTokens_UnconfiguredExercise_ServesTheShippedConstantsUnchanged()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise => exercise.Id = exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var (root, _) = await GetOkAsync(host, "/api/brand-tokens");

        root.GetProperty("name").GetString().Should().Be(ParticipantShellDefaults.BrandName);
        root.GetProperty("colors").GetProperty("onSurface").GetString().Should().Be(ParticipantShellDefaults.BrandOnSurface);
    }

    [RequiresDockerFact]
    public async Task BrandTokens_ExerciseA_NeverServesExerciseBsBrand()
    {
        // ISOLATION (always-Critical, COR-001/XC-001). Exercise is the SCOPE, so PulseDbContext's central
        // query filter is a NO-OP on this table — this proves the service's own scoping is what confines the
        // read, and that B's configured brand cannot reach A's participants.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseA;
            exercise.BrandName = "Exercise A Network";
        });
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseB;
            exercise.BrandName = "Exercise B Network";
        });

        await using var host = await StartHostAsync(exerciseA);
        var (root, body) = await GetOkAsync(host, "/api/brand-tokens");

        root.GetProperty("name").GetString().Should().Be(
            "Exercise A Network", "a participant in A sees only A's brand");
        body.Should().NotContain(
            "Exercise B Network", "another exercise's configuration must never appear on this response");
    }

    [RequiresDockerFact]
    public async Task ChannelNav_ConfiguredChannels_ReportsPerChannelEnabledFlags_AndAnEnabledCurrentChannel()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseId;
            exercise.EnabledChannels = "news,weather";
        });

        await using var host = await StartHostAsync(exerciseId);
        var (root, _) = await GetOkAsync(host, "/api/channel-nav-config");

        var channels = root.GetProperty("channels");
        channels.GetArrayLength().Should().Be(5, "the FULL catalog still ships — the client filters to enabled-only");

        EnabledById(channels, "social").Should().BeFalse("a channel the exercise did not enable is reported enabled:false");
        EnabledById(channels, "portal").Should().BeFalse();
        EnabledById(channels, "news").Should().BeTrue();
        EnabledById(channels, "press").Should().BeFalse();
        EnabledById(channels, "weather").Should().BeTrue();

        root.GetProperty("currentChannelId").GetString().Should().Be(
            "news", "the channel selected on mount must itself be enabled — social is off for this exercise");
        root.GetProperty("hideWhenSingleChannel").GetBoolean().Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task ChannelNav_UnconfiguredExercise_KeepsThePhase1Default_SocialOnly()
    {
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise => exercise.Id = exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var (root, _) = await GetOkAsync(host, "/api/channel-nav-config");

        var channels = root.GetProperty("channels");
        EnabledById(channels, "social").Should().BeTrue();
        EnabledById(channels, "portal").Should().BeFalse();
        EnabledById(channels, "news").Should().BeFalse();
        EnabledById(channels, "press").Should().BeFalse();
        EnabledById(channels, "weather").Should().BeFalse();
        root.GetProperty("currentChannelId").GetString().Should().Be("social");
    }

    [RequiresDockerFact]
    public async Task ChannelNav_UnparseableStoredValue_DegradesToThePlatformDefault_RatherThanBlankingTheShell()
    {
        // The column is a comma-separated string with no DB-level integrity. A hand-edited/legacy value must
        // not 500 a participant read or leave the shell with no channel at all.
        var exerciseId = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseId;
            exercise.EnabledChannels = "not-a-channel,,";
        });

        await using var host = await StartHostAsync(exerciseId);
        var (root, _) = await GetOkAsync(host, "/api/channel-nav-config");

        EnabledById(root.GetProperty("channels"), "social").Should().BeTrue();
        root.GetProperty("currentChannelId").GetString().Should().Be("social");
    }

    [RequiresDockerFact]
    public async Task ChannelNav_ExerciseA_NeverReportsExerciseBsChannelSelection()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseA;
            exercise.EnabledChannels = "social";
        });
        await SeedAsync(exercise =>
        {
            exercise.Id = exerciseB;
            exercise.EnabledChannels = "social,news,weather,press,portal";
        });

        await using var host = await StartHostAsync(exerciseA);
        var (root, _) = await GetOkAsync(host, "/api/channel-nav-config");

        var channels = root.GetProperty("channels");
        EnabledById(channels, "social").Should().BeTrue();
        EnabledById(channels, "news").Should().BeFalse("B's five enabled channels must not leak into A's nav");
        EnabledById(channels, "weather").Should().BeFalse();
    }

    [RequiresDockerFact]
    public async Task AllEndpoints_UnresolvedScope_Return401_NeverEmptyOkConfig()
    {
        await using var host = await StartHostAsync(exerciseId: null, authenticatedStaff: false);

        foreach (var route in AllRoutes)
        {
            var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "{0} must fail closed with 401 on an unresolved exercise scope — never a default/empty-but-200 config (COR-001)",
                route);
        }
    }

    [RequiresDockerFact]
    public async Task AllEndpoints_EmptyGuidScope_Return401_BecauseAnUnsetScopeCollapsesToGuidEmpty()
    {
        await using var host = await StartHostAsync(Guid.Empty, authenticatedStaff: false);

        foreach (var route in AllRoutes)
        {
            var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));

            response.StatusCode.Should().Be(
                HttpStatusCode.Unauthorized,
                "{0} must treat Guid.Empty as 'no scope resolved' — the write-guard guarantees no row carries it",
                route);
        }
    }

    private static bool EnabledById(JsonElement channels, string id) =>
        channels.EnumerateArray()
            .Single(c => c.GetProperty("id").GetString() == id)
            .GetProperty("enabled")
            .GetBoolean();

    private static async Task<(JsonElement Root, string Body)> GetOkAsync(ExerciseConfigurationTestHost host, string route)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 on a resolved scope", route);

        var body = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(body);
        return (document.RootElement.Clone(), body);
    }

    private async Task SeedAsync(Action<Exercise> configure)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(Guid.NewGuid());
        configure(exercise);

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private Task<ExerciseConfigurationTestHost> StartHostAsync(Guid? exerciseId, bool authenticatedStaff = true)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return ExerciseConfigurationTestHost.StartAsync(_fixture.ConnectionString!, exerciseId, authenticatedStaff);
    }
}
