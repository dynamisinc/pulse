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
/// HTTP-level coverage of <c>POST /api/ops/bind-participant-persona</c> (story identity-auth-roles/10) over a self-hosted
/// <see cref="TestServer"/> that maps <see cref="BootstrapEndpoints.MapBootstrapEndpoints"/> directly. These are
/// plain <c>[Fact]</c> (no Docker): they exercise only the FAIL-CLOSED paths that short-circuit BEFORE any database
/// access (unconfigured/missing/wrong secret → 404; a bad body → 400) plus the endpoint's own rate-limit policy,
/// proving route + verb mapping, the <c>X-Bootstrap-Secret</c> header binding, and status mapping — exactly
/// mirroring <see cref="BootstrapEndpointsHttpTests"/> for the sibling route. The DB-backed bind/rebind/isolation/
/// telemetry paths are covered by the <see cref="ParticipantPersonaBindingServiceTests"/>
/// <c>[RequiresDockerFact]</c> suite, and <see cref="CompositionRootWiringTests"/> proves the REAL host maps this
/// route (a self-mapped TestServer alone could not).
/// </summary>
public sealed class ParticipantPersonaBindingEndpointHttpTests
{
    private const string ConfiguredSecret = "s3cr3t-bootstrap-value";
    private const string Route = "/api/ops/bind-participant-persona";

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

    private static HttpRequestMessage Request(object? body, string? secret)
    {
        var message = new HttpRequestMessage(HttpMethod.Post, Route)
        {
            Content = JsonContent.Create(body),
        };

        if (secret is not null)
        {
            message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, secret);
        }

        return message;
    }

    private static object ValidBody() => new
    {
        hostname = "pulse-uat.cobrasoftware.com",
        username = "participant1",
        personaHandle = "FairhavenWater",
    };

    [Fact]
    public async Task Bind_UnconfiguredSecret_Returns404_RegardlessOfHeader()
    {
        using var host = await StartHostAsync(configuredSecret: null);
        using var client = host.GetTestClient();

        using var message = Request(ValidBody(), "any-value");
        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "an unconfigured bootstrap secret disables the binding endpoint entirely — it 404s regardless of the presented header (fail closed)");
    }

    [Fact]
    public async Task Bind_MissingSecretHeader_Returns404()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = Request(ValidBody(), secret: null);
        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "with no X-Bootstrap-Secret header the endpoint must not even confirm its own existence (404, not 401/403)");
    }

    [Fact]
    public async Task Bind_WrongSecret_Returns404()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = Request(ValidBody(), "not-the-configured-secret");
        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "a wrong secret is indistinguishable from a disabled endpoint (404) — no existence hint to an unauthorized caller");
    }

    [Fact]
    public async Task Bind_CorrectSecretButNullBody_Returns400()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = new HttpRequestMessage(HttpMethod.Post, Route)
        {
            Content = new StringContent("null", System.Text.Encoding.UTF8, "application/json"),
        };
        message.Headers.Add(BootstrapEndpoints.BootstrapSecretHeaderName, ConfiguredSecret);

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "an authorized caller with a missing body gets a 400 (the secret gate passed) — before any DB access");
    }

    [Fact]
    public async Task Bind_CorrectSecretButMissingUsername_Returns400()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = Request(
            new { hostname = "pulse-uat.cobrasoftware.com", personaHandle = "FairhavenWater" },
            ConfiguredSecret);

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "a missing username fails validation before any DB access — the endpoint binds a NAMED existing account");
    }

    [Fact]
    public async Task Bind_CorrectSecretButNoPersonaIdentifier_Returns400()
    {
        using var host = await StartHostAsync(ConfiguredSecret);
        using var client = host.GetTestClient();

        using var message = Request(
            new { hostname = "pulse-uat.cobrasoftware.com", username = "participant1" },
            ConfiguredSecret);

        var response = await client.SendAsync(message);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "a body with neither personaHandle nor personaId is a caller error (400) — validated before any DB access");
    }

    [Fact]
    public async Task Bind_ExceedsPerIpRateLimit_Returns429()
    {
        // NFR-009: the binding endpoint carries its OWN per-IP fixed-window policy (10/minute, AddOpsBootstrap())
        // as defense-in-depth even though it is secret-gated. Every request here fails closed fast (404 for the
        // unconfigured secret, never touching the DB), so this isolates the RATE LIMITER's own behavior.
        using var host = await StartHostAsync(configuredSecret: null);
        using var client = host.GetTestClient();

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            using var message = Request(ValidBody(), "any-value");
            var response = await client.SendAsync(message);

            response.StatusCode.Should().Be(HttpStatusCode.NotFound,
                $"attempt {attempt} is within the configured 10/minute window and reaches the handler (which 404s the unconfigured secret)");
        }

        using var eleventhMessage = Request(ValidBody(), "any-value");
        var eleventh = await client.SendAsync(eleventhMessage);

        eleventh.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the 11th bind attempt within the same window from the same caller must be rejected by the per-IP rate limiter (NFR-009)");
    }
}
