namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Text.Json;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Xunit;

/// <summary>
/// The Wave-0 seam-freeze proof that <see cref="EngineReviewItemDto"/> serializes to the EXACT JSON the
/// frozen <c>reviewContracts.ts</c> mirror deserializes into — camelCase keys and the lowercase-kebab enum
/// literals (<c>routedAtLevel</c>, <c>disposition</c>, <c>decision</c>). A drift here is a cross-phase
/// migration (E8 §11, adversarial review D2), so these assert on the wire string, not just the object graph.
/// Model-only, so a plain <c>[Fact]</c> (no Docker).
/// </summary>
public class EngineReviewItemDtoSerializationTests
{
    private static EngineReviewItemDto BuildDelayedAutoDto()
    {
        return new EngineReviewItemDto
        {
            ExerciseId = "11111111-1111-1111-1111-111111111111",
            StorylineId = "22222222-2222-2222-2222-222222222222",
            DraftId = "33333333-3333-3333-3333-333333333333",
            RoutedAtLevel = AutonomyLevel.DelayedAuto,
            Disposition = DraftDisposition.CountingDown,
            Countdown = new DelayedAutoCountdownDto
            {
                ExerciseId = "11111111-1111-1111-1111-111111111111",
                StorylineId = "22222222-2222-2222-2222-222222222222",
                DraftId = "33333333-3333-3333-3333-333333333333",
                StartedScenarioMinute = 42,
                CountdownMinutes = 5,
                Decision = ControllerDecision.Approved,
            },
            Posts = new List<GeneratedPostDto>
            {
                new()
                {
                    PersonaHandle = "@mvega_fh",
                    Text = "Water pressure is dropping on the east side.",
                    Sentiment = -0.4,
                    Hashtags = new[] { "#WaterIssues", "#EastSide" },
                },
                new()
                {
                    PersonaHandle = "@jdoe_local",
                    Text = "Anyone else without water on Elm?",
                    Sentiment = -0.2,
                    Hashtags = new[] { "#WaterIssues" },
                },
            },
            StorylineTag = "#WaterIssues",
            StorylineBrief = "Rising frustration about the water outage.",
            ActionLabel = "reply → @mvega_fh",
        };
    }

    [Fact]
    public void Serialize_EmitsCamelCaseKeys_MatchingTheFrozenContract()
    {
        var json = JsonSerializer.Serialize(BuildDelayedAutoDto());

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Top-level keys mirror reviewContracts.ts EngineReviewItemInit, field-for-field.
        foreach (var key in new[]
                 {
                     "exerciseId", "storylineId", "draftId", "routedAtLevel", "disposition",
                     "countdown", "posts", "storylineTag", "storylineBrief", "actionLabel",
                 })
        {
            root.TryGetProperty(key, out _).Should().BeTrue($"the frozen contract requires a camelCase '{key}' key");
        }
    }

    [Fact]
    public void Serialize_EmitsKebabAndLowerEnumLiterals_NotPascalCaseNames()
    {
        var json = JsonSerializer.Serialize(BuildDelayedAutoDto());

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        root.GetProperty("routedAtLevel").GetString().Should().Be(
            "delayed-auto", "AutonomyLevel.DelayedAuto must serialize to the frozen 'delayed-auto' literal, never 'DelayedAuto'");
        root.GetProperty("disposition").GetString().Should().Be(
            "counting-down", "DraftDisposition.CountingDown must serialize to 'counting-down', never 'CountingDown'");
        root.GetProperty("countdown").GetProperty("decision").GetString().Should().Be(
            "approved", "ControllerDecision.Approved must serialize to 'approved'");
    }

