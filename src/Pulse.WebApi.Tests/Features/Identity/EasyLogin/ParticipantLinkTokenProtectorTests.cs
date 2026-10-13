namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using FluentAssertions;
using Microsoft.AspNetCore.DataProtection;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.EasyLogin;

/// <summary>
/// easy-login/01 (Tokens AC, EL-5) — <see cref="ParticipantLinkTokenProtector"/> round-trips a link token under its
/// fixed Data Protection purpose, and returns <c>null</c>, NEVER throwing, for anything it cannot turn back into a
/// token: tampered text, text protected under another purpose, a key ring that no longer holds the key, garbage, and
/// empty input. That soft failure is what lets the roster say <c>needsReissue</c> instead of answering 500.
/// </summary>
public sealed class ParticipantLinkTokenProtectorTests
{
    private readonly EphemeralDataProtectionProvider _provider = new();

    [Fact]
    public void Protect_ThenUnprotect_RoundTripsTheToken()
    {
        var protector = new ParticipantLinkTokenProtector(_provider);
        var token = ParticipantLinkTokens.Generate();

        var protectedToken = protector.Protect(token);

        protectedToken.Should().NotContain(token, "the stored copy is ciphertext, not the token");
        protectedToken.Length.Should().BeLessThanOrEqualTo(
            ParticipantLink.MaxProtectedTokenLength, "it must fit the nvarchar(512) ProtectedToken column");
        protector.Unprotect(protectedToken).Should().Be(token);
    }

    [Fact]
    public void Unprotect_TamperedText_ReturnsNull_AndDoesNotThrow()
    {
        var protector = new ParticipantLinkTokenProtector(_provider);
        var protectedToken = protector.Protect(ParticipantLinkTokens.Generate());

        // Flip one character in the middle of the payload (the authenticated ciphertext).
        var chars = protectedToken.ToCharArray();
        var middle = chars.Length / 2;
        chars[middle] = chars[middle] == 'A' ? 'B' : 'A';
        var tampered = new string(chars);

        var act = () => protector.Unprotect(tampered);

        act.Should().NotThrow();
        protector.Unprotect(tampered).Should().BeNull("a tampered payload fails authentication and is unrecoverable");
    }

    [Fact]
    public void Unprotect_TextProtectedUnderAnotherPurpose_ReturnsNull()
    {
        var protector = new ParticipantLinkTokenProtector(_provider);
        var token = ParticipantLinkTokens.Generate();
        var otherPurpose = _provider.CreateProtector("Pulse.SomethingElse").Protect(token);

        protector.Unprotect(otherPurpose).Should().BeNull(
            "a payload protected for any other purpose must never read back as a link token");
    }

    [Fact]
    public void Unprotect_WhenTheKeyRingNoLongerHoldsTheKey_ReturnsNull()
    {
        // A lost App Service key ring (or a slot swap) is modelled by a second provider with its own fresh keys.
        var before = new ParticipantLinkTokenProtector(new EphemeralDataProtectionProvider());
        var protectedToken = before.Protect(ParticipantLinkTokens.Generate());

        var after = new ParticipantLinkTokenProtector(new EphemeralDataProtectionProvider());

        var act = () => after.Unprotect(protectedToken);

        act.Should().NotThrow("a missing key is an inconvenience (needsReissue), never an outage");
        after.Unprotect(protectedToken).Should().BeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64url!!")]
    [InlineData("CfDJ8AAAAAAAAAAAAAAAAAAAAAA")]
    public void Unprotect_EmptyOrGarbage_ReturnsNull(string? input)
    {
        var protector = new ParticipantLinkTokenProtector(_provider);

        var act = () => protector.Unprotect(input);

        act.Should().NotThrow();
        protector.Unprotect(input).Should().BeNull();
    }

    [Fact]
    public void Protect_UsesTheFixedPurposeString()
    {
        var token = ParticipantLinkTokens.Generate();
        var protectedToken = new ParticipantLinkTokenProtector(_provider).Protect(token);

        _provider.CreateProtector(ParticipantLinkTokenProtector.Purpose).Unprotect(protectedToken).Should().Be(
            token, "the purpose is a fixed, documented string; changing it would orphan every stored copy");
        ParticipantLinkTokenProtector.Purpose.Should().Be("Pulse.EasyLogin.ParticipantLinkToken.v1");
    }

    [Fact]
    public void Protect_RefusesAnEmptyToken_AndTheConstructorRefusesNull()
    {
        var protector = new ParticipantLinkTokenProtector(_provider);

        ((Action)(() => protector.Protect(string.Empty))).Should().Throw<ArgumentException>();
        ((Action)(() => _ = new ParticipantLinkTokenProtector(null!))).Should().Throw<ArgumentNullException>();
    }
}
