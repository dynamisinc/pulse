namespace Pulse.WebApi.Tests.Features.Portal.Resources;

using System;
using System.Linq;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Portal.Contracts;
using Pulse.WebApi.Features.Portal.Resources;
using Xunit;

/// <summary>
/// The Resources shelf (exercise-portal story 04) on the REAL <c>Program</c> host: the service and its sanitizer profile
/// resolve, the document flag defaults off, and every <c>/api/portal/resources*</c> route is mapped exactly once.
/// </summary>
public sealed class PortalResourcesCompositionRootWiringTests
{
    public static TheoryData<string, string> Routes() => new()
    {
        { "GET", "/api/portal/resources" },
        { "GET", "/api/portal/resources/{id:guid}" },
        { "POST", "/api/portal/resources" },
        { "PUT", "/api/portal/resources/{id:guid}" },
        { "DELETE", "/api/portal/resources/{id:guid}" },
        { "POST", "/api/portal/resources/reorder" },
    };

    [Fact]
    public void ProgramCs_ResolvesTheShelfService_ItsProfile_AndADocumentFlagThatDefaultsOff()
    {
        using var factory = new WiringProbeFactory();
        using var scope = factory.Services.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = Guid.NewGuid();

        scope.ServiceProvider.GetRequiredService<IPortalResourceService>().Should().BeOfType<PortalResourceService>();
        factory.Services.GetRequiredService<ISanitizerProfileRegistry>()
            .Contains(PortalResourceSanitizer.ProfileName).Should().BeTrue();
        factory.Services.GetRequiredService<IOptions<PortalResourceOptions>>().Value.DocumentAttachmentsEnabled
            .Should().BeFalse("PDF attachments stay off until the flag is turned on");
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public void ProgramCs_MapsEveryShelfRoute_ExactlyOnce(string method, string pattern)
    {
        using var factory = new WiringProbeFactory();

        factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Count(endpoint =>
                string.Equals(endpoint.RoutePattern.RawText, pattern, StringComparison.OrdinalIgnoreCase)
                && (endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods.Contains(method) ?? false))
            .Should().Be(1, "{0} {1} is mapped once", method, pattern);
    }

    [Fact]
    public void AddPortalResources_IsIdempotent()
    {
        var once = new ServiceCollection().AddPortalResources();
        var twice = new ServiceCollection().AddPortalResources().AddPortalResources();

        twice.Should().HaveCount(once.Count, "a second call must not register the sanitizer profile twice");
        once.Should().ContainSingle(d => d.ServiceType == typeof(IPortalResourceService) && d.Lifetime == ServiceLifetime.Scoped);
    }

    /// <summary>Boots the real <c>Program</c> host with a dummy, never-connecting connection string. Overrides nothing else.</summary>
    private sealed class WiringProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string DummyConnectionString =
            "Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;";

        public WiringProbeFactory()
        {
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
        }
    }
}
