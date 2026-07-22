namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.Identity.Sessions;
using Pulse.WebApi.Features.Identity.Staff;

/// <summary>
/// Composition guard for <see cref="SessionEndpoints.AddSessions"/> (story 03) — a plain <c>[Fact]</c> (no
/// container): builds a service provider and proves the extension registers a resolvable graph (so the
/// orchestrator's one-line <c>Program.cs</c> wiring cannot silently miss a dependency), that the session
/// lifetimes bind, and — the crux — that the REAL <see cref="CurrentStaffSessionAccessor"/> WINS over story
/// 05's fail-closed <see cref="NullCurrentStaffSessionAccessor"/> regardless of registration order.
/// </summary>
public class SessionRegistrationTests
{
    private static ServiceCollection BaseServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        // Cross-wave / B0 collaborators the graph needs at runtime.
        services.AddDbContext<PulseDbContext>(options =>
            options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;"));
        services.AddExerciseScoping();
        return services;
    }

    private static IConfiguration EmptyConfig() => new ConfigurationBuilder().Build();

    [Fact]
    public void AddSessions_RegistersTheIssuerServiceAndAuthenticator()
    {
        var services = BaseServices();
        services.AddSessions(EmptyConfig());
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<ISessionIssuer>().Should().BeOfType<SessionIssuer>();
        scope.ServiceProvider.GetRequiredService<SessionService>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<ISessionAuthenticator>().Should().BeOfType<SessionAuthenticator>();
    }

    [Fact]
    public void AddSessions_BindsSessionLifetimeDefaults()
    {
        var services = BaseServices();
        services.AddSessions(EmptyConfig());
        using var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptions<SessionOptions>>().Value;

        options.SessionLifetimeMinutes.Should().Be(60, "sessions are short-lived by default (one hour)");
        options.RefreshLifetimeMinutes.Should().Be(720, "the refresh window is longer than the access window");
    }

    [Fact]
    public void AddSessions_AfterAddStaffIdentity_RealStaffSessionAccessorWins()
    {
        var services = BaseServices();
        // Intended order: story 05 first (TryAdd's the fail-closed Null), then story 03 (Replace's the real one).
        services.AddStaffIdentity(EmptyConfig());
        services.AddSessions(EmptyConfig());
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<ICurrentStaffSessionAccessor>()
            .Should().BeOfType<CurrentStaffSessionAccessor>(
                "AddSessions() must Replace story 05's fail-closed NullCurrentStaffSessionAccessor with the real, " +
                "auth-scheme-backed accessor so a live staff session finally resolves the staff endpoints");
    }

    [Fact]
    public void AddSessions_BeforeAddStaffIdentity_RealStaffSessionAccessorStillWins()
    {
        var services = BaseServices();
        // Reverse order — Replace is order-independent, so the real accessor must still win.
        services.AddSessions(EmptyConfig());
        services.AddStaffIdentity(EmptyConfig());
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<ICurrentStaffSessionAccessor>()
            .Should().BeOfType<CurrentStaffSessionAccessor>(
                "the real accessor must win regardless of registration order — story 05's TryAdd never overrides it");
    }
}
