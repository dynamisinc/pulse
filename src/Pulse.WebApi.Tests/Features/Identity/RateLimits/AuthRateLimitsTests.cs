namespace Pulse.WebApi.Tests.Features.Identity.RateLimits;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Features.Identity.RateLimits;
using Xunit;

/// <summary>
/// The configurable authentication rate limits (identity-auth-roles/18 follow-up, cleared for A1a). The sign-off
/// requirement is that the defaults are byte-for-byte unchanged when no key is set.
/// </summary>
public sealed class AuthRateLimitsTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    /// <summary>No keys set: every policy keeps its historical hard-coded limit.</summary>
    [Fact]
    public void Unset_KeepsTheHistoricalDefaults()
    {
        var configuration = Config(new Dictionary<string, string?>());

        AuthRateLimits.ParticipantLoginPerMinute(configuration).Should().Be(10);
        AuthRateLimits.SharedLoginPerMinute(configuration).Should().Be(5);
        AuthRateLimits.SessionPerMinute(configuration).Should().Be(60);
        AuthRateLimits.StaffLoginPerMinute(configuration).Should().Be(10);
    }

    /// <summary>Configured positive values are honored, each under its own key.</summary>
    [Fact]
    public void Configured_ValuesAreHonored()
    {
        var configuration = Config(new Dictionary<string, string?>
        {
            ["Authentication:RateLimits:ParticipantLoginPerMinute"] = "150",
            ["Authentication:RateLimits:SharedLoginPerMinute"] = "100",
            ["Authentication:RateLimits:SessionPerMinute"] = "600",
            ["Authentication:RateLimits:StaffLoginPerMinute"] = "20",
        });

        AuthRateLimits.ParticipantLoginPerMinute(configuration).Should().Be(150);
        AuthRateLimits.SharedLoginPerMinute(configuration).Should().Be(100);
        AuthRateLimits.SessionPerMinute(configuration).Should().Be(600);
        AuthRateLimits.StaffLoginPerMinute(configuration).Should().Be(20);
    }

    /// <summary>A typo never disables a limiter: non-integer, zero and negative values fall back to the default.</summary>
    [Theory]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("-5")]
    [InlineData("")]
    public void Invalid_FallsBackToTheDefault(string raw)
    {
        var configuration = Config(new Dictionary<string, string?> { ["Authentication:RateLimits:SessionPerMinute"] = raw });

        AuthRateLimits.SessionPerMinute(configuration).Should().Be(60);
    }

    /// <summary>A null configuration is a programming error, not a silent default.</summary>
    [Fact]
    public void NullConfiguration_Throws()
    {
        var act = () => AuthRateLimits.SessionPerMinute(null!);

        act.Should().Throw<ArgumentNullException>();
    }

    /// <summary>Orchestrator review L-3: a present-but-refused value is reported by key; a missing or valid one is not.</summary>
    [Fact]
    public void FindRejectedKeys_ReportsOnlyPresentRefusedValues()
    {
        var configuration = Config(new Dictionary<string, string?>
        {
            ["Authentication:RateLimits:SessionPerMinute"] = "abc",
            ["Authentication:RateLimits:SharedLoginPerMinute"] = "0",
            ["Authentication:RateLimits:StaffLoginPerMinute"] = "20",
        });

        AuthRateLimits.FindRejectedKeys(configuration).Should().BeEquivalentTo(
            "Authentication:RateLimits:SessionPerMinute",
            "Authentication:RateLimits:SharedLoginPerMinute");
    }

    /// <summary>No keys set: nothing to report.</summary>
    [Fact]
    public void FindRejectedKeys_NoKeys_IsEmpty()
    {
        AuthRateLimits.FindRejectedKeys(Config([])).Should().BeEmpty();
    }

    /// <summary>The startup check logs one warning per refused key, naming the key and never the value.</summary>
    [Fact]
    public async Task StartupCheck_LogsEachRefusedKey()
    {
        var configuration = Config(new Dictionary<string, string?> { ["Authentication:RateLimits:SessionPerMinute"] = "sixty" });
        var logger = new RecordingLogger();
        var check = new AuthRateLimitsStartupCheck(configuration, logger);

        await check.StartAsync(CancellationToken.None);

        logger.Messages.Should().ContainSingle()
            .Which.Should().Contain("Authentication:RateLimits:SessionPerMinute").And.NotContain("sixty");
    }

    /// <summary>Registering from all four auth slices adds the hosted check once.</summary>
    [Fact]
    public void StartupCheck_Register_IsIdempotent()
    {
        var services = new ServiceCollection();

        AuthRateLimitsStartupCheck.Register(services);
        AuthRateLimitsStartupCheck.Register(services);

        services.Count(d => d.ImplementationType == typeof(AuthRateLimitsStartupCheck)).Should().Be(1);
    }

    private sealed class RecordingLogger : ILogger<AuthRateLimitsStartupCheck>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Messages.Add(formatter(state, exception));
    }
}
