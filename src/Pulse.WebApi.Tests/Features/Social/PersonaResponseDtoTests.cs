namespace Pulse.WebApi.Tests.Features.Social;

using System;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Xunit;

/// <summary>
/// Model-only (no database, so plain <see cref="FactAttribute"/>) coverage of
/// <c>PersonaResponseDto.FromPersona</c> after <c>profiles-social-graph/06</c>: the projection must return the
/// PERSISTED presentation values, never the removed B1 stand-ins (<c>"citizen"</c>, <c>"micro"</c>, <c>0</c>,
/// the fixed <c>2026-01-01</c> instant, the blanket <c>bio</c> omission), while <c>avatarColor</c>/
/// <c>initials</c> stay derived and the frozen wire shape (<c>features/personas/types.ts:84-101</c>) is
/// unchanged.
/// </summary>
public sealed class PersonaResponseDtoTests
{
    private static readonly DateTimeOffset AuthoredJoinedAt = new(2024, 3, 9, 8, 30, 0, TimeSpan.Zero);

    private static Persona AuthoredPersona() => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        DisplayName = "The Scoop",
        Handle = "TheScoopHQ",
        Kind = "org",
        Verified = false,
        PersonaTemplateId = null,
        Bio = "The stories they don't want you to see.",
        PersonaType = "influencer",
        AudienceBand = "mid",
        AudienceMagnitude = 50186,
        JoinedAt = AuthoredJoinedAt,
    };

    [Fact]
    public void FromPersona_ProjectsThePersistedPresentationValues_NotTheB1StandIns()
    {
        var persona = AuthoredPersona();

        var dto = PersonaResponseDto.FromPersona(persona);

        dto.PersonaType.Should().Be("influencer", "the archetype comes from the entity, not the 'citizen' stand-in");
        dto.AudienceBand.Should().Be("mid", "the band comes from the entity, not the 'micro' stand-in");
        dto.FollowerCount.Should().Be(
            50186, "followerCount is the persisted SOC-054 magnitude, not the stand-in 0");
        dto.Bio.Should().Be(
            "The stories they don't want you to see.", "bio is projected now, no longer omitted unconditionally");
        dto.JoinedAt.Should().Be(
            AuthoredJoinedAt.ToString("O"),
            "joinedAt is the persisted SCENARIO instant round-tripped, never the fixed 2026-01-01 stand-in and "
            + "never re-derived from the server clock (COR-053)");
    }

    [Fact]
    public void FromPersona_KeepsAvatarColorAndInitials_DerivedAndStable()
    {
        var persona = AuthoredPersona();

        var first = PersonaResponseDto.FromPersona(persona);
        var second = PersonaResponseDto.FromPersona(persona);

        first.Initials.Should().Be("TS", "initials stay DERIVED from displayName — no column stores them");
        first.AvatarColor.Should().MatchRegex("^#[0-9A-Fa-f]{6}$");
        second.AvatarColor.Should().Be(
            first.AvatarColor, "the avatar color stays DERIVED from the handle and is stable across reads");
    }

    [Fact]
    public void FromPersona_NullBio_OmitsTheKeyEntirely_RatherThanEmittingNull()
    {
        var persona = AuthoredPersona();
        persona.Bio = null;

        var json = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(persona));

        using var document = JsonDocument.Parse(json);
        document.RootElement.TryGetProperty("bio", out _).Should().BeFalse(
            "bio is OPTIONAL in the frozen client contract — an absent bio is omitted, never emitted as null");
    }

    [Fact]
    public void FromPersona_CarriesNoProvenanceOrOperatorField_XC002()
    {
        var json = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(AuthoredPersona()));

        using var document = JsonDocument.Parse(json);
        foreach (var forbidden in new[]
                 { "origin", "actingHumanId", "createdWallClock", "injectId", "operatorId", "sessionId" })
        {
            document.RootElement.TryGetProperty(forbidden, out _).Should().BeFalse(
                $"'{forbidden}' must be wire-ABSENT on a participant-facing persona payload (XC-002)");
        }
    }

    [Fact]
    public void FromPersona_NeverFlagsAnUnverifiedLookalike_TheAbsentSealIsTheOnlySignal()
    {
        // SOC-052 / D1-008: a bad-actor archetype projects exactly like any other persona — the only
        // difference a participant can see is verified: false.
        var lookalike = AuthoredPersona();
        lookalike.DisplayName = "Fairhaven Water Update";
        lookalike.Handle = "FairhavenWaterUpd";
        lookalike.PersonaType = "bad-actor";

        var json = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(lookalike));

        using var document = JsonDocument.Parse(json);
        document.RootElement.GetProperty("verified").GetBoolean().Should().BeFalse();
        foreach (var forbidden in new[] { "suspected", "impersonator", "flagged", "trustWarning", "isFake" })
        {
            document.RootElement.TryGetProperty(forbidden, out _).Should().BeFalse(
                $"the platform never flags a lookalike — '{forbidden}' must not exist on the wire (D1-008)");
        }
    }
}
