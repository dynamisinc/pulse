namespace Pulse.WebApi.Tests.Features.Ops.OrgAdminSeed;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.Identity.Providers;
using Pulse.WebApi.Features.Ops.OrgAdminSeed;
using Xunit;

/// <summary>
/// Composition-root guard for the <c>orgAdmin</c> startup seeder, boot-tested against the REAL
/// <c>Program</c> host. It asserts the two halves of the wiring that no unit test can see: that
/// <c>Program.cs</c> actually calls <see cref="OrgAdminSeedExtensions.AddOrgAdminSeed"/> outside production, and
/// that the same call registers <b>nothing at all</b> inside it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Route counting would be vacuous here.</b> This slice maps no endpoint — it is a one-shot
/// <see cref="IHostedService"/> — so the usual "is the route mapped exactly once" probe would find nothing
/// either way and pass on a completely unwired tree. The observable wiring is the host's registered
/// <see cref="IHostedService"/> set, so that is what is asserted. Without this, the slice could merge fully
/// green while its <c>Program.cs</c> line was never added and the seeder never ran once — the #310/#317
/// "merged green but wired to nothing" failure mode.
/// </para>
/// <para>
/// The environment is set through the PROCESS environment variable, not <c>ConfigureWebHost</c>: Program.cs is
/// top-level statements, so <c>builder.Environment</c> is resolved inside
/// <c>WebApplication.CreateBuilder(args)</c> — before any factory customization could layer a value on. Same
/// reasoning, and same idiom, as <c>CorsTests.CorsWebApplicationFactory</c>; the assembly disables cross-class
/// parallelization (AssemblyInfo.cs) so the mutation cannot race another class's host construction.
/// </para>
/// <para>
/// The host is fed a dummy, never-connecting connection string because building it needs no database — and the
/// seeder itself performs NO database work here, since these hosts configure no staff allowlist, which is
/// exactly the inert posture an un-opted-in environment is meant to have.
/// </para>
/// </remarks>
public sealed class CompositionRootWiringTests
{
    [Fact]
    public void ProgramCs_RegistersTheOrgAdminSeeder_OutsideProduction()
    {
        using var factory = new EnvironmentProbeFactory("Development");

        factory.Services.GetServices<IHostedService>().Should().Contain(
            service => service is OrgAdminSeedHostedService,
            "without builder.Services.AddOrgAdminSeed(...) in Program.cs the seeder never runs on the real host, "
            + "and the org-admin surface stays unreachable exactly as it was before this feature — green tests "
            + "and all");
    }

    [Fact]
    public void ProgramCs_ActuallyRUNSTheSeeder_AtHostStart()
    {
        var log = new CapturingLoggerProvider();
        using var factory = new EnvironmentProbeFactory("Development", log);

        // Accessing Services BUILDS AND STARTS the real host, which is what runs IHostedService.StartAsync.
        _ = factory.Services.GetRequiredService<IHostedService>();

        log.Messages.Should().Contain(
            message => message.Contains("orgAdmin startup seeder", StringComparison.Ordinal),
            "registration alone proves nothing — this repo has merged fully-green slices whose code never ran. "
            + "The seeder must actually EXECUTE at host start, and its own log line is the only evidence of "
            + "that from outside. (This host has no reachable database, so what it says is that it failed and "
            + "was skipped — which still proves it ran, and proves the host survived it.)");
    }

    [Fact]
    public async Task ProgramCs_ZeroConfig_AcceptsTheDefaultOrgAdminCredential_OnTheRealHost()
    {
        using var factory = new EnvironmentProbeFactory("Development");

        var result = await AuthenticateAsync(factory, DefaultOrgAdminAccount.Secret);

        result.Outcome.Should().Be(
            StaffAuthenticationOutcome.Authenticated,
            "END TO END on the REAL host with NO Authentication:StaffIdentity configuration whatsoever: the "
            + "registration-time injection has to be visible to the identity provider the login endpoint "
            + "actually resolves. Asserting on the options object instead would pass even if the provider read a "
            + "different accessor or a stale snapshot");
        result.Identity!.ExternalSubject.Should().Be(DefaultOrgAdminAccount.ExternalSubject);
    }

