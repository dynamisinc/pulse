namespace Pulse.WebApi.Tests.Features.Social.PersonaAdmin;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Social.PersonaAdmin;
using Xunit;

/// <summary>
/// The merge-patch matrix for <c>PATCH /api/staff/personas/{id}</c> (demo-polish PE-BE, story 21 ACs "Merge-patch
/// endpoint" and "Immutable fields are loud"), at the parser: absent / null / value per field, the fields that may
/// not be null, the immutable and unknown field names, sanitization (NFR-004) and the length bounds. Pure, no
/// database. The same rules are re-proven end to end over HTTP in <see cref="PersonaAdminEndpointTests"/>.
/// </summary>
public sealed class PersonaProfilePatchParserTests
{
    private static readonly Guid SomeMediaId = Guid.Parse("6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f");

    [Fact]
    public void EmptyObject_IsAValidPatch_ThatSetsNothing()
    {
        var patch = ParseValid("{}");

        patch.PresentFieldNames.Should().BeEmpty("an empty merge-patch changes nothing (RFC 7396)");
        patch.DisplayName.IsPresent.Should().BeFalse();
        patch.Bio.IsPresent.Should().BeFalse();
        patch.Location.IsPresent.Should().BeFalse();
        patch.Verified.IsPresent.Should().BeFalse();
        patch.AvatarMediaId.IsPresent.Should().BeFalse();
        patch.BannerMediaId.IsPresent.Should().BeFalse();
    }

    [Fact]
    public void Values_ForEveryField_ArePresent_WithTheirValues()
    {
        var patch = ParseValid($$"""
            {
              "displayName": "Fulton County EM",
              "bio": "Official county updates.",
              "location": "Fulton, OH",
              "verified": false,
              "avatarMediaId": "{{SomeMediaId}}",
              "bannerMediaId": "{{SomeMediaId:N}}"
            }
            """);

        patch.DisplayName.Should().Be(new PatchField<string>(true, "Fulton County EM"));
        patch.Bio.Should().Be(new PatchField<string?>(true, "Official county updates."));
        patch.Location.Should().Be(new PatchField<string?>(true, "Fulton, OH"));
        patch.Verified.Should().Be(new PatchField<bool>(true, false));
        patch.AvatarMediaId.Should().Be(new PatchField<Guid?>(true, SomeMediaId));
        patch.BannerMediaId.Should().Be(new PatchField<Guid?>(true, SomeMediaId), "any GUID spelling parses");
        patch.PresentFieldNames.Should().Equal("displayName", "bio", "location", "verified", "avatarMediaId", "bannerMediaId");
    }

    [Fact]
    public void AbsentFields_StayAbsent_WhenOnlyOneFieldIsNamed()
    {
        var patch = ParseValid("""{ "verified": true }""");

        patch.Verified.Should().Be(new PatchField<bool>(true, true));
        patch.PresentFieldNames.Should().Equal(["verified"], "absent = unchanged; only the named field is applied");
    }

    [Theory]
    [InlineData("bio")]
    [InlineData("location")]
    [InlineData("avatarMediaId")]
    [InlineData("bannerMediaId")]
    public void Null_OnAClearableField_IsAPresentClear(string field)
    {
        var patch = ParseValid($$"""{ "{{field}}": null }""");

        patch.PresentFieldNames.Should().Equal(field);
        (field switch
        {
            "bio" => patch.Bio.IsPresent && patch.Bio.Value is null,
            "location" => patch.Location.IsPresent && patch.Location.Value is null,
            "avatarMediaId" => patch.AvatarMediaId.IsPresent && patch.AvatarMediaId.Value is null,
            _ => patch.BannerMediaId.IsPresent && patch.BannerMediaId.Value is null,
        }).Should().BeTrue($"null clears {field}");
    }

    [Theory]
    [InlineData("displayName", PersonaAdminMessages.DisplayNameNull)]
    [InlineData("verified", PersonaAdminMessages.VerifiedNull)]
    public void Null_OnANonClearableField_IsRefused(string field, string expected)
    {
        ParseInvalid($$"""{ "{{field}}": null }""").Should().Be(expected);
    }

