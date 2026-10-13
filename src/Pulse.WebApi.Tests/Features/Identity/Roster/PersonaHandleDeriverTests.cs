namespace Pulse.WebApi.Tests.Features.Identity.Roster;

using System.Collections.Generic;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Roster;
using Xunit;

/// <summary>
/// easy-login/02 (AC-3, the frozen auto-handle rule) — <see cref="PersonaHandleDeriver"/> reproduces the staff roster
/// mock's <c>deriveAutoPersonaHandle</c>: the full name as a <c>[a-z0-9_]</c> slug of at most 30 characters, with
/// <c>_2</c>, <c>_3</c> on a collision.
/// </summary>
public sealed class PersonaHandleDeriverTests
{
    private static readonly HashSet<string> None = [];

    [Theory]
    [InlineData("Jane Smith", "jane_smith")]
    [InlineData("José Álvarez", "jose_alvarez")]
    [InlineData("Mary-Ann O'Neil", "mary_ann_o_neil")]
    [InlineData("  --Madonna--  ", "madonna")]
    [InlineData("<>", "participant")]
    public void Derive_SlugsTheFullName(string name, string expected)
    {
        PersonaHandleDeriver.Derive(name, None.Contains).Should().Be(expected);
    }

    [Fact]
    public void Derive_OnACollision_AppendsUnderscoreTwoThenThree()
    {
        PersonaHandleDeriver.Derive("Jane Smith", new HashSet<string> { "jane_smith" }.Contains).Should().Be("jane_smith_2");
        PersonaHandleDeriver.Derive("Jane Smith", new HashSet<string> { "jane_smith", "jane_smith_2" }.Contains)
            .Should().Be("jane_smith_3");
    }

    [Fact]
    public void Derive_CapsAt30_EvenWithACollisionSuffix()
    {
        var name = new string('x', 50);

        PersonaHandleDeriver.Derive(name, None.Contains).Should().HaveLength(PersonaHandleDeriver.MaxLength);
        var collided = PersonaHandleDeriver.Derive(name, new HashSet<string> { new string('x', 30) }.Contains);
        collided.Should().HaveLength(PersonaHandleDeriver.MaxLength).And.EndWith("_2");
    }

    [Fact]
    public void Derive_SteppingAroundTheRowsOwnSignInName_GivesMadonnaUnderscoreTwo()
    {
        // The workspace passes every sign-in name as taken too, the row's own included (EL-1).
        PersonaHandleDeriver.Derive("Madonna", new HashSet<string> { "madonna" }.Contains).Should().Be("madonna_2");
    }
}
