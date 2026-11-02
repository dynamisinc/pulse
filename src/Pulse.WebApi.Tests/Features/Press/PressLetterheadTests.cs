namespace Pulse.WebApi.Tests.Features.Press;

using System.Text.Json.Nodes;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Outlets;

/// <summary>
/// Press story 01 (#738), letterhead defaults: an org newsroom's address and default contact live in
/// <c>SkinOverridesJson.ext.press</c> (F03's allowlist, size cap and value rules apply), and an org without them reads as a
/// NEUTRAL letterhead, never a platform-branded one.
/// </summary>
public sealed class PressLetterheadTests
{
    private const string SkinKey = "wire-room";

    private static readonly ContentMediaDto Logo = new()
    {
        Id = "m-1", Kind = "image", Role = "hero", Url = "/media/m-1", ContentType = "image/png", Alt = "Fulton County EM logo",
    };

    private readonly ISkinOverridesValidator _validator = new SkinOverridesValidator();

    [Fact]
    public void NoOverrides_IsANeutralLetterhead()
    {
        var neutral = PressLetterhead.Read(null, null);

        neutral.Logo.Should().BeNull();
        neutral.Address.Should().BeNull();
        neutral.DefaultContact.Should().BeNull();
        PressLetterhead.Read("""{"palette":{"accent":"#123456"}}""", Logo).Should().Be(new ReleaseLetterheadDto { Logo = Logo });
        PressLetterhead.Read("not json", Logo).Should().Be(new ReleaseLetterheadDto { Logo = Logo });
    }

    [Fact]
    public void Write_ThenRead_RoundTripsTheLetterhead_ThroughF03sValidator_KeepingOtherOverrides()
    {
        var existing = new JsonObject { ["palette"] = new JsonObject { ["accent"] = "#1a2b3c" } };
        var contact = new ReleaseContactDto { Name = "Jordan Alvarez", Title = "Public Information Officer", Phone = "404-555-0142" };

        var (overrides, errors) = PressLetterhead.Write(_validator, SkinKey, existing, "141 Pryor St SW, Atlanta, GA 30303", contact);

        errors.Should().BeEmpty();
        overrides!["palette"]!["accent"]!.GetValue<string>().Should().Be("#1a2b3c");
        overrides["ext"]!["press"]!.AsObject().Select(p => p.Key).Should().BeSubsetOf(PressVocabulary.LetterheadExtKeys);
        existing["ext"].Should().BeNull("the input is not mutated");

        var read = PressLetterhead.Read(overrides.ToJsonString(), Logo);
        read.Logo.Should().Be(Logo);
        read.Address.Should().Be("141 Pryor St SW, Atlanta, GA 30303");
        read.DefaultContact.Should().Be(contact);
    }

    [Fact]
    public void Write_RemovesAClearedField_AndCapsLength()
    {
        var (first, _) = PressLetterhead.Write(_validator, SkinKey, null, "141 Pryor St SW", new ReleaseContactDto { Name = "J. Alvarez" });
        var (cleared, errors) = PressLetterhead.Write(_validator, SkinKey, first, null, null);

        errors.Should().BeEmpty();
        PressLetterhead.Read(cleared!.ToJsonString(), null).Should().Be(new ReleaseLetterheadDto());

        var (_, tooLong) = PressLetterhead.Write(_validator, SkinKey, null, new string('a', 301), null);
        tooLong.Should().ContainSingle().Which.Should().Contain("letterheadAddress");
    }

    [Fact]
    public void Write_RefusesWhatF03RefusesToday_AnEmailWithItsAtSign()
    {
        // Pinned on purpose: F03 validates ext strings as CSS-safe values and refuses '@'. A default contact email cannot
        // be stored until F03 gives the ext.press.letterhead* keys text rules (foundation follow-up raised by press 01).
        var (overrides, errors) = PressLetterhead.Write(
            _validator, SkinKey, null, null, new ReleaseContactDto { Name = "J. Alvarez", Email = "pio@fulton-em.example" });

        overrides.Should().BeNull();
        errors.Should().ContainSingle().Which.Should().Contain("ext.press.letterheadContactEmail");
    }

    [Fact]
    public void Read_IgnoresAnOverLongOrNonStringValue()
    {
        var json = new JsonObject
        {
            ["ext"] = new JsonObject
            {
                ["press"] = new JsonObject { ["letterheadAddress"] = new string('a', 301), ["letterheadContactName"] = 7 },
            },
        }.ToJsonString();

        PressLetterhead.Read(json, null).Should().Be(new ReleaseLetterheadDto());
    }
}