    [Theory]
    [InlineData("handle", "handle")]
    [InlineData("kind", "kind")]
    [InlineData("personaType", "personaType")]
    [InlineData("exerciseId", "exerciseId")]
    [InlineData("Handle", "handle")]
    [InlineData("EXERCISEID", "exerciseId")]
    public void ImmutableField_IsRefusedLoudly_NeverIgnored(string sent, string canonical)
    {
        ParseInvalid($$"""{ "{{sent}}": "x" }""").Should().Be(PersonaAdminMessages.CannotBeChanged(canonical));
        PersonaAdminMessages.CannotBeChanged(canonical).Should().Be($"{canonical} cannot be changed.");
    }

    [Fact]
    public void ImmutableField_NextToValidFields_IsStillRefused_AndWinsOverValueErrors()
    {
        ParseInvalid("""{ "displayName": "New name", "handle": "new_handle" }""")
            .Should().Be(PersonaAdminMessages.CannotBeChanged("handle"), "the whole patch is refused; nothing is half-applied");
        ParseInvalid("""{ "displayName": null, "exerciseId": "00000000-0000-0000-0000-000000000001" }""")
            .Should().Be(PersonaAdminMessages.CannotBeChanged("exerciseId"), "field names are checked before any value");
    }

    [Theory]
    [InlineData("avatarUrl")]
    [InlineData("bannerUrl")]
    [InlineData("DisplayName")]
    [InlineData("id")]
    [InlineData("castable")]
    [InlineData("audienceBand")]
    [InlineData("followerCount")]
    [InlineData("whatever")]
    public void UnknownField_IsRefused_NamingTheEditableFields(string field)
    {
        var message = ParseInvalid($$"""{ "{{field}}": "x" }""");

        message.Should().Be(PersonaAdminMessages.UnknownField(field));
        message.Should().Be(
            $"Unknown field '{field}'. Editable fields: displayName, bio, location, verified, avatarMediaId, bannerMediaId.");
    }

    [Fact]
    public void UnknownField_EchoesItsName_StrippedOfMarkup_AndLengthCapped()
    {
        var message = ParseInvalid("""{ "<script>alert(1)</script><b>x</b>": 1 }""");
        message.Should().Be(PersonaAdminMessages.UnknownField("x"));
        message.Should().NotContain("<").And.NotContain("script");

        var longName = new string('a', 500);
        var capped = ParseInvalid($$"""{ "{{longName}}": 1 }""");
        capped.Should().Contain(new string('a', 64) + "…'").And.NotContain(new string('a', 65));
    }

    [Fact]
    public void DuplicateField_IsRefused()
    {
        ParseInvalid("""{ "displayName": "One", "displayName": "Two" }""")
            .Should().Be(PersonaAdminMessages.DuplicateField("displayName"));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("[{\"displayName\":\"x\"}]")]
    [InlineData("\"displayName\"")]
    [InlineData("null")]
    [InlineData("42")]
    [InlineData("true")]
    public void NonObjectBody_IsRefused(string body)
    {
        ParseInvalid(body).Should().Be(PersonaAdminMessages.BodyNotObject);
    }

    [Theory]
    [InlineData("""{ "displayName": 42 }""", PersonaAdminMessages.DisplayNameType)]
    [InlineData("""{ "displayName": ["x"] }""", PersonaAdminMessages.DisplayNameType)]
    [InlineData("""{ "bio": 42 }""", PersonaAdminMessages.BioType)]
    [InlineData("""{ "bio": {} }""", PersonaAdminMessages.BioType)]
    [InlineData("""{ "location": true }""", PersonaAdminMessages.LocationType)]
    [InlineData("""{ "verified": "true" }""", PersonaAdminMessages.VerifiedType)]
    [InlineData("""{ "verified": 1 }""", PersonaAdminMessages.VerifiedType)]
    public void WrongValueType_IsRefused(string body, string expected)
    {
        ParseInvalid(body).Should().Be(expected);
    }

    [Theory]
    [InlineData("42")]
    [InlineData("\"\"")]
    [InlineData("\"not-a-guid\"")]
    [InlineData("\"00000000-0000-0000-0000-000000000000\"")]
    [InlineData("{}")]
    public void MalformedMediaId_GetsTheSameTextAsAnUnknownId(string value)
    {
        // DP-16: the service answers an unknown / cross-exercise / non-image id with exactly these strings, so a
        // malformed id must not be distinguishable either.
        ParseInvalid($$"""{ "avatarMediaId": {{value}} }""").Should().Be(PersonaAdminMessages.AvatarMediaNotFound);
        ParseInvalid($$"""{ "bannerMediaId": {{value}} }""").Should().Be(PersonaAdminMessages.BannerMediaNotFound);
    }

