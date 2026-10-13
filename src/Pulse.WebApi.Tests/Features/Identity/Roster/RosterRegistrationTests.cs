namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Roster;
using Pulse.WebApi.Features.Identity.Staff;
using Xunit;

/// <summary>
/// easy-login/02 (composition seam) — <see cref="RosterEndpoints.AddRoster"/> registers everything the slice needs on top
/// of story 01's <c>AddEasyLoginFoundation()</c> (a missing registration would only surface at request time), and
/// <see cref="RosterEndpoints.MapRosterEndpoints"/> maps exactly the three frozen routes, once each, with the literal
/// <c>/import</c> segment. The real-host wiring assertion is the orchestrator's <c>CompositionRootWiringTests</c>.
/// </summary>
public sealed class RosterRegistrationTests
{
    [Fact]
    public async Task AddRoster_OnTopOfTheFoundation_ResolvesBothServicesInARequestScope()
    {
        await using var provider = await BuildProviderAsync();
        await using var scope = provider.CreateAsyncScope();

        scope.ServiceProvider.GetRequiredService<RosterService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<RosterQueryService>().Should().NotBeNull();
    }

    [Fact]
    public void AddRoster_IsIdempotent()
    {
        var once = new ServiceCollection();
        once.AddRoster();

        var twice = new ServiceCollection();
        twice.AddRoster();
        twice.AddRoster();

        twice.Count.Should().Be(once.Count, "Gate-2 CR-001: Program.cs wires AddRoster(), so a repeat call must register nothing more");
        twice.Count(d => d.ServiceType == typeof(RosterService)).Should().Be(1);
        twice.Count(d => d.ServiceType == typeof(RosterQueryService)).Should().Be(1);
    }

    [Fact]
    public async Task MapRosterEndpoints_MapsTheThreeFrozenRoutes_OnceEach()
    {
        using var host = await RosterHttpHost.StartAsync(services =>
        {
            services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=nonexistent;Database=pulse;"));
            services.AddScoped<IExerciseContext, ExerciseContext>();
            services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
        });

        var routes = host.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(m => $"{m} {e.RoutePattern.RawText}"))
            .ToList();

        routes.Should().BeEquivalentTo(
            ["GET /api/staff/roster", "POST /api/staff/roster", "POST /api/staff/roster/import"],
            "story 02 owns exactly these three routes");

        long? LimitOf(string method, string route) => host.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Single(e => e.RoutePattern.RawText == route && e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains(method))
            .Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize;

        LimitOf("POST", RosterEndpoints.ImportRoute).Should().Be(RosterEndpoints.MaxImportRequestBytes, "the 1 MB file plus the multipart envelope");
        RosterEndpoints.MaxImportRequestBytes.Should().BeGreaterThan(RosterEndpoints.MaxImportFileBytes);
        LimitOf("POST", RosterEndpoints.RosterRoute).Should().Be(RosterEndpoints.MaxAddRequestBytes, "one row is a few KB");
    }

    private static Task<ServiceProvider> BuildProviderAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(RosterSeed.Configuration());
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=nonexistent;Database=pulse;"));
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();
        Pulse.WebApi.Features.Identity.EasyLogin.EasyLoginFoundationExtensions.AddEasyLoginFoundation(services);
        services.AddRoster();

        return Task.FromResult(services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true }));
    }
}
