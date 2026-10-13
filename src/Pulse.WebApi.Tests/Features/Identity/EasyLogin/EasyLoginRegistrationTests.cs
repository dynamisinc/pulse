namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (issuer, factory and registration AC) — <see cref="EasyLoginFoundationExtensions.AddEasyLoginFoundation"/>
/// registers the whole kernel: <see cref="EasyLoginOptions"/> bound from <c>Authentication:EasyLogin</c> with the
/// documented defaults and validated at startup, <c>TimeProvider.System</c> with <c>TryAddSingleton</c> (so a test's
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
        Action<IServiceCollection>? after = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
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
    [InlineData("Authentication:EasyLogin:DayRolloverHour", "7")]
    [InlineData("Authentication:EasyLogin:DayRolloverHour", "-1")]
    [InlineData("Authentication:EasyLogin:JoinPermitPerMinute", "0")]
    [InlineData("Authentication:EasyLogin:WordPermitPerMinute", "-5")]
    [InlineData("Authentication:EasyLogin:MaxCardsPerRequest", "0")]
    public void Options_OutOfRange_FailValidation_AtStartup(string key, string value)
    {
        using var provider = BuildProvider(new Dictionary<string, string?> { [key] = value });

        var startup = () => provider.GetRequiredService<IStartupValidator>().Validate();
        var read = () => provider.GetRequiredService<IOptions<EasyLoginOptions>>().Value;

        startup.Should().Throw<OptionsValidationException>("{0}={1} is out of range and must fail the host on start", key, value);
        read.Should().Throw<OptionsValidationException>();
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
        services.GetRequiredService<IParticipantLinkIssuer>().Should().BeOfType<NullParticipantLinkIssuer>();
        services.GetRequiredService<TimeProvider>().Should().NotBeNull();
        services.GetRequiredService<JoinUrlBuilder>().Build("tok").Should().Be("https://pulse-uat.cobrasoftware.com/join/tok");

        var protector = services.GetRequiredService<IParticipantLinkTokenProtector>();
        protector.Unprotect(protector.Protect("tok")).Should().Be("tok", "the host's Data Protection key ring backs the protector");

        // The RosterStaffRoleFilter resolves these from the request scope; the real host must provide them.
        services.GetRequiredService<Pulse.WebApi.Features.Identity.Staff.StaffAssignmentService>().Should().NotBeNull();
        services.GetRequiredService<IExerciseContext>().Should().NotBeNull();
    }

    [Fact]
    public void ComposedIntoTheRealHost_AnOutOfRangeRolloverHour_FailsTheHostOnStart()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Authentication:EasyLogin:DayRolloverHour"] = "9",
            }));
            builder.ConfigureTestServices(services => services.AddEasyLoginFoundation());
        });

        var start = () => factory.CreateClient();

        start.Should().Throw<OptionsValidationException>("ValidateOnStart fails the deploy loudly instead of moving the day boundary");
    }

    private static Account NewAccount() => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        Username = "jsmith",
        DisplayName = "Jane Smith",
        Role = "participant",
        CreatedAt = DateTimeOffset.UtcNow,
    };

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
