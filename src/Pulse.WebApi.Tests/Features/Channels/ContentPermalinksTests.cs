namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// Channels-foundation story 02 (#698), AC "Permalinks are path-only": <see cref="IContentPermalinks.For"/> returns
/// <c>/{channelId}/{outletSlug}/{contentSlug}</c> and never a host (FC-9.3). The TS twin is <c>permalink.test.ts</c>.
/// </summary>
public class ContentPermalinksTests
{
    private readonly IContentPermalinks _permalinks = ContentPermalinks.Instance;

    [Fact]
    public void For_ReturnsTheChannelOutletContentPath()
    {
        _permalinks.For("news", "newsline-7", "emergency-call-delays").Should().Be("/news/newsline-7/emergency-call-delays");
    }

    [Theory]
    [InlineData("news")]
    [InlineData("press")]
    [InlineData("weather")]
    public void For_NeverReturnsAHost(string channelId)
    {
        var value = _permalinks.For(channelId, "outlet-1", "item-2");

        value.Should().NotContain("://");
        value.Should().NotStartWith("//");
        value.Should().StartWith($"/{channelId}/");
    }

    [Theory]
    [InlineData("news", "https:", "x")]
    [InlineData("news", "", "x")]
    [InlineData("news", "evil.test", "x")]
    [InlineData("news", "Newsline", "x")]
    [InlineData("news", "ok", "../etc")]
    [InlineData("news", "ok", "a/b")]
    [InlineData("news", "ok", "a?b=1")]
    [InlineData("news", "ok", "a\n")]
    [InlineData("news", "ok\n", "a")]
    [InlineData("social", "ok", "ok")]
    [InlineData("portal", "ok", "ok")]
    [InlineData("//x.test", "ok", "ok")]
    [InlineData("https://x.test", "ok", "ok")]
    public void For_RejectsAnythingThatIsNotAContentChannelAndTwoSlugs(string channelId, string outletSlug, string contentSlug)
    {
        var act = () => _permalinks.For(channelId, outletSlug, contentSlug);

        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("/news/newsline-7/a", true)]
    [InlineData("/", true)]
    [InlineData("https://x.test/news", false)]
    [InlineData("//x.test/news", false)]
    [InlineData("news/a", false)]
    [InlineData("/x?u=https://evil.test", false)]
    [InlineData("/\t/evil.test/x", false)]
    [InlineData("/\n/evil.test", false)]
    [InlineData("/a\u0000b", false)]
    [InlineData("/a\u0085b", false)]
    [InlineData("/\\evil.test", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsHostRelativePath_AcceptsOnlyAPlainPath(string? value, bool expected)
    {
        ChannelVocabulary.IsHostRelativePath(value).Should().Be(expected);
    }

    [Fact]
    public void For_RejectsASlugOverEightyCharacters()
    {
        var act = () => _permalinks.For("news", "ok", new string('a', 81));

        act.Should().Throw<ArgumentException>();
        _permalinks.For("news", "ok", new string('a', 80)).Should().EndWith(new string('a', 80));
    }
}
