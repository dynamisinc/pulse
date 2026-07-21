namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Story <c>identity-backend/B2-Wave-0</c> (schema + contract seam-freeze) — locks the FROZEN
/// <see cref="SessionDto"/> wire contract: the exact JSON key set (camelCase, mirroring the frontend
/// <c>Session</c> type verbatim — <c>src/frontend/src/core/auth/sessionResolver.ts</c>), the OMITTED-not-null
/// treatment of the optional <c>personaId</c>, the raw <c>ExerciseRole</c> string passthrough for
/// <c>role</c>, the round-trippable ISO-8601 <c>expiresAt</c>, and <see cref="SessionDto.FromSession"/>'s
/// field-for-field mapping across all three session kinds. Plain <c>[Fact]</c>/<c>[Theory]</c> — no
/// database, so these run everywhere and are the fast, deterministic signal for this frozen contract.
/// </summary>
public class SessionDtoTests
{
    private static Session NewSession(
        Guid? personaId = null,
        Guid? accountId = null,
        string role = "participant",
        bool isReadOnly = false,
        string actingHumanId = "human-1",
        DateTimeOffset? expiresAt = null) => new()
    {
        Id = Guid.NewGuid(),
        TokenHash = "token-hash",
        Kind = "participant",
        ExerciseId = Guid.NewGuid(),
        PrincipalId = (accountId ?? Guid.NewGuid()).ToString(),
        AccountId = accountId,
        StaffUserId = null,
        Role = role,
        PersonaId = personaId,
        ActingHumanId = actingHumanId,
        IsReadOnly = isReadOnly,
        IssuedAt = DateTimeOffset.UtcNow,
        ExpiresAt = expiresAt ?? new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero),
    };

    [Fact]
    public void Serialized_WithPersonaId_HasExactlyTheFrozenSevenKeys()
    {
        var dto = SessionDto.FromSession(NewSession(personaId: Guid.NewGuid()));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["exerciseId", "accountId", "role", "personaId", "actingHumanId", "isReadOnly", "expiresAt"],
            "the frozen Session wire shape has exactly these seven camelCase keys, no more, no fewer");
    }

    [Fact]
    public void Serialized_WithoutPersonaId_OmitsTheKeyEntirely_NotNull()
    {
        var dto = SessionDto.FromSession(NewSession(personaId: null));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        var keys = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();

        keys.Should().NotContain("personaId",
            "the frozen client validator accepts `undefined | string` but rejects `null` for personaId, so an " +
            "absent persona must OMIT the key entirely from the JSON — not serialize it as a null value");
        keys.Should().BeEquivalentTo(
            ["exerciseId", "accountId", "role", "actingHumanId", "isReadOnly", "expiresAt"],
            "the remaining six keys must still be present when personaId is omitted");
    }

    [Theory]
    [InlineData("participant")]
    [InlineData("pio")]
    [InlineData("controller")]
    [InlineData("evaluator")]
    [InlineData("planner")]
    [InlineData("orgAdmin")]
    public void Role_SerializesAsTheRawExerciseRoleString(string role)
    {
        var dto = SessionDto.FromSession(NewSession(role: role));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.GetProperty("role").GetString().Should().Be(
            role, "the session role must serialize as the raw ExerciseRole vocabulary string with no case mapping");
    }

    [Fact]
    public void ExpiresAt_IsIso8601AndRoundTrips()
    {
        var instant = new DateTimeOffset(2033, 6, 14, 9, 30, 15, TimeSpan.FromHours(-5));
        var dto = SessionDto.FromSession(NewSession(expiresAt: instant));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);
        var wireValue = document.RootElement.GetProperty("expiresAt").GetString();

        var reparsed = DateTimeOffset.Parse(wireValue!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

        reparsed.Should().Be(instant, "expiresAt must be a round-trippable ISO-8601 instant, not a re-derived/lossy value");
    }

    [Fact]
    public void FromSession_MapsEveryFieldCorrectly_ParticipantWithPersona()
    {
        var accountId = Guid.NewGuid();
        var personaId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();
        var expiresAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);

        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = "token-hash",
            Kind = "participant",
            ExerciseId = exerciseId,
            PrincipalId = accountId.ToString(),
            AccountId = accountId,
            StaffUserId = null,
            Role = "pio",
            PersonaId = personaId,
            ActingHumanId = "human-42",
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt,
        };

        var dto = SessionDto.FromSession(session);

        dto.ExerciseId.Should().Be(exerciseId.ToString());
        dto.AccountId.Should().Be(accountId.ToString());
        dto.Role.Should().Be("pio");
        dto.PersonaId.Should().Be(personaId.ToString());
        dto.ActingHumanId.Should().Be("human-42");
        dto.IsReadOnly.Should().BeFalse();
        dto.ExpiresAt.Should().Be(expiresAt.ToString("O"));
    }

    [Fact]
    public void FromSession_MapsEveryFieldCorrectly_ReadOnlyWithNoPersona()
    {
        var ephemeralId = Guid.NewGuid().ToString();
        var exerciseId = Guid.NewGuid();
        var expiresAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero);

        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = "token-hash",
            Kind = "readonly",
            ExerciseId = exerciseId,
            PrincipalId = ephemeralId,
            AccountId = null,
            StaffUserId = null,
            Role = "participant",
            PersonaId = null,
            ActingHumanId = ephemeralId,
            IsReadOnly = true,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt,
        };

        var dto = SessionDto.FromSession(session);

        dto.ExerciseId.Should().Be(exerciseId.ToString());
        dto.AccountId.Should().Be(ephemeralId, "a read-only session's wire accountId is the ephemeral PrincipalId (COR-015 — no named account)");
        dto.PersonaId.Should().BeNull();
        dto.ActingHumanId.Should().Be(ephemeralId);
        dto.IsReadOnly.Should().BeTrue();
    }

    [Fact]
    public void FromSession_MapsEveryFieldCorrectly_StaffWithNoPersona()
    {
        var staffUserId = Guid.NewGuid();
        var exerciseId = Guid.NewGuid();

        var session = new Session
        {
            Id = Guid.NewGuid(),
            TokenHash = "token-hash",
            Kind = "staff",
            ExerciseId = exerciseId,
            PrincipalId = staffUserId.ToString(),
            AccountId = null,
            StaffUserId = staffUserId,
            Role = "controller",
            PersonaId = null,
            ActingHumanId = staffUserId.ToString(),
            IsReadOnly = false,
            IssuedAt = DateTimeOffset.UtcNow,
            ExpiresAt = new DateTimeOffset(2033, 6, 14, 15, 0, 0, TimeSpan.Zero),
        };

        var dto = SessionDto.FromSession(session);

        dto.AccountId.Should().Be(staffUserId.ToString());
        dto.Role.Should().Be("controller");
        dto.PersonaId.Should().BeNull();
        dto.IsReadOnly.Should().BeFalse();
    }

    [Fact]
    public void FromSession_Throws_WhenSessionIsNull()
    {
        var act = () => SessionDto.FromSession(null!);

        act.Should().Throw<ArgumentNullException>();
    }
}
