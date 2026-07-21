namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Story 03 — locks the <c>Authorization: Bearer &lt;token&gt;</c> extraction the auth scheme depends on:
/// case-insensitive scheme, trimmed value, fail-closed on anything absent or malformed. Plain <c>[Fact]</c>.
/// </summary>
public class SessionTokenExtractorTests
{
    private static HttpRequest RequestWithAuthorization(string? headerValue)
    {
        var context = new DefaultHttpContext();
        if (headerValue is not null)
        {
            context.Request.Headers.Authorization = headerValue;
        }

        return context.Request;
    }

    [Fact]
    public void TryGetBearerToken_ParsesAValidBearerHeader()
    {
        SessionTokenExtractor.TryGetBearerToken(RequestWithAuthorization("Bearer ABC123"), out var token)
            .Should().BeTrue();
        token.Should().Be("ABC123");
    }

    [Fact]
    public void TryGetBearerToken_IsSchemeCaseInsensitive()
    {
        SessionTokenExtractor.TryGetBearerToken(RequestWithAuthorization("bearer ABC123"), out var token)
            .Should().BeTrue("the bearer scheme name is case-insensitive per RFC 6750");
        token.Should().Be("ABC123");
    }

    [Fact]
    public void TryGetBearerToken_NoHeader_FailsClosed()
    {
        SessionTokenExtractor.TryGetBearerToken(RequestWithAuthorization(null), out var token)
            .Should().BeFalse("a request with no Authorization header presents no token");
        token.Should().BeEmpty();
    }

    [Fact]
    public void TryGetBearerToken_NonBearerScheme_FailsClosed()
    {
        SessionTokenExtractor.TryGetBearerToken(RequestWithAuthorization("Basic dXNlcjpwYXNz"), out var token)
            .Should().BeFalse("only the Bearer scheme carries an opaque session token");
        token.Should().BeEmpty();
    }

    [Fact]
    public void TryGetBearerToken_EmptyBearerValue_FailsClosed()
    {
        SessionTokenExtractor.TryGetBearerToken(RequestWithAuthorization("Bearer    "), out var token)
            .Should().BeFalse("an empty bearer value is not a token");
        token.Should().BeEmpty();
    }
}
