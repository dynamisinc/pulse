namespace Pulse.WebApi.Tests.Features.DemoFeedback;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Exports;
using Pulse.WebApi.Features.Injects.Import;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social.Editing;
using Pulse.WebApi.Features.Social.Pins;
using Pulse.WebApi.Features.WhiteNoise;
using Xunit;

/// <summary>
/// Composition-root guard for the demo-feedback backend (#496, seam S-2; plain <see cref="FactAttribute"/>, no
/// Docker), mirroring <c>Features/ExerciseConfiguration/CompositionRootWiringTests.cs</c>: boots the REAL
/// <c>Program</c> host with NO <c>ConfigureTestServices</c> override, then asserts that <c>Program.cs</c> itself
/// registers and maps stories 02–05.
/// </summary>
/// <remarks>
/// <para>
/// Every story's own suite composes its slice through a test host (an <c>IStartupFilter</c> or a slice-only
/// <c>WebApplicationFactory</c>), so each merged fully green while <c>Program.cs</c> called none of the four
/// <c>Add*</c>/<c>Map*</c> pairs. This file is the one host that adds nothing, so it is the only place a missing
/// line is observable (the #310 → #317 lesson).
/// </para>
/// <para>
/// It also pins the two S-2 details the Gate-1 reviews raised: the CORS policy exposes <c>Content-Disposition</c>
/// (the console reads the export's file name cross-origin), and exactly one white-noise pacer runs.
/// </para>
/// <para>
/// Enumerating endpoints and resolving services only needs the host to BUILD, so it is fed a dummy,
/// never-connecting connection string. The white-noise pacer waits <c>FirstSweepDelay</c> before touching the
/// database, so the brief host lifetime here never reaches it.
/// </para>
/// </remarks>
public sealed class DemoFeedbackCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsEveryDemoFeedbackRouteExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        (string Method, string Route, string Story)[] expected =
        [
            ("GET", PostExportEndpoints.ExportRoute, "02 MapPostExport()"),
            ("POST", InjectImportEndpoints.ImportRoute, "03 MapInjectImport()"),
            ("GET", PinEndpoints.PinnedFeedRoute, "04 MapPostPins()"),
            ("PUT", PinEndpoints.StaffPinRoute, "04 MapPostPins()"),
            ("DELETE", PinEndpoints.StaffPinRoute, "04 MapPostPins()"),
            ("GET", WhiteNoiseEndpoints.NoiseRoute, "05 MapWhiteNoise()"),
            ("PUT", WhiteNoiseEndpoints.NoiseRoute, "05 MapWhiteNoise()"),
            ("PUT", WhiteNoiseEndpoints.PoolRoute, "05 MapWhiteNoise()"),
            ("PATCH", PostEditEndpoints.EditRoute, "19 MapPostEditing()"),
            ("GET", PostEditEndpoints.HistoryRoute, "19 MapPostEditing()"),
        ];

        foreach (var (method, route, story) in expected)
        {
            CountRoutes(dataSource, method, route).Should().Be(
                1,
                "{0} {1} must be wired into Program.cs exactly once via story {2}: missing, it 404s against the "
                + "real host while the story's own suite stays green; twice, it AmbiguousMatches at request time",
                method,
                route,
                story);
        }
    }

    [Fact]
    public void ProgramCs_RegistersEveryDemoFeedbackService_WithTheRealImplementations()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<PostExportService>().Should().NotBeNull("AddPostExport() registers the export (02)");
        provider.GetService<PostExportGate>().Should().NotBeNull(
            "the single-flight export gate (02) must be registered, or every export request fails to resolve");
        provider.GetService<InjectImportService>().Should().NotBeNull("AddInjectImport() registers the import (03)");
        provider.GetService<PinService>().Should().NotBeNull("AddPostPins() registers the exercise pin (04)");
        provider.GetService<PinnedFeedService>().Should().NotBeNull("AddPostPins() registers the Pinned tab read (04)");
        provider.GetService<WhiteNoiseService>().Should().NotBeNull("AddWhiteNoise() registers the knob + pool (05)");

        provider.GetRequiredService<IFeedBroadcaster>().Should().BeOfType<SignalRFeedBroadcaster>(
            "PostPinChanged (04) rides IFeedBroadcaster's default no-op unless the real SignalR broadcaster wins — "
            + "a fallback here would silently drop every exercise-pin push");
        provider.GetRequiredService<INoiseBroadcaster>().Should().BeOfType<NoiseBroadcaster>(
            "NoiseStateChanged (05) must reach the staff group through the real broadcaster");
        provider.GetRequiredService<INoiseJitterSource>().Should().BeOfType<CryptoNoiseJitterSource>(
            "production pacing uses the crypto jitter source; the seeded/fixed sources are test-only");
    }

    [Fact]
    public void ProgramCs_RunsExactlyOneWhiteNoisePacer()
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetServices<IHostedService>().OfType<WhiteNoisePacer>().Should().ContainSingle(
            "AddWhiteNoise() registers the pacer once; zero means white noise never posts, two would double the rate");
    }

    [Fact]
    public void ProgramCs_CorsPolicy_ExposesContentDisposition_SoTheConsoleCanReadTheExportFileName()
    {
        using var factory = new WiringProbeFactory(frontendBaseUrl: "https://console.example.test");

        var options = factory.Services.GetRequiredService<IOptions<CorsOptions>>().Value;
        var policy = options.GetPolicy("FrontendCors");

        policy.Should().NotBeNull("Program.cs registers the FrontendCors policy");
        policy!.ExposedHeaders.Should().Contain(
            "Content-Disposition",
            "story 09 downloads the export cross-origin (Static Web App → API) and must read the server's file "
            + "name; without the exposed header the browser hides it from script (02 Gate-1 M2)");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely BUILDS.
    /// It overrides NOTHING else. The optional frontend URL feeds the CORS policy (fail-closed, with no origins and
    /// no exposed headers, when absent). It goes in through <c>UseSetting</c>, scoped to THIS host, never a process
    /// environment variable: the easy-login join-link builder reads the same key, and a process-wide value would
    /// leak into tests running in parallel.
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly string? _frontendBaseUrl;

        public WiringProbeFactory(string? frontendBaseUrl = null)
        {
            _frontendBaseUrl = frontendBaseUrl;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            if (_frontendBaseUrl is not null)
            {
                builder.UseSetting("Authentication:FrontendBaseUrl", _frontendBaseUrl);
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
