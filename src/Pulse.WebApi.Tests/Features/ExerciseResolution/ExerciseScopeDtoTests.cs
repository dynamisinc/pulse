namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using System;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// Story <c>identity-backend/B2-Wave-0</c> (schema + contract seam-freeze) — locks the FROZEN
/// <see cref="ExerciseScopeDto"/> wire contract: the exact JSON key set (camelCase, mirroring the frontend
/// <c>ExerciseScope</c> type verbatim — <c>src/frontend/src/core/exerciseContext/exerciseContextResolver.ts</c>),
/// the lowercase <c>ExerciseStatus</c> vocabulary passthrough for <c>status</c>, that staff/host-only fields
/// (<c>Hostname</c>/<c>BrandedDomain</c>/<c>CurrentScenarioTime</c>) never leak onto this participant-facing
/// shape (XC-002), and <see cref="ExerciseScopeDto.FromExercise"/>'s field-for-field mapping. Plain
/// <c>[Fact]</c>/<c>[Theory]</c> — no database, so these run everywhere.
/// </summary>
public class ExerciseScopeDtoTests
{
    private static Exercise NewExercise(string status = "active", string timeZone = "America/New_York") => new()
    {
        Id = Guid.NewGuid(),
        Name = "Atlanta Hurricane Cascade",
        TimeZone = timeZone,
        Status = status,
    };

