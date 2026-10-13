namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
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
