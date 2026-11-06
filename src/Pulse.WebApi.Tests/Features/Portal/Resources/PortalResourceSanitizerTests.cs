namespace Pulse.WebApi.Tests.Features.Portal.Resources;

using FluentAssertions;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Portal.Resources;
using Xunit;

/// <summary>
/// The resource body profile (exercise-portal story 04, NFR-004) through F04's registry: the rich-body elements survive,
/// every script vector goes, and a link survives only when it is host-relative (FC-9.3, Q-E3-8).
/// </summary>
public sealed class PortalResourceSanitizerTests
{
    private static readonly SanitizerProfileRegistry Registry = new(
        [new SanitizerProfileRegistration(PortalResourceSanitizer.ProfileName, PortalResourceSanitizer.Profile)]);

    private static string Sanitize(string html) => Registry.Sanitize(PortalResourceSanitizer.ProfileName, html);

    [Fact]
    public void TheProfile_IsAcceptedByF04sRegistry()
    {
        Registry.Contains(PortalResourceSanitizer.ProfileName).Should().BeTrue();
    }

    [Fact]
    public void RichBodyElements_Survive()
    {
        Sanitize("<h2>Rules</h2><p><strong>Do</strong> <em>not</em></p><ul><li>one</li></ul>")
            .Should().Be("<h2>Rules</h2><p><strong>Do</strong> <em>not</em></p><ul><li>one</li></ul>");
    }

    [Theory]
    [InlineData("<script>alert(1)</script>", "<script")]
    [InlineData("<p onclick=\"x()\">t</p>", "onclick")]
    [InlineData("<a href=\"javascript:alert(1)\">t</a>", "javascript:")]
    [InlineData("<a href=\"JaVaScRiPt&#58;alert(1)\">t</a>", "alert(1)")]
    [InlineData("<form action=\"/x\"><input name=\"q\"></form>", "<form")]
    [InlineData("<iframe src=\"/portal\"></iframe>", "<iframe")]
    [InlineData("<p style=\"color:red\">t</p>", "style")]
    public void ScriptVectors_AreStripped(string html, string forbidden)
    {
        Sanitize(html).Should().NotContainEquivalentOf(forbidden);
    }

    [Theory]
    [InlineData("https://example.com/guide")]
    [InlineData("http://example.com/")]
    [InlineData("//example.com/guide")]
    [InlineData("mailto:ops@example.com")]
    [InlineData("tel:5551234")]
    public void ExternalLinks_LoseTheirHref(string href)
    {
        var result = Sanitize($"<a href=\"{href}\">guide</a>");

        result.Should().NotContain("href", "only host-relative links may survive (FC-9.3, Q-E3-8)");
        result.Should().Contain("guide", "the link text stays");
    }

    [Theory]
    [InlineData("/portal")]
    [InlineData("/news/metro-desk-9/story-1")]
    [InlineData("#schedule")]
    public void HostRelativeLinks_Survive(string href)
    {
        Sanitize($"<a href=\"{href}\">here</a>").Should().Contain($"href=\"{href}\"");
    }
}
