namespace Pulse.WebApi.Tests.Features.TrustedProxy;

using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.TrustedProxy;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// identity-auth-roles/18 (#480): forwarded headers make the per-IP rate limiter see the client, trusting ONLY
/// the configured platform proxy. A self-hosted <see cref="TestServer"/> composes the slice in the order
/// <c>Program.cs</c> must use — <c>UsePulseForwardedHeaders()</c> first, <c>UseRateLimiter()</c> after — over the
/// REAL staff-login limiter policy (<see cref="StaffAuthEndpoints.AddStaffIdentity"/>, 10/minute per IP). Plain
/// <c>[Fact]</c>: every login here fails validation (null body → 400) before any database access.
/// </summary>
/// <remarks>
/// <see cref="TestServer"/> has no TCP peer (a null <c>RemoteIpAddress</c>, which the forwarded-headers middleware
/// treats as trusted), so a test-only middleware ahead of everything sets the peer from <see cref="PeerHeader"/> —
/// the stand-in for "which machine opened the connection".
/// </remarks>
public sealed class ForwardedHeadersTests
{
    private const string PeerHeader = "X-Test-Peer";
    private const string ProxyIp = "10.0.0.4";
    private const string LoginPath = "/api/auth/staff/login";
    private const string ProbePath = "/probe";

    private static async Task<IHost> StartHostAsync(IDictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        return await new HostBuilder()
            .ConfigureWebHost(web =>
            {
                web.UseTestServer();
                web.ConfigureServices(services =>
                {
                    services.AddRouting();
                    services.AddPulseForwardedHeaders(configuration);
                    services.AddStaffIdentity(configuration);
                    services.AddDbContext<PulseDbContext>(options =>
                        options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;"));
                    services.AddScoped<IExerciseContext, ExerciseContext>();
                    services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
                });
                web.Configure(app =>
                {
                    app.Use((context, next) =>
                    {
                        if (context.Request.Headers.TryGetValue(PeerHeader, out var peer))
                        {
                            context.Connection.RemoteIpAddress = IPAddress.Parse(peer.ToString());
                        }

                        return next(context);
                    });

                    // The order under test: forwarded headers FIRST, the rate limiter after.
                    app.UsePulseForwardedHeaders();
                    app.UseRouting();
                    app.UseRateLimiter();
                    app.UseEndpoints(endpoints =>
                    {
                        endpoints.MapStaffAuthEndpoints();
                        endpoints.MapGet(ProbePath, (HttpContext context) => Results.Json(new ProbeResult
                        {
                            RemoteIp = context.Connection.RemoteIpAddress?.ToString(),
                            Scheme = context.Request.Scheme,
                            IsHttps = context.Request.IsHttps,
                        }));
                    });
                });
            })
            .StartAsync();
    }

    private static Dictionary<string, string?> TrustProxy() => new()
    {
        ["ForwardedHeaders:KnownProxies:0"] = ProxyIp,
    };

    private static HttpRequestMessage Request(HttpMethod method, string path, string peer, string? forwardedFor, string? forwardedProto = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add(PeerHeader, peer);
        if (forwardedFor is not null)
        {
            request.Headers.Add("X-Forwarded-For", forwardedFor);
        }

        if (forwardedProto is not null)
        {
            request.Headers.Add("X-Forwarded-Proto", forwardedProto);
        }

        if (method == HttpMethod.Post)
        {
            request.Content = new StringContent("null", Encoding.UTF8, "application/json");
        }

        return request;
    }

    private static Task<HttpResponseMessage> FailedLoginAsync(HttpClient client, string peer, string? forwardedFor)
        => client.SendAsync(Request(HttpMethod.Post, LoginPath, peer, forwardedFor));

    private static async Task<ProbeResult> ProbeAsync(HttpClient client, string peer, string? forwardedFor, string? forwardedProto = null)
    {
        var response = await client.SendAsync(Request(HttpMethod.Get, ProbePath, peer, forwardedFor, forwardedProto));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProbeResult>())!;
    }

    /// <summary>AC-1: a trusted proxy's X-Forwarded-For becomes the client IP (App Service sends ip:port).</summary>
    [Fact]
    public async Task TrustedProxy_ForwardedFor_BecomesTheClientIp()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();

        var withPort = await ProbeAsync(client, ProxyIp, "203.0.113.10:51234");
        var bare = await ProbeAsync(client, ProxyIp, "203.0.113.11");

