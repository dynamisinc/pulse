namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Xunit;

/// <summary>
/// #661 S1: EVERY participant write route carries the held-world refusal (<c>RefuseWhenWritesPaused()</c>, #379).
/// The route set comes from the live <see cref="EndpointDataSource"/> of the REAL <c>Program</c> host, so a
/// participant write mapped tomorrow is caught the day it is mapped, with nobody writing a test for it.
/// </summary>
/// <remarks>
/// <para>
/// <b>How it sees a filter.</b> Endpoint filters are folded into the request delegate and are invisible on a built
/// endpoint, so <c>RefuseWhenWritesPaused()</c> also stamps <see cref="ParticipantWritePauseMetadata"/>. This suite
/// reads that marker.
/// </para>
/// <para>
/// <b>The only hand-maintained artifact is the exemption list</b> (<see cref="NotParticipantWritePrefixes"/>): route
/// prefixes that are staff, auth, ops or telemetry surfaces, none of which a participant writes the fiction through.
/// Every OTHER mutating endpoint (any verb but GET/HEAD/OPTIONS) must carry the marker. Adding a prefix here is a
/// reviewed decision that a whole surface is not participant-world.
/// </para>
/// <para>
/// Docker-free: the host is built against an unreachable connection string; building the endpoint data source never
/// opens a connection.
/// </para>
/// </remarks>
public sealed class ParticipantWriteRouteCoverageTests
{
    /// <summary>
    /// Route prefixes (segment-matched against the route pattern's raw text) that are NOT participant-world writes.
    /// </summary>
    private static readonly string[] NotParticipantWritePrefixes =
    [
        // Sign-in / session lifecycle (the pre-auth allowlist and its neighbours).
        "/api/auth",

        // The staff consoles and staff-only authoring/conduct surfaces.
        "/api/staff",
        "/api/engine",
        "/api/steering",
        "/api/injects",
        "/api/org",

        // Operator bootstrap / seeding (ops-key gated).
        "/api/ops",

        // Client telemetry ingest (XC-004 instrumentation, not the fiction).
        "/api/telemetry",

        // SignalR negotiate (the hub's own transport; live pushes are gated on the send side, #375).
        "/hubs",

        // Liveness / readiness probes (declared with no method constraint).
        "/health",
    ];

    /// <summary>The participant write routes #379 named, which the sweep must reach (a coverage guard, not an exemption).</summary>
    private static readonly string[] KnownParticipantWrites =
    [
        "POST /api/posts",
        "PATCH /api/posts/{postId:guid}",
        "PUT /api/posts/{postId:guid}/reactions/{kind}",
        "DELETE /api/posts/{postId:guid}/reactions/{kind}",
        "POST /api/personas/{personaId:guid}/follow",
        "DELETE /api/personas/{personaId:guid}/follow",
        "POST /api/media",
    ];

    [Fact]
    public void EveryParticipantWriteRoute_CarriesTheHeldWorldRefusal()
    {
        using var factory = new RouteTableFactory();

        var writes = ParticipantWrites(factory).ToList();

        writes.Select(write => write.Key).Should().Contain(
            KnownParticipantWrites,
            "the sweep must reach every participant write #379 guarded — otherwise a green result proves nothing");

        writes.Where(write => !write.Guarded).Select(write => write.Key).Should().BeEmpty(
            "#661 S1: a participant write route without RefuseWhenWritesPaused() lets a participant author into a "
            + "paused or frozen world. Add .RefuseWhenWritesPaused() to it, or, if the route is genuinely not a "
            + "participant-world write, add its surface to NotParticipantWritePrefixes in review");
    }

    [Fact]
    public void TheMarker_IsStampedOnlyAlongsideTheFilter_NeverOnAReadRoute()
    {
        using var factory = new RouteTableFactory();

        var markedReads = Endpoints(factory)
            .Where(endpoint => endpoint.Metadata.GetMetadata<ParticipantWritePauseMetadata>() is not null)
            .SelectMany(endpoint => Methods(endpoint).Select(method => (Method: method, endpoint.RoutePattern.RawText)))
            .Where(pair => pair.Method is "GET" or "HEAD")
            .Select(pair => $"{pair.Method} {pair.RawText}");

        markedReads.Should().BeEmpty("the held-world refusal is a write gate; a read carrying it would 409 a reader");
    }

    private static IEnumerable<RouteEndpoint> Endpoints(RouteTableFactory factory) =>
        factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>();

    private static IEnumerable<string> Methods(RouteEndpoint endpoint) =>
        endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["*"];

    private static IEnumerable<(string Key, bool Guarded)> ParticipantWrites(RouteTableFactory factory)
    {
        foreach (var endpoint in Endpoints(factory))
        {
            var raw = "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/');
            if (NotParticipantWritePrefixes.Any(prefix => IsUnder(raw, prefix)))
            {
                continue;
            }

            var guarded = endpoint.Metadata.GetMetadata<ParticipantWritePauseMetadata>() is not null;
            foreach (var method in Methods(endpoint))
            {
                if (method is "GET" or "HEAD" or "OPTIONS")
                {
                    continue;
                }

                yield return ($"{method} {raw}", guarded);
            }
        }
    }

    private static bool IsUnder(string route, string prefix) =>
        route.Equals(prefix, StringComparison.OrdinalIgnoreCase)
        || route.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase);

    /// <summary>The real <c>Program</c> host, pointed at an unreachable database (the route table needs none).</summary>
    private sealed class RouteTableFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        public RouteTableFactory() => Environment.SetEnvironmentVariable(
            ConnectionStringEnvVar,
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;");

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
