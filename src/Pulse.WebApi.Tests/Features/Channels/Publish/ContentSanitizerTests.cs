namespace Pulse.WebApi.Tests.Features.Channels.Publish;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Pulse.WebApi.Features.Channels.Content.Publish;
using Pulse.WebApi.Features.Channels.Contracts;
using Xunit;

/// <summary>
/// NFR-004: the named body profiles (<see cref="SanitizerProfileRegistry"/>) and the allowlist rebuilder behind them
/// (<see cref="ContentSanitizer"/>). Script, event handlers, <c>javascript:</c> URLs and style-borne payloads never
/// survive any built-in profile, and the registry refuses a profile that could let them through.
/// </summary>
public sealed class ContentSanitizerTests
{
    private static readonly SanitizerProfileRegistry Registry = new();

    public static TheoryData<string> Payloads => new()
    {
        "<script>alert(1)</script>",
        "<SCRIPT src=//evil.example/x.js></SCRIPT>",
        "<img src=x onerror=alert(1)>",
        "<p onclick=\"alert(1)\">hi</p>",
        "<a href=\"javascript:alert(1)\">x</a>",
        "<a href=\"JaVaScRiPt:alert(1)\">x</a>",
        "<a href=\"jav&#97;script:alert(1)\">x</a>",
        "<a href=\"java\tscript:alert(1)\">x</a>",
        "<a href=\"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==\">x</a>",
        "<a href=\"vbscript:msgbox(1)\">x</a>",
        "<p style=\"background:url(javascript:alert(1))\">x</p>",
        "<style>body{background:url(javascript:alert(1))}</style>",
        "<iframe src=\"https://evil.example\"></iframe>",
        "<svg><script>alert(1)</script></svg>",
        "<<script>script>alert(1)<</script>/script>",
        "<p>ok</p><img src=x onerror=alert(1)",
        "<!--<script>alert(1)</script>--><p>x</p>",
        "<object data=\"x.swf\"></object><embed src=x>",
        "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
        "<a href=\"/news/x\" onmouseover=alert(1)>x</a>",
    };

    [Theory]
    [MemberData(nameof(Payloads))]
    public void NoBuiltInProfile_LetsAnExecutablePayloadThrough(string payload)
    {
        foreach (var profile in new[] { ISanitizerProfileRegistry.Plain, ISanitizerProfileRegistry.RichBasic, ISanitizerProfileRegistry.RichTables })
        {
            var output = Registry.Sanitize(profile, payload);

            // Text may still SAY "onerror=" (inert); what matters is that no emitted TAG is executable.
            foreach (Match tag in Regex.Matches(output, "<[^>]*>"))
            {
                tag.Value.Should().MatchRegex(@"\A</?(p|br|strong|em|ul|ol|li|blockquote|h2|h3|h4|a|table|caption|thead|tbody|tfoot|tr|th|td)[\s>]",
                    "only allowlisted elements are emitted (profile {0})", profile);
                tag.Value.Should().NotMatchRegex(@"(?i)\son\w*\s*=", "no event handler (profile {0})", profile);
                tag.Value.Should().NotContainEquivalentOf("style=", "profile {0}", profile);
                tag.Value.Should().NotMatchRegex(@"(?i)(javascript|vbscript|data):", "no script-capable URL (profile {0})", profile);
            }

            output.Should().NotContainEquivalentOf("<script", "profile {0}", profile);
            Registry.Sanitize(profile, output).Should().Be(output, "sanitizing is a fixed point (profile {0})", profile);
        }
    }

    [Fact]
    public void RichBasic_KeepsItsAllowlist_AndForcesRelOnLinks()
    {
        var output = Registry.Sanitize(
            ISanitizerProfileRegistry.RichBasic,
            "<h2 id=x>Head</h2><p class=\"lead\">A <strong>b</strong> <em>c</em><br>"
            + "<a href=\"https://example.org/a?b=1&amp;c=2\" rel=\"opener\" target=\"_blank\">d</a></p>"
            + "<ul><li>e</li></ul><ol><li>f</li></ol><blockquote>g</blockquote><h4>h</h4><h1>i</h1><table><tr><td>j</td></tr></table>");

        output.Should().Be(
            "<h2>Head</h2><p>A <strong>b</strong> <em>c</em><br>"
            + "<a href=\"https://example.org/a?b=1&amp;c=2\" rel=\"noopener noreferrer nofollow\">d</a></p>"
            + "<ul><li>e</li></ul><ol><li>f</li></ol><blockquote>g</blockquote><h4>h</h4>ij");
    }

