namespace Pulse.WebApi.Tests;

using System;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;

/// <summary>
/// Story 01 AC: "Given a request whose Origin header matches the configured frontend origin ...
/// then it is allowed; given an unlisted origin, then it is rejected." Overrides
/// Authentication:FrontendBaseUrl to a known allowed origin so the fail-closed CORS policy in
/// Program.cs has something concrete to allow/reject against.
/// </summary>
public class CorsTests : IClassFixture<CorsTests.CorsWebApplicationFactory>
{
    private const string AllowedOrigin = "https://allowed.exercise.example";
    private const string UnlistedOrigin = "https://not-allowed.example";

    private readonly CorsWebApplicationFactory _factory;

    public CorsTests(CorsWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Preflight_FromUnlistedOrigin_IsNotReflectedInAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/health");
        request.Headers.Add("Origin", UnlistedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        response.Headers.Contains("Access-Control-Allow-Origin").Should().BeFalse();
    }

    [Fact]
    public async Task SimpleRequest_FromUnlistedOrigin_IsNotReflectedInAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", UnlistedOrigin);

        var response = await client.SendAsync(request);

        response.Headers.Contains("Access-Control-Allow-Origin").Should().BeFalse();
    }

    [Fact]
    public async Task Preflight_FromAllowedOrigin_IsReflectedInAllowOriginHeader()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/health");
        request.Headers.Add("Origin", AllowedOrigin);
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values).Should().BeTrue();
        values.Should().ContainSingle().Which.Should().Be(AllowedOrigin);
    }

    /// <summary>
    /// Boots the real host with Authentication:FrontendBaseUrl set to a known allowed origin.
    /// Program.cs reads this config key into a local variable at the top level, before
    /// builder.Build() runs, so the override must already be visible to
    /// WebApplication.CreateBuilder(args) itself — i.e. as a process environment variable (the same
    /// double-underscore App Service convention Program.cs's own comments reference) — rather than
    /// layered on afterwards via ConfigureAppConfiguration/ConfigureWebHost, which only take effect once
    /// the host is (re)built, too late for a value already captured into a local variable. Because this
    /// mutates a process-wide environment variable, the assembly disables xUnit's default cross-class
    /// parallelization (see AssemblyInfo.cs) so it never races another test class's host construction.
    /// </summary>
    public class CorsWebApplicationFactory : WebApplicationFactory<Program>
    {
        private const string EnvironmentVariableName = "Authentication__FrontendBaseUrl";

        public CorsWebApplicationFactory()
        {
            Environment.SetEnvironmentVariable(EnvironmentVariableName, AllowedOrigin);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(EnvironmentVariableName, null);
        }
    }
}
