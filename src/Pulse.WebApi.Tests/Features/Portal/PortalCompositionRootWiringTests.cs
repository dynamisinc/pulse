namespace Pulse.WebApi.Tests.Features.Portal;

using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.ExerciseResolution;
using Pulse.WebApi.Features.Portal;
using Pulse.WebApi.Features.Portal.Config;
using Pulse.WebApi.Features.Portal.Contracts;
using Xunit;

/// <summary>
/// Composition-root guard for the exercise portal (E3; plain <see cref="FactAttribute"/>s, no Docker): boots the REAL
/// <c>Program</c> host and proves the <c>AddPortal()</c> / <c>MapPortal()</c> seams are wired: story 03's routes are
/// mapped exactly once, refuse an anonymous caller (never a 404, which is what an unwired slice looks like), and its
/// service resolves. Later portal backend stories (04, 21) extend this file.
/// </summary>
public sealed class PortalCompositionRootWiringTests
{
    /// <summary>Story 03: every portal config route, mapped by <c>MapPortal()</c>.</summary>
    /// <returns>The method and raw route pattern of each route.</returns>
    public static TheoryData<string, string> ConfigRoutes() => new()
    {
        { "GET", "/api/portal" },
        { "GET", "/api/portal/config" },
        { "PUT", "/api/portal/config" },
    };

    [Fact]
    public void AddPortal_IsIdempotent_AndRegistersTheConfigService()
    {
        var once = new ServiceCollection().AddPortal();
        var twice = new ServiceCollection().AddPortal().AddPortal();

        twice.Should().HaveCount(once.Count, "every registration is a TryAdd");
        once.Should().ContainSingle(d => d.ServiceType == typeof(IPortalConfigService)
            && d.ImplementationType == typeof(PortalConfigService)
            && d.Lifetime == ServiceLifetime.Scoped);
    }

    [Fact]
    public void ProgramCs_ResolvesThePortalConfigService()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        scope.ServiceProvider.GetRequiredService<IPortalConfigService>().Should().BeOfType<PortalConfigService>();
    }

    [Fact]
    public void ProgramCs_MapsEveryConfigRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        foreach (var route in ConfigRoutes())
        {
            var (method, pattern) = ((string)route[0], (string)route[1]);
            dataSource.Endpoints
                .OfType<RouteEndpoint>()
                .Count(endpoint =>
                    string.Equals(endpoint.RoutePattern.RawText, pattern, StringComparison.OrdinalIgnoreCase)
                    && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false))
                .Should().Be(1, "{0} {1} must be wired into Program.cs exactly once (MapPortal -> MapPortalConfig)", method, pattern);
        }
    }

    [Theory]
    [MemberData(nameof(ConfigRoutes))]
    public async Task AnAnonymousCall_IsRefused_NeverA404(string method, string pattern)
    {
        using var factory = new WiringProbeFactory(resolveExercise: true);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(new HttpMethod(method), pattern);
        if (method == "PUT")
        {
            request.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
        }

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "{0} {1}: an anonymous caller is refused before any handler or database work (an unwired route would 404)",
            method,
            pattern);
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string (the channels wiring test's
    /// probe). When asked, every request resolves to a fixed exercise (a scope, still no session).
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly bool _resolveExercise;

        public WiringProbeFactory(bool resolveExercise = false)
        {
            _resolveExercise = resolveExercise;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
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
        private static readonly Guid ExerciseId = Guid.Parse("cccccccc-0000-4000-8000-0000000000d3");

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) =>
            Task.FromResult<Guid?>(ExerciseId);
    }
}
