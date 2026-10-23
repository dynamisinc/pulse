namespace Pulse.WebApi.Tests.Features.Org.PeopleDirectory;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Org.PeopleDirectory;
using Pulse.WebApi.Features.Identity.Sessions;
using Xunit;

/// <summary>
/// identity-auth-roles/19 — composition-root guard (plain <see cref="FactAttribute"/>, no Docker): the REAL <c>Program</c>
/// maps the three org-directory routes exactly once, none is pre-auth, and the service resolves.
/// </summary>
public sealed class OrgPeopleCompositionRootWiringTests
{
    [Theory]
    [InlineData("GET", OrgPeopleEndpoints.PeopleRoute)]
    [InlineData("GET", OrgPeopleEndpoints.PersonRoute)]
    [InlineData("PATCH", OrgPeopleEndpoints.PersonRoute)]
    public void ProgramCs_MapsEachDirectoryRoute_ExactlyOnce_AndNeverPreAuth(string method, string route)
    {
        using var factory = new WiringProbeFactory();
        var endpoint = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => string.Equals(e.RoutePattern.RawText, route, StringComparison.OrdinalIgnoreCase)
                && (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false))
            .Should().ContainSingle("{0} {1} must be wired into Program.cs exactly once via MapOrgPeopleEndpoints()", method, route)
            .Which;

        PreAuthAllowlist.Contains(endpoint).Should().BeFalse("the directory requires a live org-admin session");
    }

    [Fact]
    public void ProgramCs_CallsAddOrgPeople_SoTheServiceResolves()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        scope.ServiceProvider.GetService<OrgPeopleService>().Should().NotBeNull("AddOrgPeople() registers the directory service");
    }

    /// <summary>The real host with a dummy, never-connecting connection string, so it merely BUILDS.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString = "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory() => Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
