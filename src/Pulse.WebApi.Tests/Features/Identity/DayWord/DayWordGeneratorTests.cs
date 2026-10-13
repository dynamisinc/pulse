namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.DayWord;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/05 (AC1): a generated word is <c>adjective-noun-NN</c>, lower-case, from curated lists of unambiguous
/// words (200 adjectives and 200 nouns after Gate-1 S-1, ~21.8 bits), always a valid word once normalised, and random
/// (cryptographic draws, so two calls differ).
/// </summary>
public sealed class DayWordGeneratorTests
{
    private static readonly Regex Shape = new("^(?<adjective>[a-z]+)-(?<noun>[a-z]+)-(?<number>[1-9][0-9])$");

    [Fact]
    public void Generate_HasTheReadAloudShape_FromTheCuratedLists()
    {
        for (var i = 0; i < 200; i++)
        {
            var word = DayWordGenerator.Generate();

            var match = Shape.Match(word);
            match.Success.Should().BeTrue("'{0}' must be adjective-noun-NN, lower-case", word);
            DayWordGenerator.Adjectives.Should().Contain(match.Groups["adjective"].Value);
            DayWordGenerator.Nouns.Should().Contain(match.Groups["noun"].Value);
            int.Parse(match.Groups["number"].Value, System.Globalization.CultureInfo.InvariantCulture)
                .Should().BeInRange(DayWordGenerator.MinNumber, DayWordGenerator.MaxNumber, "two spoken digits, never a leading zero");
        }
    }

    [Fact]
    public void Generate_IsAlwaysAnAcceptableWord_AndNormalisesToItsLettersAndDigits()
    {
        for (var i = 0; i < 200; i++)
        {
            var word = DayWordGenerator.Generate();
            var normalized = DayWordNormalizer.Normalize(word);

            DayWordNormalizer.IsAcceptableLength(normalized).Should().BeTrue("a generated word must always be settable ({0})", word);
            normalized.Should().Be(word.Replace("-", string.Empty, System.StringComparison.Ordinal));
        }
    }

    [Fact]
    public void Generate_TwoCallsDiffer()
    {
        // 3.6 million combinations: 20 draws all equal would mean the source is not random.
        var words = Enumerable.Range(0, 20).Select(_ => DayWordGenerator.Generate()).ToList();

        words.Distinct().Should().HaveCountGreaterThan(1, "the generator draws with RandomNumberGenerator, so calls differ");
        DayWordGenerator.Generate().Should().NotBe(DayWordGenerator.Generate(), "two consecutive calls differ (collision odds ~1 in 3.6 million)");
    }

    [Fact]
    public void TheCuratedLists_AreLowerCaseAsciiLetters_Unique_AndReadable()
    {
        foreach (var list in new[] { DayWordGenerator.Adjectives, DayWordGenerator.Nouns })
        {
            list.Should().OnlyHaveUniqueItems();
            list.Should().OnlyContain(word => Regex.IsMatch(word, "^[a-z]{4,8}$"), "short, lower-case ASCII letters only");
            list.Count.Should().Be(200, "Gate-1 S-1: about 200 plain words per list");
            list.Should().BeInAscendingOrder(System.StringComparer.Ordinal, "kept alphabetical so a review can scan it");
        }

        DayWordGenerator.Adjectives.Intersect(DayWordGenerator.Nouns).Should().BeEmpty();
    }

    [Fact]
    public void TheWordSpace_IsAbout22Bits()
    {
        var combinations = (long)DayWordGenerator.Adjectives.Count * DayWordGenerator.Nouns.Count
            * (DayWordGenerator.MaxNumber - DayWordGenerator.MinNumber + 1);

        combinations.Should().Be(3_600_000);
        System.Math.Log2(combinations).Should().BeGreaterThan(21.7, "Gate-1 S-1: ~21.8 bits, up from ~17.8");
    }

    [Theory]
    [InlineData("fire")]
    [InlineData("flood")]
    [InlineData("storm")]
    [InlineData("smoke")]
    [InlineData("alarm")]
    [InlineData("blue")]
    [InlineData("bear")]
    [InlineData("harbor")]
    [InlineData("beacon")]
    [InlineData("rocket")]
    [InlineData("siren")]
    [InlineData("secret")]
    [InlineData("whale")]
    [InlineData("deer")]
    public void TheCuratedLists_AvoidAlarmingWords_HomophonesAndRegionalSpellings(string word)
    {
        DayWordGenerator.Adjectives.Should().NotContain(word);
        DayWordGenerator.Nouns.Should().NotContain(word);
    }

    [Fact]
    public void AGeneratedWord_IsRedactedFromTelemetry_IfTypedIntoTheNameBox()
    {
        // Story 01's redaction recognises this exact shape, so a generated word typed as a sign-in name never lands
        // in a failure event.
        EasyLoginTelemetry.RedactAttemptedName(DayWordGenerator.Generate()).Should().BeNull();
    }
}
