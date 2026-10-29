namespace Pulse.WebApi.Tests.Features.Channels;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.ExerciseConfiguration;

/// <summary>
/// Channels-foundation story 02 (#698): the C# half of the C#↔TS wire-contract parity check. The golden file
/// <c>src/frontend/src/features/channels/contract/wireContract.json</c> is read by BOTH suites (this one and
/// <c>wireContract.test.ts</c>), so the C# records, <see cref="ChannelVocabulary"/>,
/// <see cref="ChannelTelemetryEventTypes"/> and the TS types can only agree with each other through it. Every
/// key set is read off a REAL serialization of a fully-populated instance, not from property names, so a
/// <c>[JsonPropertyName]</c> typo or a dropped member fails here. Plain facts, no database.
/// </summary>
public class ChannelContractParityTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        (JsonNode.Parse(File.ReadAllText(Path.Combine(
            FindRepositoryRoot(), "src", "frontend", "src", "features", "channels", "contract", "wireContract.json")))
            ?? throw new InvalidOperationException("wireContract.json is empty.")).AsObject());

    private static readonly IReadOnlyDictionary<string, object> Samples = BuildSamples();

    public static TheoryData<string> ShapeNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in Samples.Keys)
        {
            data.Add(name);
        }

        return data;
    }

    public static TheoryData<string> ParticipantShapeNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in GoldenStrings(Golden.Value["participantShapes"]))
        {
            data.Add(name);
        }

        return data;
    }

    [Fact]
    public void Samples_CoverExactlyTheGoldenShapes()
    {
        Samples.Keys.Should().BeEquivalentTo(Golden.Value["shapes"]!.AsObject().Select(p => p.Key));
    }

    [Theory]
    [MemberData(nameof(ShapeNames))]
    public void SerializedKeys_EqualTheGoldenKeySet(string shape)
    {
        var expected = GoldenStrings(Golden.Value["shapes"]![shape]);

        SerializedKeys(Samples[shape]).Should().BeEquivalentTo(
            expected, $"{shape} must serialize to exactly the frozen FC-3 camelCase keys");
    }

    [Theory]
    [MemberData(nameof(ShapeNames))]
    public void SerializedKeys_AreStableUnderDefaultAndWebOptions(string shape)
    {
        // The SignalR JSON protocol and the REST pipeline may carry different options; explicit
        // [JsonPropertyName]s make the wire key independent of the naming policy.
        var plain = SerializedKeys(Samples[shape], new JsonSerializerOptions());
        var web = SerializedKeys(Samples[shape], new JsonSerializerOptions(JsonSerializerDefaults.Web));

        plain.Should().BeEquivalentTo(web);
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_ExposesNoStaffOnlyMember(string shape)
    {
        var type = Samples[shape].GetType();
        var excluded = GoldenStrings(Golden.Value["participantExcludedKeys"]);

        var wireNames = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name ?? p.Name)
            .ToList();

        wireNames.Should().NotContain(excluded, $"{shape} is a participant DTO (XC-002)");
        wireNames.Should().NotContain(n => n.Contains("wallclock", StringComparison.OrdinalIgnoreCase), "no wall clock on a participant DTO");
        type.GetProperties().Select(p => p.Name).Should().NotContain(
            ["Origin", "ActingHumanId", "Status", "Background", "FeaturedRank", "Version", "InjectId", "ExternalRef"],
            "a participant DTO cannot even hold a staff-only member under another wire name");
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShape_IsSealedAndDerivesFromNothing(string shape)
    {
        // A derived instance would serialize its runtime type's extra members on the SignalR protocol.
        var type = Samples[shape].GetType();

        type.IsSealed.Should().BeTrue();
        type.BaseType.Should().Be(typeof(object));
    }

    [Fact]
    public void Tombstone_CarriesNoBody()
    {
        var keys = SerializedKeys(Samples["ChannelContentTombstoneDto"]);

        keys.Should().NotContain(["bodyHtml", "headline", "dek", "media", "payload", "revisions", "hero"]);
        keys.Should().Contain("retractedScenarioTime");
    }

    [Fact]
    public void ParticipantStateDefaults_AreTheVocabularyLiterals()
    {
        new ChannelContentTombstoneDto
        {
            Id = "x", ChannelId = "news", Kind = "article", Outlet = OutletRef(), Slug = "a", Permalink = "/news/o/a",
            RetractedScenarioTime = "2026-12-02T14:40:00Z",
        }.State.Should().Be("retracted");
        ((ChannelContentSummaryDto)Samples["ChannelContentSummaryDto"]).State.Should().Be("published");
        ((ChannelContentDto)Samples["ChannelContentDto"]).State.Should().Be("published");
    }

    public static TheoryData<string, string[]> VocabularyLists() => new()
    {
        { "channelIds", ChannelVocabulary.ChannelIds.ToArray() },
        { "contentChannelIds", ChannelVocabulary.ContentChannelIds.ToArray() },
        { "contentKinds", ChannelVocabulary.ContentKinds.ToArray() },
        { "contentStatuses", ChannelVocabulary.ContentStatuses.ToArray() },
        { "participantContentStates", ChannelVocabulary.ParticipantContentStates.ToArray() },
        { "contentOrigins", ChannelVocabulary.ContentOrigins.ToArray() },
        { "revisionKinds", ChannelVocabulary.RevisionKinds.ToArray() },
        { "participantRevisionKinds", ChannelVocabulary.ParticipantRevisionKinds.ToArray() },
        { "stampMovingRevisionKinds", ChannelVocabulary.StampMovingRevisionKinds.ToArray() },
        { "alertSeverities", ChannelVocabulary.AlertSeverities.ToArray() },
        { "mediaRoles", ChannelVocabulary.MediaRoles.ToArray() },
        { "contentMediaKinds", ChannelVocabulary.ContentMediaKinds.ToArray() },
        { "realtimeEvents", ChannelRealtimeEvents.All.ToArray() },
    };

    [Theory]
    [MemberData(nameof(VocabularyLists))]
    public void Vocabulary_EqualsTheGoldenListInOrder(string name, string[] values)
    {
        values.Should().Equal(GoldenStrings(Golden.Value["vocabulary"]![name]));
    }

    [Fact]
    public void ChannelIds_EqualTheChannelCatalogIds()
    {
        ChannelVocabulary.ChannelIds.Should().Equal(ChannelCatalog.All.Select(c => c.Id));
    }

    [Fact]
    public void TelemetryVocabulary_EqualsTheGoldenFc6bList()
    {
        ChannelTelemetryEventTypes.All.Should().Equal(GoldenStrings(Golden.Value["telemetryEventTypes"]));
        ChannelTelemetryEventTypes.All.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public void TelemetryVocabulary_ConstantsAreAllListed()
    {
        var constants = typeof(ChannelTelemetryEventTypes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral)
            .Select(f => (string)f.GetRawConstantValue()!);

        constants.Should().BeEquivalentTo(ChannelTelemetryEventTypes.All);
    }

    private static string[] GoldenStrings(JsonNode? node) =>
        node!.AsArray().Select(n => n!.GetValue<string>()).ToArray();

    private static List<string> SerializedKeys(object value, JsonSerializerOptions? options = null)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, value.GetType(), options));
        return document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
    }

    private static OutletRefDto OutletRef() => new()
    {
        Id = "o-1", ChannelId = "news", Slug = "newsline-7", Name = "Newsline 7", SkinKey = "newsline7",
    };

    /// <summary>One fully-populated instance per pinned shape, keyed by the golden-file name.</summary>
    private static Dictionary<string, object> BuildSamples()
    {
        var media = new ContentMediaDto
        {
            Id = "m-1", Kind = "image", Role = "hero", Url = "/media/m-1", PosterUrl = null, ContentType = "image/jpeg",
            Width = 1200, Height = 630, DurationSec = null, Alt = "alt", Caption = null,
        };
        var revision = new ContentRevisionDto { Number = 2, Kind = "update", ScenarioTime = "2026-12-02T14:32:00Z", Note = null };
        var alert = new AlertDto
        {
            Id = "a-1", Severity = "emergency", Message = "Tornado Warning", ScenarioTime = "2026-12-02T14:20:00Z",
            Href = "/weather/weather-desk/tornado-warning-1", SourceChannel = "weather", ContentId = "c-1",
            ExpiresScenarioTime = null,
        };
        var summary = new ChannelContentSummaryDto
        {
            Id = "c-1", ChannelId = "news", Kind = "article", Outlet = OutletRef(), Slug = "a", Permalink = "/news/newsline-7/a",
            Headline = "H", PublishedScenarioTime = "2026-12-02T14:05:00Z",
        };
        var mediaWrite = new ContentMediaWriteRequest { MediaId = "m-1", Role = "inline", Alt = null };

        return new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["OutletRefDto"] = OutletRef(),
            ["OutletDto"] = new OutletDto
            {
                Id = "o-1", ChannelId = "news", Slug = "newsline-7", Name = "Newsline 7", SkinKey = "newsline7",
                HomeRoute = "/news/newsline-7", Logo = media, SkinOverrides = new JsonObject { ["schemaVersion"] = 1 },
            },
            ["ContentMediaDto"] = media,
            ["ContentBylineDto"] = new ContentBylineDto { Name = "Staff", PersonaId = null },
            ["ContentRevisionDto"] = revision,
            ["ChannelContentSummaryDto"] = summary,
            ["ChannelContentDto"] = new ChannelContentDto
            {
                Id = "c-1", ChannelId = "news", Kind = "article", Outlet = OutletRef(), Slug = "a", Permalink = "/news/newsline-7/a",
                Headline = "H", PublishedScenarioTime = "2026-12-02T14:05:00Z", BodyHtml = "<p>b</p>",
                Media = [media], Revisions = [revision],
            },
            ["ChannelContentTombstoneDto"] = new ChannelContentTombstoneDto
            {
                Id = "c-2", ChannelId = "press", Kind = "release", Outlet = OutletRef(), Slug = "b", Permalink = "/press/wire-room/b",
                RetractedScenarioTime = "2026-12-02T14:40:00Z",
            },
            ["ChannelContentListDto"] = new ChannelContentListDto { Items = [summary], NextCursor = null },
            ["ChannelContentStaffDto"] = new ChannelContentStaffDto
            {
                Id = "c-1", ChannelId = "news", Kind = "article", Outlet = OutletRef(), Slug = "a", Permalink = "/news/newsline-7/a",
                Headline = "H", BodyHtml = "<p>b</p>", Status = "draft", Origin = "controller", ActingHumanId = "h-1",
                RevisionLog = [revision with { Kind = "edit" }],
            },
            ["ContentMediaWriteRequest"] = mediaWrite,
            ["ContentWriteRequest"] = new ContentWriteRequest { Kind = "article", OutletId = "o-1", Headline = "H", Media = [mediaWrite] },
            ["AlertDto"] = alert,
            ["AlertsChangedDto"] = new AlertsChangedDto { Alerts = [alert] },
            ["ContentRevisedDto"] = new ContentRevisedDto
            {
                Id = "c-1", ChannelId = "news", Permalink = "/news/newsline-7/a", UpdatedScenarioTime = "2026-12-02T14:32:00Z",
                Revisions = [revision], Headline = "H",
            },
            ["ContentRetractedDto"] = new ContentRetractedDto
            {
                Id = "c-1", ChannelId = "news", Permalink = "/news/newsline-7/a", RetractedScenarioTime = "2026-12-02T14:40:00Z",
            },
            ["LinkPreviewDto"] = new LinkPreviewDto { Title = "H", SourceName = "Newsline 7", Permalink = "/news/newsline-7/a" },
            ["PublishOptions"] = new PublishOptions
            {
                PairedPost = new PairedPostOptions(), Alert = new PublishAlertOptions { Severity = "advisory" },
            },
            ["PairedPostOptions"] = new PairedPostOptions { Text = "Read more" },
            ["PublishAlertOptions"] = new PublishAlertOptions { Severity = "emergency" },
        };
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "pulse.slnx")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("Could not locate pulse.slnx above the test binary.");
    }
}
