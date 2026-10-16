namespace Pulse.WebApi.Tests.Features.Social.Editing;

using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Social.Editing;
using Xunit;

/// <summary>
/// demo-feedback/17 (contract-stub AC) — the frozen Wave 4 wire shapes (WAVE-4.md, "Types") serialize camelCase with
/// exactly the frozen keys, independent of serializer naming policy, and <see cref="PauseTierStateDto"/> carries
/// <c>persisted</c>, defaulting to <c>true</c> until story 18 wires the write-through.
/// </summary>
public class Wave4ContractStubTests
{
    /// <summary>A serializer with NO naming policy: the keys must come from the explicit attributes alone.</summary>
    private static readonly JsonSerializerOptions NoPolicy = new();

    private static JsonObject Serialize<T>(T value) =>
        JsonNode.Parse(JsonSerializer.Serialize(value, NoPolicy))!.AsObject();

    [Fact]
    public void EditPostRequest_ReadsText_AndAMissingTextIsNullNotAFailure()
    {
        JsonSerializer.Deserialize<EditPostRequest>("""{"text":"fixed typo"}""", NoPolicy)!.Text.Should().Be("fixed typo");
        JsonSerializer.Deserialize<EditPostRequest>("{}", NoPolicy)!.Text.Should().BeNull(
            "a missing field is a validation 400 in story 19, never a deserialization failure");
        Serialize(new EditPostRequest { Text = "x" }).Select(p => p.Key).Should().Equal("text");
    }

    [Fact]
    public void PostEditHistoryDto_SerializesThePostIdAndVersionsWithTheFrozenKeys()
    {
        var dto = new PostEditHistoryDto
        {
            PostId = "p-1",
            Versions =
            [
                new PostEditVersionDto { EditNumber = 1, Text = "after", ScenarioTime = "2033-09-04T13:05:00.0000000-04:00" },
                new PostEditVersionDto { EditNumber = 0, Text = "before", ScenarioTime = "2033-09-04T13:00:00.0000000-04:00" },
            ],
        };

        var json = Serialize(dto);

        json.Select(p => p.Key).Should().Equal("postId", "versions");
        var first = json["versions"]!.AsArray()[0]!.AsObject();
        first.Select(p => p.Key).Should().Equal("editNumber", "text", "scenarioTime");
        first["editNumber"]!.GetValue<int>().Should().Be(1);
        first["scenarioTime"]!.GetValue<string>().Should().Be("2033-09-04T13:05:00.0000000-04:00");
    }

    [Fact]
    public void PostEditedDto_AndItsSummary_SerializeWithTheFrozenKeys()
    {
        var dto = new PostEditedDto
        {
            PostId = "p-1",
            Text = "after",
            Edited = new PostEditedSummaryDto { Count = 2, ScenarioTime = "2033-09-04T13:05:00.0000000-04:00" },
            Version = 2,
        };

        var json = Serialize(dto);

        json.Select(p => p.Key).Should().Equal("postId", "text", "edited", "version");
        json["edited"]!.AsObject().Select(p => p.Key).Should().Equal("count", "scenarioTime");
        json["edited"]!["count"]!.GetValue<int>().Should().Be(2);
        json["version"]!.GetValue<int>().Should().Be(2, "version = edited.count (DF-33)");
    }

    [Fact]
    public void PauseTierStateDto_CarriesPersisted_DefaultingToTrue()
    {
        var json = Serialize(new PauseTierStateDto { Tier = "running", ClockFrozen = false });

        json.Select(p => p.Key).Should().Equal("tier", "clockFrozen", "persisted");
        json["persisted"]!.GetValue<bool>().Should().BeTrue("persisted is true until story 18 wires the write-through");
        Serialize(new PauseTierStateDto { Tier = "freeze", ClockFrozen = true, Persisted = false })["persisted"]!
            .GetValue<bool>().Should().BeFalse();
    }
}
