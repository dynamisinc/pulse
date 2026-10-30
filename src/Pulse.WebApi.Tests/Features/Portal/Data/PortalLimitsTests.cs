namespace Pulse.WebApi.Tests.Features.Portal.Data;

using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Portal.Data;

/// <summary>
/// exercise-portal/01 — the PC-1 limits guard stories 03/04/16 call before writing: masthead name ≤ 60 characters,
/// <c>ModulesJson</c> / <c>SkinOverridesJson</c> ≤ 4 KB, ≤ 25 live resources. Over-cap input is refused with a readable
/// reason that names the field and the limit. Pure; no database.
/// </summary>
public class PortalLimitsTests
{
    [Fact]
    public void TheLimits_AreThePc1Numbers()
    {
        PortalLimits.MaxMastheadNameLength.Should().Be(60);
        PortalLimits.MaxJsonBytes.Should().Be(4096);
        PortalLimits.MaxResources.Should().Be(25);
    }

    [Fact]
    public void AConfigAtEveryLimit_IsValid()
    {
        var result = PortalLimits.CheckConfig(new string('a', 60), Json(4096), Json(4096));

        result.IsValid.Should().BeTrue();
        result.Errors.Should().BeEmpty();
    }

    [Fact]
    public void NullOptionalFields_AreValid_TheyMeanTheDefaults()
    {
        PortalLimits.CheckConfig(portalName: null, modulesJson: "[]", skinOverridesJson: null).IsValid.Should().BeTrue();
    }

    [Fact]
    public void AMastheadNameOverSixtyCharacters_IsRefused_WithAReadableReason()
    {
        var result = PortalLimits.CheckConfig(new string('a', 61), "[]", null);

        result.IsValid.Should().BeFalse();
        result.Errors.Should().ContainSingle().Which.Should().Be("The masthead name is 61 characters; the limit is 60.");
    }

    [Fact]
    public void TheMastheadLimit_CountsCharacters_NotUtf16Units()
    {
        // 60 emoji are 120 UTF-16 units: within the limit, and within F01's 120-unit column.
        var sixtyEmoji = string.Concat(Enumerable.Repeat("\U0001F300", 60));
        sixtyEmoji.Length.Should().Be(120);

        PortalLimits.CheckConfig(sixtyEmoji, "[]", null).IsValid.Should().BeTrue();
        PortalLimits.CheckConfig(sixtyEmoji + "\U0001F300", "[]", null).IsValid.Should().BeFalse();
        (PortalConfig.MaxPortalNameLength >= PortalLimits.MaxMastheadNameLength * 2).Should().BeTrue(
            "the column must hold the longest name the guard allows");
    }

    [Theory]
    [InlineData("module list", true)]
    [InlineData("skin overrides", false)]
    public void AJsonFieldOverFourKilobytes_IsRefused_NamingTheFieldAndTheLimit(string label, bool modules)
    {
        var over = Json(4097);

        var result = modules ? PortalLimits.CheckConfig(null, over, null) : PortalLimits.CheckConfig(null, "[]", over);

        result.Errors.Should().ContainSingle().Which.Should().Be(
            $"The {label} is 4097 bytes; the limit is 4096 bytes (4 KB).");
    }

    [Fact]
    public void TheJsonLimit_CountsUtf8Bytes()
    {
        // 'é' is one UTF-16 unit but two UTF-8 bytes: quoted, 2,046 of them are 4,094 bytes and 2,048 are 4,098.
        PortalLimits.CheckConfig(null, $"\"{new string('é', 2046)}\"", null).IsValid.Should().BeTrue();
        PortalLimits.CheckConfig(null, $"\"{new string('é', 2048)}\"", null).IsValid.Should().BeFalse();
    }

    [Fact]
    public void EveryLimitExceeded_IsReported_NotJustTheFirst()
    {
        var result = PortalLimits.CheckConfig(new string('a', 61), Json(5000), Json(5000));

        result.Errors.Should().HaveCount(3);
    }

    [Fact]
    public void CheckConfig_OnAnEntity_ChecksItsLimitedFields()
    {
        var config = new PortalConfig { LayoutKey = "anchor", PortalName = new string('a', 61), ModulesJson = "[]" };

        PortalLimits.CheckConfig(config).IsValid.Should().BeFalse();
        config.PortalName = "Kestrel Today";
        PortalLimits.CheckConfig(config).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData(0, 1, true)]
    [InlineData(24, 1, true)]
    [InlineData(0, 25, true)]
    [InlineData(25, 0, true)]
    [InlineData(25, 1, false)]
    [InlineData(20, 6, false)]
    public void TheResourceCap_IsTwentyFiveLiveResources(int liveCount, int adding, bool valid)
    {
        PortalLimits.CheckResourceCount(liveCount, adding).IsValid.Should().Be(valid);
    }

    [Fact]
    public void AResourceOverTheCap_IsRefused_WithAReadableReason()
    {
        PortalLimits.CheckResourceCount(25).Errors.Should().ContainSingle().Which.Should().Be(
            "The portal already has 25 resources; adding 1 would exceed the limit of 25.");
    }

    [Fact]
    public void NegativeCounts_AreAProgrammingError()
    {
        var negativeLive = () => PortalLimits.CheckResourceCount(-1);
        var negativeAdding = () => PortalLimits.CheckResourceCount(0, -1);

        negativeLive.Should().Throw<ArgumentOutOfRangeException>();
        negativeAdding.Should().Throw<ArgumentOutOfRangeException>();
    }

    /// <summary>A JSON string literal of exactly <paramref name="bytes"/> UTF-8 bytes.</summary>
    private static string Json(int bytes) => $"\"{new string('x', bytes - 2)}\"";
}
