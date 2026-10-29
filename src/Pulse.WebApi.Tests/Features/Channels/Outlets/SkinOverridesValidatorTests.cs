namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Xunit;

/// <summary>
/// Story 03 AC "Reusable skin-override validator" and "Scoop-only clutter" (FC-3b, FC-7, D3-P2): the public, pure
/// <see cref="SkinOverridesValidator"/> — the CAN-list allowlist at every level, value types, the string defence, the
/// 4 KB cap at its exact boundary, the <c>ext</c> namespaces, and clutter on and off the tabloid key. Plain facts.
/// </summary>
public sealed class SkinOverridesValidatorTests
{
    private const string NewsSkin = "newsline7";

    private readonly ISkinOverridesValidator _validator = new SkinOverridesValidator();

    private SkinOverridesValidationResult Validate(string json, string skinKey = NewsSkin) =>
        _validator.Validate(skinKey, JsonNode.Parse(json)!.AsObject());

    [Fact]
    public void NullAndEmpty_AreValid()
    {
        _validator.Validate(NewsSkin, null).IsValid.Should().BeTrue("null means no overrides");
        Validate("{}").IsValid.Should().BeTrue("an empty object overrides nothing");
    }

    [Fact]
    public void EveryCanListToken_IsAccepted()
    {
        var result = Validate("""
            {
              "schemaVersion": 1,
              "type": { "mastheadFamily": "Georgia, serif", "hedFamily": "Inter", "dekFamily": "Inter", "bodyFamily": "Georgia",
                        "kickerFamily": "Inter", "hedCase": "upper" },
              "palette": { "accent": "#c8102e", "link": "#0645ad", "bg": "#ffffff", "surface": "#f5f5f5", "text": "#111111",
                           "rule": "#dddddd", "breaking": "#b00020" },
              "density": { "spacingScale": 1.1, "ruleWeight": "2px", "radius": 4 },
              "media": { "cropAggression": "tight", "captionStyle": "italic", "playerTint": "#000000" },
              "breaking": { "style": "banner", "vocabulary": "BREAKING" },
              "byline": { "format": "By NAME" },
              "dateline": { "format": "CITY —" },
              "layout": { "rail": true, "homeLead": "video-lead" },
              "ext": { "news": { "tickerSpeed": 3, "showTicker": true, "sections": ["Local", "Weather"] },
                       "press": { "letterhead": "seal" }, "weather": { "iconSet": "nws" }, "portal": { "density": null } }
            }
            """);

        result.Errors.Should().BeEmpty();
    }

    [Theory]
    [InlineData("""{ "slotOrder": ["hero"] }""", "skinOverrides.slotOrder is not an allowed skin token.")]
    [InlineData("""{ "watermark": false }""", "skinOverrides.watermark is not an allowed skin token.")]
    [InlineData("""{ "scenarioTimeSource": "wall" }""", "skinOverrides.scenarioTimeSource is not an allowed skin token.")]
    [InlineData("""{ "palette": { "contrastFloor": 1 } }""", "skinOverrides.palette.contrastFloor is not an allowed skin token.")]
    [InlineData("""{ "layout": { "shareButton": false } }""", "skinOverrides.layout.shareButton is not an allowed skin token.")]
    [InlineData("""{ "type": { "comments": "on" } }""", "skinOverrides.type.comments is not an allowed skin token.")]
    public void AnyKeyOffTheCanList_IsRejectedByItsDottedPath(string json, string expected)
    {
        Validate(json).Errors.Should().ContainSingle().Which.Should().Be(expected, "the CANNOT list is structurally unreachable");
    }

    [Theory]
    [InlineData("""{ "schemaVersion": 2 }""")]
    [InlineData("""{ "schemaVersion": "1" }""")]
    public void SchemaVersion_MustBeTheNumberOne(string json)
    {
        Validate(json).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.schemaVersion must be 1.");
    }

