namespace Pulse.WebApi.Tests.Features.Weather.Kinds;

using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Weather.Contracts;
using Pulse.WebApi.Features.Weather.Kinds;

/// <summary>
/// Weather story 01 (#752): the <c>weather_product</c> descriptor's validator table (WX-010), zone existence, supersession
/// (always-Critical isolation: another exercise's product is never a valid target), normalization and the FC-7a delivery
/// seam. In-memory context under the central exercise filter; no Docker.
/// </summary>
public sealed class WeatherProductDescriptorTests : IDisposable
{
    private readonly WeatherKindHarness _harness = new();
    private readonly WeatherProductDescriptor _descriptor = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public void Descriptor_DeclaresTheKindChannelPlainPolicyAndImageVideoMedia()
    {
        _descriptor.Kind.Should().Be("weather_product");
        _descriptor.ChannelId.Should().Be("weather");
        _descriptor.BodyPolicy.Should().Be(ISanitizerProfileRegistry.Plain);
        _descriptor.AllowedMediaKinds.Should().BeEquivalentTo(["image", "video"]);
        _descriptor.AllowedMediaKinds.Should().NotContain("document");
        _descriptor.DefaultAlertMapping.Should().BeNull("the weather editor owns its delivery options (FC-8)");
    }

    [Fact]
    public async Task ValidWatch_IsAccepted()
    {
        var exercise = _harness.NewExercise();

        var result = await _descriptor.ValidatePayloadAsync(WeatherPayloads.Watch(), _harness.ValidationContext(exercise));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task ValidWarning_IsAccepted()
    {
        var exercise = _harness.NewExercise();

        var result = await _descriptor.ValidatePayloadAsync(WeatherPayloads.Warning(), _harness.ValidationContext(exercise));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task EveryHazardInTheClosedList_IsAccepted()
    {
        var exercise = _harness.NewExercise();
        foreach (var hazard in WeatherVocabulary.Hazards)
        {
            var payload = WeatherPayloads.Watch();
            payload["hazard"] = hazard;

            var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

            result.IsValid.Should().BeTrue("{0} is in the closed hazard list", hazard);
        }
    }

    public static TheoryData<string, string, string> InvalidFields() => new()
    {
        // (field, JSON value, expected error path)
        { "productType", "\"emergency\"", "payload.productType" },
        { "productType", "null", "payload.productType" },
        { "hazard", "\"meteor\"", "payload.hazard" },
        { "hazard", "\"Tornado\"", "payload.hazard" },
        { "action", "\"extend\"", "payload.action" },
        { "zoneSlugs", "[]", "payload.zoneSlugs" },
        { "zoneSlugs", "\"kestrel-county-north\"", "payload.zoneSlugs" },
        { "zoneSlugs", "[\"Kestrel County\"]", "payload.zoneSlugs[0]" },
        { "zoneSlugs", "[\"harbor-point\",\"harbor-point\"]", "payload.zoneSlugs[1]" },
        { "zoneSlugs", "[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\",\"i\",\"j\",\"k\",\"l\",\"m\"]", "payload.zoneSlugs" },
        { "effectiveScenarioTime", "\"2026-12-02T13:30:00\"", "payload.effectiveScenarioTime" },
        { "effectiveScenarioTime", "\"Dec 2 2026\"", "payload.effectiveScenarioTime" },
        { "expiresScenarioTime", "\"2026-12-02T13:30:00Z\"", "payload.expiresScenarioTime" },
        { "expiresScenarioTime", "\"2026-12-02T13:00:00Z\"", "payload.expiresScenarioTime" },
        { "expiresScenarioTime", "1700000000", "payload.expiresScenarioTime" },
        { "actions", "[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\",\"i\"]", "payload.actions" },
        { "actions", "[\"\"]", "payload.actions[0]" },
        { "actions", "[\"<b></b>\"]", "payload.actions[0]" },
        { "actions", "[3]", "payload.actions[0]" },
        { "supersedesContentId", "\"8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a03\"", "payload.supersedesContentId" },
        { "ibw", "\"tornado\"", "payload.ibw" },
        { "delivery", "\"yes\"", "payload.delivery" },
    };

    [Theory]
    [MemberData(nameof(InvalidFields))]
    public async Task InvalidField_FailsWithAFieldLevelError(string field, string json, string path)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Watch();
        payload[field] = JsonNode.Parse(json);

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

        result.IsValid.Should().BeFalse();
        result.Errors.Should().Contain(e => e.StartsWith(path + ":", StringComparison.Ordinal), string.Join("; ", result.Errors));
    }

    [Theory]
    [InlineData("productType")]
    [InlineData("hazard")]
    [InlineData("action")]
    [InlineData("zoneSlugs")]
    [InlineData("effectiveScenarioTime")]
    [InlineData("expiresScenarioTime")]
    public async Task MissingRequiredField_Fails(string field)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Watch();
        payload.Remove(field);

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

        result.Errors.Should().Contain($"payload.{field}: is required");
    }

