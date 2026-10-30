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

/// <summary>Weather story 01 (#752): the <c>forecast</c> descriptor's validator table (WX-001/003) and zone rules.</summary>
public sealed class ForecastDescriptorTests : IDisposable
{
    private readonly WeatherKindHarness _harness = new();
    private readonly ForecastDescriptor _descriptor = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public void Descriptor_DeclaresTheKindChannelPlainPolicyAndNoDelivery()
    {
        _descriptor.Kind.Should().Be("forecast");
        _descriptor.ChannelId.Should().Be("weather");
        _descriptor.BodyPolicy.Should().Be(ISanitizerProfileRegistry.Plain);
        _descriptor.AllowedMediaKinds.Should().BeEquivalentTo(["image", "video"]);
        _descriptor.DefaultAlertMapping.Should().BeNull();
        ((IContentKindDescriptor)_descriptor).ResolvePublishOptions(new ContentItem
        {
            ChannelId = "weather", Kind = "forecast", Slug = "f", Status = "draft", Headline = "h",
            CreatedScenarioTime = DateTimeOffset.UnixEpoch, CreatedWallClock = DateTimeOffset.UnixEpoch, Origin = "controller",
            ActingHumanId = "human-1",
        }).Should().BeNull("a forecast raises no alert and makes no post");
    }

    [Fact]
    public async Task ValidForecast_IsAccepted_SingleTemperaturesAndHiLoPairs()
    {
        var exercise = _harness.NewExercise();

        var result = await _descriptor.ValidatePayloadAsync(WeatherPayloads.Forecast(), _harness.ValidationContext(exercise));

        result.IsValid.Should().BeTrue(string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task EveryConditionCode_IsAccepted()
    {
        var exercise = _harness.NewExercise();
        foreach (var code in WeatherVocabulary.ConditionCodes)
        {
            var payload = WeatherPayloads.Forecast();
            payload["current"]!["conditionCode"] = code;

            (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise)))
                .IsValid.Should().BeTrue("{0} is in the icon vocabulary", code);
        }
    }

    public static TheoryData<string, string, string> InvalidCurrent() => new()
    {
        { "tempF", "200", "payload.current.tempF" },
        { "tempF", "70.5", "payload.current.tempF" },
        { "tempF", "\"70\"", "payload.current.tempF" },
        { "conditionCode", "\"drizzle\"", "payload.current.conditionCode" },
        { "windMph", "-1", "payload.current.windMph" },
        { "humidityPct", "101", "payload.current.humidityPct" },
        { "windDir", "\"\"", "payload.current.windDir" },
        { "condition", "null", "payload.current.condition" },
        { "observedScenarioTime", "\"yesterday\"", "payload.current.observedScenarioTime" },
    };

    [Theory]
    [MemberData(nameof(InvalidCurrent))]
    public async Task InvalidCurrentField_Fails(string field, string json, string path)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Forecast();
        payload["current"]![field] = JsonNode.Parse(json);

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

