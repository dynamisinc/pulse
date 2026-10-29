namespace Pulse.WebApi.Tests.Features.Weather.Kinds;

using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Features.Weather.Kinds;

/// <summary>
/// Weather story 01 (#752): the plain-text corpus (NFR-004) — every payload string comes back inert through both the write
/// normalization and the participant projection — and the projection leak test (XC-002): the projection carries the
/// structured fields only, never <c>delivery</c>, <c>supersedesContentId</c>, a planning note or any unknown key.
/// </summary>
public sealed partial class WeatherSanitizerAndProjectionTests : IDisposable
{
    private readonly WeatherKindHarness _harness = new();
    private readonly WeatherProductDescriptor _products = new();
    private readonly ForecastDescriptor _forecasts = new();

    public void Dispose() => _harness.Dispose();

    public static TheoryData<string> Corpus() =>
    [
        "<script>alert(1)</script>Take shelter.",
        "<SCRIPT SRC=//evil.test/x.js></SCRIPT>Take shelter.",
        "<img src=x onerror=alert(1)>Take shelter.",
        "<<b>img src=x onerror=alert(1)>Take shelter.",
        "<svg/onload=alert(1)>Take shelter.",
        "<a href=\"javascript:alert(1)\">Take shelter.</a>",
        "<style>body{display:none}</style>Take shelter.",
        "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>Take shelter.",
        "Take\u0000 shelter.\u001b[31m‮",
        // A control or bidi character INSIDE a tag must not let the tag survive and then collapse into a live one.
        "<\u0001script>alert(1)</script>Take shelter.",
        "<‮script>alert(1)</script>Take shelter.",
        "<\u0000img src=x onerror=alert(1)>Take shelter.",
        "<\tscript>alert(1)</script>Take shelter.",
    ];

    [Theory]
    [MemberData(nameof(Corpus))]
    public void Clean_IsIdempotent_OnTheCorpus(string attack)
    {
        foreach (var multiline in new[] { true, false })
        {
            var once = WeatherPlainText.Clean(attack, multiline);

            WeatherPlainText.Clean(once, multiline).Should().Be(once);
            CompleteTag().IsMatch(once).Should().BeFalse(once);
        }
    }