    [Theory]
    [InlineData("""{ "palette": "red" }""", "skinOverrides.palette must be an object.")]
    [InlineData("""{ "palette": { "accent": true } }""", "skinOverrides.palette.accent must be a string or a number.")]
    [InlineData("""{ "palette": { "accent": { "nested": "x" } } }""", "skinOverrides.palette.accent must be a string or a number.")]
    [InlineData("""{ "density": { "radius": [4] } }""", "skinOverrides.density.radius must be a string or a number.")]
    [InlineData("""{ "layout": { "rail": "yes" } }""", "skinOverrides.layout.rail must be a boolean.")]
    [InlineData("""{ "layout": { "homeLead": "hero-lead" } }""", "skinOverrides.layout.homeLead must be one of video-lead, text-lead, list-lead, clutter.")]
    public void TokenValues_MustHaveTheirFc3bType(string json, string expected)
    {
        Validate(json).Errors.Should().ContainSingle().Which.Should().Be(expected);
    }

    [Theory]
    [InlineData("red;background:url(x)")]
    [InlineData("</style><script>")]
    [InlineData("a{b}")]
    [InlineData("URL(https://evil)")]
    [InlineData("expression(alert(1))")]
    [InlineData("JavaScript:alert(1)")]
    public void StringValues_RefuseCssAndMarkupBreakouts(string value)
    {
        var overrides = new JsonObject { ["palette"] = new JsonObject { ["accent"] = value } };

        _validator.Validate(NewsSkin, overrides).Errors.Should().ContainSingle()
            .Which.Should().StartWith("skinOverrides.palette.accent contains a disallowed character or sequence");
    }

    [Theory]
    [InlineData("byline")]
    [InlineData("dateline")]
    public void TextTemplateFormats_AllowPlaceholderBraces_ButStillRefuseMarkup(string group)
    {
        var placeholder = new JsonObject { [group] = new JsonObject { ["format"] = "By {name}, {role}" } };
        _validator.Validate(NewsSkin, placeholder).IsValid.Should().BeTrue("text templates render as text, not CSS");

        var markup = new JsonObject { [group] = new JsonObject { ["format"] = "{name}</span><script>" } };
        _validator.Validate(NewsSkin, markup).Errors.Should().ContainSingle()
            .Which.Should().StartWith($"skinOverrides.{group}.format contains a disallowed character or sequence");
    }

    [Fact]
    public void StringValues_RefuseControlCharacters_AndOverlongValues()
    {
        var control = new JsonObject { ["byline"] = new JsonObject { ["format"] = "By\u0007 NAME" } };
        var overlong = new JsonObject { ["byline"] = new JsonObject { ["format"] = new string('x', SkinOverridesValidator.MaxStringLength + 1) } };
        var atLimit = new JsonObject { ["byline"] = new JsonObject { ["format"] = new string('x', SkinOverridesValidator.MaxStringLength) } };

        _validator.Validate(NewsSkin, control).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.byline.format contains a control or invisible formatting character.");
        _validator.Validate(NewsSkin, overlong).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.byline.format is longer than 200 characters.");
        _validator.Validate(NewsSkin, atLimit).IsValid.Should().BeTrue();
    }

    [Fact]
    public void Clutter_IsAllowedOnlyOnTheTabloidKey()
    {
        const string Clutter = """{ "clutter": ["SHOCKING!", "You won't believe"] }""";

        Validate(Clutter, SkinOverridesValidator.TabloidSkinKey).IsValid.Should().BeTrue("The Scoop owns clutter (D3-P2)");
        Validate(Clutter, NewsSkin).Errors.Should().ContainSingle()
            .Which.Should().Be("skinOverrides.clutter is only allowed for the tabloid skin ('the-scoop').");
    }

    [Fact]
    public void HomeLeadClutter_IsAllowedOnlyOnTheTabloidKey()
    {
        const string Json = """{ "layout": { "homeLead": "clutter" } }""";

        Validate(Json, SkinOverridesValidator.TabloidSkinKey).IsValid.Should().BeTrue();
        Validate(Json, NewsSkin).Errors.Should().ContainSingle()
            .Which.Should().Be("skinOverrides.layout.homeLead 'clutter' is only allowed for the tabloid skin ('the-scoop').");
    }

