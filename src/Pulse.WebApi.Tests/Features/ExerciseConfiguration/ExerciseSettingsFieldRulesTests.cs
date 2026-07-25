namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.ExerciseConfiguration;
using Xunit;

/// <summary>
/// Model-only tests (no database) for the settings write's validation vocabulary: the strict channel-id
/// parser, the IANA time-zone guard (XC-008), the NFR-004 sanitize-and-bound rules, the outlet-name map, and
/// the request/response DTO wire shapes.
/// </summary>
public sealed class ExerciseSettingsFieldRulesTests
{
    // ---- ChannelCatalog: the strict parser over a column with no DB-level integrity ---------------

    [Fact]
    public void ChannelCatalog_ShipsTheClosedFiveChannelCatalog_WithGuardSafeLabelsAndIcons()
    {
        string[] expected = ["social", "portal", "news", "press", "weather"];

        ChannelCatalog.All.Select(c => c.Id).Should().Equal(expected);

        // icon must stay inside channelNavConfig.ts's closed ChannelIconId union, or the frontend guard
        // rejects the WHOLE channel-nav response and the shell falls back to its default.
        ChannelCatalog.All.Select(c => c.Icon).Should().Equal(expected);
        ChannelCatalog.All.Should().OnlyContain(
            c => c.Label.Length > 0, "the frontend guard rejects an empty channel label");
    }

    [Theory]
    [InlineData("social")]
    [InlineData("SOCIAL")]
    [InlineData("  news  ")]
    public void TryNormalize_AcceptsACataloguedId_CaseInsensitively_AndCanonicalizesIt(string raw)
    {
        var ok = ChannelCatalog.TryNormalize([raw], out var canonical, out var error);

        ok.Should().BeTrue(error);
        canonical.Should().ContainSingle().Which.Should().Be(raw.Trim().ToLowerInvariant());
    }

    [Fact]
    public void TryNormalize_EmitsCanonicalCatalogOrder_AndCollapsesDuplicates()
    {
        var ok = ChannelCatalog.TryNormalize(["weather", "social", "weather"], out var canonical, out _);

        ok.Should().BeTrue();
        canonical.Should().Equal("social", "weather");
    }

