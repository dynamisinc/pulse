namespace Pulse.WebApi.Tests.Features.Identity.SharedAccess;

using FluentAssertions;
using Pulse.WebApi.Features.Identity.SharedAccess;

/// <summary>
/// Model-only unit tests for <see cref="SharedCredentialHasher"/> (story 06, COR-015 / NFR-009). No database or
/// Docker — the slow-KDF hasher is a pure primitive — so these stay plain <c>[Fact]</c>. They prove the shared
/// password is never stored in the clear, verifies correctly, is salted per-hash, and fails closed on a bad
/// guess / a credential with no stored hash.
/// </summary>
public sealed class SharedCredentialHasherTests
{
    private readonly SharedCredentialHasher _hasher = new();

    [Fact]
    public void Hash_DoesNotContainThePlaintext_AndVerifiesBack()
    {
        const string password = "atl-cie-2033";

        var hash = _hasher.Hash(password);

        hash.Should().NotBeNullOrEmpty();
        hash.Should().NotContain(password, "the raw shared password must never be recoverable from the stored hash (NFR-009)");
        _hasher.Verify(hash, password).Should().BeTrue("the correct password must verify against its own hash");
    }

    [Fact]
    public void Verify_WrongPassword_ReturnsFalse()
    {
        var hash = _hasher.Hash("correct-horse");

        _hasher.Verify(hash, "wrong-horse").Should().BeFalse("a wrong shared password must fail closed");
    }

    [Fact]
    public void Hash_IsSalted_SoTwoHashesOfTheSamePasswordDiffer()
    {
        const string password = "same-password";

        var first = _hasher.Hash(password);
        var second = _hasher.Hash(password);

        first.Should().NotBe(second,
            "a slow, salted KDF must produce a different hash each time (a per-hash random salt) — a deterministic " +
            "hash would leak that two exercises share a password and be far cheaper to attack");
        _hasher.Verify(first, password).Should().BeTrue();
        _hasher.Verify(second, password).Should().BeTrue("both independently-salted hashes still verify the same password");
    }

    [Fact]
    public void Verify_NullOrEmptyStoredHash_FailsClosed()
    {
        _hasher.Verify(null, "anything").Should().BeFalse("a credential with no stored hash authenticates nothing (fail closed)");
        _hasher.Verify(string.Empty, "anything").Should().BeFalse("an empty stored hash authenticates nothing (fail closed)");
    }

    [Fact]
    public void Verify_EmptyProvidedPassword_FailsClosed()
    {
        var hash = _hasher.Hash("real-password");

        _hasher.Verify(hash, string.Empty).Should().BeFalse("an empty submission can never match a real hash");
    }

    [Fact]
    public void VerifyDecoy_AlwaysReturnsFalse_RegardlessOfInput()
    {
        // Story 07 (Gate-1 timing-oracle fold): the decoy runs a full PBKDF2 verify against a fixed dummy hash so
        // a NEGATIVE login path (absent / disabled / revoked / locked credential) pays the same slow-KDF cost a
        // real verify would — but it must NEVER authenticate anything, for any input, including a null/empty guess.
        _hasher.VerifyDecoy("any-guess").Should().BeFalse("the decoy verify never authenticates anything");
        _hasher.VerifyDecoy(string.Empty).Should().BeFalse("an empty guess against the decoy still fails closed");
        _hasher.VerifyDecoy(null).Should().BeFalse("a null submission is treated as empty and still fails closed");
    }
}
