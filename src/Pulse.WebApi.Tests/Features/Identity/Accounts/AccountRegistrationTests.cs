namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.Identity.Accounts;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// Composition guard for <see cref="AccountEndpoints.AddParticipantAccounts"/> (story 02) — a plain <c>[Fact]</c>
/// (no container): builds a provider and proves the extension registers a resolvable graph, so the orchestrator's
/// one-line <c>Program.cs</c> wiring cannot silently miss a dependency. The cross-wave seams this slice depends
/// on (<see cref="ISessionIssuer"/> from story 03, <see cref="ICurrentStaffSessionAccessor"/> from story 05/03)
/// are registered as test doubles, mirroring how the endpoints run before the serial merge.
/// </summary>
public sealed class AccountRegistrationTests
{
    private static ServiceProvider BuildProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        services.AddParticipantAccounts();

        // Cross-wave / B0 collaborators the graph needs at runtime, stubbed here.
        services.AddDbContext<PulseDbContext>(options =>
            options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddScoped<ISessionIssuer, RecordingSessionIssuer>();
        services.AddScoped<ICurrentStaffSessionAccessor, NullCurrentStaffSessionAccessor>();

        return services.BuildServiceProvider();
    }

    [Fact]
    public void AddParticipantAccounts_RegistersTheLoginAndProvisioningServices()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<ParticipantLoginService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<AccountProvisioningService>().Should().NotBeNull();
    }

    [Fact]
    public void AddParticipantAccounts_RegistersThePasswordHasherAsSingleton()
    {
        using var provider = BuildProvider();

        var first = provider.GetRequiredService<ParticipantPasswordHasher>();
        var second = provider.GetRequiredService<ParticipantPasswordHasher>();

        first.Should().BeSameAs(second, "the slow-KDF hasher is stateless and thread-safe → a singleton");
    }
}