    [Fact]
    public void ProgramCs_ScreamsAboutTheDefaultCredential_ONEVERYBoot()
    {
        var firstBoot = new CapturingLoggerProvider();
        using (var factory = new EnvironmentProbeFactory("Development", firstBoot))
        {
            _ = factory.Services.GetRequiredService<IHostedService>();
        }

        var secondBoot = new CapturingLoggerProvider();
        using (var factory = new EnvironmentProbeFactory("Development", secondBoot))
        {
            _ = factory.Services.GetRequiredService<IHostedService>();
        }

        firstBoot.Messages.Should().Contain(
            message => message.Contains("DEFAULT ADMIN CREDENTIAL IS ACTIVE", StringComparison.Ordinal),
            "a host running on a published admin credential must say so out loud");
        secondBoot.Messages.Should().Contain(
            message => message.Contains("DEFAULT ADMIN CREDENTIAL IS ACTIVE", StringComparison.Ordinal),
            "and on the NEXT boot too. The exposure is not a one-off event to be announced once — it is a "
            + "standing state of this deployment, and the boots most in need of the warning are the later ones");
    }

    [Fact]
    public async Task ProgramCs_DoesNotScream_AndRejectsTheDefault_WhenARealAllowlistEntryIsConfigured()
    {
        const string operatorSecret = "operator-chosen-secret";
        var operatorSubject = $"idp|{Guid.NewGuid():N}";

        var log = new CapturingLoggerProvider();
        using var factory = new EnvironmentProbeFactory("Development", log, new Dictionary<string, string?>
        {
            // The indexed double-underscore form a deployed App Service actually uses.
            ["Authentication__StaffIdentity__Accounts__0__Username"] = DefaultOrgAdminAccount.Username,
            ["Authentication__StaffIdentity__Accounts__0__Secret"] = operatorSecret,
            ["Authentication__StaffIdentity__Accounts__0__ExternalSubject"] = operatorSubject,
            ["Authentication__StaffIdentity__Accounts__0__DisplayName"] = "Configured Operator",
        });

        _ = factory.Services.GetRequiredService<IHostedService>();

        (await AuthenticateAsync(factory, operatorSecret)).Identity!.ExternalSubject.Should().Be(
            operatorSubject, "the operator's configured entry is what authenticates");
        (await AuthenticateAsync(factory, DefaultOrgAdminAccount.Secret)).Outcome.Should().Be(
            StaffAuthenticationOutcome.Rejected,
            "and the published default is NOT also accepted — a configured entry wins outright rather than "
            + "sitting alongside a credential the operator believes they replaced");

        log.Messages.Should().NotContain(
            message => message.Contains("DEFAULT ADMIN CREDENTIAL IS ACTIVE", StringComparison.Ordinal),
            "and there is nothing to scream about, so it must stay quiet — an alarm that fires on a correctly "
            + "configured host is an alarm nobody reads on the host that needs it");
    }

    [Fact]
    public async Task ProgramCs_InProduction_InjectsNothing_AndRejectsTheDefaultCredential()
    {
        using var factory = new EnvironmentProbeFactory("Production");

        factory.Services.GetRequiredService<IOptions<DynamisIdentityProviderOptions>>().Value.Accounts
            .Should().BeEmpty(
                "the production gate covers the ALLOWLIST INJECTION as well as the seeder registration — a "
                + "default admin credential must not enter a live deployment's allowlist even though no seeder "
                + "is present to use it");

        (await AuthenticateAsync(factory, DefaultOrgAdminAccount.Secret)).Outcome.Should().Be(
            StaffAuthenticationOutcome.Rejected,
            "and the outcome a human cares about: on a production host the published credential is not a login");
    }

    /// <summary>Authenticates the default username against a booted host's real <see cref="IIdentityProvider"/>.</summary>
    private static async Task<StaffAuthenticationResult> AuthenticateAsync(
        WebApplicationFactory<Program> factory,
        string secret)
    {
        using var scope = factory.Services.CreateScope();

        return await scope.ServiceProvider.GetRequiredService<IIdentityProvider>()
            .AuthenticateAsync(new StaffCredentials
            {
                Username = DefaultOrgAdminAccount.Username,
                Secret = secret,
            });
    }

