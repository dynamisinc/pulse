namespace Pulse.WebApi.Tests.Features.News;

using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.News;
using Xunit;

/// <summary>
/// News story 01 (#718): the article descriptor's identity, payload schema (E4-C1), participant projection (XC-002) and
/// alert suggestion (NWS-012), as pure logic. The media and funnel rules are in <see cref="ArticleFunnelTests"/>.
/// </summary>
public sealed class ArticleKindDescriptorTests
{
    private readonly ArticleKindDescriptor _descriptor = new();

    [Fact]
    public void Identity_IsTheNewsArticleKind_WithTheArticleRichBodyAndImageOrVideoMedia()
    {
        _descriptor.Kind.Should().Be("article");
        _descriptor.ChannelId.Should().Be("news");
        _descriptor.BodyPolicy.Should().Be("article-rich");
        _descriptor.AllowedMediaKinds.Should().BeEquivalentTo(["image", "video"]);
        _descriptor.AllowedMediaKinds.Should().NotContain("document");
    }

    [Fact]
    public async Task AFullValidPayload_IsAccepted_AndStoredNormalized()
    {
        var payload = Json("""
            {
              "breaking": { "text": "  Bridge closed  " },
              "dateline": { "place": "RIVERTON", "agency": "MD9" },
              "slugCode": "BRIDGE-0412",
              "storyType": "breaking_hard_news"
            }
            """);

        var result = await ValidateAsync(payload);

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
        payload.ToJsonString().Should().Be(
            """{"breaking":{"text":"Bridge closed"},"dateline":{"place":"RIVERTON","agency":"MD9"},"slugCode":"BRIDGE-0412","storyType":"breaking_hard_news"}""");
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"breaking":null,"dateline":null}""")]
    [InlineData("""{"dateline":{"place":"Riverton"}}""")]
    [InlineData("""{"dateline":{"place":"Riverton","agency":null}}""")]
    [InlineData("""{"storyType":"follow_up"}""")]
    [InlineData("""{"storyType":"human_interest"}""")]
    [InlineData("""{"storyType":"press_conference_recap"}""")]
    [InlineData("""{"slugCode":"x"}""")]
    [InlineData("""{"slugCode":null,"storyType":null}""")]
    public async Task MinimalAndNullablePayloads_AreAccepted(string json)
    {
        var result = await ValidateAsync(Json(json));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task AnEmptyPayload_IsStoredWithExplicitNullBreakingAndDateline()
    {
        var payload = Json("{}");

        (await ValidateAsync(payload)).IsValid.Should().BeTrue();

        payload.ToJsonString().Should().Be("""{"breaking":null,"dateline":null}""");
    }

    [Theory]
    [InlineData("""{"kicker":"WEATHER"}""", "payload.kicker")]
    [InlineData("""{"hero":"x"}""", "payload.hero")]
    [InlineData("""{"breaking":{"text":"x","color":"red"}}""", "payload.breaking.color")]
    [InlineData("""{"dateline":{"place":"x","date":"today"}}""", "payload.dateline.date")]
    public async Task UnknownKeys_AreRefused_FieldLevel(string json, string path)
    {
        var result = await ValidateAsync(Json(json));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.StartsWith(path, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("""{"breaking":true}""", "payload.breaking")]
    [InlineData("""{"breaking":"Bridge closed"}""", "payload.breaking")]
    [InlineData("""{"breaking":{}}""", "payload.breaking.text")]
    [InlineData("""{"breaking":{"text":""}}""", "payload.breaking.text")]
    [InlineData("""{"breaking":{"text":"   "}}""", "payload.breaking.text")]
    [InlineData("""{"breaking":{"text":42}}""", "payload.breaking.text")]
    [InlineData("""{"dateline":"Riverton"}""", "payload.dateline")]
    [InlineData("""{"dateline":{}}""", "payload.dateline.place")]
    [InlineData("""{"dateline":{"place":"x","agency":""}}""", "payload.dateline.agency")]
    [InlineData("""{"slugCode":""}""", "payload.slugCode")]
    [InlineData("""{"slugCode":7}""", "payload.slugCode")]
    [InlineData("""{"storyType":"opinion"}""", "payload.storyType")]
    [InlineData("""{"storyType":"BREAKING_HARD_NEWS"}""", "payload.storyType")]
    public async Task WrongTypesAndEmptyStrings_AreRefused_FieldLevel(string json, string path)
    {
        var result = await ValidateAsync(Json(json));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(error => error.StartsWith(path, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("breaking.text", 120)]
    [InlineData("dateline.place", 80)]
    [InlineData("dateline.agency", 40)]
    [InlineData("slugCode", 48)]
    public async Task Lengths_AreBoundedInCodePoints_AtTheLimitOkAndOneOverRefused(string field, int max)
    {
        (await ValidateAsync(WithField(field, new string('a', max)))).IsValid.Should().BeTrue();

        // An astral character is one code point (two UTF-16 units): the limit counts what a reader sees.
        (await ValidateAsync(WithField(field, string.Concat(Enumerable.Repeat("\U0001F525", max))))).IsValid.Should().BeTrue();

        var over = await ValidateAsync(WithField(field, new string('a', max + 1)));
        over.IsValid.Should().BeFalse();
        over.Errors.Should().ContainSingle(error => error.StartsWith($"payload.{field}", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("breaking.text", "<script>alert(1)</script>")]
    [InlineData("breaking.text", "Bridge <b>closed</b>")]
    [InlineData("dateline.place", "<img src=x onerror=alert(1)>")]
    [InlineData("dateline.agency", "MD9>")]
    [InlineData("slugCode", "a<b")]
    public async Task MarkupInAnyString_IsRefused_NeverStripped(string field, string value)
    {
        var payload = WithField(field, value);
        var before = payload.ToJsonString();

        var result = await ValidateAsync(payload);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle(error => error.StartsWith($"payload.{field}", StringComparison.Ordinal) && error.Contains("markup"));
        payload.ToJsonString().Should().Be(before, "a refused payload is never repaired in place");
    }

    [Theory]
    [InlineData("Bridge\nclosed")]
    [InlineData("Bridge\u0000closed")]
    [InlineData("Bridge \u202Edesolc")]
    [InlineData("Bridge\u2028closed")]
    [InlineData("Bridge\u200Bclosed")]
    [InlineData("Bridge\uFEFFclosed")]
    [InlineData("Bridge\u200Fclosed")]
    [InlineData("Bridge\u061Cclosed")]
    public async Task ControlAndBidiCharacters_AreRefused(string value)
    {
        var result = await ValidateAsync(WithField("breaking.text", value));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle(error => error.StartsWith("payload.breaking.text", StringComparison.Ordinal));
    }

    [Fact]
    public async Task EveryProblem_IsReported_NotJustTheFirst()
    {
        var result = await ValidateAsync(Json("""{"x":1,"breaking":{"text":""},"storyType":"nope"}"""));

        result.Errors.Should().HaveCount(3);
    }

    [Fact]
    public void Projection_IsExactlyBreakingDatelineAndSlugCode_NeverStoryTypeOrUnknownKeys()
    {
        var stored = Json("""
            {
              "breaking": { "text": "Bridge closed", "staffNote": "x" },
              "dateline": { "place": "RIVERTON", "agency": "MD9" },
              "slugCode": "BRIDGE-0412",
              "storyType": "breaking_hard_news",
              "internalNote": "do not show"
            }
            """);

        var projected = _descriptor.ProjectPayload(stored);

        projected.Select(pair => pair.Key).Should().Equal("breaking", "dateline", "slugCode");
        projected.ToJsonString().Should().NotContain("storyType").And.NotContain("internalNote").And.NotContain("staffNote")
            .And.NotContain("breaking_hard_news");
        projected["dateline"]!["agency"]!.GetValue<string>().Should().Be("MD9");
    }

    [Fact]
    public void Projection_OfABreakingBannerWithAnUnknownKey_DropsTheBanner_NeverEchoesIt()
    {
        // Stored payloads are normalized on write, so this shape only arises from a direct DB edit: fail closed.
        var projected = _descriptor.ProjectPayload(Json("""{"breaking":{"text":"x","staffNote":"y"}}"""));

        projected["breaking"].Should().BeNull();
    }

    [Fact]
    public void Projection_OfAnEmptyOrUnreadablePayload_IsAllNulls()
    {
        _descriptor.ProjectPayload([]).ToJsonString().Should().Be("""{"breaking":null,"dateline":null,"slugCode":null}""");
        _descriptor.ProjectPayload(Json("""{"breaking":true,"dateline":"x","slugCode":3}""")).ToJsonString()
            .Should().Be("""{"breaking":null,"dateline":null,"slugCode":null}""");
    }

    [Fact]
    public void Projection_DoesNotAliasTheStoredPayload()
    {
        var stored = Json("""{"breaking":{"text":"Bridge closed"}}""");

        var projected = _descriptor.ProjectPayload(stored);
        projected["breaking"]!["text"] = "changed";

        stored["breaking"]!["text"]!.GetValue<string>().Should().Be("Bridge closed");
    }

    [Fact]
    public void AlertSuggestion_IsAnAdvisoryWithTheHeadlineVerbatim_OnlyWhenBreaking()
    {
        var breaking = Item("""{"breaking":{"text":"BREAKING"},"dateline":null}""", "Route 9 bridge closed: <i>officials</i> say");
        var quiet = Item("""{"breaking":null,"dateline":null}""");

        var suggestion = _descriptor.SuggestAlert(breaking);

        suggestion.Should().NotBeNull();
        suggestion!.Severity.Should().Be("advisory");
        suggestion.Headline.Should().Be(breaking.Headline, "the headline is used verbatim");
        suggestion.ExpiresScenarioTime.Should().BeNull();
        _descriptor.SuggestAlert(quiet).Should().BeNull("a non-breaking article suggests no alert");
        _descriptor.SuggestAlert(Item("not json")).Should().BeNull();
        _descriptor.SuggestAlert(Item("""{"breaking":{"text":"<b>x</b>"}}""")).Should().BeNull("an unreadable banner is no banner");
    }

    [Fact]
    public void DefaultAlertMapping_IsNull_SoAnItemBlindReaderNeverPreFillsAnAlert_AndSuggestAlertIsWhatTheInterfaceDispatches()
    {
        _descriptor.DefaultAlertMapping.Should().BeNull("only a breaking article suggests an alert, which the property cannot see");

        IContentKindDescriptor asInterface = _descriptor;
        asInterface.SuggestAlert(Item("""{"breaking":null}""")).Should().BeNull();
        asInterface.SuggestAlert(Item("""{"breaking":{"text":"x"}}"""))!.Severity
            .Should().Be("advisory", "the interface call reaches the article override");
    }

    private Task<PayloadValidationResult> ValidateAsync(JsonObject payload) =>
        _descriptor.ValidatePayloadAsync(payload, new PayloadValidationContext
        {
            ExerciseId = Guid.NewGuid(),
            Db = null!, // no hero in these writes, so the descriptor never reads the database
            Services = null!,
            TargetStatus = ChannelVocabulary.StatusDraft,
        });

    private static JsonObject Json(string json) => (JsonObject)JsonNode.Parse(json)!;

    private static JsonObject WithField(string field, string value)
    {
        var parts = field.Split('.');
        if (parts.Length == 1)
        {
            return new JsonObject { [parts[0]] = value };
        }

        var inner = new JsonObject { [parts[1]] = value };
        if (parts[0] == "dateline" && parts[1] != "place")
        {
            inner["place"] = "Riverton";
        }

        return new JsonObject { [parts[0]] = inner };
    }

    private static ContentItem Item(string payloadJson, string headline = "Route 9 bridge closed") => new()
    {
        ChannelId = "news",
        Kind = "article",
        Headline = headline,
        Slug = "route-9-bridge-closed",
        Status = "draft",
        Origin = "controller",
        ActingHumanId = "human-1",
        CreatedScenarioTime = DateTimeOffset.UnixEpoch,
        CreatedWallClock = DateTimeOffset.UnixEpoch,
        PayloadJson = payloadJson,
    };
}