    [Fact]
    public void Clutter_OnTheTabloid_IsAStringArrayOfAtMost20ShortItems()
    {
        var tooMany = new JsonObject { ["clutter"] = new JsonArray(Enumerable.Range(0, 21).Select(i => (JsonNode?)JsonValue.Create($"c{i}")).ToArray()) };
        var tooLong = new JsonObject { ["clutter"] = new JsonArray(JsonValue.Create(new string('x', 81))) };
        var notStrings = new JsonObject { ["clutter"] = new JsonArray(JsonValue.Create(1)) };
        var notArray = new JsonObject { ["clutter"] = "x" };

        _validator.Validate(SkinOverridesValidator.TabloidSkinKey, tooMany).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.clutter may hold at most 20 items.");
        _validator.Validate(SkinOverridesValidator.TabloidSkinKey, tooLong).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.clutter[0] is longer than 80 characters.");
        _validator.Validate(SkinOverridesValidator.TabloidSkinKey, notStrings).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.clutter[0] must be a string.");
        _validator.Validate(SkinOverridesValidator.TabloidSkinKey, notArray).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides.clutter must be an array of strings.");
    }

    [Theory]
    [InlineData("news")]
    [InlineData("press")]
    [InlineData("weather")]
    [InlineData("portal")]
    public void Ext_AcceptsEachChannelNamespace_WithFlatValues(string ns)
    {
        var overrides = new JsonObject
        {
            ["ext"] = new JsonObject
            {
                [ns] = new JsonObject
                {
                    ["label"] = "x",
                    ["size"] = 2,
                    ["on"] = false,
                    ["unset"] = null,
                    ["list"] = new JsonArray(JsonValue.Create("a"), JsonValue.Create("b")),
                },
            },
        };

        _validator.Validate(NewsSkin, overrides).Errors.Should().BeEmpty();
    }

    [Fact]
    public void Ext_RejectsAnUnknownNamespace_Readably()
    {
        Validate("""{ "ext": { "foo": { "x": 1 } } }""").Errors.Should().ContainSingle()
            .Which.Should().Be("skinOverrides.ext.foo is not an allowed namespace (news, press, weather, portal).");
        SkinOverridesValidator.ExtNamespaces.Should().Equal("news", "press", "weather", "portal");
    }

    [Theory]
    [InlineData("""{ "ext": { "news": { "nested": { "a": 1 } } } }""", "skinOverrides.ext.news.nested must be a string, number, boolean or string array.")]
    [InlineData("""{ "ext": { "news": { "mixed": ["a", 1] } } }""", "skinOverrides.ext.news.mixed[1] must be a string.")]
    [InlineData("""{ "ext": { "news": "flat" } }""", "skinOverrides.ext.news must be an object.")]
    [InlineData("""{ "ext": ["news"] }""", "skinOverrides.ext must be an object.")]
    [InlineData("""{ "ext": { "news": { "bad key": 1 } } }""", "skinOverrides.ext.news.bad key is not a valid token name.")]
    public void Ext_NamespaceBlocks_AreFlat(string json, string expected)
    {
        Validate(json).Errors.Should().ContainSingle().Which.Should().Be(expected);
    }

    [Fact]
    public void TheSizeCap_Is4096Utf8Bytes_OfCompactJson_InclusiveBoundary()
    {
        // Values stay under the per-string cap by spreading them across ext keys, so only the TOTAL size is under test.
        // Fill with 100-char values while there is comfortable room, then size one last value to land exactly.
        static JsonObject OfSize(int totalBytes)
        {
            var ext = new JsonObject();
            var overrides = new JsonObject { ["ext"] = new JsonObject { ["news"] = ext } };
            int Size() => Encoding.UTF8.GetByteCount(SkinOverridesValidator.Serialize(overrides));

            var index = 0;
            while (Size() + 130 <= totalBytes)
            {
                ext[$"k{index++}"] = new string('x', 100);
            }

            var last = $"k{index}";
            ext[last] = string.Empty;
            ext[last] = new string('x', totalBytes - Size());
            return overrides;
        }

        var atCap = OfSize(SkinOverridesValidator.MaxBytes);
        var overCap = OfSize(SkinOverridesValidator.MaxBytes + 1);
        Encoding.UTF8.GetByteCount(SkinOverridesValidator.Serialize(atCap)).Should().Be(4096);
        Encoding.UTF8.GetByteCount(SkinOverridesValidator.Serialize(overCap)).Should().Be(4097);

        _validator.Validate(NewsSkin, atCap).IsValid.Should().BeTrue("4096 bytes is within the cap");
        _validator.Validate(NewsSkin, overCap).Errors.Should().ContainSingle().Which.Should().Be("skinOverrides exceeds the 4 KB cap.");
    }

