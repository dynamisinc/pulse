namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System.Collections.Generic;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Composition guard for <c>AddStaffIdentity()</c> (story 05) — a plain <c>[Fact]</c> (no container): builds a
/// service provider and proves the extension registers a resolvable graph, so the orchestrator's one-line
/// <c>Program.cs</c> wiring cannot silently miss a dependency. Registers the cross-wave seams story 03 owns
/// (<see cref="ISessionIssuer"/>) as test doubles, mirroring how the endpoints will run before Wave 2.
/// </summary>
public sealed class StaffIdentityRegistrationTests
{
    private static ServiceProvider BuildProvider()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Authentication:StaffIdentity:Accounts:0:Username"] = "controller",
                ["Authentication:StaffIdentity:Accounts:0:Secret"] = "s3cr3t-pass",
                ["Authentication:StaffIdentity:Accounts:0:ExternalSubject"] = "idp|controller-01",
                ["Authentication:StaffIdentity:Accounts:0:DisplayName"] = "Controller One",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();

        // The story-05 slice under test.
        services.AddStaffIdentity(configuration);

        // Cross-wave collaborators the graph needs at runtime (story 03 / B0), stubbed here.
        services.AddDbContext<PulseDbContext>(options =>
            options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();

        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddStaffIdentity_RegistersProviderBehindTheInterface()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IIdentityProvider>()
            .Should().BeOfType<DynamisIdentityProvider>("the Phase-1 Dynamis provider is registered behind the seam");
    }

    [Fact]
    public void AddStaffIdentity_BindsTheAllowlistOptions()
    {
        using var provider = BuildProvider();

        var options = provider.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value;

        options.Accounts.Should().ContainSingle()
            .Which.ExternalSubject.Should().Be("idp|controller-01", "the allowlist binds from the configured section");
    }

    [Fact]
    public void AddStaffIdentity_RegistersAFailClosedCurrentStaffSessionAccessorByDefault()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<ICurrentStaffSessionAccessor>()
            .Should().BeOfType<NullCurrentStaffSessionAccessor>(
                "until story 03 wires the real accessor, the default must be the fail-closed null accessor (endpoints 401)");
    }

    [Fact]
    public void AddStaffIdentity_RegistersTheLoginAndAssignmentServices()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<StaffLoginService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<StaffAssignmentService>().Should().NotBeNull();
    }
}
