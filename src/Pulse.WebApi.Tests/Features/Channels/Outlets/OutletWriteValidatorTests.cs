namespace Pulse.WebApi.Tests.Features.Channels.Outlets;

using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Xunit;

/// <summary>
/// Story 03 AC "Validation" (the pure half) and AC "No exercise-identifying leakage" (the type half): the outlet write
/// body's shape rules, and the participant <see cref="OutletDto"/> carrying no staff or exercise field. Plain facts.
/// </summary>
public sealed class OutletWriteValidatorTests
{
    private static readonly SkinOverridesValidator Skin = new();

    private static OutletWriteRequest Valid() => new()
    {
        ChannelId = "news",
        Slug = "metro-desk-9",
        Name = "Metro Desk 9",
        SkinKey = "newsline7",
        Categories = ["Local", "Weather"],
    };

    private static Outlet Existing() => new()
    {
        Id = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        ChannelId = "news",
        Slug = "metro-desk-9",
        Name = "Metro Desk 9",
        SkinKey = "newsline7",
        Version = 3,
    };

    [Fact]
    public void AValidCreate_IsTrimmedAndNormalized()
    {
        var result = OutletWriteValidator.Parse(
            Valid() with { Name = "  Metro Desk 9  ", Tagline = "   ", Categories = [" Local ", "Weather"], SkinOverrides = new JsonObject() },
            existing: null,
            Skin);

        var draft = result.Draft!;
        draft.Name.Should().Be("Metro Desk 9");
        draft.Tagline.Should().BeNull("a blank optional string is unset");
        draft.Categories.Should().Equal("Local", "Weather");
        draft.CategoriesJson.Should().Be("[\"Local\",\"Weather\"]");
        draft.SkinOverridesJson.Should().BeNull("an empty overrides object stores nothing");
    }

    [Fact]
    public void ANullBody_IsAReadable400()
    {
        OutletWriteValidator.Parse(null, null, Skin).Error.Should().Be("A request body is required.");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("social")]
    [InlineData("portal")]
    [InlineData("tv")]
    public void CreateRequiresAContentChannel(string? channelId)
    {
        OutletWriteValidator.Parse(Valid() with { ChannelId = channelId }, null, Skin).Error
            .Should().Be("channelId must be one of news, press, weather.");
    }

    [Fact]
    public void TheChannelIsImmutableAfterCreate_AndAPutNeedsAVersion()
    {
        var existing = Existing();

        OutletWriteValidator.Parse(Valid() with { ChannelId = "press", Version = 3 }, existing, Skin).Error
            .Should().Be("channelId cannot be changed after the outlet is created.");
        OutletWriteValidator.Parse(Valid() with { ChannelId = null }, existing, Skin).Error.Should().Be("version is required.");
        OutletWriteValidator.Parse(Valid() with { ChannelId = null, Version = 3 }, existing, Skin).Draft!.ChannelId.Should().Be("news");
    }

    [Theory]
    [InlineData("Metro Desk")]
    [InlineData("UPPER")]
    [InlineData("under_score")]
    [InlineData("")]
    [InlineData("staff")]
    public void SlugFollowsFc1_AndStaffIsReserved(string slug)
    {
        OutletWriteValidator.Parse(Valid() with { Slug = slug }, null, Skin).Error.Should().NotBeNull();
    }

    [Fact]
    public void NameAndTagline_AreBoundedAndControlFree()
    {
        OutletWriteValidator.Parse(Valid() with { Name = " " }, null, Skin).Error.Should().Be("name is required.");
        OutletWriteValidator.Parse(Valid() with { Name = new string('n', Outlet.MaxNameLength + 1) }, null, Skin).Error
            .Should().Be("name must be at most 120 characters.");
        OutletWriteValidator.Parse(Valid() with { Name = "Metro\u0000Desk" }, null, Skin).Error
            .Should().Be("name must not contain control or invisible formatting characters.");
        OutletWriteValidator.Parse(Valid() with { Tagline = new string('t', Outlet.MaxTaglineLength + 1) }, null, Skin).Error
            .Should().Be("tagline must be at most 200 characters.");
    }

    [Fact]
    public void InvisibleFormattingCharacters_AreRefusedInNameTaglineAndCategories()
    {
        const string Rlo = "\u202E";

        OutletWriteValidator.Parse(Valid() with { Name = $"Metro{Rlo}Desk" }, null, Skin).Error
            .Should().Be("name must not contain control or invisible formatting characters.");
        OutletWriteValidator.Parse(Valid() with { Tagline = $"On your{Rlo} side" }, null, Skin).Error
            .Should().Be("tagline must not contain control or invisible formatting characters.");
        OutletWriteValidator.Parse(Valid() with { Categories = [$"Lo{Rlo}cal"] }, null, Skin).Error
            .Should().Be("categories[0] must not contain control or invisible formatting characters.");
    }

