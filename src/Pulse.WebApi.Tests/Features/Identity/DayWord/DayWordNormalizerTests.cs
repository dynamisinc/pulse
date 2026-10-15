namespace Pulse.WebApi.Tests.Features.Identity.DayWord;

using System.IO;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.DayWord;

/// <summary>
/// easy-login/05 (AC1, AC3; EL-9 amended): the server's day-word normalisation is NFKD, combining marks dropped,
/// lower-cased, <c>a-z0-9</c> only, 6 to 64 characters after normalising, and it matches the client's
/// <c>dayWordNormalize.ts</c> step for step. The vectors below are the client suite's own
/// (<c>dayWordNormalize.test.ts</c>), so the two sides are pinned to the same answers.
/// </summary>
public sealed class DayWordNormalizerTests
{
    /// <summary>
    /// The SHARED test vectors: every pair here is asserted verbatim by
    /// <c>src/frontend/src/features/participantAdmin/dayWord/dayWordNormalize.test.ts</c> against
    /// <c>normalizeDayWord</c>. A change on either side must change both.
    /// </summary>
    public static TheoryData<string, string> SharedVectors => new()
    {
        { "PineCone", "pinecone" },
        { "Pine Cone 42!", "pinecone42" },
        { "a-b_c.d,e f", "abcdef" },
        { "café", "cafe" },
        { "Ñandú 1", "nandu1" },
        { "Crème Brûlée", "cremebrulee" },
        { "ＡＢＣ１２３", "abc123" },
        { "日本語", "" },
        { "Straße", "strae" },
        { "Hello, World 99", "helloworld99" },
    };

    [Theory]
    [MemberData(nameof(SharedVectors))]
    public void Normalize_MatchesTheClientsVectors(string input, string expected)
    {
        DayWordNormalizer.Normalize(input).Should().Be(expected, "the server and dayWordNormalize.ts must agree on {0}", input);
    }

    [Fact]
    public void Normalize_PrecomposedAndDecomposedAccentsAreTheSameWord()
    {
        DayWordNormalizer.Normalize("café").Should().Be(DayWordNormalizer.Normalize("café")).And.Be("cafe");
    }

    [Theory]
    [InlineData("Maple Harbor 42")]
    [InlineData("maple-harbor-42")]
    [InlineData("MAPLEHARBOR42")]
    [InlineData("  maple.harbor.42  ")]
    public void Normalize_SpellingsOfOneWord_AreTheSameWord(string spelling)
    {
        DayWordNormalizer.Normalize(spelling).Should().Be("mapleharbor42", "AC3: these are the same word on both sides");
    }

    [Theory]
    [InlineData("Café-7", "cafe7")]
    [InlineData("Ⅻ²①", "xii21")]
    [InlineData("ﬁne", "fine")]
    [InlineData("\u212A", "k")]
    [InlineData("\u0130stanbul", "istanbul")]
    public void Normalize_AppliesCompatibilityDecomposition(string input, string expected)
    {
        DayWordNormalizer.Normalize(input).Should().Be(expected, "NFKD folds ligatures, numerals, the Kelvin sign and dotted capitals");
    }

    [Fact]
    public void Normalize_IsIdempotent()
    {
        var once = DayWordNormalizer.Normalize("Hello, World 99");
        DayWordNormalizer.Normalize(once).Should().Be(once);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("!!!---")]
    public void Normalize_NothingUsable_IsEmpty(string? input)
    {
        DayWordNormalizer.Normalize(input).Should().BeEmpty();
    }

    [Fact]
    public void Normalize_ALoneSurrogate_IsDroppedNotThrown()
    {
        // string.Normalize refuses ill-formed UTF-16; JavaScript passes it through and the filter drops it. Neither side
        // may throw on an anonymous request, and both must reach the same word.
        var act = () => DayWordNormalizer.Normalize("ab\ud800cd\udc00ef");

        act.Should().NotThrow();
        DayWordNormalizer.Normalize("ab\ud800cd\udc00ef").Should().Be("abcdef");
        DayWordNormalizer.Normalize("ab😀cd").Should().Be("abcd", "a well-formed pair (an emoji) is simply not a letter or digit");
    }

    [Theory]
    [InlineData("abcdef", true)]
    [InlineData("abcde", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsAcceptableLength_CountsTheNormalisedForm(string? normalized, bool expected)
    {
        DayWordNormalizer.IsAcceptableLength(normalized).Should().Be(expected);
    }

    [Fact]
    public void IsAcceptableLength_BoundsAre6And64()
    {
        DayWordNormalizer.MinLength.Should().Be(6);
        DayWordNormalizer.MaxLength.Should().Be(64);
        DayWordNormalizer.IsAcceptableLength(new string('a', 64)).Should().BeTrue();
        DayWordNormalizer.IsAcceptableLength(new string('a', 65)).Should().BeFalse();
        DayWordNormalizer.MaxRawLength.Should().Be(256, "the raw bound is four times the normalised maximum");
    }

    [Fact]
    public void Normalize_CountsTheFoldedForm_SoÑandúOneIsSixCharacters()
    {
        DayWordNormalizer.IsAcceptableLength(DayWordNormalizer.Normalize("Ñandú 1")).Should().BeTrue();
        DayWordNormalizer.IsAcceptableLength(DayWordNormalizer.Normalize("café")).Should().BeFalse();
    }

    [Fact]
    public void TheClientNormaliser_IsStillTheChainThisServerMirrors()
    {
        // Pins the seam from this side: if dayWordNormalize.ts changes its chain, this fails and both sides are
        // revisited together. Skips quietly only when the frontend tree is not checked out next to the API.
        var path = FindClientNormaliser();
        if (path is null)
        {
            return;
        }

        var source = File.ReadAllText(path);
        source.Should().Contain(".normalize('NFKD')");
        source.Should().Contain(".replace(/\\p{M}/gu, '')");
        source.Should().Contain(".toLowerCase()");
        source.Should().Contain(".replace(/[^a-z0-9]/g, '')");
    }

    private static string? FindClientNormaliser()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            var candidate = Path.Combine(
                directory.FullName, "src", "frontend", "src", "features", "participantAdmin", "dayWord", "dayWordNormalize.ts");
            if (File.Exists(candidate))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        return null;
    }
}