    [Fact]
    public void RichTables_AddsTheTableElements()
    {
        var output = Registry.Sanitize(
            ISanitizerProfileRegistry.RichTables,
            "<table border=1><caption>Shelters</caption><thead><tr><th scope=\"col\" style=\"color:red\">Name</th></tr></thead>"
            + "<tbody><tr><td colspan=\"2\" onclick=\"x()\">Gym</td></tr></tbody></table>");

        output.Should().Be(
            "<table><caption>Shelters</caption><thead><tr><th scope=\"col\">Name</th></tr></thead>"
            + "<tbody><tr><td colspan=\"2\">Gym</td></tr></tbody></table>");
    }

    [Fact]
    public void Plain_StripsEveryTag_AndKeepsTheTextHtmlSafe()
    {
        Registry.Sanitize(ISanitizerProfileRegistry.Plain, "<p>Tom &amp; Jerry say 5 < 10 & \"hi\"</p><script>x</script>")
            .Should().Be("Tom &amp; Jerry say 5 &lt; 10 &amp; \"hi\"");
    }

    [Theory]
    [InlineData("/news/newsline-7/story", true)]
    [InlineData("#section-2", true)]
    [InlineData("https://example.org", true)]
    [InlineData("mailto:desk@example.org", true)]
    [InlineData("//evil.example/x", false)]
    [InlineData("relative/path", false)]
    [InlineData("ftp://example.org", false)]
    [InlineData("/a\\b", false)]
    public void Links_SurviveOnlyAsFragmentsHostRelativePathsOrAllowedSchemes(string href, bool kept)
    {
        var output = Registry.Sanitize(ISanitizerProfileRegistry.RichBasic, $"<a href=\"{href}\">x</a>");

        output.Contains("href=", StringComparison.Ordinal).Should().Be(kept);
    }

    [Fact]
    public void UnclosedElements_AreClosed_AndStrayCloseTagsDropped()
    {
        Registry.Sanitize(ISanitizerProfileRegistry.RichBasic, "</p><p>a <strong>b <a href=\"/x\">c")
            .Should().Be("<p>a <strong>b <a href=\"/x\" rel=\"noopener noreferrer nofollow\">c</a></strong></p>");
    }

    [Fact]
    public void PathologicalInput_IsSanitizedInLinearTime()
    {
        // Each is at most MaxRawBodyLength (400k) and shaped after a review finding: unclosed openers, unterminated
        // quotes, unclosed raw-text blocks, rebuilt tags, deep nesting followed by stray closes, and "</a" with no '>'.
        var inputs = new[]
        {
            string.Concat(Enumerable.Repeat("<a b ", 40_000)),
            string.Concat(Enumerable.Repeat("<p x='", 40_000)) + ">",
            string.Concat(Enumerable.Repeat("<script>", 40_000)),
            string.Concat(Enumerable.Repeat("<<b>", 40_000)),
            string.Concat(Enumerable.Repeat("<em>", 50_000)) + string.Concat(Enumerable.Repeat("</p>", 50_000)),
            string.Concat(Enumerable.Repeat("</a", 133_000)),
            string.Concat(Enumerable.Repeat("<!", 100_000)),
        };

        foreach (var input in inputs)
        {
            var stopwatch = Stopwatch.StartNew();
            Registry.Sanitize(ISanitizerProfileRegistry.RichTables, input);
            stopwatch.Elapsed.Should().BeLessThan(
                TimeSpan.FromMilliseconds(500), "a linear pass over {0} characters starting {1}", input.Length, input[..8]);
        }
    }