    [Fact]
    public void TheSlugIsImmutableAfterCreate()
    {
        OutletWriteValidator.Parse(Valid() with { Slug = "metro-desk-nine", Version = 3 }, Existing(), Skin).Error
            .Should().Be("slug cannot be changed after the outlet is created (permalink stability, NWS-011).");
        OutletWriteValidator.Parse(Valid() with { Version = 3 }, Existing(), Skin).Draft.Should().NotBeNull("echoing the slug is fine");
    }

    [Fact]
    public void AParentIsOnlyAllowedOnAPressOutlet()
    {
        var parent = Guid.NewGuid().ToString();

        OutletWriteValidator.Parse(Valid() with { ParentOutletId = parent }, null, Skin).Error
            .Should().Be("parentOutletId is only allowed on a press outlet.");
        OutletWriteValidator.Parse(Valid() with { ChannelId = "press", ParentOutletId = parent }, null, Skin).Draft.Should().NotBeNull();
    }

    [Fact]
    public void SkinOverrides_AreStoredWithRelaxedEscaping()
    {
        var draft = OutletWriteValidator.Parse(
            Valid() with { SkinOverrides = JsonNode.Parse("""{ "type": { "hedFamily": "\"Noto Sans\" , 'Ж'" } }""") }, null, Skin).Draft!;

        draft.SkinOverridesJson.Should().Be("""{"type":{"hedFamily":"\"Noto Sans\" , 'Ж'"}}""");
    }

    [Fact]
    public void Categories_AreAtMost20_NonBlank_Short_AndUniqueIgnoringCase()
    {
        OutletWriteValidator.Parse(Valid() with { Categories = Enumerable.Range(0, 21).Select(i => (string?)$"c{i}").ToList() }, null, Skin).Error
            .Should().Be("categories may hold at most 20 entries.");
        OutletWriteValidator.Parse(Valid() with { Categories = Enumerable.Range(0, 20).Select(i => (string?)$"c{i}").ToList() }, null, Skin).Draft
            .Should().NotBeNull("20 is the limit, inclusive");
        OutletWriteValidator.Parse(Valid() with { Categories = ["Local", "local"] }, null, Skin).Error
            .Should().Be("categories[1] 'local' is a duplicate.");
        OutletWriteValidator.Parse(Valid() with { Categories = ["Local", " "] }, null, Skin).Error
            .Should().Be("categories[1] must not be blank.");
        OutletWriteValidator.Parse(Valid() with { Categories = [new string('c', 41)] }, null, Skin).Error
            .Should().Be("categories[0] must be at most 40 characters.");
    }

    [Fact]
    public void Ids_MustBeGuids()
    {
        OutletWriteValidator.Parse(Valid() with { PairedPersonaId = "not-a-guid", LogoMediaId = Guid.Empty.ToString() }, null, Skin).Error
            .Should().Be("pairedPersonaId must be a GUID. logoMediaId must be a GUID.", "every error is collected");
    }

    [Fact]
    public void SkinKeyAndOverrides_AreValidated_AndStoredCompact()
    {
        OutletWriteValidator.Parse(Valid() with { SkinKey = "Not A Key" }, null, Skin).Error
            .Should().Be("skinKey must be 1-64 characters of a-z, 0-9 and '-'.");
        OutletWriteValidator.Parse(Valid() with { SkinOverrides = JsonValue.Create("red") }, null, Skin).Error
            .Should().Be("skinOverrides must be an object.");
        OutletWriteValidator.Parse(Valid() with { SkinOverrides = JsonNode.Parse("""{ "clutter": ["x"] }""") }, null, Skin).Error
            .Should().Be("skinOverrides.clutter is only allowed for the tabloid skin ('the-scoop').");

        var draft = OutletWriteValidator.Parse(
            Valid() with { SkinOverrides = JsonNode.Parse("""{  "palette" : { "accent" : "#c8102e" } }""") }, null, Skin).Draft!;
        draft.SkinOverridesJson.Should().Be("""{"palette":{"accent":"#c8102e"}}""");
    }

    [Fact]
    public void TheParticipantOutletDto_CarriesNoStaffExerciseOrWallClockField()
    {
        var wireNames = typeof(OutletDto)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.GetCustomAttribute<JsonPropertyNameAttribute>()!.Name)
            .ToList();

        wireNames.Should().BeEquivalentTo(
            ["id", "channelId", "slug", "name", "tagline", "parentOutletId", "pairedPersonaId", "logo", "categories", "skinKey",
             "skinOverrides", "homeRoute"],
            "XC-002: no exerciseId, enabled, sortOrder, version, logoMediaId, deletedAt or wall-clock field");

        var json = JsonSerializer.Serialize(new OutletDto
        {
            Id = Guid.NewGuid().ToString(),
            ChannelId = "news",
            Slug = "metro-desk-9",
            Name = "Metro Desk 9",
            SkinKey = "newsline7",
            HomeRoute = "/news/metro-desk-9",
        });
        foreach (var forbidden in new[] { "exerciseId", "enabled", "version", "sortOrder", "deletedAt", "logoMediaId" })
        {
            json.Should().NotContain($"\"{forbidden}\"");
        }
    }
}
