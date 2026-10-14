namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (issuer, factory and registration AC) — <see cref="RosterLinkDtoFactory"/> turns a
/// <see cref="ParticipantLink"/> (or none) into the frozen <see cref="RosterLinkDto"/>: the status, <c>joinUrl</c> ONLY
/// when the link is active and its token is recoverable, and <c>needsReissue</c> when it is active but cannot be
/// decrypted (a lost key ring), never an exception.
/// </summary>
public sealed class RosterLinkDtoFactoryTests
{
    private const string Base = "https://pulse-uat.cobrasoftware.com";

    private static readonly DateTimeOffset IssuedAt = new(2026, 10, 14, 8, 30, 0, TimeSpan.FromHours(-4));

    private readonly EphemeralDataProtectionProvider _keyRing = new();

    private RosterLinkDtoFactory FactoryFor(string? frontendBaseUrl = Base, IDataProtectionProvider? keyRing = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [JoinUrlBuilder.FrontendBaseUrlKey] = frontendBaseUrl })
            .Build();

        return new RosterLinkDtoFactory(
            new ParticipantLinkTokenProtector(keyRing ?? _keyRing), new JoinUrlBuilder(configuration));
    }

    private ParticipantLink ActiveLink(out string token, IDataProtectionProvider? keyRing = null)
    {
        token = ParticipantLinkTokens.Generate();
        return new ParticipantLink
        {
            Id = Guid.NewGuid(),
            ExerciseId = Guid.NewGuid(),
            AccountId = Guid.NewGuid(),
            TokenHash = ParticipantLinkTokens.Hash(token),
            ProtectedToken = new ParticipantLinkTokenProtector(keyRing ?? _keyRing).Protect(token),
            Generation = 1,
            IssuedAt = IssuedAt,
            UseCount = 3,
            LastUsedAt = IssuedAt.AddHours(2),
        };
    }

    [Fact]
    public void NoLink_IsStatusNone_WithAZeroUseCount_AndNothingElse()
    {
        var dto = FactoryFor().Create(null);

        dto.Status.Should().Be("none");
        dto.UseCount.Should().Be(0);
        Keys(dto).Should().BeEquivalentTo(["status", "useCount"], "an account with no link reports only its status and count");
    }

    [Fact]
    public void ActiveRecoverableLink_CarriesTheJoinUrl_AndNoReissueFlag()
    {
        var link = ActiveLink(out var token);

        var dto = FactoryFor().Create(link);

        dto.Status.Should().Be("active");
        dto.JoinUrl.Should().Be($"{Base}/join/{token}", "an active link whose token decrypts yields its join URL");
        dto.NeedsReissue.Should().BeNull("a recoverable link does not need a reissue (omitted on the wire)");
        dto.UseCount.Should().Be(3);
        dto.IssuedAt.Should().Be(IssuedAt.ToString("O"), "instants are ISO-8601 round-trip strings");
        dto.LastUsedAt.Should().Be(IssuedAt.AddHours(2).ToString("O"));
        dto.RevokedAt.Should().BeNull();
    }

    [Fact]
    public void ActiveRecoverableLink_WithNoJoinBaseConfigured_OmitsTheUrl_ButDoesNotAskForAReissue()
    {
        var link = ActiveLink(out _);

        var dto = FactoryFor(frontendBaseUrl: null).Create(link);

        dto.Status.Should().Be("active");
        dto.JoinUrl.Should().BeNull("with no SPA origin configured the URL is unavailable, never guessed");
        dto.NeedsReissue.Should().BeNull("the token itself is fine; reissuing would not help");
    }

    [Fact]
    public void ActiveLink_WhoseKeyRingIsGone_NeedsReissue_AndHasNoJoinUrl()
    {
        var link = ActiveLink(out _, keyRing: new EphemeralDataProtectionProvider());

        var act = () => FactoryFor().Create(link);

        act.Should().NotThrow("a lost key ring is reported, never a 500");
        var dto = act();
        dto.Status.Should().Be("active");
        dto.NeedsReissue.Should().BeTrue();
        dto.JoinUrl.Should().BeNull();
    }

    [Fact]
    public void ActiveLink_WithNoProtectedCopy_NeedsReissue()
    {
        var link = ActiveLink(out _);
        link.ProtectedToken = null;

        var dto = FactoryFor().Create(link);

        dto.NeedsReissue.Should().BeTrue();
        dto.JoinUrl.Should().BeNull();
    }

    [Fact]
    public void ActiveLink_WhoseCopyDecryptsToAnotherToken_NeedsReissue_RatherThanPrintingADeadLink()
    {
        var link = ActiveLink(out _);
        link.ProtectedToken = new ParticipantLinkTokenProtector(_keyRing).Protect(ParticipantLinkTokens.Generate());

        var dto = FactoryFor().Create(link);

        dto.JoinUrl.Should().BeNull("a copy that does not hash to TokenHash would produce a link that does not sign in");
        dto.NeedsReissue.Should().BeTrue();
    }

    [Fact]
    public void RevokedLink_IsStatusRevoked_WithItsInstants_AndNeverAJoinUrl()
    {
        var link = ActiveLink(out _);
        var revokedAt = IssuedAt.AddDays(1);
        link.RevokedAt = revokedAt;

        var dto = FactoryFor().Create(link);

        dto.Status.Should().Be("revoked");
        dto.RevokedAt.Should().Be(revokedAt.ToString("O"));
        dto.IssuedAt.Should().Be(IssuedAt.ToString("O"));
        dto.UseCount.Should().Be(3);
        dto.JoinUrl.Should().BeNull("a revoked link is never handed out, even if a stale copy still decrypts");
        dto.NeedsReissue.Should().BeNull();
    }

    [Fact]
    public void Constructor_RefusesNullCollaborators()
    {
        var builder = new JoinUrlBuilder(new ConfigurationBuilder().Build());
        var protector = new ParticipantLinkTokenProtector(_keyRing);

        ((Action)(() => _ = new RosterLinkDtoFactory(null!, builder))).Should().Throw<ArgumentNullException>();
        ((Action)(() => _ = new RosterLinkDtoFactory(protector, null!))).Should().Throw<ArgumentNullException>();
    }

    private static IEnumerable<string> Keys(RosterLinkDto dto) =>
        JsonNode.Parse(JsonSerializer.Serialize(dto))!.AsObject().Select(p => p.Key).ToList();
}
