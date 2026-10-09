namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
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
public partial class PostSanitizerTests
{
    /// <summary>The tag shape no sanitized output may contain (the old implementation's tag regex).</summary>
    private static readonly Regex AnyTag = TagRegex();

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
    [InlineData("<<b>img src=x onerror=alert(1)>")]
    [InlineData("<<i></i>svg onload=alert(1)>")]
    [InlineData("<<<b>b>img src=x onerror=alert(1)>")]
    public void Sanitize_ClassicStoredXssPayloads_LeaveNoExecutableMarkup(string payload)
    {
        // The same property the isolation suite proves at the read boundary (exercise-isolation/07,
        // COR-007/NFR-004): a stored script must be able to execute NOWHERE. Here we assert the
        // sanitizer itself never leaves anything that parses as an HTML tag.
        var result = PostSanitizer.Sanitize(payload);

        result.Should().NotContain("<", "no character sequence that could open an HTML/script tag may survive sanitization");
        result.Should().NotContain(">");
    }

    [Theory]
    [InlineData("<<b>img src=x onerror=alert(1)>", "Body ", " end")]
    [InlineData("<<i></i>svg onload=alert(1)>", "Body ", " end")]
    public void Sanitize_TagRebuildingPayloads_AreStrippedUntilStable_NotRebuiltByOnePass(string payload, string before, string after)
    {
        // Gate-1 M-2: a single pass removes <b> (or <i></i>) and REBUILDS <img onerror> / <svg onload> from the
        // pieces around it. The sanitizer repeats until a pass removes nothing.
        var result = PostSanitizer.Sanitize(before + payload + after);

        result.Should().Be(before + after, "the rebuilt tag is stripped on the next pass, leaving the author's text");
        result.Should().NotContain("onerror").And.NotContain("onload");
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

    // ---- Wave 1b DoS fix: one linear pass, still strip-until-stable --------------------------------------------

    [Theory]
    [InlineData("nested-rebuild")]
    [InlineData("unclosed-script-openers")]
    [InlineData("openers-without-close")]
    [InlineData("nested-script-rebuild")]
    public void Sanitize_A64KiBAdversarialInput_IsLinear_WellUnderHalfASecond(string shape)
    {
        // The old repeat-until-stable regexes were quadratic on these (2.4 s for 32 KB of nested tags, measured);
        // the post route allows 64 KiB and the anonymous login path sanitizes a username too.
        var input = Adversarial(shape, 64 * 1024);
        PostSanitizer.Sanitize("<<b>warm-up>"); // JIT outside the measurement

        var stopwatch = Stopwatch.StartNew();
        var result = PostSanitizer.Sanitize(input);
        stopwatch.Stop();

        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromMilliseconds(500), "sanitizing is linear ({0})", shape);
        AnyTag.IsMatch(result).Should().BeFalse("no tag survives ({0})", shape);
        ReferenceSanitize(result).Should().Be(result, "the output is stable: stripping it again changes nothing ({0})", shape);
    }

    [Fact]
    public void Sanitize_DeeplyNestedRebuildingTags_AreAllStripped()
    {
        var depth = 5_000;
        var payload = new string('<', depth) + string.Concat(Enumerable.Repeat("b>", depth - 1)) + "img src=x onerror=alert(1)>";

        PostSanitizer.Sanitize("Before " + payload + " after").Should().Be("Before  after");
    }

    [Theory]
    [InlineData("<<b>script>alert(1)</script>")]
    [InlineData("<scr<b>ipt>alert(1)</script>")]
    [InlineData("<a<b>c>")]
    [InlineData("<<b>i <c>>")]
    [InlineData("</<b>a>x")]
    [InlineData("<script>never closed <b>bold</b>")]
    [InlineData("<STYLE type=x>body{}</style >after")]
    [InlineData("<scripts>not a block</scripts>")]
    public void Sanitize_OverlappingAndRebuiltFragments_LeaveNoTag_AndAreStable(string payload)
    {
        var result = PostSanitizer.Sanitize(payload);

        AnyTag.IsMatch(result).Should().BeFalse("no sequence that parses as a tag may survive: {0}", result);
        ReferenceSanitize(result).Should().Be(result, "stripping the output again changes nothing");
        PostSanitizer.Sanitize(result).Should().Be(result, "the sanitizer is idempotent");
    }

    [Fact]
    public void Sanitize_RealisticMarkup_MeetsTheGuarantees()
    {
        // Ordinary text mixed with well-formed tags, script/style blocks, URLs in angle brackets and literal
        // <, <<, <3, <-, >, >>. The linear pass is NOT byte-identical to the old regexes (they differ on a small
        // fraction of tag-laden inputs, in both directions; see PostSanitizer's remarks), so this asserts the real
        // guarantees instead: no complete tag, a fixed point (for this AND the old regexes), and a subsequence of
        // the input. Deterministic seed, so a failure reproduces.
        var random = new Random(20261008);
        for (var sample = 0; sample < 5_000; sample++)
        {
            var input = RealisticMarkup(random);
            var result = PostSanitizer.Sanitize(input);

            AssertGuarantees(input, result);
        }
    }

