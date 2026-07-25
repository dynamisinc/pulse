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

        dto.AudienceBand.Should().Be("mid", "the band comes from the entity, not the 'micro' stand-in");
        dto.FollowerCount.Should().Be(
            50186, "followerCount is the persisted SOC-054 magnitude, not the stand-in 0");
        dto.Bio.Should().Be(
            "The stories they don't want you to see.", "bio is projected now, no longer omitted unconditionally");
        dto.JoinedAt.Should().Be(
            "2024-03-09T08:30:00.000Z",
            "joinedAt is the persisted SCENARIO instant (COR-053), emitted in the frontend mock's own "
            + "toISOString() format so the mock→live flip changes no rendered dateline (WR-004)");
    }

    [Fact]
    public void FromPersona_ComposesTheDisplayedFollowerCount_MagnitudePlusRealInboundEdges()
    {
        // profiles-social-graph/07 AC3: displayed follower count = AudienceMagnitude + real inbound edges.
        var dto = PersonaResponseDto.FromPersona(AuthoredPersona(), inboundFollowEdges: 3, outboundFollowEdges: 7);

        dto.FollowerCount.Should().Be(
            50189, "the displayed follower count is the SOC-054 magnitude PLUS the real inbound follow edges");
        dto.AudienceMagnitude.Should().Be(
            50186,
            "the magnitude term is emitted on its own so audienceReach() — which takes magnitude and edges "
            + "SEPARATELY — can never be handed the composite and double-count the edges");
        dto.FollowerCount.Should().Be(
            dto.AudienceMagnitude + 3, "edges are recoverable as followerCount - audienceMagnitude");
    }

    [Fact]
    public void FromPersona_FollowingCount_IsRealOutboundEdgesOnly_MagnitudeNeverInflatesIt()
    {
        // profiles-social-graph/07 AC3: SOC-054's magnitude is a FOLLOWER-side construct only.
        var dto = PersonaResponseDto.FromPersona(AuthoredPersona(), inboundFollowEdges: 3, outboundFollowEdges: 7);

        dto.FollowingCount.Should().Be(
            7, "the following count is real outbound edges only — the audience magnitude never contributes");

        var noEdges = PersonaResponseDto.FromPersona(AuthoredPersona());
        noEdges.FollowingCount.Should().Be(
            0,
            "a persona with a 50K audience magnitude and no outbound edges follows NOBODY — a magnitude-derived "
            + "following count would be a fabrication");
        noEdges.FollowerCount.Should().Be(50186, "with no edges the displayed count is the magnitude alone");
    }

    [Fact]
    public void StaffFromPersona_ComposesTheSameCounts_TheFollowGraphIsNotStaffOnlyData()
    {
        var dto = StaffPersonaResponseDto.FromPersona(AuthoredPersona(), inboundFollowEdges: 3, outboundFollowEdges: 7);

        dto.FollowerCount.Should().Be(50189);
        dto.AudienceMagnitude.Should().Be(50186);
        dto.FollowingCount.Should().Be(
            7, "only personaType widens the staff shape — the follow counts are identical in both worlds");
    }

    [Fact]
    public void FromPersona_JoinedAt_MatchesJavaScriptToISOString_ForANonUtcOffsetToo()
    {
        var persona = AuthoredPersona();
        // A persisted instant with a non-zero offset must normalize to UTC first, exactly as Date#toISOString
        // does — otherwise the same instant would render as a different dateline than the mock's.
        persona.JoinedAt = new DateTimeOffset(2025, 7, 8, 14, 0, 0, TimeSpan.FromHours(2));

        PersonaResponseDto.FromPersona(persona).JoinedAt.Should().Be(
            "2025-07-08T12:00:00.000Z", "the wire instant is UTC with millisecond precision and a literal Z");
    }

    [Fact]
    public void FromPersona_StructurallyOmitsPersonaType_TheImpersonatorTellStaysStaffOnly()
    {
        var json = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(AuthoredPersona()));

        using var document = JsonDocument.Parse(json);
        document.RootElement.TryGetProperty("personaType", out _).Should().BeFalse(
            "the archetype labels exactly one seeded account 'bad-actor' — emitting it to a participant would "
            + "be a machine-readable flag on the SOC-052 lookalike, which D1-008 forbids");
        typeof(PersonaResponseDto).GetProperty("PersonaType").Should().BeNull(
            "the omission is STRUCTURAL — there is no property to populate, so it cannot be reintroduced by "
            + "an accidental edit to the factory");
    }

    [Fact]
    public void StaffFromPersona_CarriesPersonaType_AndTheSameParticipantFields()
    {
        var persona = AuthoredPersona();

        var dto = StaffPersonaResponseDto.FromPersona(persona);

        dto.PersonaType.Should().Be(
            "influencer", "the staff console's persona picker filters and labels on the archetype (COR-020)");
        dto.AudienceBand.Should().Be("mid");
        dto.FollowerCount.Should().Be(50186);
        dto.JoinedAt.Should().Be("2024-03-09T08:30:00.000Z", "both worlds render the same scenario instant");
        dto.AvatarColor.Should().Be(
            PersonaResponseDto.FromPersona(persona).AvatarColor,
            "the derived avatar is identical in both worlds — the split is about the archetype only");
    }

    [Fact]
    public void StaffFromPersona_NeverProjectsTheCastableGate()
    {
        var json = JsonSerializer.Serialize(StaffPersonaResponseDto.FromPersona(AuthoredPersona()));

        using var document = JsonDocument.Parse(json);
        document.RootElement.TryGetProperty("castable", out _).Should().BeFalse(
            "the engine-casting gate is server-side authoring state — projecting it would single out the "
            + "lookalike on the wire, the same defect as leaking personaType to a participant");
        typeof(StaffPersonaResponseDto).GetProperty("Castable").Should().BeNull();
        typeof(PersonaResponseDto).GetProperty("Castable").Should().BeNull();
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
        // SOC-052 / D1-008, asserted on the field that actually carried the tell: a bad-actor persona and an
        // ordinary citizen must serialize to payloads that differ in NOTHING a client could branch on except
        // `verified`. Before the WR-001 fix this was false — `personaType: "bad-actor"` was on the wire.
        var lookalike = AuthoredPersona();
        lookalike.DisplayName = "Fairhaven Water Update";
        lookalike.Handle = "FairhavenWaterUpd";
        lookalike.PersonaType = "bad-actor";
        lookalike.Verified = false;

        // Identical in EVERY respect except the archetype — same ids, so any byte of difference in the two
        // payloads can only come from personaType.
        var ordinary = AuthoredPersona();
        ordinary.Id = lookalike.Id;
        ordinary.ExerciseId = lookalike.ExerciseId;
        ordinary.DisplayName = "Fairhaven Water Update";
        ordinary.Handle = "FairhavenWaterUpd";
        ordinary.PersonaType = "citizen";
        ordinary.Verified = false;

        var lookalikeJson = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(lookalike));
        var ordinaryJson = JsonSerializer.Serialize(PersonaResponseDto.FromPersona(ordinary));

        lookalikeJson.Should().Be(
            ordinaryJson,
            "the archetype must make NO difference to a participant payload — otherwise the platform is "
            + "flagging the lookalike for any client that reads the field (D1-008)");
        lookalikeJson.Should().NotContain(
            "bad-actor", "the bad-actor archetype must never appear anywhere in a participant response");

        using var document = JsonDocument.Parse(lookalikeJson);
        document.RootElement.GetProperty("verified").GetBoolean().Should().BeFalse(
            "the ABSENT verified seal is the only trust signal a participant ever sees (SOC-052)");
        foreach (var forbidden in new[]
                 { "personaType", "castable", "suspected", "impersonator", "flagged", "trustWarning", "isFake" })
        {
            document.RootElement.TryGetProperty(forbidden, out _).Should().BeFalse(
                $"the platform never flags a lookalike — '{forbidden}' must not exist on the wire (D1-008)");
        }
    }
}
