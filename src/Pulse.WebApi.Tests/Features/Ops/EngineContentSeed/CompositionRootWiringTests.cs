namespace Pulse.WebApi.Tests.Features.Ops.EngineContentSeed;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

/// <summary>
/// Composition-root guard for the engine-content-seed slice (plain <see cref="FactAttribute"/>, no Docker),
/// mirroring <c>Features/Ops/Bootstrap/CompositionRootWiringTests.cs</c>: boots the real
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host, resolves the aggregate
/// <see cref="EndpointDataSource"/> from its <c>Services</c>, and asserts <c>Program.cs</c> wires the seed
/// route EXACTLY ONCE.
/// </summary>
/// <remarks>
/// This is a direct regression guard against the class of defect (login #310 → fix #317) where a merged
/// feature slice's "orchestrator-owned" <c>Program.cs</c> wiring (its <c>Add*</c>/<c>Map*</c> calls) is never
/// applied — the slice's own <c>TestServer</c> tests map the endpoint themselves, so they stay green while the
/// real host never maps it, leaving the endpoint dead (routing 404). This fails if
/// <c>MapEngineContentSeedEndpoints()</c> is ever dropped from <c>Program.cs</c> (and guards against an
/// accidental double-map, which would <c>AmbiguousMatch</c> at request time). Enumerating endpoints only needs
/// the host to BUILD, so it is fed a dummy, never-connecting connection string.
/// </remarks>
public sealed class CompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsTheSeedEngineContentEndpointExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", "/api/ops/seed-engine-content").Should().Be(
            1,
            "POST /api/ops/seed-engine-content must be wired into Program.cs exactly once — without "
            + "MapEngineContentSeedEndpoints() the endpoint is dead code (404) and nothing ever registers an "
            + "exercise with the reaction loop (the #324 gap this feature closes)");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS — enumerating endpoints needs no live database. The env var is set in the ctor (before the host
    /// captures configuration) and cleared on dispose. Mirrors the bootstrap slice's probe factory.
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
