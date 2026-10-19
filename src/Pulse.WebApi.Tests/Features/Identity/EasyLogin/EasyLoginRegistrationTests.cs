namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (issuer, factory and registration AC) — <see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>
/// registers the whole kernel: <see cref="EasyLoginOptions"/> read from <c>Authentication:EasyLogin</c> with the
/// documented defaults and clamp-to-default (review W-2: a bad value never stops the host; it falls back and its KEY is
/// logged once at startup), <c>TimeProvider.System</c> with <c>TryAddSingleton</c> (so a test's
/// fake wins), Data Protection and the token protector, the URL builder, the facts reader, the link DTO factory, and
/// the fail-closed <see cref="NullParticipantLinkIssuer"/> that story 03's <c>Replace</c> overrides. The last tests
/// compose it into the REAL <c>Program</c> host, so a missing dependency there cannot hide behind a hand-built
/// container.
/// </summary>
public sealed class EasyLoginRegistrationTests
{
    private static ServiceProvider BuildProvider(
        IDictionary<string, string?>? settings = null,
        Action<IServiceCollection>? before = null,
        Action<IServiceCollection>? after = null,
        CapturingLoggerProvider? log = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddLogging(logging =>
        {
            if (log is not null)
            {
                logging.AddProvider(log);
            }
        });
        services.AddSingleton<IConfiguration>(configuration);
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer("Server=model-only;Database=none;"));
        before?.Invoke(services);

        services.AddEasyLoginFoundation();

