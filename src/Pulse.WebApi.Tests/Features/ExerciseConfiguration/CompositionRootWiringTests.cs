namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.ExerciseConfiguration;
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
