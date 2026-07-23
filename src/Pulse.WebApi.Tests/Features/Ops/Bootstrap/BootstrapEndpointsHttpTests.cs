namespace Pulse.WebApi.Tests.Features.Ops.Bootstrap;

using System.Collections.Generic;
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
using Pulse.WebApi.Features.Ops.Bootstrap;

/// <summary>
/// HTTP-level coverage of <c>POST /api/ops/bootstrap-exercise</c> (story login/05) over a self-hosted
/// <see cref="TestServer"/> that maps <see cref="BootstrapEndpoints.MapBootstrapEndpoints"/> directly. These are
/// plain <c>[Fact]</c> (no Docker): they exercise only the FAIL-CLOSED paths that short-circuit BEFORE any
/// database access (unconfigured/missing/wrong secret → 404; a bad body → 400) plus the rate limiter, proving
/// route + verb mapping, the <c>X-Bootstrap-Secret</c> header binding, and status mapping. The DB-backed
/// creation/idempotency/telemetry paths are covered by the <see cref="BootstrapServiceTests"/>
/// <c>[RequiresDockerFact]</c> suite. A self-hosted server is used because <c>Program.cs</c> does not map this
/// route during this wave (the orchestrator wires it serially — this story must not edit <c>Program.cs</c>).
/// </summary>
public sealed class BootstrapEndpointsHttpTests
{
    private const string ConfiguredSecret = "s3cr3t-bootstrap-value";

    private static async Task<IHost> StartHostAsync(string? configuredSecret)
    {
        var settings = new Dictionary<string, string?>();
        if (configuredSecret is not null)
        {
            settings[$"{BootstrapOptions.SectionName}:Secret"] = configuredSecret;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();

                    // The slice under test + the DbContext its service ctor needs. The DbContext uses a
                    // never-connecting string — every path asserted here fails closed BEFORE any query.
                    services.AddOpsBootstrap(configuration);
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                });
                web.Configure(app =>
                {
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints => endpoints.MapBootstrapEndpoints());
                });
            })
            .StartAsync();
    }

    [Fact]
    public async Task Bootstrap_UnconfiguredSecret_Returns404_RegardlessOfHeader()
    {
        using var host = await StartHostAsync(configuredSecret: null);
        using var client = host.GetTestClient();

        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/ops/bootstrap-exercise")
        {
            Content = JsonContent.Create(new { hostname = "pulse-uat.cobrasoftware.com", exerciseName = "UAT" }),
        };
        message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, "any-value");

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "an unconfigured bootstrap secret disables the endpoint entirely — it 404s regardless of the presented header (fail closed)");
    }

    [Fact]
    public async Task Bootstrap_MissingSecretHeader_Returns404()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        var response = await client.PostAsJsonAsync(
            "/api/ops/bootstrap-exercise",
            new { hostname = "pulse-uat.cobrasoftware.com", exerciseName = "UAT" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "with no X-Bootstrap-Secret header the endpoint must not even confirm its own existence (404, not 401/403)");
    }

    [Fact]
    public async Task Bootstrap_WrongSecret_Returns404()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/ops/bootstrap-exercise")
        {
            Content = JsonContent.Create(new { hostname = "pulse-uat.cobrasoftware.com", exerciseName = "UAT" }),
        };
        message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, "not-the-configured-secret");

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "a wrong secret is indistinguishable from a disabled endpoint (404) — no existence hint to an unauthorized caller");
    }

    [Fact]
    public async Task Bootstrap_CorrectSecretButNullBody_Returns400()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/ops/bootstrap-exercise")
        {
            Content = new StringContent("null", System.Text.Encoding.UTF8, "application/json"),
        };
        message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, ConfiguredSecret);

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "an authorized caller with a missing body gets a 400 (the secret gate passed, so a body error is now surfaced) — before any DB access");
    }

    [Fact]
    public async Task Bootstrap_CorrectSecretButMissingHostname_Returns400()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/ops/bootstrap-exercise")
        {
            Content = JsonContent.Create(new { exerciseName = "UAT" }),
        };
        message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, ConfiguredSecret);

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "a missing/invalid hostname fails validation before any DB access");
    }

    [Fact]
    public async Task Bootstrap_ExceedsPerIpRateLimit_Returns429()
    {
        // NFR-009: the bootstrap endpoint is per-IP rate-limited (a fixed 10/minute window, AddOpsBootstrap())
        // as defense-in-depth even though it is secret-gated. Every request here fails closed fast (404 for the
        // unconfigured secret, never touching the DB), so this isolates the RATE LIMITER's own behavior: the
        // 11th request within the window must be rejected by the limiter itself (429), before the handler.
        using var host = await StartHostAsync(configuredSecret: null);
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/ops/bootstrap-exercise",
                new { hostname = "pulse-uat.cobrasoftware.com", exerciseName = "UAT" });

            response.StatusCode.Should().Be(HttpStatusCode.NotFound,
                $"attempt {attempt} is within the configured 10/minute window and reaches the handler (which 404s the unconfigured secret)");
        }

        var eleventh = await client.PostAsJsonAsync(
            "/api/ops/bootstrap-exercise",
            new { hostname = "pulse-uat.cobrasoftware.com", exerciseName = "UAT" });

        eleventh.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the 11th bootstrap attempt within the same window from the same caller must be rejected by the per-IP rate limiter (NFR-009)");
    }
}
