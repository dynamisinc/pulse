namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (URLs and days AC, EL-6) — the join URL is <c>{Authentication:FrontendBaseUrl}/join/{token}</c> with a
/// single slash at the join, <c>http</c>/<c>https</c> only, and <c>null</c> (never a guessed host) when the base is
/// unset or not an absolute http(s) URL.
/// </summary>
public sealed class JoinUrlBuilderTests
{
    private const string Token = "AbC-dEf_GhIjKlMnOpQrSt";

    private static JoinUrlBuilder BuilderFor(string? frontendBaseUrl)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = frontendBaseUrl })
            .Build();
        return new JoinUrlBuilder(configuration);
    }

    [Theory]
    [InlineData("https://pulse-uat.cobrasoftware.com", "https://pulse-uat.cobrasoftware.com/join/")]
    [InlineData("https://pulse-uat.cobrasoftware.com/", "https://pulse-uat.cobrasoftware.com/join/")]
    [InlineData("https://pulse-uat.cobrasoftware.com///", "https://pulse-uat.cobrasoftware.com/join/")]
    [InlineData("  https://pulse-uat.cobrasoftware.com/  ", "https://pulse-uat.cobrasoftware.com/join/")]
    [InlineData("http://localhost:5198", "http://localhost:5198/join/")]
    [InlineData("https://spa.example/app", "https://spa.example/app/join/")]
    [InlineData("https://spa.example/app/", "https://spa.example/app/join/")]
    public void Build_JoinsTheBaseAndTokenWithASingleSlash(string configuredBase, string expectedPrefix)
    {
        var builder = BuilderFor(configuredBase);

        builder.Build(Token).Should().Be(expectedPrefix + Token);
        builder.IsAvailable.Should().BeTrue();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("/relative/path")]
    [InlineData("pulse-uat.cobrasoftware.com")]
    [InlineData("ftp://files.example")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://spa.example/?next=evil")]
    [InlineData("https://spa.example/#frag")]
    [InlineData("https://user:secret@spa.example")]
    public void Build_ReturnsNull_WhenTheBaseIsUnsetOrNotAnAbsoluteHttpUrl(string? configuredBase)
    {
        var builder = BuilderFor(configuredBase);

        builder.Build(Token).Should().BeNull(
            "join links are unavailable rather than guessed when the base '{0}' is unusable", configuredBase);
        builder.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public void Build_ReadsTheVerbatimBicepKey()
    {
        JoinUrlBuilder.FrontendBaseUrlKey.Should().Be(
            "Authentication:FrontendBaseUrl", "the key infrastructure/modules/webapp.bicep provisions (Authentication__FrontendBaseUrl)");
        JoinUrlBuilder.JoinPathSegment.Should().Be("join", "the SPA route is /join/:token (story 08)");
    }

    [Fact]
    public void Build_EscapesANonBase64UrlToken_AsOnePathSegment()
    {
        BuilderFor("https://spa.example").Build("a/b?c").Should().Be(
            "https://spa.example/join/a%2Fb%3Fc", "whatever the token, it can only ever be one path segment");
    }

    [Fact]
    public void Build_RefusesAnEmptyToken()
    {
        var act = () => BuilderFor("https://spa.example").Build(string.Empty);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Build_FollowsTheConfigurationAtCallTime()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var builder = new JoinUrlBuilder(configuration);

        builder.IsAvailable.Should().BeFalse();

        configuration[JoinUrlBuilder.FrontendBaseUrlKey] = "https://spa.example";

        builder.Build(Token).Should().Be("https://spa.example/join/" + Token);
    }
}
