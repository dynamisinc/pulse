namespace Pulse.WebApi.Tests.Features.Social;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Pure unit tests for <see cref="PostSanitizer"/> — the server-side half of the NFR-004 stored-XSS
/// guard exercised end-to-end by <c>PostWriteEndpointTests</c> (which posts the same payloads over HTTP
/// and reads the persisted row back). This class is the standing stored-XSS suite's server-side
/// extension referenced by story <c>02-post-write-api.md</c>'s NFR-004 AC, cross-referenced against the
/// isolation suite's stored-XSS coverage (<c>exercise-isolation/07</c>, COR-007/NFR-004) — the same
/// "a stored script can execute nowhere" property, proven here at the sanitizer unit rather than the
/// cross-exercise-read boundary. No DI/DB is needed — <see cref="PostSanitizer.Sanitize"/> is a pure
/// static function — so these run locally as plain <see cref="FactAttribute"/>s, unlike the
/// <see cref="RequiresDockerFactAttribute"/>-gated integration tests in this folder.
/// </summary>
public class PostSanitizerTests
{
    [Fact]
    public void Sanitize_ScriptTag_StripsTagAndExecutableContents()
    {
        var result = PostSanitizer.Sanitize("Before<script>alert('xss')</script>After");

        result.Should().Be("BeforeAfter");
        result.Should().NotContain("<script", "the tag and its executable body must both be removed");
        result.Should().NotContain("alert", "script CONTENTS are stripped, not just the tag wrapper");
    }

    [Fact]
    public void Sanitize_ScriptTagWithAttributes_IsStillStripped()
    {
        var result = PostSanitizer.Sanitize("<script type=\"text/javascript\">doEvil()</script>Safe text");

        result.Should().Be("Safe text");
    }

    [Fact]
    public void Sanitize_StyleTag_StripsTagAndContents()
    {
        var result = PostSanitizer.Sanitize("<style>body{display:none}</style>Visible");

        result.Should().Be("Visible");
    }

    [Fact]
    public void Sanitize_ImgOnErrorPayload_StripsWholeTag_NoExecutableMarkupRemains()
    {
        var result = PostSanitizer.Sanitize("Look <img src=x onerror=alert(document.cookie)> here");

        result.Should().Be("Look  here");
        result.Should().NotContain("<img");
        result.Should().NotContain("onerror");
    }

    [Fact]
    public void Sanitize_JavascriptHrefAnchor_StripsWholeAnchorTag_TextPreserved()
    {
        var result = PostSanitizer.Sanitize("<a href=\"javascript:alert(1)\">click me</a>");

        result.Should().Be("click me", "the anchor markup is removed but the author's link text is real content");
        result.Should().NotContain("javascript:");
        result.Should().NotContain("<a ");
    }

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<SCRIPT>alert(1)</SCRIPT>")]
    [InlineData("<img src=x onerror=alert(1)>")]
    [InlineData("<svg onload=alert(1)>")]
    [InlineData("<iframe src=\"javascript:alert(1)\"></iframe>")]
    [InlineData("<a href=\"javascript:alert(1)\">go</a>")]
    [InlineData("<body onload=alert(1)>")]
    [InlineData("<div onclick=\"alert(1)\">click</div>")]
    public void Sanitize_ClassicStoredXssPayloads_LeaveNoExecutableMarkup(string payload)
    {
        // The same property the isolation suite proves at the read boundary (exercise-isolation/07,
        // COR-007/NFR-004): a stored script must be able to execute NOWHERE. Here we assert the
        // sanitizer itself never leaves anything that parses as an HTML tag.
        var result = PostSanitizer.Sanitize(payload);

        result.Should().NotContain("<", "no character sequence that could open an HTML/script tag may survive sanitization");
        result.Should().NotContain(">");
    }

    [Fact]
    public void Sanitize_PlainText_IsPreservedExactly()
    {
        const string plain = "The evacuation route is now Route 9 northbound.";

        PostSanitizer.Sanitize(plain).Should().Be(plain);
    }

    [Theory]
    [InlineData("Don't forget the briefing at 0900.")]
    [InlineData("She said \"stay calm\" & keep moving.")]
    [InlineData("5 < 10 and 10 > 5, plain math, not markup.")]
    public void Sanitize_LiteralAmpersandsQuotesAndAngleBrackets_AreNeverEntityEncoded(string input)
    {
        // Strip-not-encode (mirrors sanitize.ts:41-45): the participant render path is a React text
        // node that already escapes & < > " ' at render, so entity-encoding here would DOUBLE-encode
        // ordinary text (don't -> don&#39;t) and break the fiction. The sanitizer must never introduce
        // an HTML entity sequence into its output.
        var result = PostSanitizer.Sanitize(input);

        result.Should().NotContain("&amp;", "the sanitizer strips, it never HTML-entity-encodes");
        result.Should().NotContain("&#39;");
        result.Should().NotContain("&quot;");
        result.Should().NotContain("&lt;");
        result.Should().NotContain("&gt;");
    }

    [Fact]
    public void Sanitize_MixedMarkupAndPlainText_RemovesOnlyMarkup_PreservesAuthorText()
    {
        var result = PostSanitizer.Sanitize(
            "Update: <b>shelter in place</b> until further notice. <script>exfil()</script>Stay tuned.");

        result.Should().Be("Update: shelter in place until further notice. Stay tuned.");
    }

    [Fact]
    public void Sanitize_NoMarkupAtAll_ReturnsInputUnchanged()
    {
        const string input = "Just an ordinary update with no markup at all.";

        PostSanitizer.Sanitize(input).Should().Be(input);
    }

    [Fact]
    public void Sanitize_EmptyString_ReturnsEmptyString()
    {
        PostSanitizer.Sanitize(string.Empty).Should().Be(string.Empty);
    }

    [Fact]
    public void Sanitize_NullInput_ThrowsArgumentNullException()
    {
        var act = () => PostSanitizer.Sanitize(null!);

        act.Should().Throw<ArgumentNullException>();
    }
}