    [Fact]
    public void Serialize_EmitsCountdownAndPostFields_MatchingTheFrozenContract()
    {
        var json = JsonSerializer.Serialize(BuildDelayedAutoDto());

        using var doc = JsonDocument.Parse(json);
        var countdown = doc.RootElement.GetProperty("countdown");

        countdown.GetProperty("exerciseId").GetString().Should().Be("11111111-1111-1111-1111-111111111111");
        countdown.GetProperty("startedScenarioMinute").GetInt32().Should().Be(42);
        countdown.GetProperty("countdownMinutes").GetInt32().Should().Be(5);

        var posts = doc.RootElement.GetProperty("posts");
        posts.GetArrayLength().Should().Be(2);
        var lead = posts[0];
        lead.GetProperty("personaHandle").GetString().Should().Be("@mvega_fh");
        lead.GetProperty("text").GetString().Should().Be("Water pressure is dropping on the east side.");
        lead.GetProperty("sentiment").GetDouble().Should().Be(-0.4);
        lead.GetProperty("hashtags").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public void Serialize_QueuedSuggestItem_EmitsNullCountdown()
    {
        var dto = new EngineReviewItemDto
        {
            ExerciseId = Guid.NewGuid().ToString(),
            StorylineId = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            RoutedAtLevel = AutonomyLevel.Suggest,
            Disposition = DraftDisposition.Queued,
            Countdown = null,
            Posts = new List<GeneratedPostDto>
            {
                new()
                {
                    PersonaHandle = "@a",
                    Text = "t",
                    Sentiment = 0,
                    Hashtags = Array.Empty<string>(),
                },
            },
            StorylineTag = "#Tag",
            StorylineBrief = "brief",
            ActionLabel = "label",
        };

        var json = JsonSerializer.Serialize(dto);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        root.GetProperty("routedAtLevel").GetString().Should().Be("suggest");
        root.GetProperty("disposition").GetString().Should().Be("queued");
        root.TryGetProperty("countdown", out var countdown).Should().BeTrue(
            "the frozen contract keeps the countdown key present (nullable), not omitted");
        countdown.ValueKind.Should().Be(JsonValueKind.Null, "a Suggest (queued) item has a null countdown");
    }

    [Theory]
    [InlineData(DraftDisposition.Queued, "queued")]
    [InlineData(DraftDisposition.CountingDown, "counting-down")]
    [InlineData(DraftDisposition.Held, "held")]
    [InlineData(DraftDisposition.Published, "published")]
    [InlineData(DraftDisposition.Vetoed, "vetoed")]
    public void Serialize_EveryDisposition_EmitsItsFrozenLiteral(DraftDisposition disposition, string expected)
    {
        var dto = new EngineReviewItemDto
        {
            ExerciseId = Guid.NewGuid().ToString(),
            StorylineId = Guid.NewGuid().ToString(),
            DraftId = Guid.NewGuid().ToString(),
            RoutedAtLevel = AutonomyLevel.Suggest,
            Disposition = disposition,
            Posts = Array.Empty<GeneratedPostDto>(),
            StorylineTag = "#Tag",
            StorylineBrief = "brief",
            ActionLabel = "label",
        };

        var json = JsonSerializer.Serialize(dto);

        using var doc = JsonDocument.Parse(json);
        doc.RootElement.GetProperty("disposition").GetString().Should().Be(expected);
    }

    [Fact]
    public void FromEntity_MapsDelayedAutoItem_ToTheWireShape()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();
        var draftId = Guid.NewGuid();

        var entity = new EngineReviewItemEntity
        {
            DraftId = draftId,
            ExerciseId = exerciseId,
            StorylineId = storylineId,
            RoutedAtLevel = AutonomyLevel.DelayedAuto,
            Disposition = DraftDisposition.CountingDown,
            CountdownStartedScenarioMinute = 10,
            CountdownMinutes = 3,
            CountdownDecision = ControllerDecision.None,
            StorylineTag = "#WaterIssues",
            StorylineBrief = "brief",
            ActionLabel = "reply → @mvega_fh",
            Posts = new List<EngineReviewDraftPost>
            {
                new() { PersonaHandle = "@mvega_fh", Text = "hi", Sentiment = 0.1, Hashtags = new List<string> { "#x" } },
            },
        };

        var dto = EngineReviewItemDto.FromEntity(entity);

        dto.ExerciseId.Should().Be(exerciseId.ToString());
        dto.DraftId.Should().Be(draftId.ToString());
        dto.RoutedAtLevel.Should().Be(AutonomyLevel.DelayedAuto);
        dto.Disposition.Should().Be(DraftDisposition.CountingDown);
        dto.Countdown.Should().NotBeNull();
        dto.Countdown!.StartedScenarioMinute.Should().Be(10);
        dto.Countdown.CountdownMinutes.Should().Be(3);
        dto.Countdown.Decision.Should().Be(ControllerDecision.None);
        dto.Posts.Should().ContainSingle().Which.PersonaHandle.Should().Be("@mvega_fh");
    }

    [Fact]
    public void FromEntity_QueuedItemWithoutCountdownColumns_MapsToNullCountdown()
    {
        var entity = new EngineReviewItemEntity
        {
            DraftId = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            StorylineId = Guid.NewGuid(),
            RoutedAtLevel = AutonomyLevel.Suggest,
            Disposition = DraftDisposition.Queued,
            StorylineTag = "#Tag",
            StorylineBrief = "brief",
            ActionLabel = "label",
        };

        var dto = EngineReviewItemDto.FromEntity(entity);

        dto.Countdown.Should().BeNull("a Suggest item with no persisted countdown fields yields a null countdown");
    }
}
