namespace Pulse.WebApi.Tests.Features.Ops.Build;

using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Ops.Build;

/// <summary>
/// #617: <c>GET /api/build</c> reports the commit the running build was published from, so Deploy Backend's smoke
/// can prove the NEW build is serving rather than trusting a <c>/health</c> 200 the old process also gives.
/// Boots the real <c>Program</c> host so the composition-root wiring (map call + allowlist) is what is tested.
/// </summary>
public sealed class BuildInfoEndpointsTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    /// <summary>Creates the suite over the shared real host.</summary>
    /// <param name="factory">The real <c>Program</c> host.</param>
    public BuildInfoEndpointsTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Build_WithNoCredential_Returns200_WithOnlyACommit_AndNoStore()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/api/build", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK, "the deploy smoke presents no credential");
        response.Headers.WwwAuthenticate.Should().BeEmpty("the session gate must not be what answers");
        response.Headers.CacheControl.Should().NotBeNull();
        response.Headers.CacheControl!.NoStore.Should().BeTrue("a cached commit is the false green this exists to stop");

        using var json = JsonDocument.Parse(body);
        var properties = json.RootElement.EnumerateObject().ToList();
        properties.Should().ContainSingle("the response carries the commit and nothing else")
            .Which.Name.Should().Be("commit");
        properties[0].Value.GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Build_ReportsTheRunningAssemblysRevision()
    {
        using var client = _factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/api/build", UriKind.Relative));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        var expected = BuildInfoEndpoints.CommitFrom(typeof(BuildInfoEndpoints).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        json.RootElement.GetProperty("commit").GetString().Should().Be(expected);
    }

    [Fact]
    public void Build_IsMappedOnce_AndIsOnThePreAuthAllowlist()
    {
        var endpoints = _factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints.OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText == BuildInfoEndpoints.Route)
            .ToList();

        endpoints.Should().ContainSingle("Program.cs must map GET /api/build exactly once");
        PreAuthAllowlist.Contains(endpoints[0]).Should().BeTrue();
        PreAuthAllowlist.Routes.Should().Contain("GET /api/build");
    }

    [Theory]
    [InlineData("1.0.0+abc123", "abc123")]
    [InlineData("1.0.0+0123456789abcdef0123456789abcdef01234567", "0123456789abcdef0123456789abcdef01234567")]
    [InlineData("1.0.0-preview.1+abc123 ", "abc123")]
    [InlineData("1.0.0+abc+def", "abc+def")]
    [InlineData("1.0.0", "unknown")]
    [InlineData("1.0.0+", "unknown")]
    [InlineData("1.0.0+   ", "unknown")]
    [InlineData("", "unknown")]
    [InlineData("   ", "unknown")]
    [InlineData(null, "unknown")]
    public void CommitFrom_TakesTheTextAfterThePlus_OrIsUnknown(string? informationalVersion, string expected)
    {
        BuildInfoEndpoints.CommitFrom(informationalVersion).Should().Be(expected);
    }
}