    [Fact]
    public void AStoredWarningWithItsAlertOff_StillProjects()
    {
        // Write-only rules never blank a stored product: projection reads the participant-visible shape.
        var stored = WeatherPayloads.Warning();
        stored["delivery"]!["raiseAlert"] = false;
        stored.Remove("supersedesContentId");
        stored["action"] = "update";

        _products.ProjectPayload(stored).Should().NotBeEmpty();
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public async Task EveryProductString_IsStoredAndProjectedAsInertText(string attack)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Warning();
        payload["ibw"]!["what"] = attack;
        payload["ibw"]!["where"] = attack;
        payload["ibw"]!["when"] = attack;
        payload["ibw"]!["impacts"] = attack;
        payload["actions"] = new JsonArray(attack);
        payload["delivery"]!["post"]!["text"] = attack;

        (await _products.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        AssertInert(payload);
        AssertInert(_products.ProjectPayload(payload));
        // A raw store (a funnel that did not persist the normalized object) still projects inert (defense in depth).
        var raw = WeatherPayloads.Warning();
        raw["ibw"]!["what"] = attack;
        raw["actions"] = new JsonArray(attack);
        AssertInert(_products.ProjectPayload(raw));
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public async Task EveryForecastString_IsStoredAndProjectedAsInertText(string attack)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Forecast();
        payload["current"]!["condition"] = attack;
        payload["periods"]![0]!["label"] = attack;
        payload["periods"]![0]!["condition"] = attack;
        payload["periods"]![0]!["windText"] = attack;
        payload["periods"]![0]!["detail"] = attack;
        payload["discussion"] = attack;
        payload["uncertaintyNote"] = attack;

        (await _forecasts.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        AssertInert(payload);
        AssertInert(_forecasts.ProjectPayload(payload));
    }

    [Fact]
    public void Clean_KeepsTheAuthorsLiteralCharacters_AndIsIdempotent()
    {
        const string text = "Winds 5 < 10 mph & gusts > 40 \"or more\" — don't drive.";

        WeatherPlainText.Clean(text, multiline: false).Should().Be(text, "strip, never entity-encode");
        WeatherPlainText.Clean(WeatherPlainText.Clean(text, multiline: true), multiline: true)
            .Should().Be(WeatherPlainText.Clean(text, multiline: true));
        WeatherPlainText.Clean("a\r\nb\rc\td", multiline: true).Should().Be("a\nb\nc d");
        WeatherPlainText.Clean("a\r\nb\rc\td", multiline: false).Should().Be("a b c d");
    }

    // ---- projection (XC-002) ---------------------------------------------------------------------

    [Fact]
    public async Task ProductProjection_CarriesTheStructuredFields_AndNeverDeliveryOrIds()
    {
        var exercise = _harness.NewExercise();
        var watch = await _harness.SeedAsync(exercise, "weather_product", "published", WeatherPayloads.Watch());
        var payload = WeatherPayloads.Warning("upgrade", watch.Id);
        payload["planningNote"] = "Controller: fire this at 14:20";
        payload["internal"] = new JsonObject { ["actingHumanId"] = "human-1" };
        (await _products.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        var projection = _products.ProjectPayload(payload);

        projection.Select(p => p.Key).Should().BeEquivalentTo(
            "productType", "hazard", "action", "supersedesPermalink", "zoneSlugs", "effectiveScenarioTime",
            "expiresScenarioTime", "ibw", "actions");
        projection["supersedesPermalink"]!.GetValue<string>().Should().Be("/weather/weather-desk/tornado-watch-1");
        var text = projection.ToJsonString();
        text.Should().NotContain("delivery").And.NotContain("raiseAlert").And.NotContain("supersedesContentId")
            .And.NotContain(watch.Id.ToString()).And.NotContain("planningNote").And.NotContain("human-1");
    }

    [Fact]
    public void ProductProjection_OfAStoredPayloadWithUnknownKeys_DropsThem()
    {
        // Straight from the store (no write normalization): unknown and staff-only keys are dropped, not echoed.
        var stored = WeatherPayloads.Watch();
        stored["planningNote"] = "do not show";
        stored["severity"] = "emergency";

        var projection = _products.ProjectPayload(stored);

        projection.ContainsKey("planningNote").Should().BeFalse();
        projection.ContainsKey("severity").Should().BeFalse();
        projection.ContainsKey("delivery").Should().BeFalse();
        projection["ibw"].Should().BeNull("an absent IBW is written as null so every key is present");
        projection.ContainsKey("ibw").Should().BeTrue();
    }

    [Fact]
    public void ProductProjection_DropsAStoredSupersedesPermalinkThatIsNotHostRelative()
    {
        var stored = WeatherPayloads.Warning("update", Guid.NewGuid());
        stored["supersedesPermalink"] = "https://evil.test/x";

        _products.ProjectPayload(stored)["supersedesPermalink"].Should().BeNull();
    }

    [Fact]
    public void ProductProjection_OfAnUnreadablePayload_IsEmpty_SoTheClientFailsClosed()
    {
        var stored = WeatherPayloads.Watch();
        stored["hazard"] = "meteor";

        _products.ProjectPayload(stored).Should().BeEmpty();
        _forecasts.ProjectPayload(new JsonObject { ["zoneSlug"] = "x" }).Should().BeEmpty();
    }

    [Fact]
    public void ForecastProjection_IsTheNormalizedForecast_UnknownKeysDropped()
    {
        var stored = WeatherPayloads.Forecast();
        stored["planningNote"] = "do not show";
        stored["periods"]![0]!["secret"] = "x";

        var projection = _forecasts.ProjectPayload(stored);

        projection.Select(p => p.Key).Should().BeEquivalentTo("zoneSlug", "current", "periods", "discussion", "uncertaintyNote");
        projection["periods"]![0]!.AsObject().Select(p => p.Key).Should().BeEquivalentTo(
            "label", "tempF", "hiF", "loF", "condition", "conditionCode", "precipPct", "windText", "detail");
        projection.ToJsonString().Should().NotContain("planningNote").And.NotContain("secret");
    }

    private static void AssertInert(JsonObject payload)
    {
        foreach (var value in Strings(payload))
        {
            CompleteTag().IsMatch(value).Should().BeFalse("no complete tag survives: {0}", value);
            value.Should().NotContainAny(["<script", "<SCRIPT", "alert(1)</", "\u0000", "\u001b", "‮"]);
            value.Any(char.IsControl).Should().BeFalse("control characters are removed: {0}", value);
        }
    }

    private static string[] Strings(JsonNode? node) => node switch
    {
        JsonObject o => [.. o.SelectMany(p => Strings(p.Value))],
        JsonArray a => [.. a.SelectMany(Strings)],
        JsonValue v when v.TryGetValue<string>(out var s) => [s],
        _ => [],
    };

    [GeneratedRegex("</?[a-zA-Z][^>]*>")]
    private static partial Regex CompleteTag();
}
