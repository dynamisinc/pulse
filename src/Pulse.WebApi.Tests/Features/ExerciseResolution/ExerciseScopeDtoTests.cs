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

    [Theory]
    [InlineData("scheduled")]
    [InlineData("active")]
    [InlineData("complete")]
    [InlineData("archived")]
    public void Status_SerializesAsTheLowercaseExerciseStatusString(string status)
    {
        var dto = ExerciseScopeDto.FromExercise(NewExercise(status: status));

        var json = JsonSerializer.Serialize(dto);
        using var document = JsonDocument.Parse(json);

        document.RootElement.GetProperty("status").GetString().Should().Be(
            status, "status must serialize as the raw lowercase ExerciseStatus vocabulary string with no case mapping");
    }

    [Fact]
    public void FromExercise_MapsEveryFieldCorrectly()
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            Name = "Coastal Cascade Exercise",
            Hostname = "atl-cie.example.com",
            BrandedDomain = "cascade.example.org",
            TimeZone = "America/Chicago",
            Status = "complete",
            CurrentScenarioTime = new DateTimeOffset(2033, 6, 14, 9, 0, 0, TimeSpan.FromHours(-5)),
        };

        var dto = ExerciseScopeDto.FromExercise(exercise);

        dto.ExerciseId.Should().Be(exercise.Id.ToString());
        dto.ExerciseName.Should().Be("Coastal Cascade Exercise");
        dto.TimeZone.Should().Be("America/Chicago");
        dto.Status.Should().Be("complete");
    }

    [Fact]
    public void FromExercise_DoesNotLeakStaffOnlyOrHostFields()
    {
        // XC-002 by construction: Hostname/BrandedDomain/CurrentScenarioTime are staff/telemetry-only and
        // must never appear on the participant-facing wire shape at all — not even as an extra JSON key.
        var exercise = new Exercise
        {
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