        after?.Invoke(services);
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
    }

    [Fact]
    public void Options_BindWithTheDocumentedDefaults_WhenTheSectionIsAbsent()
    {
        using var provider = BuildProvider();

        var options = provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value;

        options.JoinPermitPerMinute.Should().Be(30);
        options.WordPermitPerMinute.Should().Be(10);
        options.DayRolloverHour.Should().Be(0);
        options.MaxCardsPerRequest.Should().Be(500);
        EasyLoginOptions.SectionName.Should().Be("Authentication:EasyLogin");
    }

    [Fact]
    public void Options_BindFromAuthenticationEasyLogin()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>
        {
            ["Authentication:EasyLogin:JoinPermitPerMinute"] = "60",
            ["Authentication:EasyLogin:WordPermitPerMinute"] = "20",
            ["Authentication:EasyLogin:DayRolloverHour"] = "3",
            ["Authentication:EasyLogin:MaxCardsPerRequest"] = "100",
        });

        provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value.Should().BeEquivalentTo(new EasyLoginOptions
        {
            JoinPermitPerMinute = 60,
            WordPermitPerMinute = 20,
            DayRolloverHour = 3,
            MaxCardsPerRequest = 100,
        });
    }

    [Theory]
    [InlineData("DayRolloverHour", "7")]
    [InlineData("DayRolloverHour", "-1")]
    [InlineData("DayRolloverHour", "three")]
    [InlineData("DayRolloverHour", "2.5")]
    [InlineData("JoinPermitPerMinute", "0")]
    [InlineData("JoinPermitPerMinute", "abc")]
    [InlineData("WordPermitPerMinute", "-5")]
    [InlineData("WordPermitPerMinute", "1e3")]
    [InlineData("MaxCardsPerRequest", "0")]
    [InlineData("MaxCardsPerRequest", "99999999999")]
    public async Task Options_OutOfRangeOrNonNumeric_FallBackToTheDefault_AndOnlyTheKeyIsLoggedOnceAtStartup(string name, string value)
    {
        var key = $"{EasyLoginOptions.SectionName}:{name}";
        var neighbour = name == nameof(EasyLoginOptions.MaxCardsPerRequest)
            ? nameof(EasyLoginOptions.JoinPermitPerMinute)
            : nameof(EasyLoginOptions.MaxCardsPerRequest);
        var log = new CapturingLoggerProvider();
        using var provider = BuildProvider(
            new Dictionary<string, string?> { [key] = value, [$"{EasyLoginOptions.SectionName}:{neighbour}"] = "77" },
            log: log);

        var read = () => provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value;
        var options = read.Should().NotThrow("{0}={1} must never stop the API (review W-2)", key, value).Subject;

        ValueOf(options, name).Should().Be(ValueOf(new EasyLoginOptions(), name), "a refused value takes its default");
        ValueOf(options, neighbour).Should().Be(77, "one bad key does not reset the rest of the section");
        options.IsValid().Should().BeTrue();
        EasyLoginOptions.FromConfiguration(provider.GetRequiredService<IConfiguration>()).Should().BeEquivalentTo(
            options, "IOptions holds exactly the clamped values, so the rate-limit policies of stories 03 and 05 read them");

        await StartupCheck(provider).StartAsync(default);

        var warnings = log.Messages.Where(m => m.Contains(key, StringComparison.Ordinal)).ToList();
        warnings.Should().ContainSingle("the refused key is logged once, at startup");
        warnings[0].Should().NotContain(value, "the log names the key, never the value");
    }

    [Fact]
    public async Task Options_ValidOrBlankValues_LogNothing()
    {
        var log = new CapturingLoggerProvider();
        using var provider = BuildProvider(
            new Dictionary<string, string?>
            {
                ["Authentication:EasyLogin:DayRolloverHour"] = " 3 ",
                ["Authentication:EasyLogin:JoinPermitPerMinute"] = "",
                ["Authentication:EasyLogin:WordPermitPerMinute"] = "   ",
            },
            log: log);

        var options = provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value;
        await StartupCheck(provider).StartAsync(default);

        options.DayRolloverHour.Should().Be(3, "surrounding whitespace is tolerated");
        options.JoinPermitPerMinute.Should().Be(30, "a blank value is 'not set': the default, silently");
        options.WordPermitPerMinute.Should().Be(10);
        log.Messages.Should().NotContain(m => m.Contains(EasyLoginOptions.SectionName, StringComparison.Ordinal));
    }

    [Fact]
    public void FromConfiguration_RefusesANullConfiguration()
    {
        ((Action)(() => EasyLoginOptions.FromConfiguration(null!))).Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void TimeProvider_IsTheSystemClock_ButAPreRegisteredOneWins()
    {
        using (var provider = BuildProvider())
        {
            provider.GetRequiredService<TimeProvider>().Should().BeSameAs(TimeProvider.System);
        }

        var fake = new FixedTimeProvider();
        using (var provider = BuildProvider(before: services => services.AddSingleton<TimeProvider>(fake)))
        {
            provider.GetRequiredService<TimeProvider>().Should().BeSameAs(
                fake, "TryAddSingleton: a test host's fake clock must win, so day-boundary tests never sleep");
        }
    }

    [Fact]
    public void TheKernel_Resolves_WithTheRightLifetimes()
    {
        using var provider = BuildProvider();
        using var scope1 = provider.CreateScope();
        using var scope2 = provider.CreateScope();

        provider.GetRequiredService<IParticipantLinkTokenProtector>().Should().BeOfType<ParticipantLinkTokenProtector>();
        provider.GetRequiredService<IParticipantLinkTokenProtector>().Should().BeSameAs(
            provider.GetRequiredService<IParticipantLinkTokenProtector>(), "the protector is a stateless singleton");
        provider.GetRequiredService<JoinUrlBuilder>().Should().BeSameAs(provider.GetRequiredService<JoinUrlBuilder>());
        provider.GetRequiredService<RosterLinkDtoFactory>().Should().BeSameAs(provider.GetRequiredService<RosterLinkDtoFactory>());

        var reader1 = scope1.ServiceProvider.GetRequiredService<ExerciseFactsReader>();
        reader1.Should().BeSameAs(scope1.ServiceProvider.GetRequiredService<ExerciseFactsReader>());
        reader1.Should().NotBeSameAs(
            scope2.ServiceProvider.GetRequiredService<ExerciseFactsReader>(), "the reader is scoped to the DbContext unit of work");
    }

    [Fact]
    public async Task TheLinkIssuer_DefaultsToTheFailClosedNullIssuer_ThatIssuesNothing()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var issuer = scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>();

        issuer.Should().BeOfType<NullParticipantLinkIssuer>();
        (await issuer.EnsureActiveAsync(NewAccount(), issuedByStaffUserId: null, DateTimeOffset.UtcNow)).Should().BeNull(
            "until story 03 is wired, a new participant reports no link rather than a half-built one being minted");
    }

    [Fact]
    public void TheLinkIssuer_IsReplacedByAReplaceRegistration_WhicheverRunsFirst()
    {
        static void Story03(IServiceCollection services) =>
            services.Replace(ServiceDescriptor.Scoped<IParticipantLinkIssuer, RecordingIssuer>());

        using (var foundationFirst = BuildProvider(after: Story03))
        using (var scope = foundationFirst.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<RecordingIssuer>();
        }

        using (var story03First = BuildProvider(before: Story03))
        using (var scope = story03First.CreateScope())
        {
            scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<RecordingIssuer>(
                "the foundation TryAdds its default, so it never overrides the real issuer");
        }
    }

    [Fact]
    public void AddEasyLoginFoundation_IsIdempotent()
    {
        using var provider = BuildProvider(after: services => services.AddEasyLoginFoundation());
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<NullParticipantLinkIssuer>();
        provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value.JoinPermitPerMinute.Should().Be(30);
        provider.GetServices<IHostedService>().OfType<EasyLoginOptionsStartupCheck>().Should().ContainSingle(
            "the startup check is registered once however often the foundation is added");
    }

    [Fact]
    public void AddEasyLoginFoundation_RefusesANullCollection()
    {
        ((Action)(() => EasyLoginFoundationExtensions.AddEasyLoginFoundation(null!))).Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public async Task ComposedIntoTheRealHost_TheKernelResolves_AndTheJoinUrlFollowsTheHostConfiguration()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [JoinUrlBuilder.FrontendBaseUrlKey] = "https://pulse-uat.cobrasoftware.com",
            }));
            builder.ConfigureTestServices(services => services.AddEasyLoginFoundation());
        });

        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;

        services.GetRequiredService<IOptions<EasyLoginOptions>>().Value.DayRolloverHour.Should().Be(0);
        services.GetRequiredService<ExerciseFactsReader>().Should().NotBeNull();
        // The backend seam wired story 03's AddPersonalLinks, which Replaces 01's fail-closed null issuer in the real host.
        services.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<Pulse.WebApi.Features.Identity.PersonalLinks.ParticipantLinkService>();
        services.GetRequiredService<TimeProvider>().Should().NotBeNull();
        services.GetRequiredService<JoinUrlBuilder>().Build("tok").Should().Be("https://pulse-uat.cobrasoftware.com/join/tok");

        var protector = services.GetRequiredService<IParticipantLinkTokenProtector>();
        protector.Unprotect(protector.Protect("tok")).Should().Be("tok", "the host's Data Protection key ring backs the protector");

        // The RosterStaffRoleFilter resolves these from the request scope; the real host must provide them.
        services.GetRequiredService<Pulse.WebApi.Features.Identity.Staff.StaffAssignmentService>().Should().NotBeNull();
        services.GetRequiredService<IExerciseContext>().Should().NotBeNull();
    }

    [Theory]
    [InlineData("9")]
    [InlineData("three")]
    public async Task ComposedIntoTheRealHost_ABadRolloverHour_StartsTheHostWithTheDefault_AndLogsTheKeyOnce(string value)
    {
        const string key = "Authentication:EasyLogin:DayRolloverHour";
        var log = new CapturingLoggerProvider();
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [key] = value,
            }));
            builder.ConfigureLogging(logging => logging.AddProvider(log));
            builder.ConfigureTestServices(services => services.AddEasyLoginFoundation());
        });

        using var client = factory.CreateClient();
        var health = await client.GetAsync(new Uri("/health", UriKind.Relative));

        health.StatusCode.Should().Be(HttpStatusCode.OK, "a bad easy-login value must not take the API down (review W-2)");
        factory.Services.GetRequiredService<IOptions<EasyLoginOptions>>().Value.DayRolloverHour.Should().Be(
            0, "the refused value falls back to the default");

        var warnings = log.Messages.Where(m => m.Contains(key, StringComparison.Ordinal)).ToList();
        warnings.Should().ContainSingle("the host logs the refused key once at startup");
        warnings[0].Should().NotContain(value, "the log names the key, never the value");
    }

    private static Account NewAccount() => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        Username = "jsmith",
        DisplayName = "Jane Smith",
        CreatedAt = DateTimeOffset.UtcNow,
        Enrollment = new Enrollment { Id = Guid.NewGuid(), ExerciseId = Guid.NewGuid(), Role = "participant" },
    };

    private static int ValueOf(EasyLoginOptions options, string name) => name switch
    {
        nameof(EasyLoginOptions.JoinPermitPerMinute) => options.JoinPermitPerMinute,
        nameof(EasyLoginOptions.WordPermitPerMinute) => options.WordPermitPerMinute,
        nameof(EasyLoginOptions.DayRolloverHour) => options.DayRolloverHour,
        nameof(EasyLoginOptions.MaxCardsPerRequest) => options.MaxCardsPerRequest,
        _ => throw new ArgumentOutOfRangeException(nameof(name), name, null),
    };

    private static EasyLoginOptionsStartupCheck StartupCheck(IServiceProvider provider) =>
        provider.GetServices<IHostedService>().OfType<EasyLoginOptionsStartupCheck>().Single();

    /// <summary>Collects every formatted log message, so "logged once, naming the key" is observable.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> _messages = new();

        public IReadOnlyCollection<string> Messages => _messages;

        public ILogger CreateLogger(string categoryName) => new QueueLogger(_messages);

        public void Dispose()
        {
        }

        private sealed class QueueLogger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => NullLogger.Instance.BeginScope(state);

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) => messages.Enqueue(formatter(state, exception));
        }
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);
    }

    private sealed class RecordingIssuer : IParticipantLinkIssuer
    {
        public Task<ParticipantLink?> EnsureActiveAsync(
            Account account,
            Guid? issuedByStaffUserId,
            DateTimeOffset now,
            System.Threading.CancellationToken cancellationToken = default) =>
            Task.FromResult<ParticipantLink?>(null);
    }
}
