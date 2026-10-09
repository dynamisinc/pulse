namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Globalization;
using System.Linq;
using System.Text;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.Social;
using Xunit;

/// <summary>
/// Wave 3 Gate-2 M-1, model half (plain facts, no Docker): <see cref="EngineDraftText.FitToCeiling"/> turns any
/// generated text into text the post-ingest funnel accepts on length — verbatim when it already fits, otherwise
/// sanitized, cut on a whole grapheme (preferring a word break) and marked with an ellipsis.
/// </summary>
public sealed class EngineDraftTextTests
{
    private const int Ceiling = PostIngestService.TextLengthCeiling;

    [Theory]
    [InlineData("Water pressure is dropping on Elm St.")]
    [InlineData("<b>Boil</b> water")]
    [InlineData("")]
    public void TextThatFits_IsKeptVerbatim(string text) =>
        EngineDraftText.FitToCeiling(text).Should().Be(text, "ingest sanitizes a fitting draft on publish, as before");

    [Fact]
    public void TextExactlyAtTheCeiling_IsKeptVerbatim()
    {
        var text = new string('w', Ceiling);
        EngineDraftText.FitToCeiling(text).Should().Be(text, "the ceiling is inclusive");
    }

    [Fact]
    public void AFourThousandCharacterPost_IsCutAtAWordBreak_UnderTheCeiling_WithAnEllipsis()
    {
        var text = Words(440); // 3,960 characters
        text.Length.Should().BeInRange(3_900, 4_100, "precondition: about 4,000 characters");

        var fitted = EngineDraftText.FitToCeiling(text);

        fitted.Length.Should().BeLessThanOrEqualTo(Ceiling);
        fitted.Should().EndWith(EngineDraftText.Ellipsis);
        var head = fitted[..^1];
        text.Should().StartWith(head, "the cut keeps the start of the model's text");
        char.IsWhiteSpace(text[head.Length]).Should().BeTrue("the cut falls on a word break, never mid-word");
        head.Length.Should().BeGreaterThan(Ceiling - EngineDraftText.WordBreakWindow, "the word break is close to the limit");
        AcceptedByIngest(fitted).Should().BeTrue();
    }

    [Theory]
    [InlineData("\U0001F600")] // a surrogate pair
    [InlineData("\U0001F468‍\U0001F469‍\U0001F467‍\U0001F466")] // a ZWJ family: 11 units, one grapheme
    [InlineData("é̂")] // a base letter with two combining marks
    [InlineData("\U0001F1FA\U0001F1F8")] // a regional-indicator flag
    public void AGraphemeStraddlingTheLimit_IsNeverSplit(string grapheme)
    {
        // No spaces, so there is no word break to prefer: the cut must land on a grapheme boundary. The cluster is
        // placed so it starts just before the budget (ceiling − 1 for the ellipsis) and ends past it.
        var budget = Ceiling - EngineDraftText.Ellipsis.Length;
        var text = new string('a', budget - 1) + grapheme + new string('b', 500);

        var fitted = EngineDraftText.FitToCeiling(text);

        fitted.Should().Be(new string('a', budget - 1) + EngineDraftText.Ellipsis, "the whole cluster goes; none of it is kept");
        HasLoneSurrogate(fitted).Should().BeFalse();
        AcceptedByIngest(fitted).Should().BeTrue();
    }

    [Fact]
    public void AGraphemeThatFitsBeforeTheLimit_IsKeptWhole()
    {
        var budget = Ceiling - EngineDraftText.Ellipsis.Length;
        var text = new string('a', budget - 2) + "\U0001F600" + new string('b', 500);

        var fitted = EngineDraftText.FitToCeiling(text);

        fitted.Should().Be(new string('a', budget - 2) + "\U0001F600" + EngineDraftText.Ellipsis);
        fitted.Length.Should().Be(Ceiling);
    }

    [Fact]
    public void MarkupHeavyOutputOverTheRawCap_ThatSanitizesShort_IsReturnedSanitized()
    {
        var text = string.Concat(Enumerable.Repeat("<b>", (PostIngestService.MaxRawTextLength / 3) + 10)) + "Boil water now.";
        text.Length.Should().BeGreaterThan(PostIngestService.MaxRawTextLength, "precondition: ingest would refuse it raw");

        EngineDraftText.FitToCeiling(text).Should().Be("Boil water now.");
    }

