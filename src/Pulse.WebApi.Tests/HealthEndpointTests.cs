namespace Pulse.WebApi.Tests;

using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

/// <summary>
/// Story 01 AC: "Given the host is running, when a client sends GET /health, then it returns 200 OK
/// with a body indicating liveness, with no dependency on a database connection." Boots the real host
/// (Program.cs, unmodified) via <see cref="WebApplicationFactory{TEntryPoint}"/> — this is the
/// assertion that closes the CI backend gate on more than "it compiles".
/// </summary>
public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Health_ReturnsBodyIndicatingLiveness()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));
        var body = await response.Content.ReadAsStringAsync();

        // ASP.NET Core's default HealthCheckMiddleware writes the overall HealthStatus (e.g. "Healthy")
        // as the response body when no custom writer is configured.
        body.Should().NotBeNullOrWhiteSpace();
        body.Should().Be("Healthy");
    }
}
