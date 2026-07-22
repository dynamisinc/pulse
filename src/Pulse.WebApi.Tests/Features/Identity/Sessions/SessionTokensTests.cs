namespace Pulse.WebApi.Tests.Features.Identity.Sessions;

using System;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Sessions;

/// <summary>
/// Story 03 (NFR-009) — locks the opaque-token primitives: <see cref="SessionTokens.Generate"/> produces
/// high-entropy, unique tokens and <see cref="SessionTokens.Hash"/> is a deterministic, non-reversible lookup
/// fingerprint that never equals the raw token. Plain <c>[Fact]</c> — no database, so this is the fast,
/// deterministic signal that the stored value is a hash and the raw token is never derivable from it.
/// </summary>
public class SessionTokensTests
{
    [Fact]
    public void Generate_ProducesDistinctTokens_OnEachCall()
    {
        var tokens = Enumerable.Range(0, 1000).Select(_ => SessionTokens.Generate()).ToList();

        tokens.Distinct().Should().HaveCount(1000,
            "each opaque token is drawn from a 256-bit CSPRNG, so collisions across 1000 draws are infeasible");
    }

    [Fact]
    public void Generate_ProducesA256BitHexToken()
    {
        var token = SessionTokens.Generate();

        token.Should().HaveLength(64, "32 random bytes render as 64 uppercase-hex characters (256 bits of entropy)");
        token.Should().MatchRegex("^[0-9A-F]+$", "the token is uppercase hex — URL-safe and header-safe, no padding");
    }

    [Fact]
    public void Hash_IsDeterministic_ForTheSameToken()
    {
        var token = SessionTokens.Generate();

        SessionTokens.Hash(token).Should().Be(SessionTokens.Hash(token),
            "the hash is the lookup key, so it must be deterministic for a given token");
    }

    [Fact]
    public void Hash_DiffersForDifferentTokens()
    {
        SessionTokens.Hash(SessionTokens.Generate()).Should().NotBe(SessionTokens.Hash(SessionTokens.Generate()),
            "distinct tokens must hash to distinct lookup keys");
    }

    [Fact]
    public void Hash_NeverEqualsTheRawToken_AndFitsTheColumn()
    {
        var token = SessionTokens.Generate();

        var hash = SessionTokens.Hash(token);

        hash.Should().NotBe(token, "only a non-reversible hash is ever stored — never the raw token (NFR-009)");
        hash.Should().HaveLength(64, "SHA-256 renders as 64 uppercase-hex characters, within the 256-char column");
    }

    [Fact]
    public void Hash_Throws_OnEmptyToken()
    {
        var act = () => SessionTokens.Hash(string.Empty);

        act.Should().Throw<ArgumentException>();
    }
}