    [Fact]
    public void Text_IsSanitizedWithPostSanitizer_AndTrimmed()
    {
        var patch = ParseValid("""
            {
              "displayName": "  <b>Fulton</b> County EM  ",
              "bio": "<script>alert('x')</script>Official updates. <img src=x onerror=alert(1)>Stay safe.",
              "location": "<i>Fulton</i>, OH"
            }
            """);

        patch.DisplayName.Value.Should().Be("Fulton County EM");
        patch.Bio.Value.Should().Be("Official updates. Stay safe.", "NFR-004: script blocks and tags are stripped, never encoded");
        patch.Location.Value.Should().Be("Fulton, OH");
    }

    [Fact]
    public void Sanitization_StripsUntilStable_SoARebuiltTagCannotSurvive()
    {
        // One pass would turn "<<b>img src=x onerror=alert(1)>" into a live "<img …>" (BP Gate-1 M-2).
        var patch = ParseValid("""{ "bio": "Hi <<b>img src=x onerror=alert(1)>there" }""");

        patch.Bio.Value.Should().Be("Hi there");
    }

    [Fact]
    public void Text_KeepsLiteralCharacters_NeverEntityEncodes()
    {
        var patch = ParseValid("""{ "displayName": "Tom's \"Fish & Chips\" 3 < 4" }""");

        patch.DisplayName.Value.Should().Be("Tom's \"Fish & Chips\" 3 < 4", "strip, never encode (PostSanitizer)");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("<b></b>")]
    [InlineData("<script>alert(1)</script>")]
    public void DisplayName_EmptyAfterSanitizing_IsRefused(string value)
    {
        ParseInvalid(JsonSerializer.Serialize(new { displayName = value })).Should().Be(PersonaAdminMessages.DisplayNameLength);
    }

    [Fact]
    public void DisplayName_Bounds_1To100()
    {
        ParseValid(JsonSerializer.Serialize(new { displayName = "A" })).DisplayName.Value.Should().Be("A");
        ParseValid(JsonSerializer.Serialize(new { displayName = new string('n', 100) })).DisplayName.Value.Should().HaveLength(100);
        ParseInvalid(JsonSerializer.Serialize(new { displayName = new string('n', 101) })).Should().Be(PersonaAdminMessages.DisplayNameLength);
    }

    [Fact]
    public void Bio_Bound_512()
    {
        ParseValid(JsonSerializer.Serialize(new { bio = new string('b', 512) })).Bio.Value.Should().HaveLength(512);
        ParseInvalid(JsonSerializer.Serialize(new { bio = new string('b', 513) })).Should().Be(PersonaAdminMessages.BioLength);
    }

    [Fact]
    public void Location_Bound_100()
    {
        ParseValid(JsonSerializer.Serialize(new { location = new string('l', 100) })).Location.Value.Should().HaveLength(100);
        ParseInvalid(JsonSerializer.Serialize(new { location = new string('l', 101) })).Should().Be(PersonaAdminMessages.LocationLength);
    }

    [Fact]
    public void Bounds_AreMeasuredAfterSanitizing()
    {
        // Markup does not count against the bound: it is gone before the value is measured or stored.
        var bio = new string('b', 512) + "<b></b><script>x</script>";

        ParseValid(JsonSerializer.Serialize(new { bio })).Bio.Value.Should().Be(new string('b', 512));
    }

    [Theory]
    [InlineData("bio")]
    [InlineData("location")]
    public void ClearableText_EmptyAfterSanitizing_IsStoredAsNull(string field)
    {
        foreach (var value in new[] { "", "   ", "<b></b>" })
        {
            var patch = ParseValid(JsonSerializer.Serialize(new Dictionary<string, string> { [field] = value }));
            var parsed = field == "bio" ? patch.Bio : patch.Location;
            parsed.Should().Be(new PatchField<string?>(true, null), $"an empty {field} is the same as clearing it, so the wire never carries \"\"");
        }
    }

