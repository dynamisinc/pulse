namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Story identity-auth-roles/11 (#361) — the default-deny session gate that closes #359. Boots the REAL
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host (never a self-mapped <c>TestServer</c>, which would
/// prove nothing about <c>Program.cs</c>'s own wiring — see #310/#317) and drives it with NO credential.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why no test like this existed before.</b> Every pre-existing test in this suite authenticates first, or
/// fakes a resolved exercise scope through DI and presents no credential at all — which, before this story,
/// was indistinguishable from being authenticated. So nothing in a 747-test suite ever walked the anonymous
/// path, and 12 routes plus the SignalR hub sat open. These are the story's own spot checks; the exhaustive
/// sweep enumerated from the live <see cref="EndpointDataSource"/> is story 14 (#367).
/// </para>
/// <para>
/// The host is fed a dummy, never-connecting connection string: a 401 is written by
/// <c>AuthorizationMiddleware</c> BEFORE any handler runs, so no route under test reaches the database. That
/// is itself part of what these tests assert — a gated endpoint must not do work before it authorizes.
/// </para>
/// </remarks>
public sealed class DefaultDenySessionGateTests
{
    /// <summary>
    /// Routes proven open to an unauthenticated caller on 2026-07-25 (ENDPOINT-AUTH-AUDIT.md). Every one must
    /// now 401. <c>POST /api/telemetry</c> is here deliberately: it is an MVC controller, the surface a
    /// minimal-API <c>IEndpointFilter</c> could not have gated, and the reason this story chose
    /// <c>FallbackPolicy</c>.
    /// </summary>
    public static TheoryData<string, string> PreviouslyOpenRoutes() => new()
    {
        { "GET", "/api/feed" },
        { "GET", "/api/personas" },
        { "GET", "/api/threads/00000000-0000-0000-0000-000000000001" },
        { "GET", "/api/shell-state" },
        { "GET", "/api/chrome-config" },
        { "GET", "/api/brand-tokens" },
        { "GET", "/api/channel-nav-config" },
        { "GET", "/api/alerts" },
        { "GET", "/api/overlay-state" },
        { "POST", "/api/posts" },
        { "POST", "/api/telemetry" },
    };

    [Theory]
    [MemberData(nameof(PreviouslyOpenRoutes))]
    public async Task PreviouslyOpenRoute_WithNoCredential_Returns401(string method, string route)
    {
        using var factory = new GateProbeFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), route);
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "{0} {1} was reachable with no credential at all before identity-auth-roles/11 (#359); the "
            + "default-deny fallback policy must reject it before any handler runs",
            method,
            route);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty(
            "the 401 must come from the GATE (which challenges per RFC 6750), not incidentally from a handler "
            + "that ran anyway");
    }

    [Theory]
    [InlineData("GET", "/api/exercise-context")]
    [InlineData("POST", "/api/auth/login")]
    [InlineData("POST", "/api/auth/staff/login")]
    [InlineData("POST", "/api/auth/shared")]
    [InlineData("POST", "/api/auth/refresh")]
    [InlineData("POST", "/api/auth/logout")]
    [InlineData("GET", "/health")]
    [InlineData("GET", "/health/ready")]
    [InlineData("POST", "/api/ops/bootstrap-exercise")]
    [InlineData("POST", "/api/ops/seed-engine-content")]
    [InlineData("POST", "/api/ops/bind-participant-persona")]
    public async Task AllowlistedRoute_WithNoCredential_IsNeverRejectedByTheGate(string method, string route)
    {
        // These eleven must stay reachable pre-auth. What they RETURN is each endpoint's own business (400 for
        // a missing body, 404 for an unconfigured ops secret, and 401 from /api/auth/refresh itself when no
        // refresh token is presented); the regression guarded here is narrower and exact: the GATE must not be
        // what answers. The RFC 6750 challenge header is the discriminator — only the gate writes it.
        using var factory = new GateProbeFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), route);
        using var response = await client.SendAsync(request);

        response.Headers.WwwAuthenticate.Should().BeEmpty(
            "{0} {1} is on the pre-auth allowlist and must remain reachable without a session — the three "
            + "/api/ops/* routes especially, since bootstrap runs against an empty database with no session to "
            + "present and its X-Bootstrap-Secret is checked INSIDE the handler, after the gate",
            method,
            route);
    }

    [Fact]
    public async Task UnauthenticatedHubConnection_IsRefused_AndJoinsNoGroup()
    {
        // The exploit this closes: an unauthenticated client negotiated, handshook, joined exercise:{id} and
        // received a live PostReceived frame (#359, exploit 3). The hub's own empty-scope abort could never
        // have caught it — the host resolved perfectly well.
        using var factory = new GateProbeFactory();
        var server = factory.Server;

        await using var connection = new HubConnectionBuilder()
            .WithUrl(
                new Uri(server.BaseAddress, "hubs/exercise"),
                options =>
                {
                    options.HttpMessageHandlerFactory = _ => server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
            .Build();

        var start = async () => await connection.StartAsync();

        await start.Should().ThrowAsync<Exception>(
            "a connection presenting no session must never reach OnConnectedAsync, let alone join a group");
        connection.State.Should().Be(HubConnectionState.Disconnected);
    }

    [Fact]
    public void FallbackPolicy_RequiresAnAuthenticatedUser()
    {
        // The gate is default-DENY: the posture must come from the fallback policy (which applies wherever an
        // endpoint declares no authorization metadata), never from per-endpoint opt-in — per-endpoint opt-in
        // is exactly the pattern that produced #359.
        using var factory = new GateProbeFactory();

        var options = factory.Services.GetRequiredService<IOptions<AuthorizationOptions>>().Value;

        options.FallbackPolicy.Should().NotBeNull("without a fallback policy nothing is gated by default");
        options.FallbackPolicy!.Requirements.Should().ContainSingle()
            .Which.Should().BeOfType<DenyAnonymousAuthorizationRequirement>();
    }

    [Fact]
    public void EveryMappedEndpoint_IsEitherGated_OrOnTheElevenRouteAllowlist()
    {
        // The composition-root invariant, asserted against the LIVE route table rather than a hand-typed list:
        // an endpoint carries IAllowAnonymous if and only if PreAuthAllowlist names it. This is what makes a
        // future accidental .AllowAnonymous() — or an allowlist entry nobody marked — a failing build rather
        // than a silent hole. (Story 14 adds the behavioural sweep over the same enumeration.)
        using var factory = new GateProbeFactory();

        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>()
            .ToList();

        var anonymous = endpoints
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .SelectMany(PreAuthAllowlist.KeysFor)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        anonymous.Should().BeEquivalentTo(
            PreAuthAllowlist.Routes,
            "the set of endpoints marked .AllowAnonymousPreAuth() must be exactly PreAuthAllowlist — no "
            + "un-listed opt-out, and no listed route left unmarked");
    }

    [Fact]
    public void BothHubEndpoints_AreGated()
    {
        using var factory = new GateProbeFactory();

        var hubEndpoints = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("/hubs", StringComparison.OrdinalIgnoreCase) == true)
            .ToList();

        hubEndpoints.Should().HaveCount(2, "MapHub expands to the connection endpoint and its /negotiate sibling");
        hubEndpoints.Should().AllSatisfy(endpoint =>
            endpoint.Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull(
                "neither hub endpoint is on the pre-auth allowlist — {0}", endpoint.RoutePattern.RawText));
    }

    /// <summary>
    /// The real <c>Program</c> host with a dummy, never-connecting connection string and a host resolver that
    /// resolves every request to a fixed exercise. The stub is the point: it reproduces the #359 precondition
    /// exactly — the request's exercise scope resolves perfectly well from the <c>Host</c> header, and the
    /// caller still has no session. Before this story that combination was honored.
    /// </summary>
    private sealed class GateProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private static readonly Guid ResolvedExerciseId = Guid.Parse("aaaaaaaa-0000-4000-8000-00000000000a");

        public GateProbeFactory()
            => Environment.SetEnvironmentVariable(
                ConnectionStringEnvVar,
                "Server=nonexistent;Database=pulse;Trusted_Connection=False;");

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IHostExerciseResolver>(new AlwaysResolvingHostResolver(ResolvedExerciseId));
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    /// <summary>Resolves every host to one fixed exercise, with no database access.</summary>
    private sealed class AlwaysResolvingHostResolver : IHostExerciseResolver
    {
        private readonly Guid _exerciseId;

        public AlwaysResolvingHostResolver(Guid exerciseId) => _exerciseId = exerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
            => Task.FromResult<Guid?>(_exerciseId);
    }
}
