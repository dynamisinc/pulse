namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Xunit;

/// <summary>
/// Composition-root guard for channels-foundation story 01 (FC-9.10; plain <see cref="FactAttribute"/>s, no Docker): boots
/// the REAL <c>Program</c> host with no override and proves the M1 schema reaches the request-scoped
/// <see cref="PulseDbContext"/> that <c>Program.cs</c> registers — every channel entity in the model, under the central
/// exercise filter — and that the <c>AddChannels()</c> seam later stories fill is safe to compose.
/// </summary>
/// <remarks>
/// Story 01 registered no service of its own (schema only); stories 03+ extend this file as they fill
/// <c>AddChannels()</c> / <c>MapChannels()</c> (story 04: the publish funnel; story 10: the alert source and the
/// <c>/api/alerts*</c> routes). Resolving the context only needs the host to BUILD, so it is fed a dummy,
/// never-connecting connection string.
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
    public void AddChannels_IsIdempotent()
    {
        var services = new ServiceCollection();

        services.AddChannels().AddChannels().Should().BeSameAs(services);
        services.GroupBy(descriptor => (descriptor.ServiceType, descriptor.ImplementationType))
            .Should().OnlyContain(group => group.Count() == 1, "a second AddChannels() registers nothing twice");

        services.Count(d => d.ServiceType == typeof(IAlertRaiser)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(AlertService)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(AlertReader)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IPlatformAlertNotifier)).Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(AlertExpirySweeper))
            .Should().Be(1, "story 10's expiry sweep runs once per host");
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

    [Fact]
    public void ProgramCs_WiresTheAlertSource_AndItsRoutes()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        scope.ServiceProvider.GetRequiredService<IAlertRaiser>().Should().BeOfType<AlertService>();
        scope.ServiceProvider.GetRequiredService<IPlatformAlertNotifier>().Should().BeOfType<NullPlatformAlertNotifier>(
            "the SOC-072 bridge is a no-op until notifications story 03 replaces it");
        scope.ServiceProvider.GetRequiredService<ParticipantShellConfigService>().Should().NotBeNull(
            "GET /api/alerts delegates to the alert source, so the shell config service must still resolve");
        factory.Services.GetServices<IHostedService>().OfType<AlertExpirySweeper>().Should().ContainSingle();

        var routes = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [])
                .Select(method => $"{method} {e.RoutePattern.RawText}"))
            .ToList();

        routes.Should().Contain(new[]
        {
            "GET /api/alerts",
            "GET /api/alerts/history",
            "POST /api/alerts",
            "POST /api/alerts/{id:guid}/clear",
        });
    }

    /// <summary>Boots the real <c>Program</c> host with a dummy, never-connecting connection string. Overrides nothing else.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        private readonly Action<IServiceCollection>? _configure;

        public WiringProbeFactory(Action<IServiceCollection>? configure = null)
        {
            _configure = configure;
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            if (_configure is not null)
            {
                builder.ConfigureServices(_configure);
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