    [Theory]
    [InlineData("radio")]
    [InlineData("social,news")]  // a pre-joined string is one unknown id, not two — the API takes a list
    [InlineData("")]
    [InlineData(null)]
    public void TryNormalize_RejectsAnythingNotInTheCatalog(string? candidate)
    {
        var ok = ChannelCatalog.TryNormalize([candidate], out var canonical, out var error);

        ok.Should().BeFalse();
        canonical.Should().BeNull();
        error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void TryNormalize_RejectsAnEmptyList_RatherThanBlankingTheParticipantWorld()
    {
        var ok = ChannelCatalog.TryNormalize([], out _, out var error);

        ok.Should().BeFalse();
        error.Should().Contain("at least one channel");
    }

    [Fact]
    public void ParseStored_TreatsNullBlankAndUnrecognizedValuesAsNotConfigured()
    {
        ChannelCatalog.ParseStored(null).Should().BeNull();
        ChannelCatalog.ParseStored("   ").Should().BeNull();
        ChannelCatalog.ParseStored("radio,tv").Should().BeNull(
            "a hand-edited row must degrade to the platform default, never 500 a participant read");
    }

    [Fact]
    public void ParseStored_IgnoresUnknownTokensButKeepsTheKnownOnes()
    {
        ChannelCatalog.ParseStored("social,radio,,news").Should().BeEquivalentTo(["social", "news"]);
    }

    [Fact]
    public void Format_RoundTripsThroughParseStored()
    {
        ChannelCatalog.TryNormalize(["news", "social"], out var canonical, out _).Should().BeTrue();
        var stored = ChannelCatalog.Format(canonical!);

        stored.Should().Be("social,news");
        ChannelCatalog.ParseStored(stored).Should().BeEquivalentTo(["social", "news"]);
    }

    // ---- time zone (XC-008) ----------------------------------------------------------------------

    [Theory]
    [InlineData("UTC")]
    [InlineData("America/New_York")]
    [InlineData("America/Chicago")]
    [InlineData("Europe/London")]
    [InlineData("Australia/Sydney")]
    public void TryNormalizeTimeZone_AcceptsARealIanaZone(string candidate)
    {
        var ok = ExerciseSettingsFieldRules.TryNormalizeTimeZone(candidate, out var timeZone, out var error);

        ok.Should().BeTrue(error);
        timeZone.Should().Be(candidate);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Not/AZone")]
    [InlineData("Eastern Standard Time")]
    public void TryNormalizeTimeZone_RejectsAbsentUnknownAndWindowsZoneIds(string? candidate)
    {
        var ok = ExerciseSettingsFieldRules.TryNormalizeTimeZone(candidate, out var timeZone, out var error);

        ok.Should().BeFalse("a non-IANA value must fail closed with a 400 (XC-008)");
        timeZone.Should().BeNull();
        error.Should().NotBeNullOrWhiteSpace();
    }

    // ---- locale ----------------------------------------------------------------------------------

    [Theory]
    [InlineData("en")]
    [InlineData("en-US")]
    [InlineData("sr-Latn-RS")]
    public void TryNormalizeLocale_AcceptsABcp47Tag(string candidate)
    {
        ExerciseSettingsFieldRules.TryNormalizeLocale(candidate, out var locale, out var error).Should().BeTrue(error);
        locale.Should().Be(candidate);
    }

    [Fact]
    public void TryNormalizeLocale_TreatsAnAbsentValueAsClearingTheSetting()
    {
        ExerciseSettingsFieldRules.TryNormalizeLocale(null, out var locale, out _).Should().BeTrue();
        locale.Should().BeNull();
    }

    [Theory]
    [InlineData("english (US)")]
    [InlineData("<script>")]
    [InlineData("e")]
    public void TryNormalizeLocale_RejectsANonTag(string candidate)
    {
        ExerciseSettingsFieldRules.TryNormalizeLocale(candidate, out _, out var error).Should().BeFalse();
        error.Should().NotBeNullOrWhiteSpace();
    }

    // ---- colors ----------------------------------------------------------------------------------

    [Theory]
    [InlineData("#abc")]
    [InlineData("#2b5f75")]
    [InlineData("#FFFFFF")]
    public void TryNormalizeColor_AcceptsTheTwoCssHexForms(string candidate)
    {
        ExerciseSettingsFieldRules.TryNormalizeColor(candidate, "brandPrimary", out var color, out var error)
            .Should().BeTrue(error);
        color.Should().Be(candidate);
    }

    [Theory]
    [InlineData("red")]
    [InlineData("#12345")]
    [InlineData("rgb(0,0,0)")]
    [InlineData("javascript:alert(1)")]
    [InlineData("#2b5f75; background:url(x)")]
    public void TryNormalizeColor_RejectsAnythingElse(string candidate)
    {
        ExerciseSettingsFieldRules.TryNormalizeColor(candidate, "brandPrimary", out var color, out var error)
            .Should().BeFalse();
        color.Should().BeNull();
        error.Should().Contain("brandPrimary");
    }

    // ---- NFR-004 free text -----------------------------------------------------------------------

    [Fact]
    public void TryNormalizeWorldName_StripsMarkupAndKeepsTheAuthorsLiteralCharacters()
    {
        var ok = ExerciseSettingsFieldRules.TryNormalizeWorldName(
            "<script>alert('x')</script>Ally's \"Metro\" & Co", out var worldName, out var error);

        ok.Should().BeTrue(error);
        worldName.Should().Be(
            "Ally's \"Metro\" & Co",
            "the sanitizer STRIPS markup and never entity-encodes — encoding would double-encode at the React text node");
    }

    [Fact]
    public void TryNormalizeBrandName_RejectsAValueThatIsEntirelyMarkup()
    {
        // An empty brand name fails the frontend's own guard, which would drop the brand-tokens response and
        // un-skin the participant world — refuse rather than store an empty string.
        ExerciseSettingsFieldRules.TryNormalizeBrandName("<script>alert(1)</script>", out var brandName, out var error)
            .Should().BeFalse();
        brandName.Should().BeNull();
        error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void TryNormalizeName_RejectsAnOverLengthValue()
    {
        var raw = new string('n', ExerciseSettingsFieldRules.MaxNameLength + 1);

        ExerciseSettingsFieldRules.TryNormalizeName(raw, out _, out var error).Should().BeFalse();
        error.Should().Contain(ExerciseSettingsFieldRules.MaxNameLength.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    [Fact]
    public void TryNormalizeName_RejectsAnAbsentValue()
    {
        ExerciseSettingsFieldRules.TryNormalizeName("   ", out _, out var error).Should().BeFalse();
        error.Should().Contain("required");
    }

    // ---- outlet names ----------------------------------------------------------------------------

    [Fact]
    public void TryNormalizeOutletNames_SanitizesBothKeysAndValues()
    {
        var raw = new Dictionary<string, string> { ["<b>news</b>"] = "<i>WXYZ</i> 9 News" };

        ExerciseSettingsFieldRules.TryNormalizeOutletNames(raw, out var sanitized, out var error).Should().BeTrue(error);
        sanitized.Should().ContainKey("news").WhoseValue.Should().Be("WXYZ 9 News");
    }

    [Fact]
    public void TryNormalizeOutletNames_RejectsAnEntryEmptiedBySanitizing()
    {
        var raw = new Dictionary<string, string> { ["news"] = "<script>alert(1)</script>" };

        ExerciseSettingsFieldRules.TryNormalizeOutletNames(raw, out _, out var error).Should().BeFalse();
        error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void TryNormalizeOutletNames_RejectsAnOverSizedMap()
    {
        var raw = Enumerable.Range(0, ExerciseSettingsFieldRules.MaxOutletNameEntries + 1)
            .ToDictionary(i => $"outlet{i}", i => $"Outlet {i}");

        ExerciseSettingsFieldRules.TryNormalizeOutletNames(raw, out _, out var error).Should().BeFalse();
        error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void OutletNameMap_RoundTripsAndToleratesAMalformedBlob()
    {
        var map = new Dictionary<string, string> { ["news"] = "WXYZ 9" };

        var json = OutletNameMap.Serialize(map);
        json.Should().NotBeNull();
        OutletNameMap.Deserialize(json).Should().ContainKey("news").WhoseValue.Should().Be("WXYZ 9");

        OutletNameMap.Serialize(new Dictionary<string, string>()).Should().BeNull("an empty map means 'not configured'");
        OutletNameMap.Deserialize("{not json").Should().BeEmpty("a hand-edited blob must not break the settings read");
        OutletNameMap.Deserialize(null).Should().BeEmpty();
    }

    // ---- DTO wire shapes -------------------------------------------------------------------------

    [Fact]
    public void UpdateExerciseSettingsRequest_DeserializesTheDocumentedWireBody()
    {
        const string body = """
            {
              "name": "Atlanta CIE",
              "worldName": "Metro Atlanta",
              "locale": "en-US",
              "timeZone": "America/New_York",
              "scheduledStartAt": "2026-03-01T13:00:00Z",
              "scheduledEndAt": null,
              "enabledChannels": ["social", "news"],
              "brandName": "Metro Now",
              "brandPrimary": "#123456",
              "outletNames": { "news": "WXYZ 9" },
              "unknownFutureField": 42
            }
            """;

        var request = JsonSerializer.Deserialize<UpdateExerciseSettingsRequest>(
            body,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        request.Should().NotBeNull();
        request!.Name.Should().Be("Atlanta CIE");
        request.TimeZone.Should().Be("America/New_York");
        request.ScheduledEndAt.Should().BeNull();
        request.EnabledChannels.Should().Equal("social", "news");
        request.OutletNames.Should().ContainKey("news");
    }

    [Fact]
    public void UpdateExerciseSettingsRequest_CarriesNoExerciseIdProperty_SoAClientCannotAimAWriteElsewhere()
    {
        typeof(UpdateExerciseSettingsRequest).GetProperties()
            .Select(p => p.Name)
            .Should().NotContain(
                ["ExerciseId", "Id"],
                "the target exercise comes ONLY from the server-resolved scope — there must be nowhere for a "
                + "client-supplied id to bind (COR-001/XC-002)");
    }

    [Fact]
    public void ExerciseSettingsDto_SerializesTheDocumentedCamelCaseWireKeys()
    {
        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            Name = "Atlanta CIE",
            TimeZone = "America/New_York",
            Status = "live",
            WorldName = "Metro Atlanta",
            ScheduledStartAt = new DateTimeOffset(2026, 3, 1, 13, 0, 0, TimeSpan.Zero),
            EnabledChannels = "social,news",
            BrandPrimary = "#123456",
        };

        var json = JsonSerializer.Serialize(ExerciseSettingsDto.FromExercise(exercise));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        foreach (var key in new[]
        {
            "exerciseId", "name", "worldName", "locale", "timeZone", "scheduledStartAt", "scheduledEndAt",
            "channels", "brandName", "brandPrimary", "brandAccent", "brandSurface", "brandOnSurface", "outletNames",
        })
        {
            root.TryGetProperty(key, out _).Should().BeTrue($"the settings contract requires a '{key}' key");
        }

        root.GetProperty("scheduledStartAt").GetString().Should().StartWith(
            "2026-03-01T13:00:00", "schedule instants are emitted as round-trip ('O') ISO-8601 strings");
        root.GetProperty("channels").GetArrayLength().Should().Be(5);
        root.GetProperty("outletNames").ValueKind.Should().Be(
            JsonValueKind.Object, "outletNames is always present (empty when unconfigured)");
    }

    [Fact]
    public void ExerciseSettingsDto_CarriesNoStaffOnlyOrParticipantHiddenState()
    {
        // XC-002: the practice/sandbox flag and the chrome columns are other stories' surfaces; this DTO must
        // not quietly become the place they leak from.
        var json = JsonSerializer.Serialize(ExerciseSettingsDto.FromExercise(new Exercise
        {
            Id = Guid.NewGuid(),
            Name = "N",
            TimeZone = "UTC",
            Status = "live",
            IsPracticeMode = true,
        }));

        json.Should().NotContain("practice", "the COR-033 flag is story 04's surface, not this one");
        json.Should().NotContain("chrome", "the COR-031 chrome config is story 02's surface, not this one");
        json.Should().NotContain("watermark");
    }
}
