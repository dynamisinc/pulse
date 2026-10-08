namespace Pulse.WebApi.Tests.Features.Injects;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Injects;
using Xunit;

/// <summary>
/// Story 06 AC "Cannot merge unwired" (the composition half), on the REAL <c>Program</c> — plain <see cref="FactAttribute"/>,
/// no database. Every <c>/api/injects*</c> route is mapped exactly once, an anonymous call to each is answered by the
/// default-deny gate (401 + challenge — never a 404, which is what an unwired slice looks like), the
/// <see cref="InjectBurstRunner"/> is a registered hosted service, and the queue service and the REAL funnel publisher
/// resolve. Without <c>AddInjects()</c>/<c>MapInjects()</c> in <c>Program.cs</c> these fail (verified by neutering the
/// <c>MapInjects()</c> line) — the #310→#317 lesson that slice-level hosts cannot catch.
/// </summary>
public sealed class InjectsCompositionRootWiringTests
{
    private const string AnyId = "00000000-0000-0000-0000-000000000001";

    public static TheoryData<string, string> Routes() => new()
    {
        { "GET", "/api/injects" },
        { "GET", "/api/injects/assignees" },
        { "POST", "/api/injects" },
        { "PUT", "/api/injects/{id:guid}" },
        { "DELETE", "/api/injects/{id:guid}" },
        { "POST", "/api/injects/reorder" },
        { "POST", "/api/injects/{id:guid}/fire" },
        { "POST", "/api/injects/{id:guid}/hold" },
        { "POST", "/api/injects/{id:guid}/release" },
        { "POST", "/api/injects/{id:guid}/skip" },
        { "POST", "/api/injects/{id:guid}/unskip" },
        { "POST", "/api/injects/{id:guid}/retry" },
    };

    [Fact]
    public void ProgramCs_MapsEveryInjectRoute_ExactlyOnce()
    {
        using var factory = new ProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        foreach (var route in Routes())
        {
            var (method, pattern) = ((string)route[0], (string)route[1]);
            CountRoutes(dataSource, method, pattern).Should().Be(
                1, "{0} {1} must be wired into Program.cs exactly once (MapInjects) — unwired, the console 404s", method, pattern);
        }
    }

    [Fact]
    public void ProgramCs_RegistersTheBurstRunner_AsAHostedService()
    {
        using var factory = new ProbeFactory();

        factory.Services.GetServices<IHostedService>().OfType<InjectBurstRunner>().Should().ContainSingle(
            "without the runner a released burst publishes its first post and then nothing, with every console closed");
    }

    [Fact]
    public void ProgramCs_ResolvesTheQueueService_OverTheRealFunnelPublisher()
    {
        using var factory = new ProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<InjectQueueService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<IInjectPostPublisher>().Should().BeOfType<FunnelInjectPostPublisher>(
            "production publishes through PostIngestService itself — a substitute must never reach the real host");
        factory.Services.GetRequiredService<IBurstJitterSource>().Should().BeOfType<CryptoBurstJitterSource>();
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task AnAnonymousCall_IsAnsweredByTheGate_NeverA404(string method, string pattern)
    {
        using var factory = new ProbeFactory(resolveExercise: true);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), pattern.Replace("{id:guid}", AnyId, StringComparison.Ordinal));
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, "{0} {1}: participants and anonymous callers are refused", method, pattern);
        response.Headers.WwwAuthenticate.Should().NotBeEmpty("the default-deny gate answers first, before any handler or database work");
    }

    private static int CountRoutes(EndpointDataSource dataSource, string method, string rawText) =>
        dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, rawText, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false));

    /// <summary>
    /// The real <c>Program</c> host on a never-connecting connection string. When asked, every request resolves to a
    /// fixed exercise (the #359 precondition: a scope from the bare Host header, and still no session).
    /// </summary>
    private sealed class ProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private readonly bool _resolveExercise;

        public ProbeFactory(bool resolveExercise = false)
        {
            _resolveExercise = resolveExercise;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, "Server=nonexistent;Database=pulse;Trusted_Connection=False;");
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            if (_resolveExercise)
            {
                builder.ConfigureTestServices(services =>
                    services.AddSingleton<IHostExerciseResolver>(new FixedHostExerciseResolver()));
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }

    private sealed class FixedHostExerciseResolver : IHostExerciseResolver
    {
        private static readonly Guid ExerciseId = Guid.Parse("cccccccc-0000-4000-8000-00000000000c");

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) =>
            Task.FromResult<Guid?>(ExerciseId);
    }
}
