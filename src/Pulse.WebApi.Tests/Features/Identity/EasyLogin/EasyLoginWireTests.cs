namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 review S-1 — the contract's two wire formats are culture-proof. <see cref="EasyLoginWire"/> writes an
/// instant as invariant <c>"O"</c> and a date as invariant Gregorian <c>yyyy-MM-dd</c>, and the link DTO factory and the
/// telemetry payloads format through it, so a server (or test runner) whose current culture is Turkish, Saudi (Umm
/// al-Qura calendar), Thai (Buddhist calendar) or Persian still puts <c>2026-10-20</c> on the wire, never
/// <c>1448-05-09</c>.
/// </summary>
public sealed class EasyLoginWireTests
{
    private static readonly DateOnly Date = new(2026, 10, 20);
    private static readonly DateTimeOffset Instant = new(2026, 10, 20, 13, 45, 0, TimeSpan.FromHours(-4));

    [Theory]
    [InlineData("tr-TR")]
    [InlineData("ar-SA")]
    [InlineData("th-TH")]
    [InlineData("fa-IR")]
    [InlineData("en-US")]
    public void InstantAndDate_AreInvariant_WhateverTheCurrentCulture(string culture)
    {
        WithCulture(culture, () =>
        {
            EasyLoginWire.Date(Date).Should().Be("2026-10-20", "a wire date is Gregorian yyyy-MM-dd under {0}", culture);
            EasyLoginWire.Instant(Instant).Should().Be(
                "2026-10-20T13:45:00.0000000-04:00", "a wire instant is invariant round-trip \"O\" under {0}", culture);
        });
    }

    [Theory]
    [InlineData("ar-SA")]
    [InlineData("th-TH")]
    public void TheHazardIsReal_ACultureSensitiveFormatWouldPutAnotherCalendarOnTheWire(string culture)
    {
        // The precondition that makes the test above meaningful: under these cultures the current calendar is not
        // Gregorian, so formatting with the current culture really would corrupt the date.
        WithCulture(culture, () =>
            Date.ToString(EasyLoginWire.DateFormat, CultureInfo.CurrentCulture).Should().NotBe("2026-10-20"));
    }

    [Theory]
    [InlineData("ar-SA")]
    [InlineData("th-TH")]
    public void TheLinkFactory_AndTheTelemetryPayloads_FormatThroughTheWire(string culture)
    {
        var keyRing = new EphemeralDataProtectionProvider();
        var token = ParticipantLinkTokens.Generate();
        var link = new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            AccountId = Guid.NewGuid(),
            TokenHash = ParticipantLinkTokens.Hash(token),
            ProtectedToken = new ParticipantLinkTokenProtector(keyRing).Protect(token),
            Generation = 1,
            IssuedAt = Instant,
            LastUsedAt = Instant,
            RevokedAt = Instant,
        };
        var factory = new RosterLinkDtoFactory(
            new ParticipantLinkTokenProtector(keyRing),
            new JoinUrlBuilder(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build()));

        WithCulture(culture, () =>
        {
            var dto = factory.Create(link);
            dto.IssuedAt.Should().Be(EasyLoginWire.Instant(Instant));
            dto.RevokedAt.Should().Be("2026-10-20T13:45:00.0000000-04:00");
            dto.LastUsedAt.Should().Be("2026-10-20T13:45:00.0000000-04:00");

            var time = new EasyLoginEventTime(Instant, Instant, "UTC");
            var staff = new EasyLoginStaffActor(Guid.NewGuid(), "planner");
            var set = EasyLoginTelemetry.DayWordSet(Guid.NewGuid(), staff, Guid.NewGuid(), Date, first: true, generated: true, time);
            var cleared = EasyLoginTelemetry.DayWordCleared(Guid.NewGuid(), staff, Guid.NewGuid(), Date, time);

            JsonNode.Parse(set.Payload!)!["date"]!.GetValue<string>().Should().Be("2026-10-20");
            JsonNode.Parse(cleared.Payload!)!["date"]!.GetValue<string>().Should().Be("2026-10-20");
        });
    }

    private static void WithCulture(string name, Action action)
    {
        var previous = CultureInfo.CurrentCulture;
        var previousUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(name);
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(name);
            action();
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
            CultureInfo.CurrentUICulture = previousUi;
        }
    }
}
