namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The END-TO-END half of story 02's projection-override AC, plus the frozen-wire-shape and isolation
/// guarantees for <c>GET /api/chrome-config</c>. Every test drives the REAL participant endpoint through a
/// host composed by the REAL <c>Add*()</c> calls against real SQL Server — so what is under test is the whole
/// path (registration idiom → <c>ParticipantShellConfigService</c> → projection → wire), not a class in
/// isolation.
/// </summary>
/// <remarks>
/// <para>
/// <b>The negative control matters.</b> <see cref="ChromeConfig_WithoutStory02Wired_StillServesTheShippedConstant"/>
/// runs the identical seed through a host WITHOUT <c>AddComplianceChromeConfig()</c> and asserts the shipped
/// constant comes back. Without it, the positive assertions could pass for the wrong reason (e.g. if the
/// seeded values happened to match a default), and the "the contribution is what actually serves" claim would
/// be untested.
/// </para>
/// <para>
/// SQL-touching, so <c>[RequiresDockerFact]</c> throughout: these SKIP cleanly (a real xUnit <c>Skipped</c>)
/// where neither Docker nor <c>PULSE_TEST_SQL_CONNECTION</c> is present, and run in CI. The pure-DI assertions
/// live in <see cref="ChromeProjectionRegistrationTests"/>, outside this collection.
/// </para>
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ChromeConfigCompositionTests
{
    private const string ChromeConfigRoute = "/api/chrome-config";

    private readonly MsSqlContainerFixture _fixture;

    public ChromeConfigCompositionTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // ---- the projection-override contract, end to end --------------------------------------------

    [RequiresDockerFact]
    public async Task ChromeConfig_WithStory02Wired_ServesTheResolvedExercisesOwnBanners_EndToEnd()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ChromeTopText = "UNCLASSIFIED // ATLANTA CIE 2026";
            e.ChromeTopFg = "#f5f5f5";
            e.ChromeTopBg = "#14532d";
            e.ChromeBottomText = "SIMULATED INFORMATION SPACE — ATLANTA";
            e.ChromeBottomFg = "#f5f5f5";
            e.ChromeBottomBg = "#14532d";
        });

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("enabled").GetBoolean().Should().BeTrue();
        root.GetProperty("top").GetProperty("text").GetString().Should().Be(
            "UNCLASSIFIED // ATLANTA CIE 2026",
            "the contributed projection — not 01b's TryAdded constant — is what the endpoint resolves");
        root.GetProperty("top").GetProperty("fg").GetString().Should().Be("#f5f5f5");
        root.GetProperty("top").GetProperty("bg").GetString().Should().Be("#14532d");
        root.GetProperty("bottom").GetProperty("text").GetString().Should().Be(
            "SIMULATED INFORMATION SPACE — ATLANTA");
        root.GetProperty("bottom").GetProperty("fg").GetString().Should().Be("#f5f5f5");
        root.GetProperty("bottom").GetProperty("bg").GetString().Should().Be("#14532d");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_WithoutStory02Wired_StillServesTheShippedConstant()
    {
        // NEGATIVE CONTROL: the identical seed, minus AddComplianceChromeConfig(). If this also returned the
        // per-exercise banner, the test above would be proving nothing about the registration.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "UNCLASSIFIED // ATLANTA CIE 2026");

        await using var host = await StartHostAsync(exerciseId, includeComplianceChromeSlice: false);
        var root = await GetOkAsync(host);

        root.GetProperty("top").GetProperty("text").GetString().Should().Be(
            ParticipantShellDefaults.ChromeTopText,
            "without story 02's contribution 01b's constant-preserving default serves — which is exactly the "
            + "silent failure a TryAdd registration would have shipped");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_ForTwoExercises_ServesEachItsOwnBanners_AndNeverTheOthers()
    {
        // Isolation (always-Critical, COR-001/XC-001): Exercise is the SCOPE, so PulseDbContext's central query
        // filter is a NO-OP on the Exercises table — the server-resolved scope is the only guard, and this
        // proves it holds across two configured exercises.
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        await SeedExerciseAsync(exerciseA, e => e.ChromeTopText = "EXERCISE A TOP BANNER");
        await SeedExerciseAsync(exerciseB, e => e.ChromeTopText = "EXERCISE B TOP BANNER");

        await using var hostA = await StartHostAsync(exerciseA);
        var responseA = await hostA.Client.GetStringAsync(new Uri(ChromeConfigRoute, UriKind.Relative));

        await using var hostB = await StartHostAsync(exerciseB);
        var responseB = await hostB.Client.GetStringAsync(new Uri(ChromeConfigRoute, UriKind.Relative));

        responseA.Should().Contain("EXERCISE A TOP BANNER");
        responseA.Should().NotContain(
            "EXERCISE B TOP BANNER", "one exercise's compliance chrome must never reach another's participants");
        responseB.Should().Contain("EXERCISE B TOP BANNER");
        responseB.Should().NotContain("EXERCISE A TOP BANNER");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_WithAnUnresolvedScope_Returns401_FailClosed()
    {
        await using var host = await StartHostAsync(exerciseId: null);

        var response = await host.Client.GetAsync(new Uri(ChromeConfigRoute, UriKind.Relative));

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "an unresolved scope fails closed — never a default/empty 200 carrying somebody's chrome");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_ForAnUnconfiguredExercise_IsUnchangedFromThePreStory02Constants()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId);

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("enabled").GetBoolean().Should().BeTrue();
        root.GetProperty("top").GetProperty("text").GetString().Should().Be(ParticipantShellDefaults.ChromeTopText);
        root.GetProperty("top").GetProperty("fg").GetString().Should().Be(ParticipantShellDefaults.ChromeBannerFg);
        root.GetProperty("top").GetProperty("bg").GetString().Should().Be(ParticipantShellDefaults.ChromeBannerBg);
        root.GetProperty("bottom").GetProperty("text").GetString().Should().Be(ParticipantShellDefaults.ChromeBottomText);
    }

    // ---- the FROZEN wire shape -------------------------------------------------------------------

    [RequiresDockerFact]
    public async Task ChromeConfig_KeepsTheFrozenWireShape_ExactlyFourKeysAndThreePerBanner()
    {
        // A changed/added/removed key does NOT raise a type error — chromeConfig.ts's private isChromeConfig
        // guard rejects the body and the shell silently falls back to its default, blanking the per-exercise
        // config in UAT. So the key set is asserted exactly, not merely "contains".
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.ChromeTopText = "SHAPE CHECK");

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        // demo-feedback/01 adds exactly one key, `watermark` (XC-002: the ONLY new field on this participant projection).
        root.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            new[] { "enabled", "top", "bottom", "watermark" },
            "ChromeConfigResponse is frozen: fill it, never reshape it — watermark is the one sanctioned addition");

        foreach (var banner in new[] { "top", "bottom" })
        {
            root.GetProperty(banner).EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
                new[] { "text", "fg", "bg" }, "each banner carries exactly text, fg and bg");
        }

        root.GetProperty("enabled").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
        root.GetProperty("watermark").ValueKind.Should().BeOneOf(JsonValueKind.True, JsonValueKind.False);
        root.GetProperty("top").GetProperty("text").ValueKind.Should().Be(JsonValueKind.String);
    }

    // ---- demo-feedback/01: the media-marking flag (DF-3) -----------------------------------------

    [RequiresDockerTheory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public async Task ChromeConfig_ServesWatermark_EqualToTheExercisesWatermarkEnabled_WithEnabledUnchanged(
        bool chromeEnabled, bool watermarkEnabled)
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = chromeEnabled;
            e.WatermarkEnabled = watermarkEnabled;
        });

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("watermark").GetBoolean().Should().Be(
            watermarkEnabled, "watermark is the stored WatermarkEnabled verbatim, decoupled from the banner (DF-3)");
        root.GetProperty("enabled").GetBoolean().Should().Be(
            chromeEnabled || !watermarkEnabled,
            "enabled is still ResolveEffectiveChromeEnabled: chrome as stored, forced on when both markings are off");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_WithoutStory02Wired_StillServesTheExercisesWatermark()
    {
        // The constant default keeps its banners, but the media-marking flag is never a constant that disagrees with
        // the exercise's real NFR-008 state.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e => e.WatermarkEnabled = false);

        await using var host = await StartHostAsync(exerciseId, includeComplianceChromeSlice: false);
        var root = await GetOkAsync(host);

        root.GetProperty("watermark").GetBoolean().Should().BeFalse();
        root.GetProperty("top").GetProperty("text").GetString().Should().Be(ParticipantShellDefaults.ChromeTopText);
    }

    // ---- NFR-008 on the participant read path ----------------------------------------------------

    [RequiresDockerFact]
    public async Task ChromeConfig_WithChromeOffAndTheWatermarkOn_ServesEnabledFalse()
    {
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = false;
            e.WatermarkEnabled = true;
        });

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("enabled").GetBoolean().Should().BeFalse(
            "chrome-off is a legal per-exercise state (D7-008) while the watermark carries the signal");
    }

    [RequiresDockerFact]
    public async Task ChromeConfig_WithAStoredRowThatHasBothMarkingsOff_ServesEnabledTrue_NFR008()
    {
        // The API cannot produce this row (the write path 400s), so it is seeded directly — a hand-edited
        // database or a restore predating the guard. The participant read must still be marked.
        var exerciseId = Guid.NewGuid();
        await SeedExerciseAsync(exerciseId, e =>
        {
            e.ComplianceChromeEnabled = false;
            e.WatermarkEnabled = false;
        });

        await using var host = await StartHostAsync(exerciseId);
        var root = await GetOkAsync(host);

        root.GetProperty("enabled").GetBoolean().Should().BeTrue(
            "NFR-008 is a property of what participants see, not only of what the API accepts");
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static async Task<JsonElement> GetOkAsync(ChromeTestHost host, string route = ChromeConfigRoute)
    {
        var response = await host.Client.GetAsync(new Uri(route, UriKind.Relative));
        response.StatusCode.Should().Be(HttpStatusCode.OK, "{0} must return 200 on a resolved scope", route);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private async Task SeedExerciseAsync(Guid exerciseId, Action<Exercise>? configure = null)
    {
        var exercise = ExerciseConfigurationTestData.UnconfiguredExercise(exerciseId, "Chrome Composition Exercise");
        configure?.Invoke(exercise);

        await using var context = _fixture.CreateContext();
        context.Exercises.Add(exercise);
        await context.SaveChangesAsync();
    }

    private Task<ChromeTestHost> StartHostAsync(
        Guid? exerciseId,
        bool includeComplianceChromeSlice = true)
    {
        _fixture.ConnectionString.Should().NotBeNull(
            "the Docker-gated MsSql fixture must have started and captured its connection string before these tests run");
        return ChromeTestHost.StartAsync(
            _fixture.ConnectionString!,
            exerciseId,
            includeComplianceChromeSlice: includeComplianceChromeSlice);
    }
}
