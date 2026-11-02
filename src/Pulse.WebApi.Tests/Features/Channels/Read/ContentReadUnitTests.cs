namespace Pulse.WebApi.Tests.Features.Channels.Read;

using System;
using System.Buffers.Text;
using System.Text;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Content.Read;
using Xunit;

/// <summary>Channels-foundation 06: the pure pieces of the read path (no Docker): the list cursor and the link-path parser.</summary>
public sealed class ContentReadUnitTests
{
    [Theory]
    [InlineData("Recency", 638_000_000_000_000_000L, 3)]
    [InlineData("Featured", 0L, 7)]
    [InlineData("FeaturedRest", 638_000_000_000_000_000L, 1)]
    public void Cursor_RoundTrips(string stage, long ticks, int served)
    {
        var cursor = new ContentListCursor(Enum.Parse<ContentListStage>(stage), ticks, served);

        ContentListCursor.TryDecode(cursor.Encode(), out var decoded).Should().BeTrue();
        decoded.Should().Be(cursor);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not base64 !")]
    [InlineData("x:1:1")]
    [InlineData("r:1")]
    [InlineData("r:1:0")]
    [InlineData("r:-1:1")]
    [InlineData("f:5:1")]
    [InlineData("q:1:1")]
    [InlineData("rr:1:1")]
    [InlineData("r:1:1:1")]
    public void Cursor_RefusesAnythingItDidNotIssue(string text)
    {
        var value = text.Contains(':', StringComparison.Ordinal)
            ? Base64Url.EncodeToString(Encoding.UTF8.GetBytes(text))
            : text;

        ContentListCursor.TryDecode(value, out _).Should().BeFalse();
    }

    [Theory]
    [InlineData("/news/newsline-7/emergency-call-delays", "news", "newsline-7", "emergency-call-delays")]
    [InlineData("/press/county-em/boil-notice-2", "press", "county-em", "boil-notice-2")]
    [InlineData("/weather/weather-desk/storm-watch", "weather", "weather-desk", "storm-watch")]
    public void LinkPath_ParsesAnExactPermalink(string path, string channel, string outlet, string content)
    {
        InSimLinkResolver.TryParse(path, out var c, out var o, out var s).Should().BeTrue();
        (c, o, s).Should().Be((channel, outlet, content));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("news/newsline-7/story")]
    [InlineData("https://example.com/news/newsline-7/story")]
    [InlineData("//example.com/news/newsline-7/story")]
    [InlineData("/news/newsline-7/story/")]
    [InlineData("/news/newsline-7/story?utm=1")]
    [InlineData("/news/newsline-7/story#top")]
    [InlineData("/news/newsline-7/%73tory")]
    [InlineData("/news/../newsline-7/story")]
    [InlineData("/news/Newsline-7/story")]
    [InlineData("/news/newsline-7")]
    [InlineData("/news/newsline-7/story/extra")]
    [InlineData("/social/newsline-7/story")]
    [InlineData("/portal/newsline-7/story")]
    [InlineData("/api/outlets/x")]
    [InlineData("/news/newsline-7/story\n")]
    public void LinkPath_RefusesEverythingElse(string? path) =>
        InSimLinkResolver.TryParse(path, out _, out _, out _).Should().BeFalse();

    [Fact]
    public void LinkPath_RefusesAnOverlongPath() =>
        InSimLinkResolver.TryParse($"/news/{new string('a', 80)}/{new string('b', 200)}", out _, out _, out _).Should().BeFalse();
}
