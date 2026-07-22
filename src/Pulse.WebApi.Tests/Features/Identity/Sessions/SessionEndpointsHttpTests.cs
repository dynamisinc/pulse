namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// HTTP-level coverage of the three session endpoints (story 03) over a self-hosted <see cref="TestServer"/>
/// that maps <see cref="SessionEndpoints.MapSessionEndpoints"/> directly. Plain <c>[Fact]</c> (no Docker):
/// these exercise only the FAIL-CLOSED paths that short-circuit BEFORE any database access (no token / no
/// refresh token), proving route + verb mapping, status mapping, and the per-IP rate limiter. A self-hosted
/// server is used because <c>Program.cs</c> does not map these routes during this wave (the orchestrator wires
/// them serially in Wave 2 — this story must not edit <c>Program.cs</c>), mirroring
/// <c>StaffAuthEndpointsHttpTests</c>. The DB-backed happy paths are covered by <see cref="SessionServiceTests"/>.
/// </summary>
public sealed class SessionEndpointsHttpTests
{
    private static async Task<IHost> StartHostAsync()
    {
        var configuration = new ConfigurationBuilder().Build();

        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();
                    services.AddSessions(configuration);
                    // A never-connecting DbContext: every path asserted here returns before touching it.
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddExerciseScoping();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapSessionEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task GetSession_NoAuthorizationHeader_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.GetAsync("/api/session");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "with no session token GET /api/session fails closed with 401, never a default/stale session");
    }

    [Fact]
    public async Task Refresh_NoBody_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/auth/refresh", new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "a refresh with no refresh token fails closed (re-auth required) before any DB access");
    }

    [Fact]
    public async Task Refresh_EmptyRefreshToken_Returns401()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/auth/refresh", new { refreshToken = "" });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "an empty refresh token is not usable — 401");
    }

    [Fact]
    public async Task Logout_NoToken_Returns204_Idempotent()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync("/api/auth/logout", content: null);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent,
            "logout is idempotent and never reveals whether a token was valid — always 204");
    }

    [Fact]
    public async Task GetSession_ExceedsPerIpRateLimit_Returns429()
    {
        // NFR-009: the session endpoints are per-IP rate-limited (a fixed 60/minute window, AddSessions()).
        // Every request here fails fast (no token, never touching the DB), isolating the limiter: the 61st
        // request within the window must be rejected by the limiter itself (429), before the handler runs.
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 60; attempt++)
        {
            var response = await client.GetAsync("/api/session");
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
                $"attempt {attempt} is within the configured 60/minute window and reaches the handler (401, no token)");
        }

        var sixtyFirst = await client.GetAsync("/api/session");
        sixtyFirst.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the 61st session request within the same window from the same caller must be rejected by the per-IP rate limiter (NFR-009)");
    }
}