        withPort.RemoteIp.Should().Be("203.0.113.10", "the App Service front end appends client ip:port, and the port is stripped");
        bare.RemoteIp.Should().Be("203.0.113.11", "a trusted proxy's forwarded client IP replaces the proxy address");
    }

    /// <summary>AC-1: a client-prepended entry to the left of the proxy's own entry is not used (ForwardLimit 1).</summary>
    [Fact]
    public async Task TrustedProxy_ClientPrependedEntry_IsNotUsed()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();

        var result = await ProbeAsync(client, ProxyIp, "198.51.100.66, 203.0.113.10");

        result.RemoteIp.Should().Be("203.0.113.10",
            "only the rightmost entry — the one the trusted front end appended — is honored; the client-supplied one is spoofable");
    }

    /// <summary>AC-1: the IPv4-mapped peer Kestrel reports on a dual-mode socket still matches a configured network.</summary>
    [Fact]
    public async Task TrustedNetwork_Ipv4MappedPeer_IsTrusted()
    {
        using var host = await StartHostAsync(new Dictionary<string, string?>
        {
            ["ForwardedHeaders:KnownNetworks:0"] = "10.0.0.0/8",
        });
        using var client = host.GetTestClient();

        var result = await ProbeAsync(client, "::ffff:10.1.2.3", "203.0.113.10");

        result.RemoteIp.Should().Be("203.0.113.10", "a peer inside a configured known network is a trusted proxy");
    }

    /// <summary>AC-2: an untrusted source's spoofed X-Forwarded-For / X-Forwarded-Proto are ignored.</summary>
    [Fact]
    public async Task UntrustedSource_SpoofedHeaders_AreIgnored()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();

        var result = await ProbeAsync(client, "198.51.100.7", "203.0.113.99", "https");

        result.RemoteIp.Should().Be("198.51.100.7", "a forwarded header from a peer that is not the configured proxy is a spoof");
        result.Scheme.Should().Be("http", "an untrusted peer cannot claim the original scheme either");
    }

    /// <summary>AC-2: with no configuration nothing is trusted — not even loopback (safe by default).</summary>
    [Fact]
    public async Task NoConfiguration_TrustsNoOne_IncludingLoopback()
    {
        using var host = await StartHostAsync(new Dictionary<string, string?>());
        using var client = host.GetTestClient();

        var result = await ProbeAsync(client, "127.0.0.1", "203.0.113.99");

        result.RemoteIp.Should().Be("127.0.0.1", "an unconfigured host trusts no proxy; the framework's loopback default is cleared");
    }

    /// <summary>AC-2: an attacker rotating spoofed X-Forwarded-For values still shares one bucket (no limiter evasion).</summary>
    [Fact]
    public async Task UntrustedSource_RotatingSpoofedForwardedFor_CannotEscapeItsBucket()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();
        const string Attacker = "198.51.100.7";

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var response = await FailedLoginAsync(client, Attacker, $"203.0.113.{attempt}");
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, $"attempt {attempt} is within the 10/minute window");
        }

        var eleventh = await FailedLoginAsync(client, Attacker, "203.0.113.200");

        eleventh.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
            "the limiter partitions on the attacker's real peer address; a fresh spoofed header must not mint a new bucket");
    }

    /// <summary>
    /// AC-1 + AC-5 (+ the caller's (a)/(c)): two clients behind the trusted proxy get separate buckets — one
    /// client exhausting the staff-login limit trips it for that client only.
    /// </summary>
    [Fact]
    public async Task ClientsBehindTrustedProxy_GetSeparateStaffLoginBuckets()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();
        const string ClientA = "203.0.113.10";
        const string ClientB = "203.0.113.20";

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var response = await FailedLoginAsync(client, ProxyIp, ClientA);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, $"client A's attempt {attempt} is within the 10/minute window");
        }

        var clientAOver = await FailedLoginAsync(client, ProxyIp, ClientA);
        var clientB = await FailedLoginAsync(client, ProxyIp, ClientB);

        clientAOver.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "client A exhausted its own per-IP bucket");
        clientB.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "client B shares the proxy's TCP address but is a different client IP, so its bucket is untouched — " +
            "the 100-person StartEx case #480 exists for");
    }

    /// <summary>AC-4: X-Forwarded-Proto from the trusted proxy restores the original https scheme.</summary>
    [Fact]
    public async Task TrustedProxy_ForwardedProto_RestoresHttpsScheme()
    {
        using var host = await StartHostAsync(TrustProxy());
        using var client = host.GetTestClient();

        var result = await ProbeAsync(client, ProxyIp, "203.0.113.10", "https");

        result.Scheme.Should().Be("https", "TLS terminates at the front end; the app must see the scheme the client used");
        result.IsHttps.Should().BeTrue("HTTPS redirection / secure-cookie logic keys on Request.IsHttps");
    }

    /// <summary>Invalid configuration fails at startup rather than silently leaving the limiter collapsed.</summary>
    [Theory]
    [InlineData("ForwardedHeaders:KnownProxies:0", "not-an-ip")]
    [InlineData("ForwardedHeaders:KnownNetworks:0", "10.0.0.0/99")]
    [InlineData("ForwardedHeaders:ForwardLimit", "0")]
    public void InvalidConfiguration_FailsFast(string key, string value)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [key] = value })
            .Build();

        var act = () => new ServiceCollection().AddPulseForwardedHeaders(configuration);

        act.Should().Throw<InvalidOperationException>("a mistyped trusted-proxy entry must not be dropped silently");
    }

    /// <summary>Gate-1 M-2: the framework trust-every-peer switch is refused at startup.</summary>
    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    public void FrameworkForwardedHeadersSwitch_IsRefusedAtStartup(string value)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_FORWARDEDHEADERS_ENABLED"] = value,
                ["ForwardedHeaders:KnownNetworks:0"] = "10.0.0.0/8",
            })
            .Build();

        var act = () => new ServiceCollection().AddPulseForwardedHeaders(configuration);

        act.Should().Throw<InvalidOperationException>("that switch trusts forwarded headers from any client")
            .WithMessage("*ASPNETCORE_FORWARDEDHEADERS_ENABLED*");
    }

    /// <summary>The switch set to false (or absent) is fine.</summary>
    [Fact]
    public void FrameworkForwardedHeadersSwitch_False_IsAllowed()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["ASPNETCORE_FORWARDEDHEADERS_ENABLED"] = "false" })
            .Build();

        var act = () => new ServiceCollection().AddPulseForwardedHeaders(configuration);

        act.Should().NotThrow();
    }

    /// <summary>The pipeline half refuses to run without its DI half.</summary>
    [Fact]
    public void UseWithoutAdd_Throws()
    {
        var app = new ApplicationBuilder(new ServiceCollection().BuildServiceProvider());

        var act = () => app.UsePulseForwardedHeaders();

        act.Should().Throw<InvalidOperationException>();
    }

    private sealed class ProbeResult
    {
        public string? RemoteIp { get; set; }

        public string? Scheme { get; set; }

        public bool IsHttps { get; set; }
    }
}
