namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.SharedAccess;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// HTTP-level coverage of <c>POST /api/auth/shared</c> (story 06) over a self-hosted <see cref="TestServer"/>
/// that maps <see cref="SharedReadOnlyEndpoints.MapSharedReadOnlyEndpoints"/> directly. These are plain
/// <c>[Fact]</c> (no Docker): they exercise only the FAIL-CLOSED paths that short-circuit BEFORE any database
/// access (bad body / missing password) plus the rate limiter, proving route + verb mapping, model binding, and
/// status mapping. The DB-backed happy/reject paths are covered by <see cref="SharedReadOnlyLoginServiceTests"/>
/// and the end-to-end <see cref="SharedReadOnlyWriteDenialIsolationTests"/>. A self-hosted server is used because
/// <c>Program.cs</c> does not map this route during this wave (the orchestrator wires it serially — this story
/// must not edit <c>Program.cs</c>).
/// </summary>
public sealed class SharedReadOnlyEndpointsHttpTests
{
    private static async Task<IHost> StartHostAsync()
    {
        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();

                    // The slice under test + the cross-wave collaborators its login service ctor needs. The
                    // DbContext uses a never-connecting string — every path asserted here returns before it.
                    services.AddSharedReadOnly();
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapSharedReadOnlyEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task SharedLogin_NullBody_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsync(
            "/api/auth/shared",
            new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing login body is a 400, never a default session");
    }

    [Fact]
    public async Task SharedLogin_MissingPassword_Returns400()
    {
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync("/api/auth/shared", new { });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a missing password fails validation before any DB access");
    }

    [Fact]
    public async Task SharedLogin_ExceedsPerIpRateLimit_Returns429()
    {
        // NFR-009: the shared-login endpoint is per-IP rate-limited (a tight 5/minute window, AddSharedReadOnly()).
        // Every request here fails validation fast (a bad body, never touching the DB), so this isolates the
        // RATE LIMITER's own behavior: the 6th request within the window must be rejected by the limiter itself
        // (429), never reaching the handler.
        using var host = await StartHostAsync();
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var response = await client.PostAsync(
                "/api/auth/shared",
                new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
                $"attempt {attempt} is within the configured 5/minute window and reaches the handler");
        }

        var sixth = await client.PostAsync(
            "/api/auth/shared",
            new StringContent("null", System.Text.Encoding.UTF8, "application/json"));

        sixth.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the 6th shared-login attempt within the same window from the same caller must be rejected by the " +
            "per-IP rate limiter (NFR-009), before it ever reaches the handler — a shared secret is the most " +
            "brute-forceable auth endpoint");
    }
}
