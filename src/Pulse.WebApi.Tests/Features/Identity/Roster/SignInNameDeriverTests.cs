namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System.Collections.Generic;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Roster;
using Xunit;

/// <summary>
/// easy-login/02 (AC-2, the frozen derivation rule) — <see cref="SignInNameDeriver"/> reproduces the frozen examples
/// and the staff roster mock's <c>deriveSignInName</c> case for case: ASCII fold, suffixes dropped, initial plus last
/// word, 32 characters, <c>1</c> for a short name, and the smallest free integer from 2 on a collision.
/// </summary>
public sealed class SignInNameDeriverTests
{
    private static readonly HashSet<string> None = [];

    [Theory]
    [InlineData("Jane Smith", "jsmith")]
    [InlineData("Mary-Ann O'Neil", "moneil")]
    [InlineData("José Álvarez", "jalvarez")]
    [InlineData("Madonna", "madonna")]
    [InlineData("Ng", "ng1")]
    [InlineData("John Smith Jr", "jsmith")]
    [InlineData("Alexander Hamilton III", "ahamilton")]
    [InlineData("Dr. Pat Lee MD", "dlee")]
    [InlineData("  JANE   smith  ", "jsmith")]
    public void Derive_TheFrozenExamples(string name, string expected)
    {
        SignInNameDeriver.Derive(name, None.Contains).Should().Be(expected);
    }

    [Fact]
    public void Derive_OnACollision_AppendsTheSmallestFreeIntegerFromTwo()
    {
        SignInNameDeriver.Derive("Jane Smith", new HashSet<string> { "jsmith" }.Contains).Should().Be("jsmith2");
        SignInNameDeriver.Derive("Jane Smith", new HashSet<string> { "jsmith", "jsmith2" }.Contains).Should().Be("jsmith3");
        SignInNameDeriver.Derive("Jane Smith", new HashSet<string> { "jsmith", "jsmith3" }.Contains).Should().Be(
            "jsmith2", "the SMALLEST free integer, not one past the highest");
    }

    [Fact]
    public void Derive_CapsAt32_EvenWithACollisionSuffix()
    {
        var name = "A " + new string('b', 60);
        var baseName = SignInNameDeriver.Derive(name, None.Contains);

        baseName.Should().HaveLength(SignInNameDeriver.MaxLength);
        var collided = SignInNameDeriver.Derive(name, new HashSet<string> { baseName }.Contains);
        collided.Should().HaveLength(SignInNameDeriver.MaxLength, "the base is shortened so the suffix still fits");
        collided.Should().EndWith("2");
    }

    [Theory]
    [InlineData("A", "a1")]
    [InlineData("Li Wu", "lwu")]
    [InlineData("O", "o1")]
    public void Derive_AShortName_GetsOneAppended(string name, string expected)
    {
        SignInNameDeriver.Derive(name, None.Contains).Should().Be(expected);
    }
}