    [Fact]
    public void Nesting_IsCappedAtMaxDepth_AndTheTextIsKept()
    {
        var input = string.Concat(Enumerable.Repeat("<em>", 200)) + "deep";

        var output = Registry.Sanitize(ISanitizerProfileRegistry.RichBasic, input);

        Regex.Matches(output, "<em>").Count.Should().Be(ContentSanitizer.MaxNestingDepth);
        output.Should().Contain("deep");
        Regex.Matches(output, "</em>").Count.Should().Be(ContentSanitizer.MaxNestingDepth, "everything opened is closed");
    }

    [Fact]
    public void UrlSchemes_MatchCaseInsensitively_WhateverTheProfilesComparer()
    {
        var registry = new SanitizerProfileRegistry();
        registry.Register("links", new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "a" },
            AllowedAttributes = new Dictionary<string, IReadOnlySet<string>> { ["a"] = new HashSet<string> { "href" } },
            AllowedUrlSchemes = new HashSet<string>(StringComparer.Ordinal) { "https" },
        });

        registry.Sanitize("links", "<a href=\"HTTPS://example.org\">x</a>").Should().Contain("href=\"HTTPS://example.org\"");
    }

    [Fact]
    public void UnknownProfile_Throws()
    {
        var act = () => Registry.Sanitize("article-rich", "<p>x</p>");

        act.Should().Throw<InvalidOperationException>().WithMessage("*article-rich*");
    }

    [Fact]
    public void AnAdditionalProfile_RegisteredAtDiTime_IsAvailable()
    {
        var services = new ServiceCollection();
        services.AddContentPublishFunnel().AddSanitizerProfile("article-rich", new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "p", "figure", "figcaption" },
        });

        using var provider = services.BuildServiceProvider();
        var registry = provider.GetRequiredService<ISanitizerProfileRegistry>();

        registry.Contains("article-rich").Should().BeTrue();
        registry.Sanitize("article-rich", "<figure><p>x</p><figcaption>y</figcaption></figure><strong>z</strong>")
            .Should().Be("<figure><p>x</p><figcaption>y</figcaption></figure>z");
    }

    public static TheoryData<SanitizerProfile> ScriptCapableProfiles => new()
    {
        new SanitizerProfile { AllowedElements = new HashSet<string> { "script" } },
        new SanitizerProfile { AllowedElements = new HashSet<string> { "iframe" } },
        new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "p" },
            AllowedAttributes = new Dictionary<string, IReadOnlySet<string>> { ["p"] = new HashSet<string> { "onclick" } },
        },
        new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "p" },
            AllowedAttributes = new Dictionary<string, IReadOnlySet<string>> { ["p"] = new HashSet<string> { "style" } },
        },
        new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "a" },
            AllowedUrlSchemes = new HashSet<string> { "https", "javascript" },
        },
        new SanitizerProfile
        {
            AllowedElements = new HashSet<string> { "img" },
            AllowedUrlSchemes = new HashSet<string> { "data" },
        },
    };

    [Theory]
    [MemberData(nameof(ScriptCapableProfiles))]
    public void TheRegistry_RefusesAScriptCapableProfile(SanitizerProfile profile)
    {
        var act = () => new SanitizerProfileRegistry().Register("unsafe", profile);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void ReRegisteringAName_IsAnError()
    {
        var act = () => new SanitizerProfileRegistry().Register(ISanitizerProfileRegistry.RichBasic, BuiltInProfiles.Plain);

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ADescriptorNamingAnUnregisteredProfile_FailsTheStartupCheck()
    {
        var descriptor = new TestKindDescriptor("article", "news", "article-rich");

        var act = () => ContentKindStartupCheck.Validate([descriptor], new SanitizerProfileRegistry());

        act.Should().Throw<InvalidOperationException>().WithMessage("*article-rich*not registered*");
    }

    [Fact]
    public void ATwiceRegisteredKind_OrANonContentChannel_FailsTheStartupCheck()
    {
        var twice = () => ContentKindStartupCheck.Validate(
            [new TestKindDescriptor("article", "news", "plain"), new TestKindDescriptor("article", "news", "plain")],
            new SanitizerProfileRegistry());
        var social = () => ContentKindStartupCheck.Validate(
            [new TestKindDescriptor("status", "social", "plain")], new SanitizerProfileRegistry());

        twice.Should().Throw<InvalidOperationException>();
        social.Should().Throw<InvalidOperationException>();
    }
}