    [Fact]
    public void ProgramCs_RegistersNothingAtAll_InProduction()
    {
        using var factory = new EnvironmentProbeFactory("Production");

        factory.Services.GetServices<IHostedService>().Should().NotContain(
            service => service is OrgAdminSeedHostedService,
            "the seeder must be structurally absent from a production host, not merely a registered service "
            + "that declines to act — there must be no code path at all that could mint an administrator in a "
            + "real customer deployment");

        factory.Services.GetService<OrgAdminSeedService>().Should().BeNull(
            "and the seeder service itself is not registered either, so nothing else could resolve and run it");
    }

    /// <summary>
    /// Boots the real <c>Program</c> host under a chosen <c>ASPNETCORE_ENVIRONMENT</c> with a dummy,
    /// never-connecting connection string, plus any extra configuration supplied as environment variables. All
    /// of them are set in the ctor (before the host captures configuration) and cleared on dispose.
    /// </summary>
    /// <remarks>
    /// Extra configuration arrives as PROCESS environment variables for the same reason the environment name
    /// does: <c>Program.cs</c> is top-level statements, so <c>builder.Configuration</c> is read while the
    /// entry point runs — before a <c>ConfigureAppConfiguration</c> callback layered on by the factory could
    /// take effect. The indexed double-underscore keys are also exactly what a deployed App Service supplies,
    /// so the test exercises the real configuration shape rather than a test-only one.
    /// </remarks>
    private sealed class EnvironmentProbeFactory : WebApplicationFactory<Program>
    {
        private const string ConnectionStringEnvVar = "ConnectionStrings__DefaultConnection";
        private const string EnvironmentEnvVar = "ASPNETCORE_ENVIRONMENT";

        /// <summary>
        /// A syntactically valid connection string that can never connect. A closed loopback PORT rather than an
        /// unresolvable host name, with a 1-second timeout: the seeder now performs real database work on these
        /// hosts (it has a credential — the injected default), so the failure it is meant to survive should be
        /// immediate rather than a DNS/connect stall repeated on every boot in this class.
        /// </summary>
        private const string DummyConnectionString =
            "Server=127.0.0.1,1;Database=pulse;Trusted_Connection=False;User Id=none;Password=none;"
            + "Connect Timeout=1;Encrypt=False;";

        private readonly string? _previousEnvironment;
        private readonly CapturingLoggerProvider? _loggerProvider;
        private readonly IReadOnlyList<string> _extraEnvironmentVariables;

        public EnvironmentProbeFactory(
            string environmentName,
            CapturingLoggerProvider? loggerProvider = null,
            IDictionary<string, string?>? extraEnvironmentVariables = null)
        {
            _loggerProvider = loggerProvider;
            _previousEnvironment = Environment.GetEnvironmentVariable(EnvironmentEnvVar);
            Environment.SetEnvironmentVariable(EnvironmentEnvVar, environmentName);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, DummyConnectionString);

            _extraEnvironmentVariables = extraEnvironmentVariables?.Keys.ToList() ?? [];
            foreach (var (key, value) in extraEnvironmentVariables ?? new Dictionary<string, string?>())
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            ArgumentNullException.ThrowIfNull(builder);
            base.ConfigureWebHost(builder);

            if (_loggerProvider is not null)
            {
                // Logging is resolved from DI, not captured into a local at builder time, so unlike the
                // environment this CAN be layered on here.
                builder.ConfigureLogging(logging => logging.AddProvider(_loggerProvider));
            }
        }

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            Environment.SetEnvironmentVariable(ConnectionStringEnvVar, null);
            Environment.SetEnvironmentVariable(EnvironmentEnvVar, _previousEnvironment);

            foreach (var key in _extraEnvironmentVariables)
            {
                Environment.SetEnvironmentVariable(key, null);
            }
        }
    }

    /// <summary>Collects every message the booted host logs, so "the seeder ran" is observable from outside it.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> _messages = new();

        /// <summary>Everything logged by the host so far.</summary>
        public IReadOnlyCollection<string> Messages => _messages;

        /// <inheritdoc />
        public ILogger CreateLogger(string categoryName) => new QueueLogger(_messages);

        /// <inheritdoc />
        public void Dispose()
        {
            // Nothing to release — the queue is owned by the test.
        }

        private sealed class QueueLogger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable BeginScope<TState>(TState state)
                where TState : notnull => NullLogger.Instance.BeginScope(state);

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                ArgumentNullException.ThrowIfNull(formatter);
                messages.Enqueue(formatter(state, exception));
            }
        }
    }
}
