namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Identity.Sessions;
using Xunit;

/// <summary>
/// Composition-root guard for the world-steering Wave-2 slices (#350 pause tier, #351 participant overlay,
/// #352 storyline steering) — plain <see cref="FactAttribute"/>, no Docker. Mirrors
/// <c>Features/Ops/Bootstrap/CompositionRootWiringTests.cs</c>: boots the real
/// <see cref="WebApplicationFactory{TEntryPoint}"/> host so <c>Program.cs</c>'s full <c>Add*</c>/<c>Map*</c>
/// wiring actually runs, then asserts against the aggregate <see cref="EndpointDataSource"/> and the real
/// service provider.
/// </summary>
/// <remarks>
/// <para>
/// This exists because each slice's own tests build their OWN <c>ServiceCollection</c> or <c>TestServer</c>,
/// so they stay green while the real host never wires the slice — the #310→#317 defect class, where a fully
/// green slice merged with its orchestrator-owned wiring never called left the endpoint dead at 404.
/// </para>
/// <para>
/// #351 is the sharpest case and the reason the resolution assertions below exist: it maps NO route of its own
/// and edits NO handler. Participants read through participant-shell's already-mapped, byte-unchanged
/// <c>GET /api/overlay-state</c> — reached by contributing an <c>IOverlayStateProjection</c> behind it — and the
/// push rides the already-mapped <c>/hubs/exercise</c>. So the slice is pure service registration, and BOTH ways
/// it can be mis-wired degrade SILENTLY rather than 404ing: a forgotten
/// <c>AddPauseParticipantOverlay()</c> leaves #350's no-op publisher writing nothing, and calling it BEFORE
/// <c>AddExerciseLifecycle()</c> lets that call replace the read-side contribution back out. Either way a
/// controller's WORLD FROZEN never reaches participants and no route count can tell. Hence the two resolution
/// assertions: the real publisher, and the decorating projection.
/// </para>
/// <para>
/// Enumerating endpoints and resolving singletons only needs the host to BUILD, never a live database, so the
/// host is fed a dummy, never-connecting connection string.
/// </para>
/// </remarks>
public sealed class SteeringCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsTheWorldSteeringRoutes_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", "/api/steering/pause-tier").Should().Be(
            1,
            "POST /api/steering/pause-tier must be wired into Program.cs exactly once — without "
            + "MapPauseTierSteering() a controller's Freeze never reaches IExerciseClock and the engine keeps "
            + "generating while the console reads WORLD FROZEN (#350)");

        CountRoutes(dataSource, "GET", "/api/steering/pause-tier").Should().Be(
            1,
            "the pause-tier resync GET must be wired exactly once — the console adopts the server tier from it "
            + "on mount (#350)");

        CountRoutes(dataSource, "GET", "/api/steering/storylines/{storylineId}").Should().Be(
            1,
            "GET /api/steering/storylines/{storylineId} must be wired exactly once — without "
            + "MapStorylineSteering() the escalation dial renders its 'no live storyline' panel forever (#352)");

        CountRoutes(dataSource, "POST", "/api/steering/storylines/{storylineId}/target").Should().Be(
            1,
            "POST /api/steering/storylines/{storylineId}/target must be wired exactly once — it is the only "
            + "path by which a controller's target reaches the Storyline the reaction loop ticks (#352)");

        CountRoutes(dataSource, "GET", "/api/overlay-state").Should().Be(
            1,
            "participant-shell's GET /api/overlay-state must stay mapped exactly once — story 08 changes neither "
            + "its registration NOR its handler, only the projection resolved behind it (#351)");
    }

    [Fact]
    public void ProgramCs_ResolvesTheRealOverlayPublisher_NotStory07sNoOpDefault()
    {
        using var factory = new WiringProbeFactory();

        var publisher = factory.Services.GetRequiredService<IPauseOverlayPublisher>();

        publisher.Should().NotBeOfType<NullPauseOverlayPublisher>(
            "Program.cs must call AddPauseParticipantOverlay() AFTER AddPauseTierSteering() so the real "
            + "publisher replaces the no-op default — #351 maps no route, so a forgotten line cannot be caught "
            + "by a route count and would silently leave every Freeze invisible to participants");

        factory.Services.GetService<OverlayStateService>().Should().NotBeNull(
            "OverlayStateService must be registered in the real host — it is the store both the publisher writes "
            + "and the contributed overlay projection reads, and without it there is no pause state for "
            + "GET /api/overlay-state to serve at all");
    }

    /// <summary>
    /// <b>The ordering guard for story 08's read side, and the only place it can be caught.</b>
    /// <c>AddPauseParticipantOverlay()</c> <c>Replace</c>s <c>IOverlayStateProjection</c> with the decorator, and
    /// <c>AddExerciseLifecycle()</c> <c>Replace</c>s the SAME seam with the projection it decorates — so the LAST
    /// call wins. If <c>Program.cs</c> ever moves the world-steering block above the exercise-configuration wave-3
    /// contributors, the decorator is silently evicted, <c>GET /api/overlay-state</c> goes back to lifecycle-only,
    /// and a controller's WORLD FROZEN becomes invisible to participants again — with every slice-level suite still
    /// green, because each builds its own collection in its own order. Nothing but a real-host resolution can see it.
    /// </summary>
    [Fact]
    public void ProgramCs_ResolvesTheSteeringPauseOverlayProjection_NotTheLifecycleProjectionAlone()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IOverlayStateProjection>().Should()
            .BeOfType<SteeringPauseOverlayProjection>(
                "AddPauseParticipantOverlay() must run AFTER AddExerciseLifecycle() so the pause contribution "
                + "decorates the lifecycle projection rather than being replaced by it — reversed, a Freeze never "
                + "reaches a participant and no route count or slice test can tell (#351, the #310→#317 shape)");
    }

    /// <summary>
    /// <b>A deliberate NON-registration, pinned so nobody "finishes the merge".</b>
    /// <c>LifecycleProjection.cs</c> invites world-steering to contribute an <c>ISteeringOverlaySource</c> adapter
    /// over <c>OverlayStateService</c>. Under Tom's ruling that seam cannot be used: the lifecycle composer joins a
    /// steering pause with rule 2 ("pause if EITHER side asks"), and the source is never told the lifecycle status,
    /// so a frozen world that has since reached EndEx would compose to <c>pause</c> and put the holding page over a
    /// finished exercise. The floor therefore stays in place and the pause enters one level up, where it can be
    /// gated. Registering the adapter as well would reintroduce the ENDEX leak through the inner projection.
    /// </summary>
    [Fact]
    public void ProgramCs_LeavesTheSteeringOverlaySourceAtItsNoOpFloor_ByDesign()
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetRequiredService<ISteeringOverlaySource>().Should()
            .BeOfType<NoSteeringOverlaySource>(
                "world-steering deliberately does NOT register an ISteeringOverlaySource adapter — see "
                + "SteeringPauseOverlayProjection's remarks: the composer's either-side-pauses join cannot express "
                + "endex > pre-start > pause and would show a holding page after EndEx");
    }

    /// <summary>
    /// The "second registry would be catastrophic" invariant, made mechanical. Both
    /// <c>AddReactionLoopHost</c> and <c>AddStorylineSteering</c> <c>TryAdd</c> the SAME
    /// <see cref="IReactionLoopRegistry"/>, so they converge on one instance in either order — but that is a
    /// source-reading argument today. If a refactor ever registered a second registry (or resolved the
    /// concrete type), the steering endpoints would read <c>Storyline</c> objects the reaction loop never
    /// ticks: a controller's target would be recorded against a shadow object and the engine would never
    /// chase it. That is precisely the "real code nothing consumes" defect this wave exists to eliminate, and
    /// it would be invisible to every slice-level test.
    /// </summary>
    [Fact]
    public void ProgramCs_ResolvesExactlyOneReactionLoopRegistry_SharedByTheLoopAndTheSteeringEndpoints()
    {
        using var factory = new WiringProbeFactory();

        var first = factory.Services.GetRequiredService<IReactionLoopRegistry>();
        var second = factory.Services.GetRequiredService<IReactionLoopRegistry>();

        second.Should().BeSameAs(
            first,
            "IReactionLoopRegistry must be a singleton shared by the reaction-loop host and the storyline "
            + "steering endpoints — two instances would let a controller set a target on a storyline the loop "
            + "never ticks (#352)");

        factory.Services.GetServices<IReactionLoopRegistry>().Should().HaveCount(
            1,
            "only ONE IReactionLoopRegistry registration may exist; AddReactionLoopHost and "
            + "AddStorylineSteering both TryAdd it precisely so they converge rather than compete");
    }

    // ---- the identity-auth-roles/11 default-deny fallback vs. these four routes -------------------

    /// <summary>
    /// <b>The integration check for #361.</b> The world-steering routes were built before the default-deny session
    /// gate existed and gate themselves with <c>EngineCockpitStaffAuthorizationFilter</c> — an ENDPOINT FILTER, not
    /// ASP.NET authorization. <c>AddSessionAuthorization()</c>'s <c>RequireAuthenticatedUser</c> FALLBACK policy now
    /// runs ahead of every endpoint filter, so this pins that the specified outcomes survive: an unauthenticated
    /// caller still gets <c>401</c> (now written by the gate, with its RFC 6750 challenge, before any handler or
    /// database work), and an AUTHENTICATED-but-not-staff caller is passed through to the filter, which is what
    /// keeps the <c>403</c>/<c>200</c> half of the contract (proven behaviourally in
    /// <see cref="PauseTierEndpointsTests"/> / <c>StorylineSteeringEndpointsTests</c>).
    /// </summary>
    /// <remarks>
    /// Database-free by construction: the host resolver is stubbed and the connection string never connects, so a
    /// route that is answered before its handler proves it. If any of these ever needed
    /// <c>.AllowAnonymousPreAuth()</c> to keep working, that would be a deliberate allowlist diff — never a
    /// silent one.
    /// </remarks>
    [Theory]
    [InlineData("GET", "/api/steering/pause-tier")]
    [InlineData("POST", "/api/steering/pause-tier")]
    [InlineData("GET", "/api/steering/storylines/00000000-0000-0000-0000-000000000001")]
    [InlineData("POST", "/api/steering/storylines/00000000-0000-0000-0000-000000000001/target")]
    public async Task SteeringRoute_WithNoCredential_IsRefusedByTheDefaultDenyGate_BeforeTheEndpointFilter(
        string method, string route)
    {
        using var factory = new GatedSteeringProbeFactory();
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), route);
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "{0} {1} must stay 401 for an unauthenticated caller — the specified outcome is unchanged by #361, only "
            + "the layer that writes it moved outward",
            method,
            route);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty(
            "and it is the GATE that answers (it challenges per RFC 6750), so the safety-critical steering control "
            + "does no work at all — not even a scope read — for a caller with no session");
    }

    /// <summary>
    /// The other half: the fallback policy does NOT swallow an authenticated request. A live PARTICIPANT session
    /// passes authorization and reaches <c>EngineCockpitStaffAuthorizationFilter</c>, which refuses it itself (no
    /// STAFF session) — with no gate challenge header, which is what distinguishes "the filter decided" from "the
    /// gate decided". That hand-off is what keeps the shipped 403-not-assigned / 200-assigned outcomes intact.
    /// </summary>
    [Theory]
    [InlineData("GET", "/api/steering/pause-tier")]
    [InlineData("GET", "/api/steering/storylines/00000000-0000-0000-0000-000000000001")]
    public async Task SteeringRoute_WithALiveParticipantSession_ReachesTheStaffFilter_NotTheGate(
        string method, string route)
    {
        using var factory = new GatedSteeringProbeFactory(GatedSteeringProbeFactory.AcceptedToken);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), route);
        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", GatedSteeringProbeFactory.AcceptedToken);
        using var response = await client.SendAsync(request);

        // Only the hand-off is asserted, and the RFC 6750 challenge header is the discriminator — exactly the
        // idiom DefaultDenySessionGateTests.AllowlistedRoute_WithNoCredential_IsNeverRejectedByTheGate uses.
        // What the route then RETURNS is the staff filter's own business, and it is deliberately NOT asserted
        // here: reaching the filter means reaching its ICurrentStaffSessionAccessor lookup, which touches the
        // database this probe intentionally cannot connect to. The filter's 401-no-staff / 403-not-assigned /
        // 200-assigned outcomes are proven against real SQL in PauseTierEndpointsTests and
        // StorylineSteeringEndpointsTests.
        response.Headers.WwwAuthenticate.Should().BeEmpty(
            "an authenticated caller must get PAST the fallback policy — if the gate answered here, the staff "
            + "filter's own COR-005 assignment decision would be unreachable and every assigned controller would "
            + "be locked out of the cockpit");
        response.StatusCode.Should().NotBe(
            HttpStatusCode.Forbidden,
            "and in particular the fallback policy must not turn an authenticated non-staff caller into an "
            + "authorization 403 before the filter has had its say");
    }

    /// <summary>
    /// <c>GET /api/overlay-state</c> — the participant read story 08 contributes to — must stay a GATED but
    /// PARTICIPANT-reachable route: gated (so #359's anonymous read is closed) and never marked
    /// <c>AllowAnonymousPreAuth</c>, while carrying no authorization metadata of its own that would demand a STAFF
    /// principal. Its authenticated <c>200</c> is proven end to end against real SQL in
    /// <see cref="OverlayStateEndpointTests"/>.
    /// </summary>
    [Fact]
    public void OverlayStateRoute_IsGated_ButCarriesNoStaffOnlyAuthorizationMetadata()
    {
        using var factory = new WiringProbeFactory();

        var overlayEndpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => string.Equals(
                endpoint.RoutePattern.RawText, "/api/overlay-state", StringComparison.OrdinalIgnoreCase))
            .ToList();

        overlayEndpoints.Should().ContainSingle();
        overlayEndpoints[0].Metadata.GetMetadata<IAllowAnonymous>().Should().BeNull(
            "the participant overlay read is NOT on the pre-auth allowlist — an anonymous caller with only a Host "
            + "header must not learn an exercise's overlay state (#359)");
        overlayEndpoints[0].Metadata.GetMetadata<IAuthorizeData>().Should().BeNull(
            "and it declares no authorization metadata of its own, so it inherits exactly the default-deny "
            + "fallback — a live PARTICIPANT session is sufficient, which is what the holding page needs");
    }

    // NOT asserted here, deliberately: that each steering route still carries
    // EngineCockpitStaffAuthorizationFilter. `AddEndpointFilter<T>()` compiles the filter INTO the endpoint's
    // request delegate and leaves no metadata naming the filter type, so there is nothing to assert from the
    // EndpointDataSource — any check that looked like it verified the gate here would in fact verify nothing,
    // which is worse than no check. The real coverage is behavioural and lives where it can be observed: both
    // slices' TestServer suites drive the genuine Map* extensions and assert 401 (no staff session / unresolved
    // scope) and 403 (staff assigned elsewhere) — see PauseTierEndpointsTests and StorylineSteeringEndpointsTests.

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// The real <c>Program</c> host with the identity-auth-roles/11 gate fully in play, a host resolver that
    /// resolves every request to a fixed exercise (reproducing the #359 precondition: the scope resolves from the
    /// bare <c>Host</c> header and the caller still has no session), and a never-connecting connection string — so
    /// any route answered here provably did no database work. Mirrors <c>DefaultDenySessionGateTests</c>'s probe.
    /// </summary>
    private sealed class GatedSteeringProbeFactory : WebApplicationFactory<Program>
    {
        /// <summary>The one raw token this factory resolves to a live participant session, when asked to.</summary>
        internal const string AcceptedToken = "steering-gate-probe-live-session-token";

        private static readonly Guid ResolvedExerciseId = Guid.Parse("bbbbbbbb-0000-4000-8000-00000000000b");

        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";

        private readonly string? _acceptedToken;

        public GatedSteeringProbeFactory(string? acceptedToken = null)
        {
            _acceptedToken = acceptedToken;
            Environment.SetEnvironmentVariable(
                ConnectionStringEnvVar,
                "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);

            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IHostExerciseResolver>(new FixedHostExerciseResolver(ResolvedExerciseId));

                if (_acceptedToken is not null)
                {
                    services.AddScoped<ISessionAuthenticator>(
                        _ => new ParticipantOnlySessionAuthenticator(_acceptedToken, ResolvedExerciseId));
                }
            });
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    /// <summary>Resolves every host to one fixed exercise, with no database access.</summary>
    private sealed class FixedHostExerciseResolver : IHostExerciseResolver
    {
        private readonly Guid _exerciseId;

        public FixedHostExerciseResolver(Guid exerciseId) => _exerciseId = exerciseId;

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken)
            => Task.FromResult<Guid?>(_exerciseId);
    }

    /// <summary>
    /// Resolves one known raw token to a live <c>participant</c> session; everything else fails closed to
    /// <c>null</c>. Stubbing the authenticator (rather than seeding rows) keeps these plain
    /// <see cref="FactAttribute"/>s off the database while still driving the REAL middleware and the REAL gate.
    /// </summary>
    private sealed class ParticipantOnlySessionAuthenticator : ISessionAuthenticator
    {
        private readonly string _acceptedToken;
        private readonly Guid _exerciseId;

        public ParticipantOnlySessionAuthenticator(string acceptedToken, Guid exerciseId)
        {
            _acceptedToken = acceptedToken;
            _exerciseId = exerciseId;
        }

        public Task<AuthenticatedSession?> AuthenticateAsync(string rawToken, CancellationToken cancellationToken)
            => Task.FromResult(
                string.Equals(rawToken, _acceptedToken, StringComparison.Ordinal)
                    ? new AuthenticatedSession
                    {
                        SessionId = Guid.NewGuid(),
                        ExerciseId = _exerciseId,
                        Kind = "participant",
                        // Required since identity-auth-roles/13 (#362) made the telemetry envelope's actor
                        // server-authoritative. Values are arbitrary here — this probe only needs a session
                        // that AUTHENTICATES, so the default-deny fallback hands off to the endpoint rather
                        // than 401ing before the wiring under test is reached.
                        PrincipalId = "steering-wiring-probe-principal",
                        ActingHumanId = "steering-wiring-probe-human",
                    }
                    : null);
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS. Mirrors the Ops bootstrap slice's probe factory.
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
