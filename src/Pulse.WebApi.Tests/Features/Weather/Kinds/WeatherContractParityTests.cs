namespace Pulse.WebApi.Tests.Features.Weather.Kinds;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// Weather story 01 (#752): the C# half of the weather C#↔TS parity check. The golden file
/// <c>src/frontend/src/features/weather/contract/weatherContract.json</c> is read by this suite and by
/// <c>weatherContract.test.ts</c>, so <see cref="WeatherVocabulary"/>, <see cref="WeatherLimits"/>, the payload records and
/// <see cref="WeatherProductStates"/> can only agree with the TS vocabulary, types and <c>productState</c> through it. Key sets
/// are read off a REAL serialization of a fully-populated instance, so a <c>[JsonPropertyName]</c> typo fails here.
/// </summary>
public class WeatherContractParityTests
{
    private static readonly Lazy<JsonObject> Golden = new(() =>
        (JsonNode.Parse(File.ReadAllText(Path.Combine(
            FindRepositoryRoot(), "src", "frontend", "src", "features", "weather", "contract", "weatherContract.json")))
            ?? throw new InvalidOperationException("weatherContract.json is empty.")).AsObject());

    private static readonly IReadOnlyDictionary<string, object> Samples = BuildSamples();

    public static TheoryData<string, string[]> VocabularyLists() => new()
    {
        { "productTypes", [.. WeatherVocabulary.ProductTypes] },
        { "hazards", [.. WeatherVocabulary.Hazards] },
        { "productActions", [.. WeatherVocabulary.ProductActions] },
        { "supersedingActions", [.. WeatherVocabulary.SupersedingActions] },
        { "conditionCodes", [.. WeatherVocabulary.ConditionCodes] },
        { "productStates", [.. WeatherVocabulary.ProductStates] },
    };

    [Theory]
    [MemberData(nameof(VocabularyLists))]
    public void Vocabulary_EqualsTheGoldenList_InOrder(string name, string[] values)
    {
        values.Should().Equal(GoldenStrings(Golden.Value["vocabulary"]![name]));
    }

    [Fact]
    public void Limits_EqualTheGoldenLimits()
    {
        var constants = typeof(WeatherLimits)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral)
            .ToDictionary(f => JsonNamingPolicy.CamelCase.ConvertName(f.Name), f => (int)f.GetRawConstantValue()!);
        var golden = Golden.Value["limits"]!.AsObject().ToDictionary(p => p.Key, p => p.Value!.GetValue<int>());

        constants.Should().BeEquivalentTo(golden);
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
        SerializedKeys(Samples[shape]).Should().BeEquivalentTo(GoldenStrings(Golden.Value["shapes"]![shape]));
    }

    [Theory]
    [MemberData(nameof(ParticipantShapeNames))]
    public void ParticipantShapes_CarryNoStaffOnlyKey(string shape)
    {
        var excluded = GoldenStrings(Golden.Value["participantExcludedKeys"]);

        SerializedKeys(Samples[shape]).Should().NotContain(excluded, "{0} is participant-visible (XC-002)", shape);
    }

    [Fact]
    public void ProductStates_RunTheGoldenCases()
    {
        foreach (var node in Golden.Value["productStateCases"]!.AsArray())
        {
            var c = node!.AsObject();
            var state = WeatherProductStates.Compute(
                Instant(c["effective"]), Instant(c["expires"]), Instant(c["now"]), c["cancelled"]!.GetValue<bool>());

            state.Should().Be(c["expected"]!.GetValue<string>(), c["name"]!.GetValue<string>());
        }
    }

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

    private static DateTimeOffset Instant(JsonNode? node) =>
        DateTimeOffset.Parse(node!.GetValue<string>(), CultureInfo.InvariantCulture);

    private static string[] GoldenStrings(JsonNode? node) => [.. node!.AsArray().Select(n => n!.GetValue<string>())];

    private static List<string> SerializedKeys(object value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, value.GetType()));
        return [.. document.RootElement.EnumerateObject().Select(p => p.Name)];
    }

    /// <summary>One fully-populated instance per pinned shape, keyed by the golden-file name.</summary>
    private static Dictionary<string, object> BuildSamples()
    {
        var ibw = new WeatherIbw { What = "w", Where = "w", When = "w", Impacts = "i" };
        var post = new WeatherDeliveryPost { Enabled = true, Text = "t" };
        var delivery = new WeatherDelivery { RaiseAlert = true, Post = post };
        var current = new ForecastCurrent
        {
            TempF = 68, Condition = "c", ConditionCode = "clear", WindMph = 1, WindDir = "S", HumidityPct = 50,
            ObservedScenarioTime = "2026-12-02T10:55:00Z",
        };
        var period = new ForecastPeriod
        {
            Label = "l", TempF = 1, HiF = null, LoF = null, Condition = "c", ConditionCode = "clear", PrecipPct = 0,
            WindText = "w", Detail = "d",
        };

        return new Dictionary<string, object>
        {
            ["WeatherProductProjection"] = new WeatherProductProjection
            {
                ProductType = "warning", Hazard = "tornado", Action = "upgrade", SupersedesPermalink = "/weather/w/x",
                ZoneSlugs = ["z"], EffectiveScenarioTime = "2026-12-02T14:20:00Z", ExpiresScenarioTime = "2026-12-02T15:15:00Z",
                Ibw = ibw, Actions = ["a"],
            },
            ["WeatherIbw"] = ibw,
            ["ForecastPayload"] = new ForecastPayload
            {
                ZoneSlug = "z", Current = current, Periods = [period], Discussion = "d", UncertaintyNote = "u",
            },
            ["ForecastCurrent"] = current,
            ["ForecastPeriod"] = period,
            ["WeatherProductPayload"] = new WeatherProductPayload
            {
                ProductType = "warning", Hazard = "tornado", Action = "upgrade", SupersedesContentId = Guid.NewGuid(),
                SupersedesPermalink = "/weather/w/x", ZoneSlugs = ["z"], EffectiveScenarioTime = "2026-12-02T14:20:00Z",
                ExpiresScenarioTime = "2026-12-02T15:15:00Z", Ibw = ibw, Actions = ["a"], Delivery = delivery,
            },
            ["WeatherDelivery"] = delivery,
            ["WeatherDeliveryPost"] = post,
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
