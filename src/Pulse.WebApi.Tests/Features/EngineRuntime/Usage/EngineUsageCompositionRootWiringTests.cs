namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Xunit;

/// <summary>
/// Composition-root guard for the AI-usage read (engine-telemetry-tuning story 03a, #401) — plain
/// <see cref="FactAttribute"/>, no Docker. Boots the real <see cref="WebApplicationFactory{TEntryPoint}"/> host
/// so <c>Program.cs</c>'s full <c>Add*</c>/<c>Map*</c> wiring actually executes, then asserts against the
/// aggregate <see cref="EndpointDataSource"/> and the real service provider. Mirrors
/// <c>Features/EngineRuntime/Steering/SteeringCompositionRootWiringTests.cs</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> The slice's own suites build their own <c>ServiceCollection</c>/<c>TestServer</c>, so
/// they stay green while the real host never wires the slice — the #310→#317 defect class, where a fully green
/// slice merged with its orchestrator-owned wiring never called and the endpoint sat dead at 404. This story
/// adds the FIRST telemetry read endpoint in <c>Pulse.WebApi</c>, and it rides an ALREADY-wired
/// <c>AddEngineReview</c>/<c>MapEngineReview</c> pair — which makes the failure mode subtler, not absent: a
/// registration added to the wrong extension method, or a route mapped on a group <c>Program.cs</c> does not
/// call, produces exactly the same dead endpoint.
/// </para>
/// <para>
/// <b>What this guard does NOT prove — read this before trusting it.</b> It proves (a) the route resolves in the
/// real host's route table, exactly once, on the expected HTTP method, and (b) the service and its bound options
/// resolve from the real provider. It does <b>not</b> execute the handler, does not run the query against a
/// database, and asserts nothing about authorization, isolation, the aggregation's numbers or the response
/// shape: the host is deliberately fed a dummy, never-connecting connection string, so any request would fail on
/// the first database touch. Those behaviours are proven where they can be observed — against real SQL in
/// <see cref="EngineUsageEndpointsTests"/> (status codes, isolation, wire shape) and as pure functions in
/// <see cref="EngineUsageAggregatorTests"/> (the numbers). Nor does it assert that the route carries
/// <c>EngineCockpitStaffAuthorizationFilter</c>: <c>AddEndpointFilter&lt;T&gt;()</c> compiles the filter INTO the
/// endpoint's request delegate and leaves no metadata naming the type, so a check that looked like it verified
/// the gate here would in fact verify nothing.
/// </para>
/// <para>
/// <b>A stated deviation from the story's integration-seam wording, not a silently narrower guard.</b>
/// <c>implementation.md</c>'s integration seam asks the composition-root guard to assert the route "resolves and
/// returns data through the real wiring". This guard delivers the RESOLVES half only. The "returns data" half is
/// met instead by <see cref="EngineUsageEndpointsTests"/>, which serves real 200s with real rows against real SQL
/// Server — but on a HAND-WIRED host (feature registrations only, no application middleware), so no test in this
/// story serves a 200 through <c>Program.cs</c>'s full pipeline. Doing that would need the real host pointed at a
/// live database plus a real issued staff session, which is a fixture this repo does not have and which this
/// behaviour-only edge does not earn. The residual risk is bounded and named: a defect in
/// <c>Program.cs</c>'s middleware ORDER around this route (rather than in its registrations, which are covered
/// here) would not be caught by this story's tests. That class of defect is what
/// <c>ExerciseConfiguration/LifecycleGatingPipelineOrderTests</c>' real-SQL probe exists for, and adding a usage
/// route to that kind of coverage belongs to whoever next needs a full-pipeline fixture.
/// </para>
/// </remarks>
public sealed class EngineUsageCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_MapsTheUsageRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "GET", "/api/engine/usage").Should().Be(
            1,
            "GET /api/engine/usage must be wired into Program.cs exactly once — it rides the already-wired "
            + "MapEngineReview() pair, so a route mapped on a group Program.cs never calls (or onto a new, "
            + "unwired slice) would leave the usage panel reading 404 forever with every slice test still green "
            + "(the #310→#317 shape)");

        // The two cockpit reads this route was added beside must be unaffected by the addition.
        CountRoutes(dataSource, "GET", "/api/engine/review-queue").Should().Be(1);
        CountRoutes(dataSource, "GET", "/api/engine/settings").Should().Be(1);
    }

    /// <summary>
    /// The other half of the wiring, and the half a route count cannot see: the handler's
    /// <see cref="EngineUsageService"/> parameter is resolved from request services at invocation time, so a
    /// registration added to the wrong extension method would surface only as a 500 in a deployed environment.
    /// The service is Scoped (it holds the <c>PulseDbContext</c> unit of work), so it is resolved from a real
    /// request-like scope rather than the root provider.
    /// </summary>
    [Fact]
    public void ProgramCs_ResolvesTheUsageService_FromARealRequestScope()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetService<EngineUsageService>().Should().NotBeNull(
            "AddEngineReview() must register EngineUsageService — without it the mapped route resolves its "
            + "handler dependency at request time and 500s, which no route count can detect");
    }

    /// <summary>
    /// The price table must bind from configuration in the REAL host. This is the one that catches a wrong
    /// section path: <c>BindConfiguration("Generation:Pricing")</c> is a string, and a typo would degrade every
    /// model to "unpriced" — a plausible-looking answer that no exception and no route count would reveal. The
    /// committed <c>appsettings.json</c> prices the <c>Fake</c> provider at zero (an honest zero: no egress, no
    /// tokens), so a bound table has exactly that entry and an unbound one has none.
    /// </summary>
    [Fact]
    public void ProgramCs_BindsThePriceTable_FromTheCommittedGenerationPricingSection()
    {
        using var factory = new WiringProbeFactory();

        var options = factory.Services.GetRequiredService<IOptions<EngineUsagePricingOptions>>().Value;
        var table = EngineUsagePriceTable.FromOptions(options);

        table.TryGetRates("Fake", "fake-deterministic", out var rates).Should().BeTrue(
            "the real host must bind Generation:Pricing — a wrong section path binds an EMPTY table, which "
            + "silently reports every model as 'unpriced' rather than throwing anything");
        rates!.InputPer1MTokens.Should().Be(0m, "Fake's zero rates are a fact, not a placeholder");
        table.Currency.Should().Be("USD");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely BUILDS.
    /// Enumerating endpoints and resolving services needs no live database — and the unreachable connection
    /// string is what keeps this a plain <see cref="FactAttribute"/> (and what bounds its claims: nothing here
    /// could execute a query even if it tried).
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
