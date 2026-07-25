namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Steering;

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
/// #351 is the sharpest case and the reason the publisher assertion below exists: it maps NO route of its own
/// (participants read through participant-shell's already-mapped <c>GET /api/overlay-state</c>, and the push
/// rides the already-mapped <c>/hubs/exercise</c>), and its handler resolves
/// <c>OverlayStateService</c> optionally via <c>RequestServices.GetService</c> — deliberately, because a hard
/// handler parameter for an unregistered type is inferred as a GET request BODY and throws at route-build
/// time, which would take the whole host and the five sibling shell-config endpoints down. The consequence is
/// that a forgotten <c>AddPauseParticipantOverlay()</c> degrades SILENTLY to the pre-story <c>none</c>
/// constant: a controller's WORLD FROZEN would simply never reach participants. No route count can catch
/// that, so this asserts the resolved publisher is the real implementation, not #350's no-op default.
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
            "participant-shell's GET /api/overlay-state must stay mapped exactly once — story 08 changes its "
            + "handler body, not its registration (#351)");
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
            "OverlayStateService must be registered in the real host — GET /api/overlay-state resolves it "
            + "optionally and falls back to the static 'none' constant when it is absent, so its absence is "
            + "indistinguishable from 'nobody froze anything'");
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
