namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseConfiguration.PracticeMode;
using Xunit;

/// <summary>
/// Composition-root guard for the exercise-configuration slice (plain <see cref="FactAttribute"/>, no Docker),
/// mirroring <c>Features/Ops/Bootstrap/CompositionRootWiringTests.cs</c> and
/// <c>Features/Social/CompositionRootWiringTests.cs</c>: boots the REAL <c>Program</c> host with NO
/// <c>ConfigureTestServices</c> override of any kind, then asserts that <c>Program.cs</c> itself both
/// registers <see cref="ExerciseConfigurationExtensions.AddExerciseConfiguration"/> and maps
/// <see cref="ExerciseConfigurationExtensions.MapExerciseConfigurationEndpoints"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this slice needs the guard more than most (login #310 → fix #317).</b> Story 01b converted six
/// ALREADY-WORKING participant-shell GETs — <c>/api/shell-state</c>, <c>/api/chrome-config</c>,
/// <c>/api/brand-tokens</c>, <c>/api/channel-nav-config</c>, <c>/api/alerts</c>, <c>/api/overlay-state</c> —
/// from <c>static readonly</c> constants onto <see cref="ParticipantShellConfigService"/>, which ONLY
/// <c>AddExerciseConfiguration()</c> registers. Their routes are mapped by the untouched, already-wired
/// <c>MapParticipantShellEndpoints()</c>, so a missing registration does not show up as a 404 anywhere: the
/// routes still exist and fail at request time when the handler's dependency cannot be resolved. That would
/// break endpoints that worked before this story — the participant shell blanks in UAT.
/// </para>
/// <para>
/// <b>No override, deliberately.</b> The slice's own tests compose the registration themselves
/// (<c>ExerciseConfigurationTestHost</c>), and <c>SocialApiWebApplicationFactory</c> calls
/// <c>services.AddExerciseConfiguration()</c> in its <c>ConfigureTestServices</c> so the Program-booted
/// contract tests keep exercising the real routes until the wiring lands. Every one of those hosts therefore
/// carries a registration PRODUCTION does not, and none of them can fail on a missing composition-root line.
/// This file is the one host that adds nothing, so it is the only place the omission is observable.
/// </para>
/// <para>
/// <b>Wave 3 extends the same guard to the three contributor slices</b> — chrome (story 02), practice mode
/// (story 04) and lifecycle (story 03). Each merged fully green while <c>Program.cs</c> called NONE of its
/// extensions, and each fails differently when a line is missed: a missing
/// <c>AddComplianceChromeConfig()</c>/<c>AddExerciseLifecycle()</c> leaves 01b's <c>TryAdd</c>ed CONSTANT
/// projection serving every exercise the same shell (silent, nothing raises); a missing
/// <c>AddPracticeMode()</c> is a hard <c>GetRequiredService</c> throw, since that seam ships no fail-safe
/// default on purpose; a missing <c>Map*</c> 404s a staff surface that every slice-composed test proves works.
/// The tests below assert the resolved IMPLEMENTATION TYPE, not merely non-null, because non-null is exactly
/// what the un-replaced constant would also give.
/// </para>
/// <para>
/// The one wave-3 failure mode NO test in this file can see is <c>UseExerciseLifecycleGating()</c> being wired
/// above <c>UseExerciseResolution()</c> — a pipeline ORDER break, invisible to DI and route enumeration alike.
/// That guard needs a real request through the real pipeline against real SQL and lives in
/// <see cref="LifecycleGatingPipelineOrderTests"/>, under <c>[RequiresDockerFact]</c> and the SQL collection.
/// </para>
/// <para>
/// Enumerating endpoints and resolving services only needs the host to BUILD, never a live database, so it is
/// fed a dummy, never-connecting connection string (set as a process env var in the factory ctor, cleared on
/// dispose). Constructing a <c>PulseDbContext</c> opens no connection.
/// </para>
/// </remarks>
public sealed class CompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_CallsAddExerciseConfiguration_SoTheParticipantShellHandlersCanResolveTheirService()
    {
        using var factory = new WiringProbeFactory();

        // Accessing Services builds the host, running Program.cs's full Add*/Map* wiring.
        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<ParticipantShellConfigService>().Should().NotBeNull(
            "the six participant-shell config GETs mapped by the already-wired MapParticipantShellEndpoints() "
            + "now depend on ParticipantShellConfigService, which only AddExerciseConfiguration() registers — "
            + "without that line in Program.cs the routes still resolve but every request fails on an "
            + "unresolvable handler dependency, blanking the participant shell (the #310/#317 failure mode, "
            + "here breaking endpoints that previously WORKED)");
    }

    [Fact]
    public void ProgramCs_CallsAddExerciseConfiguration_SoTheThreeWave3ProjectionSeamsHaveTheirDefaults()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<IChromeConfigProjection>().Should().NotBeNull(
            "the constant-preserving chrome projection is the floor story 02 replaces — an unregistered seam "
            + "cannot be Replace()d and /api/chrome-config cannot be served");
        provider.GetService<IShellVariantProjection>().Should().NotBeNull(
            "the constant-preserving shell-variant projection is the floor story 03 replaces — /api/shell-state "
            + "depends on it");
        provider.GetService<IOverlayStateProjection>().Should().NotBeNull(
            "the constant-preserving overlay-state projection is the floor story 03 replaces — "
            + "/api/overlay-state depends on it");
    }

    [Fact]
    public void ProgramCs_MapsTheStaffExerciseSettingsRoutesExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", ExerciseSettingsEndpoints.SettingsRoute).Should().Be(
            1,
            "GET {0} must be wired into Program.cs exactly once via MapExerciseConfigurationEndpoints() — "
            + "without it the staff settings editor 404s against the real host, and a second mapping would "
            + "AmbiguousMatch at request time",
            ExerciseSettingsEndpoints.SettingsRoute);
        CountRoutes(dataSource, "PUT", ExerciseSettingsEndpoints.SettingsRoute).Should().Be(
            1,
            "PUT {0} must be wired into Program.cs exactly once — it is the only write path for the COR-030 "
            + "settings",
            ExerciseSettingsEndpoints.SettingsRoute);
    }

    /// <summary>
    /// Story 02: <c>Program.cs</c> must call <c>AddComplianceChromeConfig()</c>, or 01b's
    /// <c>ConstantChromeConfigProjection</c> keeps serving one identical banner set to every exercise —
    /// silently, with the whole story's own suite still green.
    /// </summary>
    [Fact]
    public void ProgramCs_CallsAddComplianceChromeConfig_SoChromeIsPerExerciseAndNotTheConstant()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetRequiredService<IChromeConfigProjection>().Should().BeOfType<ChromeConfigProjection>(
            "AddComplianceChromeConfig() Replace()s 01b's constant-preserving default — without that line in "
            + "Program.cs the seam still resolves (to ConstantChromeConfigProjection), so nothing raises and "
            + "/api/chrome-config hands every exercise the same shipped banners, which is precisely the defect "
            + "story 02 exists to fix");

        provider.GetService<ChromeSettingsService>().Should().NotBeNull(
            "the staff chrome read/write handlers resolve this service at request time — an unregistered one "
            + "leaves the mapped routes 500ing on an unresolvable handler dependency, not 404ing");
    }

    /// <summary>Story 02: both staff chrome verbs are mapped by <c>MapComplianceChromeEndpoints()</c>, once each.</summary>
    [Fact]
    public void ProgramCs_MapsTheStaffChromeSettingsRoutesExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", ChromeSettingsEndpoints.ChromeSettingsRoute).Should().Be(
            1,
            "GET {0} must be wired exactly once via MapComplianceChromeEndpoints() — omitted, the staff chrome "
            + "editor 404s against the real host; twice, it AmbiguousMatches at request time",
            ChromeSettingsEndpoints.ChromeSettingsRoute);
        CountRoutes(dataSource, "PUT", ChromeSettingsEndpoints.ChromeSettingsRoute).Should().Be(
            1,
            "PUT {0} must be wired exactly once — it is the only write path for the COR-031 chrome block and "
            + "the only place the NFR-008 chrome/watermark mutual guard runs",
            ChromeSettingsEndpoints.ChromeSettingsRoute);
    }

    /// <summary>
    /// Story 04: <c>AddPracticeMode()</c> is the ONLY registration of <see cref="IEvaluationEligibility"/>
    /// anywhere in the host — by design there is no fail-safe default, so a missing line is a loud
    /// <c>GetRequiredService</c> throw rather than a silent "everything is eligible". Naming it here means the
    /// throw arrives as a named guard failure at build time, not as a 500 in UAT.
    /// </summary>
    [Fact]
    public void ProgramCs_CallsAddPracticeMode_SoTheEvaluationEligibilitySeamExistsAtAll()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<IEvaluationEligibility>().Should().BeOfType<PracticeModeEvaluationEligibility>(
            "AddPracticeMode() is the only thing that registers the COR-033 eligibility seam E10's export "
            + "filtering will consume; omit it from Program.cs and the seam does not exist in the running host "
            + "at all — deliberately a hard failure, never a default that quietly leaks rehearsal data into an AAR");

        provider.GetService<PracticeModeService>().Should().NotBeNull(
            "the staff practice-mode handlers resolve this service at request time");
    }

    /// <summary>Story 04: both staff practice-mode verbs are mapped by <c>MapPracticeModeEndpoints()</c>, once each.</summary>
    [Fact]
    public void ProgramCs_MapsTheStaffPracticeModeRoutesExactlyOncePerVerb()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", PracticeModeEndpoints.PracticeModeRoute).Should().Be(
            1,
            "GET {0} must be wired exactly once via MapPracticeModeEndpoints()",
            PracticeModeEndpoints.PracticeModeRoute);
        CountRoutes(dataSource, "PUT", PracticeModeEndpoints.PracticeModeRoute).Should().Be(
            1,
            "PUT {0} must be wired exactly once — it is the only way the COR-033 flag is ever set",
            PracticeModeEndpoints.PracticeModeRoute);
    }

    /// <summary>
    /// Story 03: <c>Program.cs</c> must call <c>AddExerciseLifecycle()</c>, or 01b's constant projections keep
    /// answering <c>/api/shell-state</c> with <c>full</c> and <c>/api/overlay-state</c> with <c>none</c> for an
    /// archived or paused exercise — again silently, with the story's own suite green.
    /// </summary>
    [Fact]
    public void ProgramCs_CallsAddExerciseLifecycle_SoTheShellProjectionsAreLifecycleDrivenNotConstant()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetRequiredService<IShellVariantProjection>()
            .Should().BeOfType<LifecycleShellVariantProjection>(
                "AddExerciseLifecycle() Replace()s 01b's ConstantShellVariantProjection — without that line "
                + "/api/shell-state answers 'full' for a paused or archived world and nothing raises");
        provider.GetRequiredService<IOverlayStateProjection>()
            .Should().BeOfType<LifecycleOverlayStateProjection>(
                "AddExerciseLifecycle() Replace()s 01b's ConstantOverlayStateProjection — without that line "
                + "a paused exercise can never render its COR-032 holding page");

        provider.GetService<ExerciseLifecycleService>().Should().NotBeNull(
            "both the staff lifecycle endpoints AND the gating middleware resolve this service at request "
            + "time — the middleware does so with GetRequiredService, so a missing registration throws on "
            + "every gated participant request");
    }

    /// <summary>Story 03: the staff lifecycle read + transition routes are mapped once each.</summary>
    [Fact]
    public void ProgramCs_MapsTheStaffExerciseLifecycleRoutesExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", LifecycleEndpoints.LifecycleRoute).Should().Be(
            1,
            "GET {0} must be wired exactly once via MapExerciseLifecycleEndpoints()",
            LifecycleEndpoints.LifecycleRoute);
        CountRoutes(dataSource, "POST", LifecycleEndpoints.TransitionRoute).Should().Be(
            1,
            "POST {0} must be wired exactly once — it is the only COR-032 transition path, so a duplicate "
            + "mapping would AmbiguousMatch every StartEx/EndEx",
            LifecycleEndpoints.TransitionRoute);
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS. It deliberately overrides NOTHING else — adding this slice's registration here would defeat the
    /// entire purpose of the file. Mirrors the bootstrap/social slices' probe factories.
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;";

        public WiringProbeFactory()
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
