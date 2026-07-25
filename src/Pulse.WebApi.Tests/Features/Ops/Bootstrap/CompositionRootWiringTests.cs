namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

/// <summary>
/// Composition-root guard for the Ops bootstrap slice (plain <see cref="FactAttribute"/>, no Docker),
/// mirroring <c>Features/Social/CompositionRootWiringTests.cs</c>: boots the real
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host, resolves the aggregate
/// <see cref="EndpointDataSource"/> from its <c>Services</c>, and asserts <c>Program.cs</c> wires the slice's
/// routes EXACTLY ONCE — the bootstrap seed endpoint (story login/05) and the persona-binding endpoint (story
/// login/07, mapped inside the SAME <c>MapBootstrapEndpoints()</c> so it needs no new composition-root line).
/// </summary>
/// <remarks>
/// <para>
/// This is a direct regression guard against the class of defect where a merged feature slice's
/// "orchestrator-owned" <c>Program.cs</c> wiring (its <c>Add*</c>/<c>Map*</c> calls) is never applied — the
/// slice's own HTTP tests map the endpoint in their own <c>TestServer</c>, so they stay green while the real
/// host never maps it, leaving the endpoint dead (routing 404). That is exactly what happened between the
/// bootstrap slice merging and this endpoint being wired; this test fails if <c>MapBootstrapEndpoints()</c> is
/// ever dropped from <c>Program.cs</c> again. (It also guards against an accidental double-map, which would
/// <c>AmbiguousMatch</c> at request time.)
/// </para>
/// <para>
/// Enumerating endpoints only needs the host to BUILD, never a live database, so the host is fed a dummy,
/// never-connecting connection string (set as a process env var in the factory ctor, cleared on dispose).
/// The bootstrap endpoint is mapped regardless of whether <c>Authentication:Bootstrap:Secret</c> is
/// configured — the secret gates the RESPONSE (404 when unset), not the route registration.
/// </para>
/// </remarks>
public sealed class CompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsTheBootstrapEndpointExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        // Accessing Services builds the host, running Program.cs's full Map* wiring; the aggregate
        // EndpointDataSource then reflects every registered endpoint.
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", "/api/ops/bootstrap-exercise").Should().Be(
            1,
            "POST /api/ops/bootstrap-exercise must be wired into Program.cs exactly once — without "
            + "MapBootstrapEndpoints() the endpoint is dead code (404) and the UAT go-live runbook cannot seed "
            + "the first exercise");
    }

    [Fact]
    public void ProgramCs_MapsTheBindParticipantPersonaEndpointExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", "/api/ops/bind-participant-persona").Should().Be(
            1,
            "POST /api/ops/bind-participant-persona must be reachable on the REAL host (story login/07 AC2) — it is "
            + "mapped inside the existing MapBootstrapEndpoints(), so no new Program.cs line is needed and the "
            + "#310/#317 'merged green but never wired, dead at 404' failure mode cannot recur; the slice's own "
            + "self-mapped TestServer tests could not have caught that");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS — enumerating endpoints needs no live database. The env var is set in the ctor (before the
    /// host captures configuration) and cleared on dispose. Mirrors the Social slice's probe factory.
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