    [Fact]
    public void Serialized_HasExactlyTheFrozenFourKeys()
    {
        var dto = ExerciseScopeDto.FromExercise(NewExercise());

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["exerciseId", "exerciseName", "timeZone", "status"],
            "the frozen ExerciseScope wire shape has exactly these four camelCase keys, no more, no fewer — " +
            "no list, no picker, no admin/simulation-status field (COR-004, XC-002)");
    }

    // The TRANSITIONAL SUPERSET (exercise-configuration story 01a, Option B — Tier-2 signed off): the six
    // COR-032 literals plus the legacy four, which stay valid through the transition. Every one of these must
    // pass through FromExercise verbatim, and every one is accepted by the widened frontend isExerciseStatus
    // guard — that pairing is what makes UAT's independent frontend/backend deploys safe in either order.
    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    [InlineData("scheduled")]
    [InlineData("active")]
    [InlineData("complete")]
    public void Status_SerializesAsTheLowercaseExerciseStatusString(string status)
    {
        var dto = ExerciseScopeDto.FromExercise(NewExercise(status: status));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.GetProperty("status").GetString().Should().Be(
            status, "status must serialize as the raw lowercase ExerciseStatus vocabulary string with no case mapping");
    }

    /// <summary>
    /// Story exercise-configuration/01a: the vocabulary widened, the SHAPE did not. A COR-032 status flowing
    /// through still serializes to exactly the frozen four camelCase keys — a builder who "improves" this DTO
    /// breaks a fail-closed client guard and blanks the participant shell in UAT rather than raising a type
    /// error (integration hazard 4).
    /// </summary>
    [Fact]
    public void Serialized_KeepsTheFrozenFourKeys_WhenACor032StatusFlowsThrough()
    {
        var dto = ExerciseScopeDto.FromExercise(NewExercise(status: "paused"));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo(
            ["exerciseId", "exerciseName", "timeZone", "status"],
            "widening the status VOCABULARY must not add, remove or rename a field on the frozen wire shape");
        document.RootElement.GetProperty("status").GetString().Should().Be(
            "paused", "FromExercise passes the stored status through verbatim — no mapping, projection or default");
    }

    [Fact]
    public void FromExercise_MapsEveryFieldCorrectly()
    {
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = Guid.NewGuid(),
            Name = "HURREX-26 Cat 4 Landfall Dry Run",
            ParticipantName = "Coastal Cascade Exercise",
            Hostname = "atl-cie.example.com",
            BrandedDomain = "cascade.example.org",
            TimeZone = "America/Chicago",
            Status = "complete",
            CurrentScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
        };

        var dto = ExerciseScopeDto.FromExercise(exercise);

        dto.ExerciseId.Should().Be(exercise.Id.ToString());
        dto.ExerciseName.Should().Be(
            "Coastal Cascade Exercise", "exerciseName is the participant-facing name (§8.4), never the internal Name");
        dto.TimeZone.Should().Be("America/Chicago");
        dto.Status.Should().Be("complete");
    }

    /// <summary>
    /// exercise-build-golive/09 (§8.4, Tier-2 information leak): with no participant-facing name set, exerciseName is
    /// NULL — written as a present <c>null</c> key (the frozen client type is <c>string | null</c>) — and never falls
    /// back to the internal name, which can leak the scenario.
    /// </summary>
    [Fact]
    public void ExerciseName_IsNull_WhenNoParticipantNameIsSet_AndNeverFallsBackToTheInternalName()
    {
        var exercise = NewExercise();
        exercise.Name = "HURREX-26 Cat 4 Landfall Dry Run";

        var dto = ExerciseScopeDto.FromExercise(exercise);

        dto.ExerciseName.Should().BeNull("there is no fallback to the internal Name (§8.4)");
        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);
        document.RootElement.GetProperty("exerciseName").ValueKind.Should().Be(
            JsonValueKind.Null, "the key stays present as null so the client's string | null guard accepts it");
        json.Should().NotContain("HURREX", "the internal name never reaches the participant-facing scope");
    }

    /// <summary>
    /// exercise-build-golive/09 (Tier-2 review M-4): the wire name is normalized — a blank or whitespace-only stored
    /// participant name is <c>null</c> (never an empty label, never the internal name), and a padded one is trimmed.
    /// </summary>
    [Theory]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("\t \n", null)]
    [InlineData("  Coastal Cascade Exercise  ", "Coastal Cascade Exercise")]
    public void ExerciseName_IsNullWhenBlankOrWhitespace_AndTrimmedOtherwise(string stored, string? expected)
    {
        var exercise = NewExercise();
        exercise.ParticipantName = stored;

        var dto = ExerciseScopeDto.FromExercise(exercise);

        dto.ExerciseName.Should().Be(expected, "the participant-facing name is null when blank and trimmed otherwise");
        dto.ExerciseName.Should().NotBe(exercise.Name, "a blank participant name never falls back to the internal name");
    }

    [Fact]
    public void FromExercise_DoesNotLeakStaffOnlyOrHostFields()
    {
        // XC-002 by construction: Hostname/BrandedDomain/CurrentScenarioTime are staff/telemetry-only and
        // must never appear on the participant-facing wire shape at all — not even as an extra JSON key.
        var exercise = new Exercise
        {
            OrganizationId = Organization.DefaultOrganizationId,
            Id = Guid.NewGuid(),
            Name = "Leak Check Exercise",
            Hostname = "should-never-leak.example.com",
            BrandedDomain = "should-never-leak.example.org",
            TimeZone = "UTC",
            Status = "scheduled",
            CurrentScenarioTime = DateTimeOffset.UtcNow,
        };

        var dto = ExerciseScopeDto.FromExercise(exercise);
        var json = JsonSerializer.Serialize(dto);

        json.Should().NotContain("should-never-leak", "the frozen wire shape must never expose Hostname/BrandedDomain values");
        json.Should().NotContain("hostname", "the frozen wire shape has no hostname field at all (case-insensitive-ish check)");
        json.Should().NotContain(
            "currentScenarioTime", "CurrentScenarioTime is a staff-only placeholder, not part of the frozen participant wire shape");
    }

    [Fact]
    public void FromExercise_Throws_WhenExerciseIsNull()
    {
        var act = () => ExerciseScopeDto.FromExercise(null!);

        act.Should().Throw<ArgumentNullException>();
    }
}
