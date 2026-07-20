namespace Pulse.Core.Tests.Features.PersonaVoice;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.PersonaVoice.Services;

public class PersonaCastingTests
{
    private static PersonaVoiceProfile Of(PersonaType type, string handle) => new()
    {
        ExerciseId = Guid.NewGuid(),
        Handle = handle,
        DisplayName = handle,
        Type = type,
    };

    [Theory]
    [InlineData(PersonaType.Troll, true)]
    [InlineData(PersonaType.Bot, true)]
    [InlineData(PersonaType.Resident, false)]
    [InlineData(PersonaType.Outlet, false)]
    [InlineData(PersonaType.Agency, false)]
    [InlineData(PersonaType.Helper, false)]
    public void IsBadActor_OnlyTrollAndBot(PersonaType type, bool expected) =>
        PersonaCasting.IsBadActor(type).Should().Be(expected);

    [Theory]
    [InlineData(PersonaType.Outlet, "outlet")]
    [InlineData(PersonaType.Agency, "procedural")]
    [InlineData(PersonaType.Helper, "correct")]
    [InlineData(PersonaType.Troll, "never break fiction")]
    public void Guidance_IsTypeSpecific(PersonaType type, string expectedFragment) =>
        PersonaCasting.Guidance(type).Should().Contain(expectedFragment);

    [Fact]
    public void Guidance_ForAdversarialTypes_ReassertsTheFictionGuard()
    {
        // ADP-022/ADP-023: a troll antagonises in-world but never breaks fiction / abuses.
        PersonaCasting.Guidance(PersonaType.Troll).Should().ContainAll("never break fiction", "never use slurs");
    }

    [Fact]
    public void EligibleCast_ExcludesBadActors_WhenNotEnabled()
    {
        var cast = new[]
        {
            Of(PersonaType.Resident, "@a"),
            Of(PersonaType.Troll, "@troll"),
            Of(PersonaType.Outlet, "@news"),
            Of(PersonaType.Bot, "@bot"),
        };

        var eligible = PersonaCasting.EligibleCast(cast, badActorsEnabled: false);

        eligible.Select(p => p.Handle).Should().Equal("@a", "@news");
    }

    [Fact]
    public void EligibleCast_IncludesBadActors_WhenEnabled()
    {
        var cast = new[] { Of(PersonaType.Resident, "@a"), Of(PersonaType.Troll, "@troll") };

        var eligible = PersonaCasting.EligibleCast(cast, badActorsEnabled: true);

        eligible.Select(p => p.Handle).Should().Equal("@a", "@troll");
    }
}
