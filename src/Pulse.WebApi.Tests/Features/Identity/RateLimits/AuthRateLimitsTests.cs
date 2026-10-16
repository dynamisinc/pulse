namespace Pulse.WebApi.Tests.Features.Identity.RateLimits;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
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
}
