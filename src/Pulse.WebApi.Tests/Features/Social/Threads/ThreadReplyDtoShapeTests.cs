namespace Pulse.WebApi.Tests.Features.Social.Threads;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Features.Social.Threads;

/// <summary>
/// Wire-shape guards for <see cref="ThreadReplyDto"/> and <see cref="ThreadResponseDto"/> (demo-polish B2, AC-6;
/// DP-17, XC-002). Model-only: no database. These fail CI if the reply shape drifts from
/// <see cref="ParticipantPostDto"/>, for example when the base gains a member that the copy constructor does not copy,
/// or a provenance member appears.
/// </summary>
public class ThreadReplyDtoShapeTests
{
    /// <summary>The only members a thread reply adds to the participant post shape.</summary>
    private static readonly string[] ReplyOnlyMembers = { "replyToPersonaId", "status" };

    /// <summary>Names that must never appear on any participant payload (implementation.md §1.1).</summary>
    private static readonly string[] ForbiddenParticipantMembers =
    {
        "origin", "actingHumanId", "createdWallClock", "injectId", "uploadedByHumanId", "blobName", "contentType",
        "bytes", "originalFileName", "baselineLikeCount", "baselineRepostCount", "baselineReplyCount", "personaType",
        "castable", "exerciseId", "deletedAt", "parentPostId",
    };

    private static readonly JsonSerializerOptions WebOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public void ThreadReplyDto_DeclaresEveryParticipantMember_PlusExactlyReplyToPersonaIdAndStatus()
    {
        var baseNames = JsonMemberNames(typeof(ParticipantPostDto));
        var replyNames = JsonMemberNames(typeof(ThreadReplyDto));

        typeof(ThreadReplyDto).BaseType.Should().Be(typeof(ParticipantPostDto), "DP-17: the reply derives from the participant shape");
        replyNames.Should().BeEquivalentTo(baseNames.Concat(ReplyOnlyMembers), "a reply is every participant member plus the two reply members");
        replyNames.Should().NotContain(ForbiddenParticipantMembers, "a reply adds only participant-safe members (XC-002)");
    }

    [Fact]
    public void VisibleReply_SerializesEveryPopulatedParticipantMember_ValueForValue()
    {
        // Catches copy-constructor drift: every base member set here must come out of the derived DTO unchanged.
        var source = FullyPopulatedParticipantPost();
        var personaId = Guid.NewGuid();

        var reply = ThreadReplyDto.Visible(source, personaId);

        var baseJson = JsonNode.Parse(JsonSerializer.Serialize(source, WebOptions))!.AsObject();
        var replyJson = JsonNode.Parse(JsonSerializer.Serialize(reply, WebOptions))!.AsObject();

        replyJson.Select(p => p.Key).Should().BeEquivalentTo(baseJson.Select(p => p.Key).Concat(ReplyOnlyMembers));
        foreach (var (name, value) in baseJson)
        {
            JsonNode.DeepEquals(replyJson[name], value).Should().BeTrue("the reply must carry the participant member '{0}' unchanged", name);
        }

        replyJson["replyToPersonaId"]!.GetValue<string>().Should().Be(personaId.ToString());
        replyJson["status"]!.GetValue<string>().Should().Be("visible");
    }

    [Fact]
    public void ParityFixture_PopulatesEveryParticipantMember()
    {
        // Keeps the test above honest: when ParticipantPostDto gains a member, this fails until the fixture sets it,
        // so the value-for-value check covers it too.
        var sample = FullyPopulatedParticipantPost();

        foreach (var property in JsonProperties(typeof(ParticipantPostDto)))
        {
            property.GetValue(sample).Should().NotBeNull(
                "the parity fixture must populate '{0}'; add it to FullyPopulatedParticipantPost()", property.Name);
        }
    }

    [Fact]
    public void TakenDownReply_SerializesOnlyTheTombstoneMembers()
    {
        var reply = new Post
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            AuthorPersonaId = Guid.NewGuid(),
            Body = "TOMBSTONE-BODY-MUST-NOT-LEAK",
            CreatedScenarioTime = new DateTimeOffset(2033, 9, 4, 14, 12, 0, TimeSpan.FromHours(-5)),
            Origin = "inject",
            ActingHumanId = "human-x",
            CreatedWallClock = DateTimeOffset.UnixEpoch,
            InjectId = "043",
            BaselineLikeCount = 96,
            BaselineRepostCount = 40,
            BaselineReplyCount = 12,
            DeletedAt = new DateTimeOffset(2033, 9, 4, 14, 30, 0, TimeSpan.FromHours(-5)),
        };
        var replyTo = Guid.NewGuid();

        var json = JsonSerializer.Serialize(ThreadReplyDto.TakenDown(reply, replyTo), WebOptions);
        var node = JsonNode.Parse(json)!.AsObject();