    [Fact]
    public void OverTheCap_TheCapIsTheOnlyError()
    {
        var overrides = new JsonObject
        {
            ["slotOrder"] = 1,
            ["ext"] = new JsonObject { ["foo"] = new string('x', SkinOverridesValidator.MaxBytes) },
        };

        _validator.Validate(NewsSkin, overrides).Errors.Should().Equal("skinOverrides exceeds the 4 KB cap.");
    }

    [Fact]
    public void TheCap_IsMeasuredWithRelaxedEscaping_SoNonLatinTextIsNotInflated()
    {
        // 10 x 190 Cyrillic letters: about 3.9 KB as raw UTF-8, but ~11 KB if each letter were escaped as \uXXXX.
        var ext = new JsonObject();
        for (var i = 0; i < 10; i++)
        {
            ext[$"k{i}"] = new string('\u0416', 190);
        }

        var overrides = new JsonObject { ["ext"] = new JsonObject { ["news"] = ext } };

        SkinOverridesValidator.Serialize(overrides).Should().Contain("\u0416", "stored as the character itself, not an escape");
        _validator.Validate(NewsSkin, overrides).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("u\\72l(x)")]
    [InlineData("image-set(\"https://x/p.png\" 1x)")]
    [InlineData("-webkit-image-set(\"a.png\" 1x)")]
    [InlineData("cross-fade(red, blue)")]
    [InlineData("element(#x)")]
    [InlineData("@import")]
    [InlineData("red /* x */")]
    [InlineData("red !important")]
    [InlineData("url (x)")]
    public void CssBoundStrings_RefuseEscapesAtRulesCommentsImportantAndNonAllowlistedFunctions(string value)
    {
        foreach (var overrides in new[]
                 {
                     new JsonObject { ["palette"] = new JsonObject { ["accent"] = value } },
                     new JsonObject { ["ext"] = new JsonObject { ["press"] = new JsonObject { ["letterhead"] = value } } },
                 })
        {
            _validator.Validate(NewsSkin, overrides).Errors.Should().ContainSingle()
                .Which.Should().Contain("contains a disallowed character or sequence", "{0} is refused in a CSS-bound token", value);
        }
    }

    [Theory]
    [InlineData("rgb(1,2,3)")]
    [InlineData("RGBA(1, 2, 3, 0.5)")]
    [InlineData("var(--x)")]
    [InlineData("\"Playfair Display\", serif")]
    [InlineData("'Inter', sans-serif")]
    [InlineData("calc(1rem + 2px)")]
    [InlineData("clamp(1rem, 2vw, 3rem)")]
    [InlineData("hsl(10 20% 30%)")]
    public void CssBoundStrings_AcceptColoursFontStacksAndAllowlistedFunctions(string value)
    {
        var overrides = new JsonObject { ["type"] = new JsonObject { ["hedFamily"] = value } };

        _validator.Validate(NewsSkin, overrides).Errors.Should().BeEmpty();
    }

    [Fact]
    public void TextTemplates_AlsoRefuseABackslash()
    {
        var overrides = new JsonObject { ["byline"] = new JsonObject { ["format"] = "By {name} \\3c" } };

        _validator.Validate(NewsSkin, overrides).Errors.Should().ContainSingle()
            .Which.Should().StartWith("skinOverrides.byline.format contains a disallowed character or sequence");
    }

    [Theory]
    [InlineData("\u202E")]
    [InlineData("\u200B")]
    [InlineData("\u2028")]
    [InlineData("\u2029")]
    public void Strings_RefuseInvisibleFormattingCharacters(string invisible)
    {
        var overrides = new JsonObject { ["palette"] = new JsonObject { ["accent"] = $"#c8{invisible}102e" } };

        _validator.Validate(NewsSkin, overrides).Errors.Should().ContainSingle()
            .Which.Should().Be("skinOverrides.palette.accent contains a control or invisible formatting character.");
    }

    [Fact]
    public void Errors_AreAllCollected()
    {
        Validate("""{ "slotOrder": 1, "palette": { "accent": true }, "ext": { "foo": {} } }""").Errors.Should().HaveCount(3);
    }
}
