namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Composition-root guard (plain <see cref="FactAttribute"/>, no Docker): boots the real
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host, resolves the aggregate
/// <see cref="EndpointDataSource"/> from its <c>Services</c>, and asserts <c>Program.cs</c> wires each Phase
/// B1 social route EXACTLY ONCE — a direct regression guard against the double-mapping (test host + Program.cs
/// both mapping a route) that would raise an <c>AmbiguousMatchException</c> at request time in CI.
/// </summary>
/// <remarks>
/// Enumerating endpoints only needs the host to BUILD, never a live database, so the host is fed a dummy,
/// never-connecting connection string (set as a process env var in the factory ctor, cleared on dispose).
/// This runs locally and validates the orchestrator's Program.cs wiring without a container.
/// </remarks>
public sealed class CompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsEachSocialHttpRouteExactlyOnce_AndMapsTheHub()
    {
        using var factory = new WiringProbeFactory();

        // Accessing Services builds the host, running Program.cs's full Map* wiring; the aggregate
        // EndpointDataSource then reflects every registered endpoint.
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/feed").Should().Be(
            1, "GET /api/feed must be mapped by Program.cs exactly once — a second (test-host) mapping would AmbiguousMatch");
        CountRoutes(dataSource, "GET", "/api/threads/{postId}").Should().Be(
            1, "GET /api/threads/{postId} must be mapped exactly once");
        CountRoutes(dataSource, "POST", "/api/posts").Should().Be(
            1, "POST /api/posts must be mapped exactly once");
        CountRoutes(dataSource, "GET", "/api/personas").Should().Be(
            1, "GET /api/personas must be mapped exactly once");

        HubEndpointCount(dataSource).Should().BeGreaterThanOrEqualTo(
            1, "the SignalR hub base route /hubs/exercise must be mapped by Program.cs (SignalR expands it into several sub-routes)");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    private static int HubEndpointCount(EndpointDataSource dataSource)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint => endpoint.RoutePattern.RawText is { } raw
                && raw.StartsWith("/hubs/exercise", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS — enumerating endpoints needs no live database. The env var is set in the ctor (before the
    /// host captures configuration) and cleared on dispose.
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
