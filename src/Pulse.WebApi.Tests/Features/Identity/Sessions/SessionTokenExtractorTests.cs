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

    // -----------------------------------------------------------------------------------------------------
    // identity-auth-roles/11 — the SignalR query-string exception, and its confinement to the hub path.
    // -----------------------------------------------------------------------------------------------------

    private static HttpRequest RequestWith(string path, string? authorization = null, string? accessToken = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        if (authorization is not null)
        {
            context.Request.Headers.Authorization = authorization;
        }

        if (accessToken is not null)
        {
            context.Request.QueryString = QueryString.Create("access_token", accessToken);
        }

        return context.Request;
    }

    [Theory]
    [InlineData("/hubs/exercise")]
    [InlineData("/hubs/exercise/negotiate")]
    [InlineData("/HUBS/exercise")]
    public void TryGetSessionToken_AcceptsTheAccessTokenQueryParameter_OnAHubPath(string path)
    {
        // A browser cannot set an Authorization header on a WebSocket upgrade, so the SignalR client sends
        // ?access_token=. Without this the gate would refuse every legitimate live-feed connection.
        SessionTokenExtractor.TryGetSessionToken(RequestWith(path, accessToken: "HUBTOKEN"), out var token)
            .Should().BeTrue();
        token.Should().Be("HUBTOKEN");
    }

    [Theory]
    [InlineData("/api/feed")]
    [InlineData("/api/posts")]
    [InlineData("/hubsomething")]
    public void TryGetSessionToken_RejectsTheAccessTokenQueryParameter_OffTheHubPath(string path)
    {
        // A token in a URL leaks through proxy logs, browser history and Referer. It is honored ONLY on the
        // transports that cannot avoid it — never on a REST route, and never on a path that merely shares a
        // character prefix with /hubs.
        SessionTokenExtractor.TryGetSessionToken(RequestWith(path, accessToken: "LEAKED"), out var token)
            .Should().BeFalse();
        token.Should().BeEmpty();
    }

    [Fact]
    public void TryGetSessionToken_PrefersTheHeader_WhenBothArePresent()
    {
        SessionTokenExtractor.TryGetSessionToken(
            RequestWith("/hubs/exercise", authorization: "Bearer HEADERTOKEN", accessToken: "QUERYTOKEN"),
            out var token).Should().BeTrue();
        token.Should().Be("HEADERTOKEN", "a properly delivered credential always wins over the URL fallback");
    }

    [Fact]
    public void TryGetSessionToken_EmptyQueryValueOnAHubPath_FailsClosed()
    {
        // The frontend's accessTokenFactory returns '' when nothing is stored — that must read as "no
        // credential" (401), never as an empty token that some later lookup treats as present.
        SessionTokenExtractor.TryGetSessionToken(RequestWith("/hubs/exercise", accessToken: "   "), out var token)
            .Should().BeFalse();
        token.Should().BeEmpty();
    }

    [Fact]
    public void TryGetSessionToken_FallsBackToTheHeader_OnAnyPath()
    {
        SessionTokenExtractor.TryGetSessionToken(RequestWith("/api/feed", authorization: "Bearer ABC123"), out var token)
            .Should().BeTrue("the header path is unchanged for every route");
        token.Should().Be("ABC123");
    }
}