    [Fact]
    public void Messages_StateTheSameBoundsAsTheConstants()
    {
        PersonaProfilePatch.MaxDisplayNameLength.Should().Be(100);
        PersonaProfilePatch.MaxBioLength.Should().Be(512).And.Be(Persona.MaxBioLength);
        PersonaProfilePatch.MaxLocationLength.Should().Be(100).And.Be(Persona.MaxLocationLength);
        PersonaAdminMessages.DisplayNameLength.Should().Contain(PersonaProfilePatch.MaxDisplayNameLength.ToString(CultureInfo.InvariantCulture));
        PersonaAdminMessages.BioLength.Should().Contain(PersonaProfilePatch.MaxBioLength.ToString(CultureInfo.InvariantCulture));
        PersonaAdminMessages.LocationLength.Should().Contain(PersonaProfilePatch.MaxLocationLength.ToString(CultureInfo.InvariantCulture));
        PersonaAdminMessages.BodyTooLarge.Should().Contain(PersonaAdminEndpoints.MaxBodyBytes.ToString(CultureInfo.InvariantCulture));
    }

    [Fact]
    public void ApplyTo_ChangesOnlyThePresentFields_AndNeverTheImmutableOnes()
    {
        var exerciseId = Guid.NewGuid();
        var avatar = Guid.NewGuid();
        var persona = new Persona
        {
            Id = Guid.NewGuid(),
            ExerciseId = exerciseId,
            DisplayName = "Old name",
            Handle = "FulcoEM",
            Kind = "org",
            PersonaType = "agency",
            Verified = true,
            Bio = "Old bio",
            Location = "Old town",
            AvatarMediaId = avatar,
            BannerMediaId = Guid.NewGuid(),
        };

        ParseValid("""{ "displayName": "New name", "bannerMediaId": null }""").ApplyTo(persona);

        persona.DisplayName.Should().Be("New name");
        persona.BannerMediaId.Should().BeNull();
        persona.Bio.Should().Be("Old bio", "absent = unchanged");
        persona.Location.Should().Be("Old town");
        persona.Verified.Should().BeTrue();
        persona.AvatarMediaId.Should().Be(avatar);
        persona.Handle.Should().Be("FulcoEM");
        persona.Kind.Should().Be("org");
        persona.PersonaType.Should().Be("agency");
        persona.ExerciseId.Should().Be(exerciseId);
    }

    [Theory]
    [InlineData("displayName", 100, PersonaAdminMessages.DisplayNameLength)]
    [InlineData("bio", 512, PersonaAdminMessages.BioLength)]
    [InlineData("location", 100, PersonaAdminMessages.LocationLength)]
    public void RawValueOverFourTimesItsBound_IsRefusedBeforeSanitizing(string field, int bound, string expected)
    {
        // Gate-1 S-1. The value is almost all markup, so AFTER sanitizing it would be one character and pass. It is
        // refused anyway: the raw pre-check runs first, so the super-linear sanitizer never sees it.
        var raw = "x" + string.Concat(Enumerable.Repeat("<b>", ((bound * PersonaProfilePatchParser.RawLengthFactor) / 3) + 1));
        raw.Length.Should().BeGreaterThan(bound * PersonaProfilePatchParser.RawLengthFactor);

        ParseInvalid(JsonSerializer.Serialize(new Dictionary<string, string> { [field] = raw })).Should().Be(expected);
    }

    [Fact]
    public void RawValueAtFourTimesItsBound_IsSanitizedThenMeasured()
    {
        var raw = new string('b', 512) + string.Concat(Enumerable.Repeat("<i></i>", 219)) + "<b>";
        raw.Length.Should().Be(512 * PersonaProfilePatchParser.RawLengthFactor);

        ParseValid(JsonSerializer.Serialize(new { bio = raw })).Bio.Value.Should().Be(new string('b', 512));
    }

    [Theory]
    [InlineData("​")]
    [InlineData("​‌‍")]
    [InlineData("﻿⁠")]
    [InlineData("ㅤㅤ")]
    [InlineData("⠀")]
    [InlineData("ᅟᅠﾠ")]
    [InlineData("́̂")]
    [InlineData("​   ‌")]
    public void DisplayName_WithNoVisibleCharacter_IsRefused(string value)
    {
        // Gate-1 S-2: zero-width, format, combining-only and blank "filler" names pass 1..100 but render as nothing.
        ParseInvalid(JsonSerializer.Serialize(new { displayName = value })).Should().Be(PersonaAdminMessages.DisplayNameInvisible);
    }

