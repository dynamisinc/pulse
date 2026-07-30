namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Features.Generation.Services;
using Xunit;

/// <summary>
/// Composition-root guard for autonomy-safety story 07 (the generation-provider egress lever) — plain
/// <see cref="FactAttribute"/>, no Docker. Boots the real <see cref="WebApplicationFactory{TEntryPoint}"/> host
/// so <c>Program.cs</c>'s full <c>Add*</c>/<c>Map*</c> wiring actually executes, then asserts against the
/// aggregate <see cref="EndpointDataSource"/> and the real service provider.
/// </summary>
/// <remarks>
/// <para>
/// This exists because the slice's own suites build their OWN <c>WebApplication</c>/<c>ServiceCollection</c>, so
/// they stay green while the real host never wires the slice — the #310→#317 defect class, where a fully green
/// feature merged with its wiring never called left the endpoint dead at 404. Story 07 needs no new
/// <c>Program.cs</c> line (both routes ride the already-wired <c>MapEngineReview()</c>, and the cut registry
/// rides the already-wired <c>AddEngineGeneration()</c>), which makes the guard MORE important, not less: the
/// wiring it depends on is someone else's line, and a future reorder or removal there would silently kill the
/// safety brake.
/// </para>
/// <para>
/// Enumerating endpoints and resolving singletons only needs the host to BUILD, never a live database, so the
/// host is fed a dummy, never-connecting connection string.
/// </para>
/// </remarks>
public sealed class GenerationProviderCutCompositionRootWiringTests
{
    private const string CutRoute = "/api/engine/generation-provider/cut-to-fake";
    private const string RestoreRoute = "/api/engine/generation-provider/restore";

    [Fact]
    public void ProgramCs_MapsBothGenerationProviderLeverRoutes_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", CutRoute).Should().Be(
            1,
            "POST {0} must be wired into the real host exactly once — without it a controller has no way to stop "
            + "the engine egressing mid-exercise, and the lever would ship dead at 404 (ADP-042)",
            CutRoute);

        CountRoutes(dataSource, "POST", RestoreRoute).Should().Be(
            1,
            "POST {0} must be wired exactly once — a cut with no reachable restore would be a one-way door for "
            + "the rest of the exercise (§8.2 human-only raise)",
            RestoreRoute);
    }

    [Theory]
    [InlineData(CutRoute)]
    [InlineData(RestoreRoute)]
    public async Task EachLeverRoute_IsReachableOnTheRealHost_AndAnswersWithAuthNotA404(string route)
    {
        // The behavioural form of the same guard: a route that was never mapped 404s, so "not 404" is exactly
        // the evidence the route table above is really in the request pipeline. WHAT it answers (401 from the
        // default-deny session gate) is asserted only as "an auth refusal, therefore a real endpoint" — the
        // gate/role/scope outcomes themselves are proven where they can be observed, in
        // EngineProviderCutEndpointsTests and EngineSettingsEndpointsTests against real SQL.
        using var factory = new WiringProbeFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Post, route)
        {
            Content = new StringContent(
                """{"actingHumanId":"controller-7","timeZone":"UTC"}""",
                System.Text.Encoding.UTF8,
                "application/json"),
        };
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().NotBe(
            HttpStatusCode.NotFound,
            "{0} must be a live endpoint on the REAL composition root; a 404 here is the #310→#317 dead-wiring "
            + "defect, which every slice-level TestServer suite is blind to",
            route);
        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "and an anonymous caller is refused by the default-deny gate before any handler work — the lever is "
            + "staff-only by construction (XC-002: participants must never learn the world is running on Fake)");
    }

    [Fact]
    public void ProgramCs_ResolvesExactlyOneGenerationProviderCutRegistry_SharedByTheLoopAndTheEndpoints()
    {
        using var factory = new WiringProbeFactory();

        var first = factory.Services.GetRequiredService<IGenerationProviderCutRegistry>();
        var second = factory.Services.GetRequiredService<IGenerationProviderCutRegistry>();

        second.Should().BeSameAs(
            first,
            "the cut registry must be a singleton: the settings POST writes it and the reaction loop's selector "
            + "reads it, so two instances would mean a controller's cut never reaches generation — a lever that "
            + "reports success and stops nothing");
        factory.Services.GetServices<IGenerationProviderCutRegistry>().Should().HaveCount(
            1, "only ONE registration may exist; AddEngineGeneration TryAdds it in exactly one place");
    }

    [Fact]
    public void ProgramCs_ResolvesTheCutAwareSelector_OverBothStartupProviders()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var selector = scope.ServiceProvider.GetRequiredService<IGenerationProvider>()
            .Should().BeOfType<GenerationProviderSelector>(
                "the real host must resolve the story-07 selector as its IGenerationProvider — resolving a bare "
                + "adapter instead would leave the cut registry written by a live, successful-looking endpoint "
                + "that generation never consults").Subject;

        selector.FakeProvider.Should().BeOfType<FakeGenerationProvider>(
            "the only destination a cut can land on is the offline provider (NFR-005 / ADP-025)");
        selector.ConfiguredProvider.Should().BeOfType<FakeGenerationProvider>(
            "and the committed appsettings default stays Provider=Fake, so this host cannot egress either way");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely BUILDS.
    /// Mirrors <c>Features/EngineRuntime/Steering/SteeringCompositionRootWiringTests</c>'s probe factory.
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
