namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Follows;
using Pulse.WebApi.Features.Social.Suggestions;

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

    [Fact]
    public void ProgramCs_MapsEachFollowGraphRouteExactlyOnce_AndResolvesItsServices()
    {
        // profiles-social-graph/07 AC7 (the regression class, not a one-off check). These routes hang off the
        // persona resource and are composed into PersonaEndpoints' already-wired Add*/Map* rather than asking
        // for a new orchestrator-owned Program.cs line — so this assertion is what PROVES the composition
        // actually executes on the real host. A slice has merged fully green here before with its wiring never
        // executed and the endpoint dead at 404 (#310→#317); a self-mapped TestServer would mask exactly that.
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", "/api/personas/{personaId:guid}/follow").Should().Be(
            1, "POST /api/personas/{id}/follow must be reachable through Program.cs exactly once");
        CountRoutes(dataSource, "DELETE", "/api/personas/{personaId:guid}/follow").Should().Be(
            1, "DELETE /api/personas/{id}/follow must be reachable through Program.cs exactly once");
        CountRoutes(dataSource, "GET", "/api/personas/{personaId:guid}/following").Should().Be(
            1, "the caller's outbound follow read must be mapped exactly once");
        CountRoutes(dataSource, "GET", "/api/personas/{personaId:guid}/followers").Should().Be(
            1, "the inbound (real followers) read must be mapped exactly once");

        // DI half: the routes existing is not enough — the handlers' services must resolve from the real
        // composition root too, or the endpoint 500s on its first request.
        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<FollowService>().Should().NotBeNull(
            "AddSocialFollowGraph must be reached from Program.cs (via AddSocialPersonaRead/AddSocialFeedRead)");
        scope.ServiceProvider.GetRequiredService<ICurrentSessionPersonaAccessor>().Should().NotBeNull(
            "the write path's session-persona accessor must be registered on the real host");
        scope.ServiceProvider.GetRequiredService<PersonaReadService>().Should().NotBeNull(
            "the persona read composes the follow counts, so it must still resolve with its new dependency");
        scope.ServiceProvider.GetRequiredService<PostReadService>().Should().NotBeNull(
            "the feed read gained the Following scope's dependencies and must still resolve");
    }

    [Fact]
    public void ProgramCs_MapsTheSuggestionsRouteExactlyOnce_AndResolvesItsServices()
    {
        // profiles-social-graph/08 AC8. GET /api/personas/suggestions is composed into PersonaEndpoints' own
        // already-wired Add*/Map* (its route is a literal segment on the persona resource), so this assertion
        // is what PROVES the composition actually executes on the real host. The story exists precisely because
        // the frontend called a route that was never mapped — shipping the fix behind dead wiring would leave
        // participants staring at the same permanent error panel (CR-001, #310→#317).
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/personas/suggestions").Should().Be(
            1, "GET /api/personas/suggestions must be reachable through Program.cs exactly once");

        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<SuggestionService>().Should().NotBeNull(
            "AddSocialSuggestions must be reached from Program.cs (via AddSocialPersonaRead) — the route "
            + "existing is not enough, an unregistered dependency 500s on the first request");
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
