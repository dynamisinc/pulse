namespace Pulse.WebApi.Tests.Features.TrustedProxy;

using System.IO;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Pulse.WebApi.Tests.Data;

/// <summary>
/// identity-auth-roles/18 AC-3 (#480): the pipeline-ORDER guard. Over the REAL <c>Program</c> pipeline (no
/// <c>ConfigureTestServices</c> override), two clients behind the configured proxy must land in separate
/// staff-login buckets. That holds only if <c>app.UsePulseForwardedHeaders()</c> is wired AND sits before
/// <c>app.UseRateLimiter()</c>: missing, or wired after the limiter, every request partitions on the proxy's
/// address and client B is refused with client A's 429.
/// </summary>
/// <remarks>
/// Proves the <b>real</b> <c>Program.cs</c> wiring order (forwarded headers first, before the rate limiter).
/// It was written before the wiring and failed red until the two Program.cs lines landed. Real SQL because the real pipeline's host resolution runs a
/// lookup on every request; every login is a null body (400) so no account is seeded.
/// </remarks>
[Collection(MsSqlCollection.Name)]
public sealed class ForwardedHeadersPipelineOrderTests
{
    private const string ProxyIp = "10.0.0.4";

    private readonly MsSqlContainerFixture _fixture;

    /// <summary>Creates the test with the shared SQL fixture.</summary>
    /// <param name="fixture">The shared MsSql container fixture.</param>
    public ForwardedHeadersPipelineOrderTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    /// <summary>AC-3 + AC-5 through Program: client A trips its own limit; client B behind the same proxy does not.</summary>
    [RequiresDockerFact]
    public async Task RealPipeline_ForwardedHeadersRunBeforeTheRateLimiter_SoClientsBehindTheProxyGetSeparateBuckets()
    {
        _fixture.ConnectionString.Should().NotBeNull("the Docker-gated MsSql fixture must have started");

        await using var factory = new ForwardedHeadersProbeFactory(_fixture.ConnectionString!);
        var server = factory.Server;

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            var status = await FailedLoginAsync(server, "203.0.113.10");
            status.Should().Be(StatusCodes.Status400BadRequest, $"client A's attempt {attempt} is within the 10/minute window");
        }

        var clientAOver = await FailedLoginAsync(server, "203.0.113.10");
        var clientB = await FailedLoginAsync(server, "203.0.113.20");

        clientAOver.Should().Be(StatusCodes.Status429TooManyRequests, "client A exhausted its own per-IP bucket");
        clientB.Should().Be(StatusCodes.Status400BadRequest,
            "a 429 here means app.UsePulseForwardedHeaders() is missing from Program.cs or wired AFTER " +
            "app.UseRateLimiter(), so the limiter partitioned on the proxy's address and one client locked out everyone");
    }

    private static async Task<int> FailedLoginAsync(Microsoft.AspNetCore.TestHost.TestServer server, string clientIp)
    {
        var context = await server.SendAsync(http =>
        {
            http.Connection.RemoteIpAddress = IPAddress.Parse(ProxyIp);
            http.Request.Method = HttpMethods.Post;
            http.Request.Path = "/api/auth/staff/login";
            http.Request.Headers["X-Forwarded-For"] = clientIp;
            http.Request.ContentType = "application/json";
            http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes("null"));
        });

        return context.Response.StatusCode;
    }

    /// <summary>
    /// The real <c>Program</c> host with the shared migrated database and the proxy trusted, both set as
    /// environment variables before the host captures its configuration (the CORS/lifecycle-probe idiom).
    /// </summary>
    private sealed class ForwardedHeadersProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string KnownProxyEnvVar = "ForwardedHeaders__KnownProxies__0";

        public ForwardedHeadersProbeFactory(string connectionString)
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, connectionString);
            Environment.SetEnvironmentVariable(KnownProxyEnvVar, ProxyIp);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
            Environment.SetEnvironmentVariable(KnownProxyEnvVar, null);
        }
    }
}