    [Theory]
    [InlineData("Fulcо EM")] // Cyrillic о
    [InlineData("Fulton Cоunty ЕМ")] // Cyrillic о, Е, М
    [InlineData("FuIcoEM")] // capital I for l
    [InlineData("Ful​co EM")] // a zero-width space INSIDE a visible name
    [InlineData("\U0001F6A8")] // an emoji alone is visible
    [InlineData("福尔顿")] // CJK
    public void DisplayName_LookalikesAndOtherScripts_StayAllowed(string value)
    {
        // SOC-052: impersonation training needs lookalike names. Only invisibility and control/bidi are refused.
        ParseValid(JsonSerializer.Serialize(new { displayName = value })).DisplayName.Value.Should().Be(value);
    }

    [Theory]
    [InlineData("\u0000")]
    [InlineData("\u0007")]
    [InlineData("\u001B")]
    [InlineData("\u007F")]
    [InlineData("\u0085")]
    [InlineData("\u009F")]
    [InlineData("‪")]
    [InlineData("‮")]
    [InlineData("⁦")]
    [InlineData("⁩")]
    public void ControlAndBidiOverrideCharacters_AreRefused_InEveryTextField(string bad)
    {
        var value = "Ful" + bad + "co";

        ParseInvalid(JsonSerializer.Serialize(new { displayName = value })).Should().Be(PersonaAdminMessages.DisplayNameForbiddenCharacter);
        ParseInvalid(JsonSerializer.Serialize(new { bio = value })).Should().Be(PersonaAdminMessages.BioForbiddenCharacter);
        ParseInvalid(JsonSerializer.Serialize(new { location = value })).Should().Be(PersonaAdminMessages.LocationForbiddenCharacter);
    }

    [Theory]
    [InlineData("\n")]
    [InlineData("\r")]
    [InlineData("\t")]
    public void LineBreaksAndTabs_AreAllowedInBioOnly(string separator)
    {
        var value = "First line" + separator + "second line";

        ParseValid(JsonSerializer.Serialize(new { bio = value })).Bio.Value.Should().Be(value, "a multi-line bio is legitimate");
        ParseInvalid(JsonSerializer.Serialize(new { displayName = value })).Should().Be(PersonaAdminMessages.DisplayNameForbiddenCharacter);
        ParseInvalid(JsonSerializer.Serialize(new { location = value })).Should().Be(PersonaAdminMessages.LocationForbiddenCharacter);
    }

    [Fact]
    public void EchoedName_IsNeverCutInsideASurrogatePair()
    {
        // Gate-1 S-3: the 64-unit cut lands between the halves of an emoji; it must back off one unit.
        var name = new string('a', 63) + "\U0001F600" + "tail";

        var message = ParseInvalid(JsonSerializer.Serialize(new Dictionary<string, int> { [name] = 1 }));

        message.Should().Be(PersonaAdminMessages.UnknownField(name));
        message.Should().Contain(new string('a', 63) + "…'");
        for (var i = 0; i < message.Length; i++)
        {
            if (char.IsHighSurrogate(message[i]))
            {
                (i + 1 < message.Length && char.IsLowSurrogate(message[i + 1])).Should().BeTrue("a lone high surrogate is not valid text");
            }
        }
    }

    [Fact]
    public void EchoedName_KeepsAWholeSurrogatePairThatFitsTheCap()
    {
        var name = new string('a', 62) + "\U0001F600" + "tail";

        ParseInvalid(JsonSerializer.Serialize(new Dictionary<string, int> { [name] = 1 }))
            .Should().Contain(new string('a', 62) + "\U0001F600" + "…'");
    }

    private static PersonaProfilePatch ParseValid(string json)
    {
        using var document = JsonDocument.Parse(json);
        PersonaProfilePatchParser.TryParse(document.RootElement, out var patch, out var error)
            .Should().BeTrue($"the body should be valid, but was refused with: {error}");
        return patch!;
    }

    private static string ParseInvalid(string json)
    {
        using var document = JsonDocument.Parse(json);
        PersonaProfilePatchParser.TryParse(document.RootElement, out var patch, out var error)
            .Should().BeFalse("the body should be refused");
        patch.Should().BeNull();
        return error!;
    }
}
