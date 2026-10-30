namespace Pulse.WebApi.Tests.Features.Channels;

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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Enablement;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.ExerciseResolution;
using Xunit;

/// <summary>
/// Composition-root guard for the channels foundation (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots
/// the REAL <c>Program</c> host with no override and proves the M1 schema reaches the request-scoped
/// <see cref="PulseDbContext"/> that <c>Program.cs</c> registers — every channel entity in the model, under the central
/// exercise filter — and that the <c>AddChannels()</c> / <c>MapChannels()</c> seams are wired: story 03's outlet routes
/// are mapped exactly once, refuse an anonymous caller (never a 404, which is what an unwired slice looks like), and its
/// services resolve.
/// </summary>
/// <remarks>
/// Story 01 registered no service of its own (schema only); stories 03+ extend this file as they fill
/// <c>AddChannels()</c> / <c>MapChannels()</c> (story 03: the outlet registry; story 04: the publish funnel; story 08: the enablement gate). Resolving
/// services only needs the host to BUILD, so it is fed a dummy, never-connecting connection string; the anonymous probe
/// is answered before any database work.
/// </remarks>
public sealed class ChannelsCompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_ResolvesTheScopedContext_WithEveryM1EntityUnderTheExerciseFilter()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        var context = scope.ServiceProvider.GetRequiredService<PulseDbContext>();

        foreach (var type in new[]
                 {
                     typeof(Outlet), typeof(ContentItem), typeof(ContentItemRevision), typeof(ContentItemMedia),
                     typeof(ChannelAlert), typeof(PortalConfig), typeof(PortalResource), typeof(WeatherZone),
                 })
        {
            var entity = context.Model.FindEntityType(type);
            entity.Should().NotBeNull("{0} is part of the context Program.cs registers", type.Name);
            entity!.FindDeclaredQueryFilter(null).Should().NotBeNull("{0} is covered by the central exercise filter", type.Name);
        }

        context.Model.FindEntityType(typeof(InjectItem))!.FindProperty(nameof(InjectItem.ContentItemId))
            .Should().NotBeNull("the folded inject column is mapped");
        context.Database.HasPendingModelChanges().Should().BeFalse("the deployed migrations describe the registered model");
    }

    [Fact]
    public void AddChannels_IsIdempotent_AndRegistersTheOutletRegistry()
    {
        var once = new ServiceCollection().AddChannels();
        var twice = new ServiceCollection().AddChannels().AddChannels();

        twice.Should().HaveCount(once.Count, "every registration is a TryAdd, so a second call adds nothing");
        once.Should().ContainSingle(d => d.ServiceType == typeof(ISkinOverridesValidator) && d.Lifetime == ServiceLifetime.Singleton);
        once.Should().ContainSingle(d => d.ServiceType == typeof(OutletService) && d.Lifetime == ServiceLifetime.Scoped);
        once.Should().ContainSingle(d => d.ServiceType == typeof(OutletDefaultsCatalog));
    }

    [Fact]
    public void ProgramCs_ResolvesThePublishFunnel_AndItsSeams()
    {
        // Story 04: the funnel, its projector, the profile registry and the startup check reach the REAL host through
        // AddChannels(); no Program.cs edit.
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        scope.ServiceProvider.GetRequiredService<IContentPublishService>().Should().BeOfType<ContentPublishService>();
        scope.ServiceProvider.GetRequiredService<ContentProjector>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<IContentPermalinks>().Should().BeSameAs(ContentPermalinks.Instance);
        var profiles = factory.Services.GetRequiredService<ISanitizerProfileRegistry>();
        profiles.Contains(ISanitizerProfileRegistry.Plain).Should().BeTrue();
        profiles.Contains(ISanitizerProfileRegistry.RichBasic).Should().BeTrue();
        profiles.Contains(ISanitizerProfileRegistry.RichTables).Should().BeTrue();
        factory.Services.GetServices<IHostedService>().OfType<ContentKindStartupCheck>().Should().ContainSingle();
    }

    [Fact]
    public void AKindNamingAnUnregisteredProfile_FailsHostStart()
    {
        using var factory = new WiringProbeFactory(services =>
            services.AddScoped<IContentKindDescriptor>(_ => new Publish.TestKindDescriptor("article", "news", "article-rich")));

        var start = () => factory.Services;

        start.Should().Throw<InvalidOperationException>().WithMessage("*article-rich*not registered*");
    }

    /// <summary>Story 03: every <c>/api/outlets*</c> route, mapped by <c>MapChannels()</c>.</summary>
    /// <returns>The method and raw route pattern of each route.</returns>
    public static TheoryData<string, string> OutletRoutes() => new()
    {
        { "GET", "/api/outlets" },
        { "GET", "/api/outlets/{slug}" },
        { "GET", "/api/outlets/staff" },
        { "POST", "/api/outlets" },
        { "PUT", "/api/outlets/{id:guid}" },
        { "DELETE", "/api/outlets/{id:guid}" },
        { "POST", "/api/outlets/reorder" },
        { "POST", "/api/outlets/defaults" },
    };

    [Fact]
    public void ProgramCs_MapsEveryOutletRoute_ExactlyOnce()
    {
        using var factory = new WiringProbeFactory();
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        foreach (var route in OutletRoutes())
        {
            var (method, pattern) = ((string)route[0], (string)route[1]);
            dataSource.Endpoints
                .OfType<RouteEndpoint>()
                .Count(endpoint =>
                    string.Equals(endpoint.RoutePattern.RawText, pattern, StringComparison.OrdinalIgnoreCase)
                    && (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false))
                .Should().Be(1, "{0} {1} must be wired into Program.cs exactly once (MapChannels -> MapOutlets)", method, pattern);
        }
    }

    [Fact]
    public void ProgramCs_ResolvesTheOutletServices()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<OutletService>().Should().NotBeNull();
        factory.Services.GetRequiredService<ISkinOverridesValidator>().Should().BeOfType<SkinOverridesValidator>();
        factory.Services.GetRequiredService<OutletDefaultsCatalog>().ForChannel("weather").Should().ContainSingle();
    }

    [Theory]
    [MemberData(nameof(OutletRoutes))]
    public async Task AnAnonymousCall_IsRefused_NeverA404(string method, string pattern)
    {
        using var factory = new WiringProbeFactory(resolveExercise: true);
        using var client = factory.CreateClient();

        using var request = new HttpRequestMessage(
            new HttpMethod(method),
            pattern
                .Replace("{id:guid}", "00000000-0000-0000-0000-000000000001", StringComparison.Ordinal)
                .Replace("{slug}", "metro-desk-9", StringComparison.Ordinal));
        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "{0} {1}: an anonymous caller is refused before any handler or database work (an unwired route would 404)",
            method,
            pattern);
    }

    [Fact]
    public void ProgramCs_ResolvesTheChannelEnablementGate_ThroughAddChannels()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IChannelEnablement>().Should().BeOfType<ChannelEnablement>(
            "story 08 registers the gate RequireChannelEnabled resolves per request; a missing line 500s every gated route");
    }

    /// <summary>
    /// Boots the real <c>Program</c> host with a dummy, never-connecting connection string. When asked, every request
    /// resolves to a fixed exercise (a scope from the bare Host header, and still no session). Overrides nothing else.
    /// </summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly Action<IServiceCollection>? _configure;
        private readonly bool _resolveExercise;

        public WiringProbeFactory(Action<IServiceCollection>? configure = null, bool resolveExercise = false)
        {
            _configure = configure;
            _resolveExercise = resolveExercise;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            if (_configure is not null)
            {
                builder.ConfigureServices(_configure);
            }

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
        private static readonly Guid ExerciseId = Guid.Parse("cccccccc-0000-4000-8000-0000000000c3");

        public Task<Guid?> ResolveExerciseIdAsync(string? rawHost, CancellationToken cancellationToken) =>
            Task.FromResult<Guid?>(ExerciseId);
    }
}
