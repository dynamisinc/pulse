namespace Pulse.WebApi.Tests.Features.ExerciseLifecycleAdmin;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.ExerciseLifecycleAdmin;
using Xunit;

/// <summary>
/// Composition-root guard for the exercise-lifecycle-admin slice (plain <see cref="FactAttribute"/>, no
/// Docker). Boots the REAL <c>Program</c> host with no <c>ConfigureTestServices</c> override of any kind and
/// asserts that <c>Program.cs</c> itself both registers
/// <see cref="ExerciseLifecycleAdminEndpoints.AddExerciseLifecycleAdmin"/> and maps
/// <see cref="ExerciseLifecycleAdminEndpoints.MapExerciseLifecycleAdminEndpoints"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this file exists.</b> A feature slice can merge fully green with its orchestrator-owned wiring never
/// called: the slice's own suites build their own hosts, so the endpoint sits dead at 404 in the deployed
/// environment with every test still passing (#310 → #317). This slice is a NEW <c>Add*</c>/<c>Map*</c> pair
/// plus a NEW pipeline call, so all three of those lines are omittable.
/// </para>
/// <para>
/// <b>What this guard does NOT prove, stated rather than implied.</b> It proves the routes resolve in the real
/// route table exactly once on the expected verbs, and that the handlers' scoped dependencies resolve from the
/// real provider. It does NOT execute a handler, touch a database, or verify the role filters —
/// <c>AddEndpointFilter</c> compiles the filter INTO the endpoint's request delegate and leaves no metadata
/// naming the type, so a check that appeared to verify the gate here would verify nothing. Authorization,
/// isolation and status codes are proven where they are observable: against real SQL in
/// <see cref="ExerciseCreationEndpointTests"/>, <see cref="ExerciseListEndpointTests"/> and
/// <see cref="OrgAdminSurfaceFamilyTests"/>. The third wiring line —
/// <c>app.UseOrganizationResolution()</c>'s POSITION in the pipeline — is invisible to DI and route
/// enumeration alike and is guarded by <see cref="OrganizationResolutionPipelineOrderTests"/>, which needs a
/// real request against real SQL.
/// </para>
/// <para>
/// Deliberately OUTSIDE the SQL collection: a plain <c>[Fact]</c> in a collection class constructs the
/// container fixture regardless and would turn a Docker-less run red (a standing Gate-2 finding). Enumerating
/// endpoints and resolving services only needs the host to BUILD, so it is fed a dummy, never-connecting
/// connection string; constructing a <c>PulseDbContext</c> opens no connection.
/// </para>
/// </remarks>
public sealed class CompositionRootWiringTests
{
    /// <summary>The three org-tier routes must each be mapped exactly once by the real composition root.</summary>
    [Fact]
    public void ProgramCs_MapsTheThreeOrgAdministrationRoutes_ExactlyOnceEach()
    {
        using var factory = new WiringProbeFactory();

        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        CountRoutes(dataSource, "POST", ExerciseLifecycleAdminEndpoints.ExercisesRoute).Should().Be(
            1,
            "POST {0} must be wired into Program.cs exactly once via MapExerciseLifecycleAdminEndpoints() — "
            + "omitted, COR-074's creation path 404s in every deployed environment while this slice's own "
            + "suites stay green; twice, it AmbiguousMatches at request time",
            ExerciseLifecycleAdminEndpoints.ExercisesRoute);

        CountRoutes(dataSource, "GET", ExerciseLifecycleAdminEndpoints.ExercisesRoute).Should().Be(
            1,
            "GET {0} must be wired exactly once — it is COR-075's only org-scoped exercise list",
            ExerciseLifecycleAdminEndpoints.ExercisesRoute);

        CountRoutes(dataSource, "GET", ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute).Should().Be(
            1,
            "GET {0} must be wired exactly once — it is COR-076's org-admin roster read, and the only "
            + "endpoint in the codebase gated on orgAdmin alone",
            ExerciseLifecycleAdminEndpoints.StaffAssignmentsRoute);
    }