    [Fact]
    public void MarkupIsMeasuredAfterSanitizing_AndNeverSurvivesACut()
    {
        var text = "<script>alert(1)</script>" + string.Concat(Enumerable.Repeat("<i>word</i> ", 600));

        var fitted = EngineDraftText.FitToCeiling(text);

        fitted.Should().NotContain("<").And.NotContain("script");
        fitted.Should().EndWith(EngineDraftText.Ellipsis);
        AcceptedByIngest(fitted).Should().BeTrue();
    }

    [Fact]
    public void OneClusterLongerThanTheWholeBudget_FallsBackToACodePointCut()
    {
        // Pathological: one base letter with 3,000 combining marks is ONE grapheme. Rather than drop everything, the
        // cut falls back to the last whole code point, which still never splits a surrogate pair.
        var text = "a" + new string('́', 3_000);

        var fitted = EngineDraftText.FitToCeiling(text);

        fitted.Length.Should().Be(Ceiling);
        fitted.Should().EndWith(EngineDraftText.Ellipsis);
        AcceptedByIngest(fitted).Should().BeTrue();
    }

    [Fact]
    public void AnyGeneratedText_FitsTheIngestBounds_AndNeverHoldsHalfASurrogatePair()
    {
        // Property: whatever a model returns, the fitted text passes ingest's raw and sanitized length checks, a
        // fitting text is untouched, and a cut never leaves a lone surrogate.
        var random = new Random(2026);
        string[] tokens = ["water", "main", " ", " ", "\n", "<b>", "</b>", "<", ">", "\U0001F600", "é", "\U0001F1FA\U0001F1F8",
            "\U0001F468‍\U0001F469", "#WaterIssues", ".", "é", "\U0001D49C"];
        for (var sample = 0; sample < 2_000; sample++)
        {
            var builder = new StringBuilder();
            var count = random.Next(0, 2_500);
            for (var i = 0; i < count; i++)
            {
                builder.Append(tokens[random.Next(tokens.Length)]);
            }

            var text = builder.ToString();
            var fitted = EngineDraftText.FitToCeiling(text);

            AcceptedByIngest(fitted).Should().BeTrue("the fitted text passes ingest's length checks ({0} → {1} units)", text.Length, fitted.Length);
            HasLoneSurrogate(fitted).Should().BeFalse("no half of a surrogate pair survives a cut");
            var sanitized = PostSanitizer.Sanitize(text);
            if (AcceptedByIngest(text))
            {
                fitted.Should().Be(text, "a text ingest would accept is never changed");
            }
            else if (sanitized.Length <= Ceiling)
            {
                fitted.Should().Be(sanitized, "over the raw cap only: the stripped text already fits");
            }
            else
            {
                fitted.Should().EndWith(EngineDraftText.Ellipsis);
                sanitized.Should().StartWith(fitted[..^1], "the cut keeps a prefix of what ingest would store");
                IsOnAGraphemeBoundary(sanitized, fitted[..^1].Length).Should().BeTrue("the cut never splits a grapheme");
            }
        }
    }

    /// <summary>ingest's two length checks: the raw cap, then the sanitized ceiling.</summary>
    private static bool AcceptedByIngest(string text) =>
        text.Length <= PostIngestService.MaxRawTextLength
        && PostSanitizer.Sanitize(text).Length <= PostIngestService.TextLengthCeiling;

    /// <summary><paramref name="count"/> distinct space-separated words of eight characters.</summary>
    private static string Words(int count) =>
        string.Join(' ', Enumerable.Range(0, count).Select(i => $"elm{i:00000}"));

    private static bool IsOnAGraphemeBoundary(string text, int index)
    {
        // The cut may have been followed by TrimEnd, so accept any boundary at or after the kept head that is
        // reached through whitespace only.
        var position = 0;
        while (position < index)
        {
            position += StringInfo.GetNextTextElementLength(text, position);
        }

        if (position == index)
        {
            return true;
        }

        // A fallback code point cut inside one oversized cluster is still a code point boundary.
        return !char.IsLowSurrogate(text[index]);
    }

    private static bool HasLoneSurrogate(string value)
    {
        for (var i = 0; i < value.Length; i++)
        {
            if (char.IsHighSurrogate(value[i]))
            {
                if (i + 1 >= value.Length || !char.IsLowSurrogate(value[i + 1]))
                {
                    return true;
                }

                i++;
            }
            else if (char.IsLowSurrogate(value[i]))
            {
                return true;
            }
        }

        return false;
    }
}