    [Fact]
    public async Task Ibw_IsRequiredForAWarning_ButOptionalForWatchAndAdvisory()
    {
        var exercise = _harness.NewExercise();
        var warning = WeatherPayloads.Warning();
        warning.Remove("ibw");
        var advisory = WeatherPayloads.Watch();
        advisory["productType"] = "advisory";

        (await _descriptor.ValidatePayloadAsync(warning, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.ibw: is required for a warning");
        (await _descriptor.ValidatePayloadAsync(WeatherPayloads.Watch(), _harness.ValidationContext(exercise)))
            .IsValid.Should().BeTrue();
        (await _descriptor.ValidatePayloadAsync(advisory, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("what")]
    [InlineData("where")]
    [InlineData("when")]
    [InlineData("impacts")]
    public async Task IbwFields_AreEachRequiredAndCappedAt1000(string field)
    {
        var exercise = _harness.NewExercise();
        var missing = WeatherPayloads.Warning();
        missing["ibw"]!.AsObject().Remove(field);
        var tooLong = WeatherPayloads.Warning();
        tooLong["ibw"]![field] = new string('x', WeatherLimits.IbwFieldMaxLength + 1);
        var atCap = WeatherPayloads.Warning();
        atCap["ibw"]![field] = new string('x', WeatherLimits.IbwFieldMaxLength);

        (await _descriptor.ValidatePayloadAsync(missing, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain($"payload.ibw.{field}: is required");
        (await _descriptor.ValidatePayloadAsync(tooLong, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain($"payload.ibw.{field}: must be at most 1000 characters");
        (await _descriptor.ValidatePayloadAsync(atCap, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Actions_AreCappedAt300Each_AndMayBeEmpty()
    {
        var exercise = _harness.NewExercise();
        var tooLong = WeatherPayloads.Watch();
        tooLong["actions"] = new JsonArray(new string('x', WeatherLimits.ActionMaxLength + 1));
        var none = WeatherPayloads.Watch();
        none["actions"] = new JsonArray();

        (await _descriptor.ValidatePayloadAsync(tooLong, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.actions[0]: must be at most 300 characters");
        (await _descriptor.ValidatePayloadAsync(none, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
    }

    // ---- delivery ---------------------------------------------------------------------------------

    [Fact]
    public async Task AWarningCannotSwitchItsAlertOff_ButItsCancelAndAWatchCan()
    {
        var exercise = _harness.NewExercise();
        var target = await _harness.SeedAsync(exercise, "weather_product", "published", WeatherPayloads.Warning());
        var warning = WeatherPayloads.Warning();
        warning["delivery"]!["raiseAlert"] = false;
        var cancel = WeatherPayloads.Warning("cancel", target.Id);
        cancel["delivery"]!["raiseAlert"] = false;
        var watch = WeatherPayloads.Watch();
        watch["delivery"]!["raiseAlert"] = false;

        (await _descriptor.ValidatePayloadAsync(warning, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.delivery.raiseAlert: a warning always raises its alert");
        (await _descriptor.ValidatePayloadAsync(cancel, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
        (await _descriptor.ValidatePayloadAsync(watch, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task AbsentDelivery_NormalizesToAlertOnAndNoPost()
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Watch();
        payload.Remove("delivery");

        (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        payload["delivery"]!.ToJsonString().Should().Be("""{"raiseAlert":true,"post":{"enabled":false,"text":null}}""");
    }

    [Fact]
    public async Task PostText_IsCappedAt280CodePoints()
    {
        var exercise = _harness.NewExercise();
        var atCap = WeatherPayloads.Watch();
        atCap["delivery"]!["post"]!["text"] = string.Concat(Enumerable.Repeat("🌪", 280)); // 280 code points, 560 UTF-16 units
        var over = WeatherPayloads.Watch();
        over["delivery"]!["post"]!["text"] = new string('x', 281);

        (await _descriptor.ValidatePayloadAsync(atCap, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
        (await _descriptor.ValidatePayloadAsync(over, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.delivery.post.text: must be at most 280 characters");
    }

    // ---- zones ------------------------------------------------------------------------------------

    [Fact]
    public async Task UnknownZone_FailsWithAFieldLevelError()
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Watch();
        payload["zoneSlugs"] = new JsonArray("kestrel-county-north", "nowhere");

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

        result.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[1]: unknown_zone 'nowhere'");
    }

    [Fact]
    public async Task AZoneOfAnotherExercise_IsUnknownHere()
    {
        var exerciseA = _harness.NewExercise("alder-ridge");
        _harness.NewExercise("kestrel-county-north");
        var payload = WeatherPayloads.Watch();
        payload["zoneSlugs"] = new JsonArray("kestrel-county-north");

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exerciseA));

        result.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[0]: unknown_zone");
    }

    [Fact]
    public async Task AnExerciseWithNoZones_FailsWithNoZones()
    {
        var exercise = _harness.NewExercise();
        _harness.Catalog(exercise).Live.Clear();

        var result = await _descriptor.ValidatePayloadAsync(WeatherPayloads.Watch(), _harness.ValidationContext(exercise));

        result.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[0]: no_zones");
    }

    [Fact]
    public async Task NoCatalogRegistered_FailsClosed()
    {
        var exercise = _harness.NewExercise();

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Watch(), _harness.ValidationContext(exercise, withCatalog: false));

        result.Errors.Should().ContainSingle().Which.Should().Contain("zone_catalog_unavailable");
    }

    [Fact]
    public async Task AZoneSoftDeletedAfterPublish_NeverInvalidatesThePublishedItem()
    {
        var exercise = _harness.NewExercise();
        var published = await _harness.SeedAsync(exercise, "weather_product", "published", WeatherPayloads.Watch());
        _harness.Catalog(exercise).Live.Remove("kestrel-county-south");

        // A revise of the published item keeps its zones.
        var revise = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Watch(), _harness.ValidationContext(exercise, published.Id));
        // A NEW item cannot use the deleted zone.
        var create = await _descriptor.ValidatePayloadAsync(WeatherPayloads.Watch(), _harness.ValidationContext(exercise));

        revise.IsValid.Should().BeTrue(string.Join("; ", revise.Errors));
        create.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[1]: unknown_zone");
    }

    [Fact]
    public async Task ANeverPublishedDraft_GetsNoGrandfathering_ForADeletedZone()
    {
        var exercise = _harness.NewExercise();
        var draft = await _harness.SeedAsync(exercise, "weather_product", "draft", WeatherPayloads.Watch());
        _harness.Catalog(exercise).Live.Remove("kestrel-county-south");

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Watch(), _harness.ValidationContext(exercise, draft.Id));

        result.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlugs[1]: unknown_zone");
    }

    // ---- supersession (isolation is always Critical) ---------------------------------------------

    [Theory]
    [InlineData("update")]
    [InlineData("upgrade")]
    [InlineData("cancel")]
    public async Task SupersedingActions_RequireSupersedesContentId(string action)
    {
        var exercise = _harness.NewExercise();

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Warning(action), _harness.ValidationContext(exercise));

        result.Errors.Should().Contain($"payload.supersedesContentId: is required for action '{action}'");
    }

    [Fact]
    public async Task Upgrade_OfAPublishedProduct_IsAccepted_AndStampsItsPermalink()
    {
        var exercise = _harness.NewExercise();
        var watch = await _harness.SeedAsync(exercise, "weather_product", "published", WeatherPayloads.Watch());
        var upgrade = WeatherPayloads.Warning("upgrade", watch.Id);
        upgrade["supersedesPermalink"] = "https://evil.test/spoofed";

        var result = await _descriptor.ValidatePayloadAsync(upgrade, _harness.ValidationContext(exercise));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
        upgrade["supersedesPermalink"]!.GetValue<string>().Should().Be(
            "/weather/weather-desk/tornado-watch-1", "the server derives the link; a client-sent one is ignored");
        upgrade["supersedesContentId"]!.GetValue<string>().Should().Be(watch.Id.ToString());
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("scheduled")]
    [InlineData("retracted")]
    public async Task Supersedes_AnUnpublishedProduct_Fails(string status)
    {
        var exercise = _harness.NewExercise();
        var target = await _harness.SeedAsync(exercise, "weather_product", status, WeatherPayloads.Watch());

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Warning("upgrade", target.Id), _harness.ValidationContext(exercise));

        result.Errors.Should().Contain("payload.supersedesContentId: must name a published weather product in this exercise");
    }

    [Fact]
    public async Task Supersedes_AForecast_Fails()
    {
        var exercise = _harness.NewExercise();
        var forecast = await _harness.SeedAsync(exercise, "forecast", "published", WeatherPayloads.Forecast());

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Warning("update", forecast.Id), _harness.ValidationContext(exercise));

        result.Errors.Should().Contain("payload.supersedesContentId: must name a published weather product in this exercise");
    }

    [Fact]
    public async Task Supersedes_AnotherExercisesPublishedProduct_Fails_AndLeaksNoPermalink()
    {
        var exerciseA = _harness.NewExercise();
        var exerciseB = _harness.NewExercise();
        var productOfB = await _harness.SeedAsync(exerciseB, "weather_product", "published", WeatherPayloads.Watch());
        var payload = WeatherPayloads.Warning("upgrade", productOfB.Id);

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exerciseA));

        result.Errors.Should().ContainSingle().Which.Should().Be(
            "payload.supersedesContentId: must name a published weather product in this exercise",
            "another exercise's product is indistinguishable from an unknown id (COR-001)");
        payload.ContainsKey("supersedesPermalink").Should().BeFalse("a failed write is not normalized");
    }

    [Fact]
    public async Task ADraftUpgrade_WhoseTargetWasRetractedBeforePublish_Fails()
    {
        var exercise = _harness.NewExercise();
        var target = await _harness.SeedAsync(exercise, "weather_product", "retracted", WeatherPayloads.Watch());
        var stored = WeatherPayloads.Warning("upgrade", target.Id);
        stored["supersedesPermalink"] = "/weather/weather-desk/tornado-watch-1";
        var draft = await _harness.SeedAsync(exercise, "weather_product", "draft", stored, "tornado-warning-1");

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Warning("upgrade", target.Id), _harness.ValidationContext(exercise, draft.Id));

        result.Errors.Should().Contain("payload.supersedesContentId: must name a published weather product in this exercise");
    }

    [Fact]
    public async Task AProductCannotSupersedeItself()
    {
        var exercise = _harness.NewExercise();
        var self = await _harness.SeedAsync(exercise, "weather_product", "published", WeatherPayloads.Warning());

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Warning("update", self.Id), _harness.ValidationContext(exercise, self.Id));

        result.Errors.Should().Contain("payload.supersedesContentId: a product cannot supersede itself");
    }

    [Fact]
    public async Task ARevise_KeepsItsSupersessionLink_WhenTheTargetWasRetractedSince()
    {
        var exercise = _harness.NewExercise();
        var target = await _harness.SeedAsync(exercise, "weather_product", "retracted", WeatherPayloads.Watch());
        var stored = WeatherPayloads.Warning("upgrade", target.Id);
        stored["supersedesPermalink"] = "/weather/weather-desk/tornado-watch-1";
        var upgrade = await _harness.SeedAsync(exercise, "weather_product", "published", stored, "tornado-warning-1");
        var revise = WeatherPayloads.Warning("upgrade", target.Id);

        var result = await _descriptor.ValidatePayloadAsync(revise, _harness.ValidationContext(exercise, upgrade.Id));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
        revise["supersedesPermalink"]!.GetValue<string>().Should().Be("/weather/weather-desk/tornado-watch-1");
    }

    // ---- normalization ---------------------------------------------------------------------------

    [Fact]
    public async Task AValidPayload_IsNormalizedInPlace_UnknownKeysDropped_StringsCleaned()
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Warning();
        payload["planningNote"] = "Fire at 14:20 sharp";
        payload["severity"] = "emergency";
        payload["ibw"]!["what"] = "  <b>Radar-indicated</b> tornado.\u0007 ";

        (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        payload.Select(p => p.Key).Should().BeEquivalentTo(
            "productType", "hazard", "action", "supersedesContentId", "supersedesPermalink", "zoneSlugs",
            "effectiveScenarioTime", "expiresScenarioTime", "ibw", "actions", "delivery");
        payload["ibw"]!["what"]!.GetValue<string>().Should().Be("Radar-indicated tornado.");
    }

    [Fact]
    public async Task AnInvalidPayload_IsLeftUntouched()
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Watch();
        payload["hazard"] = "meteor";
        var before = payload.ToJsonString();

        (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise))).IsValid.Should().BeFalse();

        payload.ToJsonString().Should().Be(before);
    }

    // ---- ResolvePublishOptions (FC-7a step 3) ----------------------------------------------------

    [Fact]
    public void ResolvePublishOptions_WithNoPlanner_IsNull_NeverAGuessedSeverity()
    {
        _descriptor.ResolvePublishOptions(Item(WeatherPayloads.Warning())).Should().BeNull();
    }

    [Fact]
    public void ResolvePublishOptions_HandsTheStoredDeliveryBlockToThePlanner()
    {
        var planner = new RecordingPlanner();
        var descriptor = new WeatherProductDescriptor(planner);
        var item = Item(WeatherPayloads.Warning());

        var options = descriptor.ResolvePublishOptions(item);

        options.Should().BeSameAs(RecordingPlanner.Options);
        planner.Item.Should().BeSameAs(item);
        planner.Payload!.Delivery.Should().Be(new WeatherDelivery
        {
            RaiseAlert = true, Post = new WeatherDeliveryPost { Enabled = true, Text = "Take shelter now." },
        });
        planner.Payload.ProductType.Should().Be("warning");
        planner.Payload.ExpiresScenarioTime.Should().Be("2026-12-02T15:15:00-00:00");
    }

    [Fact]
    public void ResolvePublishOptions_ForAnUnreadablePayloadOrAnotherKind_IsNull()
    {
        var descriptor = new WeatherProductDescriptor(new RecordingPlanner());
        var broken = Item(WeatherPayloads.Warning());
        broken.PayloadJson = "not json";
        var forecast = Item(WeatherPayloads.Forecast());
        forecast.Kind = "forecast";

        descriptor.ResolvePublishOptions(broken).Should().BeNull();
        descriptor.ResolvePublishOptions(forecast).Should().BeNull();
    }

    private static ContentItem Item(JsonObject payload) => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        ChannelId = "weather",
        Kind = "weather_product",
        Slug = "tornado-warning-1",
        Status = "scheduled",
        Headline = "Tornado Warning for northern Kestrel County",
        PayloadJson = payload.ToJsonString(),
        CreatedScenarioTime = DateTimeOffset.Parse("2026-12-02T14:00:00Z", System.Globalization.CultureInfo.InvariantCulture),
        CreatedWallClock = DateTimeOffset.UtcNow,
        Origin = "controller",
        ActingHumanId = "human-1",
    };

    private sealed class RecordingPlanner : IWeatherDeliveryPlanner
    {
        public static readonly PublishOptions Options = new() { Alert = new PublishAlertOptions { Severity = "emergency" } };

        public ContentItem? Item { get; private set; }

        public WeatherProductPayload? Payload { get; private set; }

        public PublishOptions? Plan(ContentItem item, WeatherProductPayload payload)
        {
            Item = item;
            Payload = payload;
            return Options;
        }
    }
}
