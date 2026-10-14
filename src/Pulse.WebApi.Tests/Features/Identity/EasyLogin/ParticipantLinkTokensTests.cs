namespace Pulse.WebApi.Tests.Features.Identity.EasyLogin;

using System;
using System.Buffers.Text;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// easy-login/01 (Tokens AC, EL-5) — a link token is 16 CSPRNG bytes as unpadded base64url (22 URL-safe characters),
/// never repeats, and is stored only as <see cref="SessionTokens.Hash"/>.
/// </summary>
public sealed class ParticipantLinkTokensTests
{
    [Fact]
    public void Generate_Returns22UnpaddedBase64UrlCharacters_EncodingSixteenBytes()
    {
        var token = ParticipantLinkTokens.Generate();

        token.Should().HaveLength(22, "16 bytes as unpadded base64url is 22 characters");
        token.Should().MatchRegex("^[A-Za-z0-9_-]{22}$", "base64url only: no '+', '/' or '=' padding, so it sits in a URL path");
        Base64Url.DecodeFromChars(token).Should().HaveCount(16, "the token carries exactly 128 random bits");
        ParticipantLinkTokens.TokenLength.Should().Be(22);
        ParticipantLinkTokens.TokenByteLength.Should().Be(16);
    }

    [Fact]
    public void Generate_NeverReturnsTheSameValueTwice()
    {
        var tokens = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < 2000; i++)
        {
            tokens.Add(ParticipantLinkTokens.Generate());
        }

        tokens.Should().HaveCount(2000, "every call draws fresh CSPRNG bytes");
        ParticipantLinkTokens.Generate().Should().NotBe(ParticipantLinkTokens.Generate());
    }

    [Fact]
    public void Hash_IsSessionTokensHash_SixtyFourUpperHexCharacters_AndDeterministic()
    {
        var token = ParticipantLinkTokens.Generate();

        var hash = ParticipantLinkTokens.Hash(token);

        hash.Should().Be(SessionTokens.Hash(token), "the link hash is exactly the session-token hash (reuse, not a fork)");
        hash.Should().MatchRegex("^[0-9A-F]{64}$", "SHA-256 as upper-case hex fits the nvarchar(64) TokenHash column");
        ParticipantLinkTokens.Hash(token).Should().Be(hash, "the hash is the lookup key, so it must be deterministic");
        hash.Should().NotContain(token, "the stored value never contains the raw token");
    }

    [Fact]
    public void Hash_DistinguishesTokensThatDifferOnlyInCase()
    {
        // base64url is case-sensitive; the hash (and therefore the lookup) must be too, whatever the column collation.
        const string token = "AbCdEfGhIjKlMnOpQrStUv";

        ParticipantLinkTokens.Hash(token).Should().NotBe(ParticipantLinkTokens.Hash(token.ToLowerInvariant()));
    }

    [Fact]
    public void Hash_RefusesAnEmptyToken()
    {
        var act = () => ParticipantLinkTokens.Hash(string.Empty);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void GeneratedTokens_UseTheWholeAlphabet_NotAFixedPrefix()
    {
        // A cheap sanity check against a broken encoder: across many tokens every position varies.
        var tokens = Enumerable.Range(0, 500).Select(_ => ParticipantLinkTokens.Generate()).ToList();

        for (var position = 0; position < 21; position++)
        {
            tokens.Select(t => t[position]).Distinct().Should().HaveCountGreaterThan(
                10, "position {0} of a random token must vary between tokens", position);
        }
    }
}
