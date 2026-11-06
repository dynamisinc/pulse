namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.EasyLogin;
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
            options.UseSqlServer("Server=nonexistent;Database=pulse;Trusted_Connection=False;Connect Timeout=1;"));
        services.AddExerciseScoping();
        services.AddExerciseClock(); // engine-runtime/08: IScenarioNow (+ the clock it reads)
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
        options.ParticipantDayLong.Should().BeTrue("easy-login story 06: participant sessions last the exercise day by default");
    }

    [Fact]
    public void AddSessions_BindsParticipantDayLongOff_FromAuthenticationSession()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Authentication:Session:ParticipantDayLong"] = "false" })
            .Build();
        var services = BaseServices();
        services.AddSessions(configuration);
        using var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IOptions<SessionOptions>>().Value.ParticipantDayLong.Should().BeFalse(
            "Authentication:Session:ParticipantDayLong = false restores the sliding participant window");
    }

    [Fact]
    public void AddSessions_RegistersTheDayCapInputs_WithoutOverridingAHostsOwnClock()
    {
        // The day cap needs a clock and the exercise facts reader. AddSessions TryAdds both so the slice resolves on its
        // own, and must never replace a clock the host (or AddEasyLoginFoundation, or a test) registered first.
        var hostClock = new FixedClock();
        var services = BaseServices();
        services.AddSingleton(EmptyConfig()); // AddEasyLoginFoundation binds through the container's IConfiguration, as a real host has.
        services.AddSingleton<TimeProvider>(hostClock);
        services.AddSessions(EmptyConfig());
        services.AddEasyLoginFoundation();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<TimeProvider>().Should().BeSameAs(hostClock);
        scope.ServiceProvider.GetRequiredService<ExerciseFactsReader>().Should().NotBeNull();
        scope.ServiceProvider.GetRequiredService<ISessionIssuer>().Should().BeOfType<SessionIssuer>();
        scope.ServiceProvider.GetRequiredService<SessionService>().Should().NotBeNull();
    }

    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
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
