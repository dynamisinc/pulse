namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC3 composition-root guard (no Docker): the REAL <c>Program</c> host maps
/// <c>POST /api/engine/settings/ambient-policy</c> exactly once on the already-wired engine group (no new
/// <c>Program.cs</c> line), refuses an anonymous caller, shares ONE ambient registry between the settings API and the
/// loop, resolves the interim lifecycle gate (the A5 seam), and binds the §8 flag to false from committed config.
/// </summary>
public sealed class AmbientCompositionRootWiringTests
{
    private const string Route = "/api/engine/settings/ambient-policy";

    [Fact]
    public void ProgramCs_MapsTheAmbientPolicyRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        dataSource.Endpoints.OfType<RouteEndpoint>()
            .Count(e => string.Equals(e.RoutePattern.RawText, Route, StringComparison.OrdinalIgnoreCase)
                && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains("POST") ?? false))
            .Should().Be(1, "the route rides the already-wired MapEngineReview()");
    }

    [Fact]
    public async Task TheRoute_IsLive_AndRefusesAnAnonymousCaller_401()
    {
        using var factory = new WiringProbeFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, Route)
        {
            Content = new StringContent(
                """{"actingHumanId":"controller-7","mode":"review","maxPerMinute":1,"maxPerHour":1}""",
                System.Text.Encoding.UTF8,
                "application/json"),
        };

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an unresolved, unauthenticated caller fails closed");
    }

    [Fact]
    public void ProgramCs_ResolvesOneAmbientRegistry_TheInterimGate_AndAnUnauthorizedFlag()
    {
        using var factory = new WiringProbeFactory();

        var registry = factory.Services.GetRequiredService<EngineAmbientPolicyRegistry>();
        factory.Services.GetServices<EngineAmbientPolicyRegistry>().Should().ContainSingle(
            "the settings POST and the loop must share one singleton or a policy would never reach the loop");
        registry.AutonomyAuthorized.Should().BeFalse("committed config merges dark (AC0)");

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<IEngineLifecyclePublishGate>()
            .Should().BeOfType<InterimEngineLifecyclePublishGate>("until Session A's A5 replaces this one registration");
    }

    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory()
            => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