        node.Select(p => p.Key).Should().BeEquivalentTo(
            new[] { "id", "authorPersonaId", "text", "counts", "scenarioTime", "replyToPersonaId", "status" },
            "a tombstone has no media, inReplyTo or viewer");
        node["text"]!.GetValue<string>().Should().BeEmpty();
        node["status"]!.GetValue<string>().Should().Be("taken-down");
        node["scenarioTime"]!.GetValue<string>().Should().Be(reply.CreatedScenarioTime.ToString("O"), "scenario time is emitted round-trip (COR-053)");
        JsonNode.DeepEquals(node["counts"], JsonNode.Parse("""{"reply":0,"repost":0,"like":0}""")).Should().BeTrue();
        json.Should().NotContain("TOMBSTONE-BODY-MUST-NOT-LEAK").And.NotContain("043").And.NotContain("human-x");
    }

    [Fact]
    public void ThreadResponse_SerializesRepliesThroughTheDerivedType()
    {
        // DP-17: a list typed by the base class would drop replyToPersonaId/status. The response must keep them.
        var reply = ThreadReplyDto.Visible(FullyPopulatedParticipantPost(), Guid.NewGuid());
        var response = new ThreadResponseDto(Array.Empty<ParticipantPostDto>(), FullyPopulatedParticipantPost(), new[] { reply });

        var node = JsonNode.Parse(JsonSerializer.Serialize(response, WebOptions))!.AsObject();
        var serializedReply = node["replies"]![0]!.AsObject();

        serializedReply.ContainsKey("replyToPersonaId").Should().BeTrue();
        serializedReply.ContainsKey("status").Should().BeTrue();
        IsValidReply(serializedReply).Should().BeTrue("the frozen client's isValidReply guard must accept it");
        IsValidPost(node["focused"]!.AsObject()).Should().BeTrue();
    }

    [Fact]
    public void NotFound_IsTheExactLegacyBytes()
    {
        JsonSerializer.Serialize(ThreadResponseDto.NotFound, WebOptions).Should().Be(
            """{"ancestors":[],"focused":null,"replies":[]}""",
            "the not-found shape is the existing byte-identical contract, with focused written as null, never omitted");
    }

    private static ParticipantPostDto FullyPopulatedParticipantPost() => new()
    {
        Id = Guid.NewGuid().ToString(),
        AuthorPersonaId = Guid.NewGuid().ToString(),
        Text = "full text",
        ScenarioTime = new DateTimeOffset(2033, 9, 4, 14, 0, 0, TimeSpan.FromHours(-5)).ToString("O"),
        Counts = new ParticipantPostCounts(1, 2, 3),
        Media = new[] { new PostMediaDto("m1", "video", "https://media.example/m1", "alt", "https://media.example/p1", 640, 360, 12.5) },
        InReplyTo = new PostInReplyToDto(Guid.NewGuid().ToString(), "parent_handle"),
        Viewer = new PostViewerStateDto(true, true),
    };

    private static PropertyInfo[] JsonProperties(Type type) => type
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Where(p => p.GetCustomAttribute<JsonIgnoreAttribute>() is not { Condition: JsonIgnoreCondition.Always })
        .ToArray();

    private static string[] JsonMemberNames(Type type) => JsonProperties(type)
        .Select(p => p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
            ?? throw new InvalidOperationException($"{type.Name}.{p.Name} has no explicit [JsonPropertyName]"))
        .ToArray();

    /// <summary>A C# port of the frozen client's <c>isValidPost</c> (<c>useThread.ts</c>).</summary>
    private static bool IsValidPost(JsonObject post) =>
        post["id"] is JsonValue id && id.TryGetValue<string>(out var idText) && idText.Length > 0
        && post["authorPersonaId"] is JsonValue author && author.TryGetValue<string>(out var authorText) && authorText.Length > 0
        && post["text"] is JsonValue text && text.TryGetValue<string>(out _)
        && post["scenarioTime"] is JsonValue time && time.TryGetValue<string>(out var timeText) && timeText.Length > 0
        && post["counts"] is JsonObject counts
        && new[] { "reply", "repost", "like" }.All(key => counts[key] is JsonValue n && n.TryGetValue<int>(out _));

    /// <summary>A C# port of the frozen client's <c>isValidReply</c> (<c>useThread.ts</c>).</summary>
    private static bool IsValidReply(JsonObject reply) =>
        IsValidPost(reply)
        && reply["replyToPersonaId"] is JsonValue to && to.TryGetValue<string>(out var toText) && toText.Length > 0
        && reply["status"] is JsonValue status && status.TryGetValue<string>(out var statusText)
        && statusText is "visible" or "taken-down";

    /// <summary>Exposed to the HTTP suites so every endpoint response is checked against the same guard.</summary>
    internal static bool IsValidThreadResponse(JsonNode? response) =>
        response is JsonObject root
        && root["ancestors"] is JsonArray ancestors && ancestors.All(a => a is JsonObject o && IsValidPost(o))
        && root.ContainsKey("focused") && (root["focused"] is null || (root["focused"] is JsonObject f && IsValidPost(f)))
        && root["replies"] is JsonArray replies && replies.All(r => r is JsonObject o && IsValidReply(o));

    internal static IReadOnlyCollection<string> Forbidden => ForbiddenParticipantMembers;
}