    [Fact]
    public void Sanitize_TextWithNoTag_ComesBackUnchanged()
    {
        // The other half of the contract: text with no complete tag in it (literal <, <<, <3, <-, >, >>, a dangling
        // "<b" with no '>') is returned exactly as written.
        string[] pieces = ["Shelter", "in place", "5 < 10", "10 > 5", "<<", "<3", "<-", "->", ">>", "a<b", "x > y", "&", "\"q\"", "don't", " ", "#Flood", "<", ">"];
        var random = new Random(77);
        for (var sample = 0; sample < 5_000; sample++)
        {
            var builder = new StringBuilder();
            for (var i = random.Next(1, 10); i > 0; i--)
            {
                builder.Append(pieces[random.Next(pieces.Length)]);
            }

            var input = builder.ToString();
            if (AnyTag.IsMatch(input))
            {
                continue; // a random join happened to form a tag ("a<b" + ">"); not this test's subject
            }

            PostSanitizer.Sanitize(input).Should().Be(input, "text with no tag is never altered: {0}", input);
        }
    }

    [Fact]
    public void Sanitize_RandomAdversarialFragments_NeverLeaveATag_AndAreStable()
    {
        var random = new Random(4242);
        const string alphabet = "<<<>>//abisSCRIPTstyle x=\"'";
        for (var sample = 0; sample < 20_000; sample++)
        {
            var chars = new char[random.Next(1, 40)];
            for (var i = 0; i < chars.Length; i++)
            {
                chars[i] = alphabet[random.Next(alphabet.Length)];
            }

            var input = new string(chars);

            AssertGuarantees(input, PostSanitizer.Sanitize(input));
        }
    }

    /// <summary>
    /// The sanitizer's real contract: no complete tag survives, the output is a fixed point (for this and for the
    /// old regexes), and it is a subsequence of the input (only removals). Linearity is the timing guard's job.
    /// </summary>
    private static void AssertGuarantees(string input, string result)
    {
        AnyTag.IsMatch(result).Should().BeFalse("no complete tag may survive: {0} → {1}", input, result);
        PostSanitizer.Sanitize(result).Should().Be(result, "the output is a fixed point: {0} → {1}", input, result);
        ReferenceSanitize(result).Should().Be(result, "the old regexes would change nothing either: {0} → {1}", input, result);
        IsSubsequence(result, input).Should().BeTrue("characters are only removed, never added or reordered: {0} → {1}", input, result);
    }

    private static bool IsSubsequence(string candidate, string source)
    {
        var next = 0;
        foreach (var c in source)
        {
            if (next < candidate.Length && candidate[next] == c)
            {
                next++;
            }
        }

        return next == candidate.Length;
    }

    private static string Adversarial(string shape, int size)
    {
        var builder = new StringBuilder(size + 64);
        switch (shape)
        {
            case "nested-rebuild":
                var depth = size / 3;
                builder.Append('<', depth);
                for (var i = 0; i < depth; i++)
                {
                    builder.Append("b>");
                }

                break;
            case "unclosed-script-openers":
                while (builder.Length < size)
                {
                    builder.Append("<script>");
                }

                break;
            case "openers-without-close":
                while (builder.Length < size)
                {
                    builder.Append("<a");
                }

                break;
            default:
                var levels = size / 16;
                builder.Append('<', levels);
                for (var i = 0; i < levels; i++)
                {
                    builder.Append("b>");
                }

                while (builder.Length < size)
                {
                    builder.Append("script>x</script>");
                }

                break;
        }

        return builder.ToString();
    }

    private static string RealisticMarkup(Random random)
    {
        string[] words = ["Shelter", "in", "place", "Route 9", "don't", "\"stay calm\"", "&", "5 < 10", "10 > 5", "a<b", "x > y", "#Flood", "@EMA", "<<", "<3", "<-", ">>", "<https://fairhaven.example/alerts>", "<mailto:pio@example.test>"];
        string[] tags = ["<b>", "</b>", "<i>", "</i>", "<a href=\"https://x.test\">", "</a>", "<img src=x onerror=alert(1)>", "<br/>", "<p class='x'>", "</p>", "<svg onload=alert(1)>"];
        string[] blocks = ["<script>alert('x')</script>", "<SCRIPT type=\"text/javascript\">evil()</SCRIPT>", "<style>body{display:none}</style>", "<style >p{}</style >"];

        var builder = new StringBuilder();
        var parts = random.Next(1, 12);
        for (var i = 0; i < parts; i++)
        {
            var roll = random.Next(10);
            builder.Append(roll switch
            {
                < 5 => words[random.Next(words.Length)],
                < 8 => tags[random.Next(tags.Length)],
                _ => blocks[random.Next(blocks.Length)],
            });
            if (random.Next(3) == 0)
            {
                builder.Append(' ');
            }
        }

        return builder.ToString();
    }

    /// <summary>The PREVIOUS implementation (repeat two regexes until stable), kept as the reference oracle.</summary>
    private static string ReferenceSanitize(string input)
    {
        var current = input;
        string previous;
        do
        {
            previous = current;
            current = TagRegex().Replace(ScriptStyleBlockRegex().Replace(previous, string.Empty), string.Empty);
        }
        while (!string.Equals(current, previous, StringComparison.Ordinal));

        return current;
    }

    [GeneratedRegex(@"<(script|style)\b[^>]*>[\s\S]*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ScriptStyleBlockRegex();

    [GeneratedRegex(@"</?[a-zA-Z][^>]*>")]
    private static partial Regex TagRegex();
}