        result.Errors.Should().Contain(e => e.StartsWith(path + ":", StringComparison.Ordinal), string.Join("; ", result.Errors));
    }

    public static TheoryData<string, string, string> InvalidPeriod() => new()
    {
        { "conditionCode", "\"tornado\"", "payload.periods[0].conditionCode" },
        { "precipPct", "101", "payload.periods[0].precipPct" },
        { "label", "\"\"", "payload.periods[0].label" },
        { "detail", "null", "payload.periods[0].detail" },
        { "windText", "5", "payload.periods[0].windText" },
        { "hiF", "80", "payload.periods[0].tempF" },
    };

    [Theory]
    [MemberData(nameof(InvalidPeriod))]
    public async Task InvalidPeriodField_Fails(string field, string json, string path)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Forecast();
        payload["periods"]![0]![field] = JsonNode.Parse(json);

        var result = await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise));

        result.Errors.Should().Contain(e => e.StartsWith(path + ":", StringComparison.Ordinal), string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task APeriod_NeedsExactlyOneTemperatureForm_AndHiNotBelowLo()
    {
        var exercise = _harness.NewExercise();
        var loneHi = WeatherPayloads.Forecast();
        loneHi["periods"]![1]!.AsObject().Remove("loF");
        var none = WeatherPayloads.Forecast();
        none["periods"]![0]!.AsObject().Remove("tempF");
        var inverted = WeatherPayloads.Forecast();
        inverted["periods"]![1]!["hiF"] = 30;

        (await _descriptor.ValidatePayloadAsync(loneHi, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.periods[1].tempF: give either tempF or both hiF and loF");
        (await _descriptor.ValidatePayloadAsync(none, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.periods[0].tempF: give either tempF or both hiF and loF");
        (await _descriptor.ValidatePayloadAsync(inverted, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.periods[1].hiF: must not be below loF");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(15)]
    public async Task Periods_MustNumber1To14(int count)
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Forecast();
        var period = payload["periods"]![0]!;
        payload["periods"] = new JsonArray([.. Enumerable.Range(0, count).Select(_ => period.DeepClone())]);

        (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise)))
            .Errors.Should().Contain("payload.periods: must have 1 to 14 entries");
    }

    [Fact]
    public async Task DiscussionAndUncertaintyNote_ArePlainTextAndCapped()
    {
        var exercise = _harness.NewExercise();
        var tooLong = WeatherPayloads.Forecast();
        tooLong["discussion"] = new string('x', WeatherLimits.DiscussionMaxLength + 1);
        tooLong["uncertaintyNote"] = new string('x', WeatherLimits.UncertaintyNoteMaxLength + 1);
        var marked = WeatherPayloads.Forecast();
        marked["discussion"] = "Line one.\r\n<script>alert(1)</script>Line two.";

        var rejected = await _descriptor.ValidatePayloadAsync(tooLong, _harness.ValidationContext(exercise));
        (await _descriptor.ValidatePayloadAsync(marked, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();

        rejected.Errors.Should().Contain("payload.discussion: must be at most 4000 characters");
        rejected.Errors.Should().Contain("payload.uncertaintyNote: must be at most 1000 characters");
        marked["discussion"]!.GetValue<string>().Should().Be("Line one.\nLine two.");
    }

    [Fact]
    public async Task ALaterForecastForTheSameZone_MayDiffer_WX003()
    {
        var exercise = _harness.NewExercise();
        await _harness.SeedAsync(exercise, "forecast", "published", WeatherPayloads.Forecast(), "forecast-north-am");
        var later = WeatherPayloads.Forecast();
        later["current"]!["tempF"] = 41;
        later["current"]!["conditionCode"] = "snow";
        later["uncertaintyNote"] = "Snow totals depend on the track.";

        (await _descriptor.ValidatePayloadAsync(later, _harness.ValidationContext(exercise))).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task UnknownZone_FailsWithAFieldLevelError()
    {
        var exercise = _harness.NewExercise();
        var payload = WeatherPayloads.Forecast();
        payload["zoneSlug"] = "nowhere";

        (await _descriptor.ValidatePayloadAsync(payload, _harness.ValidationContext(exercise)))
            .Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlug: unknown_zone 'nowhere'");
    }

    [Fact]
    public async Task AZoneSoftDeletedAfterPublish_NeverInvalidatesThePublishedForecast()
    {
        var exercise = _harness.NewExercise();
        var published = await _harness.SeedAsync(exercise, "forecast", "published", WeatherPayloads.Forecast(), "forecast-north-am");
        _harness.Catalog(exercise).Live.Remove("kestrel-county-north");

        (await _descriptor.ValidatePayloadAsync(WeatherPayloads.Forecast(), _harness.ValidationContext(exercise, published.Id)))
            .IsValid.Should().BeTrue();
        (await _descriptor.ValidatePayloadAsync(WeatherPayloads.Forecast(), _harness.ValidationContext(exercise)))
            .IsValid.Should().BeFalse();
    }

    [Fact]
    public async Task AnotherExercisesForecastId_GrandfathersNothing()
    {
        // Isolation (always Critical): passing exercise B's item id as the item being edited in A must not let A use a zone
        // only B's stored payload names.
        var exerciseA = _harness.NewExercise("alder-ridge");
        var exerciseB = _harness.NewExercise();
        var forecastOfB = await _harness.SeedAsync(exerciseB, "forecast", "published", WeatherPayloads.Forecast());

        var result = await _descriptor.ValidatePayloadAsync(
            WeatherPayloads.Forecast(), _harness.ValidationContext(exerciseA, forecastOfB.Id));

        result.Errors.Should().ContainSingle().Which.Should().StartWith("payload.zoneSlug: unknown_zone");
    }
}
