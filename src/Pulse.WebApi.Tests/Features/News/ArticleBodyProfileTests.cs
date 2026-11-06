namespace Pulse.WebApi.Tests.Features.News;

using FluentAssertions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.News;
using Xunit;

/// <summary>
/// News story 01 (#718, NFR-004): the <c>article-rich</c> body profile through the REAL foundation registry, so the profile
/// is proved to be accepted by it (never script-capable) and to keep exactly the D3-P1 body anatomy.
/// </summary>
public sealed class ArticleBodyProfileTests
{
    private const string MediaId = "6f1c9a52-4b0e-4c43-9d0e-6f3d2b8f1a77";

    private readonly SanitizerProfileRegistry _registry =
        new([new SanitizerProfileRegistration(ArticleBodyProfile.Name, ArticleBodyProfile.Profile)]);

    [Fact]
    public void TheFoundationRegistry_AcceptsTheProfile()
    {
        _registry.Contains("article-rich").Should().BeTrue();
    }

    [Theory]
    [InlineData("<p>One <strong>two</strong> <em>three</em><br>four</p>")]
    [InlineData("<h2>Section</h2><h3>Sub</h3>")]
    [InlineData("<ul><li>a</li></ul><ol><li>b</li></ol>")]
    [InlineData("<blockquote>Plain quote</blockquote>")]
    [InlineData("<blockquote class=\"pull-quote\">We are ready.</blockquote>")]
    [InlineData("<figure data-media-id=\"" + MediaId + "\"><figcaption>The bridge at dawn.</figcaption></figure>")]
    [InlineData("<pulse-post data-id=\"" + MediaId + "\"></pulse-post>")]
    public void TheArticleAnatomy_SurvivesUnchanged(string html)
    {
        _registry.Sanitize(ArticleBodyProfile.Name, html).Should().Be(html);
    }

    [Fact]
    public void Links_SurviveWithTheForcedRel()
    {
        _registry.Sanitize(ArticleBodyProfile.Name, "<a href=\"https://metro-desk-9.example/a\" target=\"_blank\">x</a>")
            .Should().Be("<a href=\"https://metro-desk-9.example/a\" rel=\"noopener noreferrer nofollow\">x</a>");
        _registry.Sanitize(ArticleBodyProfile.Name, "<a href=\"/news/metro-desk-9/a/x\">x</a>")
            .Should().Contain("href=\"/news/metro-desk-9/a/x\"");
    }

    [Theory]
    [InlineData("<p>a</p><script>alert(1)</script>", "<p>a</p>")]
    [InlineData("<p onclick=\"alert(1)\">a</p>", "<p>a</p>")]
    [InlineData("<img src=x onerror=alert(1)>", "")]
    [InlineData("<a href=\"javascript:alert(1)\">x</a>", "<a rel=\"noopener noreferrer nofollow\">x</a>")]
    [InlineData("<a href=\"&#106;avascript:alert(1)\">x</a>", "<a rel=\"noopener noreferrer nofollow\">x</a>")]
    [InlineData("<a href=\"data:text/html,<script>alert(1)</script>\">x</a>", "<a rel=\"noopener noreferrer nofollow\">x</a>")]
    [InlineData("<iframe src=\"https://evil.example\"></iframe><p>a</p>", "<p>a</p>")]
    [InlineData("<p style=\"position:fixed;top:0\">a</p>", "<p>a</p>")]
    [InlineData("<style>body{display:none}</style><p>a</p>", "<p>a</p>")]
    [InlineData("<h1>Too big</h1>", "Too big")]
    [InlineData("<h4>Too small</h4>", "Too small")]
    [InlineData("<table><tr><td>x</td></tr></table>", "x")]
    [InlineData("<div class=\"x\"><span>a</span></div>", "a")]
    public void ScriptsHandlersBadUrlsIframesAndInlineStyles_AreStripped(string html, string expected)
    {
        _registry.Sanitize(ArticleBodyProfile.Name, html).Should().Be(expected);
    }

    [Theory]
    [InlineData("<blockquote class=\"pull-quote evil\">q</blockquote>")]
    [InlineData("<blockquote class=\"MuiAlert-root\">q</blockquote>")]
    [InlineData("<blockquote class=\"Pull-Quote\">q</blockquote>")]
    public void ABlockquote_KeepsOnlyThePullQuoteClass(string html)
    {
        _registry.Sanitize(ArticleBodyProfile.Name, html).Should().Be("<blockquote>q</blockquote>");
    }

    [Theory]
    [InlineData("<figure data-media-id=\"not-a-guid\"></figure>", "<figure></figure>")]
    [InlineData("<figure data-media-id=\"" + MediaId + "\" data-src=\"x\" class=\"y\"></figure>", "<figure data-media-id=\"" + MediaId + "\"></figure>")]
    [InlineData("<pulse-post data-id=\"x\" onload=\"alert(1)\"></pulse-post>", "<pulse-post></pulse-post>")]
    [InlineData("<pulse-post data-id=\"" + MediaId + "\">inner <script>x</script></pulse-post>", "<pulse-post data-id=\"" + MediaId + "\">inner </pulse-post>")]
    public void ReferenceAttributes_MustBeGuids_AndNothingElseSurvives(string html, string expected)
    {
        _registry.Sanitize(ArticleBodyProfile.Name, html).Should().Be(expected);
    }
}
