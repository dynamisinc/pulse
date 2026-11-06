namespace Pulse.WebApi.Tests.Features.Channels.Alerts;

using System;
using System.Linq;
using System.Reflection;
using FluentAssertions;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Contracts;
using Xunit;

/// <summary>
/// Channels-foundation story 10, the raise rules every raiser shares: frozen severities, a plain-text headline of
/// 1..200 code points kept verbatim after sanitizing (D4-010), a host-relative <c>href</c> (FC-9.3), a known source, a
/// future scenario-time expiry — and no way at all to mark an alert out-of-fiction (SHELL-CONTRACT §2).
/// </summary>
public sealed class AlertRaiseValidatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 3, 14, 0, 0, TimeSpan.FromHours(-6));

    [Theory]
    [InlineData("info")]
    [InlineData("advisory")]
    [InlineData("emergency")]
    public void EachFrozenSeverity_IsAccepted(string severity)
    {
        var result = AlertRaiseValidator.Validate(Raise() with { Severity = severity }, Now);

        result.Error.Should().BeNull();
        result.Raise!.Severity.Should().Be(severity);
    }

    [Theory]
    [InlineData("warning")]
    [InlineData("Emergency")]
    [InlineData("")]
    [InlineData(null)]
    public void AnyOtherSeverity_IsRefused(string? severity)
    {
        AlertRaiseValidator.Validate(Raise() with { Severity = severity! }, Now).Error
            .Should().Contain("severity");
    }

    [Fact]
    public void Headline_IsKeptVerbatim_ApartFromTrimming()
    {
        const string headline = "Tornado Warning for Fairhaven County until 3:45 PM CST — take shelter now";

        var result = AlertRaiseValidator.Validate(Raise() with { Headline = $"  {headline}\t" }, Now);

        result.Raise!.Headline.Should().Be(headline, "the bar, the post and the product page carry the same string (D4-010)");
    }

    [Fact]
    public void Headline_Markup_IsStripped_NeverEncoded()
    {
        var result = AlertRaiseValidator.Validate(
            Raise() with { Headline = "<b>Boil water</b> notice<script>alert(1)</script>" }, Now);

        result.Raise!.Headline.Should().Be("Boil water notice");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("<script>x</script>")]
    [InlineData(null)]
    public void Headline_ThatIsEmptyAfterSanitizing_IsRefused(string? headline)
    {
        AlertRaiseValidator.Validate(Raise() with { Headline = headline! }, Now).Error.Should().Contain("headline");
    }

    [Fact]
    public void Headline_LengthIsCountedInCodePoints_Bounded200()
    {
        var mixed = string.Concat(Enumerable.Repeat("🌪", 100)) + new string('a', 100);
        AlertRaiseValidator.Validate(Raise() with { Headline = mixed }, Now).Error
            .Should().BeNull("200 code points; an emoji counts once");

        AlertRaiseValidator.Validate(Raise() with { Headline = new string('a', 201) }, Now).Error
            .Should().Contain("headline");
    }

    [Fact]
    public void Headline_IsAlsoHeldToTheStoredUtf16Bound()
    {
        // 151 emoji = 151 code points (under 200) but 302 UTF-16 units (over the nvarchar(300) column).
        var emoji = string.Concat(Enumerable.Repeat("🌪", 151));

        AlertRaiseValidator.Validate(Raise() with { Headline = emoji }, Now).Error.Should().Contain("headline");
        AlertRaiseValidator.Validate(Raise() with { Headline = string.Concat(Enumerable.Repeat("🌪", 150)) }, Now)
            .Error.Should().BeNull();
    }

    [Theory]
    [InlineData("/weather/weather-desk/tornado-warning-1")]
    [InlineData("/alerts")]
    [InlineData(null)]
    public void Href_HostRelativeOrNull_IsAccepted(string? href)
    {
        AlertRaiseValidator.Validate(Raise() with { Href = href }, Now).Raise!.Href.Should().Be(href);
    }

    [Theory]
    [InlineData("https://evil.example/x")]
    [InlineData("//evil.example/x")]
    [InlineData("weather/x")]
    [InlineData("/\\evil")]
    [InlineData("/a\tb")]
    [InlineData("")]
    public void Href_ThatIsNotHostRelative_IsRefused(string href)
    {
        AlertRaiseValidator.Validate(Raise() with { Href = href }, Now).Error.Should().Contain("href");
    }

    [Fact]
    public void Href_LongerThanTheColumn_IsRefused()
    {
        AlertRaiseValidator.Validate(Raise() with { Href = "/" + new string('a', 512) }, Now).Error
            .Should().Contain("href");
    }

    [Theory]
    [InlineData("weather")]
    [InlineData("news")]
    [InlineData("system")]
    public void Source_ChannelIdOrSystem_IsAccepted(string source)
    {
        AlertRaiseValidator.Validate(Raise() with { SourceChannel = source }, Now).Error.Should().BeNull();
    }

    [Theory]
    [InlineData("tv")]
    [InlineData("System")]
    [InlineData("")]
    public void Source_Unknown_IsRefused(string source)
    {
        AlertRaiseValidator.Validate(Raise() with { SourceChannel = source }, Now).Error.Should().Contain("sourceChannel");
    }

    [Fact]
    public void SourceContentId_Empty_IsRefused()
    {
        AlertRaiseValidator.Validate(Raise() with { SourceContentId = Guid.Empty }, Now).Error
            .Should().Contain("sourceContentId");
    }

    [Fact]
    public void Expiry_InTheScenarioFuture_IsParsed()
    {
        var result = AlertRaiseValidator.Validate(Raise() with { ExpiresScenarioTime = "2026-12-03T21:45:00Z" }, Now);

        result.Raise!.ExpiresScenarioTime.Should().Be(new DateTimeOffset(2026, 12, 3, 21, 45, 0, TimeSpan.Zero));
    }

    [Theory]
    [InlineData("2026-12-03T20:00:00Z")] // == Now (14:00 -06:00)
    [InlineData("2026-12-03T13:00:00-06:00")]
    public void Expiry_AtOrBeforeScenarioNow_IsRefused(string expires)
    {
        AlertRaiseValidator.Validate(Raise() with { ExpiresScenarioTime = expires }, Now).Error
            .Should().Contain("later than the current scenario time");
    }

    [Theory]
    [InlineData("tomorrow")]
    [InlineData("2026-12-04T10:00:00")] // no offset: refused rather than guessed
    [InlineData("")]
    public void Expiry_ThatIsNotAnInstantWithAnOffset_IsRefused(string expires)
    {
        AlertRaiseValidator.Validate(Raise() with { ExpiresScenarioTime = expires }, Now).Error
            .Should().Contain("ISO 8601");
    }

    [Fact]
    public void Caller_MustHaveAKnownOriginAndAnActingHuman()
    {
        AlertRaiseValidator.ValidateCaller(Caller()).Should().BeNull();
        AlertRaiseValidator.ValidateCaller(null).Should().NotBeNull();
        AlertRaiseValidator.ValidateCaller(Caller() with { Origin = "system" }).Should().Contain("Origin");
        AlertRaiseValidator.ValidateCaller(Caller() with { ActingHumanId = " " }).Should().Contain("ActingHumanId");
        AlertRaiseValidator.ValidateCaller(Caller() with { Origin = "inject" }).Should().Contain("InjectId",
            "the v0 schema requires injectId whenever origin is inject");
        AlertRaiseValidator.ValidateCaller(Caller() with { Origin = "inject", InjectId = Guid.NewGuid() }).Should().BeNull();
    }

    [Fact]
    public void NoRaisePath_OffersAWayToMarkAnAlertOutOfFiction()
    {
        // SHELL-CONTRACT §2: a real-world message is ONLY the break-fiction overlay. Neither the in-process raise, the
        // staff request body nor the wire shape has a member that could carry a register or a real-world flag.
        var forbidden = new[] { "real", "register", "fiction", "world", "exercise", "break" };
        foreach (var type in new[] { typeof(AlertRaise), typeof(StaffAlertRaiseRequest), typeof(AlertDto) })
        {
            var names = type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name.ToLowerInvariant());
            names.Should().NotContain(
                name => forbidden.Any(word => name.Contains(word, StringComparison.Ordinal)),
                "{0} must offer no out-of-fiction marker", type.Name);
        }

        typeof(IAlertRaiser).GetMethods().SelectMany(m => m.GetParameters()).Select(p => p.ParameterType)
            .Should().OnlyContain(t => t == typeof(AlertRaise) || t == typeof(ContentCaller) || t == typeof(Guid)
                || t == typeof(System.Threading.CancellationToken));
    }

    private static AlertRaise Raise() => new()
    {
        Severity = ChannelVocabulary.SeverityEmergency,
        Headline = "Tornado Warning for Fairhaven County",
        SourceChannel = ChannelVocabulary.Weather,
    };

    private static ContentCaller Caller() => new() { Origin = ChannelVocabulary.OriginController, ActingHumanId = "h-1" };
}