    /// <summary>
    /// The other half of the wiring, and the half a route count cannot see: every handler resolves its service
    /// from request services at invocation time, so a missing <c>AddExerciseLifecycleAdmin()</c> would surface
    /// only as a 500 in a deployed environment. All four are Scoped (they hold the <c>PulseDbContext</c> unit
    /// of work), so they are resolved from a real request-like scope rather than the root provider.
    /// </summary>
    [Fact]
    public void ProgramCs_CallsAddExerciseLifecycleAdmin_SoEveryHandlerDependencyResolves()
    {
        using var factory = new WiringProbeFactory();

        using var scope = factory.Services.CreateScope();
        var provider = scope.ServiceProvider;

        provider.GetService<StaffCallerContext>().Should().NotBeNull(
            "the OrgAdminAuthorizationFilter resolves this from HttpContext.RequestServices on EVERY gated "
            + "request — an unregistered one throws before any handler runs, on all three routes at once");
        provider.GetService<ExerciseCreationService>().Should().NotBeNull();
        provider.GetService<ExerciseListService>().Should().NotBeNull();
        provider.GetService<OrgStaffDirectoryService>().Should().NotBeNull();
        provider.GetService<ExerciseManagementService>().Should().NotBeNull("story 22's rename and archive handlers");
    }

    /// <summary>
    /// The route table's shape is itself part of the isolation guarantee. No org-tier route may take an
    /// organization id or a staff-user id, and until demo-feedback story 22 none took any parameter at all. Story
    /// 22's row actions need an EXERCISE id, so the rule is now an explicit allow-list
    /// (<see cref="ExerciseLifecycleAdminEndpoints.ExerciseIdRoutes"/>): the parameterized org routes must be
    /// EXACTLY that list, each taking ONE <c>exerciseId</c> with a <c>guid</c> constraint, and every entry must be
    /// driven by <see cref="OrgExerciseByIdIsolationTests"/>, which proves it answers another customer's exercise
    /// with the same bare 404 as an id that does not exist. A new id-bearing org route therefore fails here until it
    /// is allow-listed, and cannot be allow-listed without a foreign-tenant 404 test.
    /// </summary>
    [Fact]
    public void TheOrgTierRoutes_TakeOnlyAllowListedExerciseIds()
    {
        using var factory = new WiringProbeFactory();

        var parameterized = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => (endpoint.RoutePattern.RawText ?? string.Empty)
                .StartsWith("/api/org/", StringComparison.OrdinalIgnoreCase))
            .Where(endpoint => endpoint.RoutePattern.Parameters.Count > 0)
            .ToList();

        // Keyed by (method, template): a new GET or DELETE on an allow-listed PATH is still a new endpoint and
        // must earn its own entry (and its own foreign-tenant case below).
        var pairs = parameterized
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods
                    ?? ["(any)"])
                .Select(method => (Method: method, Route: endpoint.RoutePattern.RawText ?? string.Empty)))
            .ToList();

        pairs.Should().OnlyHaveUniqueItems();
        pairs.Should().BeEquivalentTo(
            ExerciseLifecycleAdminEndpoints.ExerciseIdRoutes,
            "an /api/org/{{id}}-shaped endpoint invites exactly the client-supplied scope COR-001 forbids one tier "
            + "down. Only the allow-listed story-22 (method, route) pairs may carry an id, each authorized against "
            + "the caller's own server-resolved tenant");

        foreach (var endpoint in parameterized)
        {
            var parameter = endpoint.RoutePattern.Parameters.Should().ContainSingle(
                "{0} takes exactly one route value", endpoint.RoutePattern.RawText).Which;
            parameter.Name.Should().Be("exerciseId", "never an organization or staff-user id on the org tier");
            parameter.ParameterPolicies.Select(policy => policy.Content).Should().Contain(
                "guid", "{0}: a non-GUID never reaches the handler", endpoint.RoutePattern.RawText);
        }

        OrgExerciseByIdIsolationTests.Callers.Keys.Should().BeEquivalentTo(
            ExerciseLifecycleAdminEndpoints.ExerciseIdRoutes,
            "every allow-listed (method, route) must be driven by the foreign-tenant 404 test");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText)
        => dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string so it merely
    /// BUILDS. It deliberately overrides NOTHING else — adding this slice's registration here would defeat the
    /// entire purpose of the file.
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
