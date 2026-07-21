namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using FluentAssertions;
using Pulse.WebApi.Features.Identity.Accounts;

/// <summary>
/// Unit tests for <see cref="ParticipantPasswordHasher"/> (story 02, NFR-004/NFR-009) — no container needed, so
/// plain <c>[Fact]</c>. Proves the slow-KDF hash is salted (non-deterministic), verifies round-trip, and fails
/// CLOSED for a wrong password, a missing hash, and a malformed hash — the credential half of participant login.
/// </summary>
public sealed class ParticipantPasswordHasherTests
{
    private readonly ParticipantPasswordHasher _hasher = new();

    [Fact]
    public void Hash_ThenVerify_WithCorrectPassword_ReturnsTrue()
    {
        var hash = _hasher.Hash("Correct-Horse-Battery-Staple");

        _hasher.Verify(hash, "Correct-Horse-Battery-Staple").Should().BeTrue(
            "a hash must verify against the exact password it was derived from");
    }

    [Fact]
    public void Verify_WithWrongPassword_ReturnsFalse()
    {
        var hash = _hasher.Hash("the-right-password");

        _hasher.Verify(hash, "the-WRONG-password").Should().BeFalse("a wrong password must fail closed");
    }

    [Fact]
    public void Hash_IsSalted_SamePasswordProducesDifferentHashes()
    {
        var first = _hasher.Hash("same-password");
        var second = _hasher.Hash("same-password");

        first.Should().NotBe(second, "a fresh random salt per hash means the same password never yields the same stored hash");
        _hasher.Verify(first, "same-password").Should().BeTrue();
        _hasher.Verify(second, "same-password").Should().BeTrue();
    }

    [Fact]
    public void Hash_IsNotThePlaintext()
    {
        var hash = _hasher.Hash("whatever");

        hash.Should().NotBeNullOrEmpty("the stored value is a slow-KDF hash");
        hash.Should().NotContain("whatever", "the plaintext must never appear in the stored hash");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Verify_WithNoStoredHash_ReturnsFalse(string? storedHash)
    {
        // A provisioned-but-credential-less account (CredentialHash null) can never authenticate — fail closed.
        _hasher.Verify(storedHash, "any-password").Should().BeFalse(
            "an account with no credential set must never authenticate");
    }

    [Theory]
    [InlineData("not-a-valid-hash")]         // not valid base64 → decode failure
    [InlineData("YWJjZGVmZ2hpamts")]         // valid base64 but not a framework hash blob
    public void Verify_WithMalformedHash_ReturnsFalse(string storedHash)
    {
        _hasher.Verify(storedHash, "any-password").Should().BeFalse("a malformed stored hash must fail closed, never throw");
    }

    [Fact]
    public void Hash_ProducesFrameworkVerifiableValue_UsableByAPlainPasswordHasher()
    {
        // Gate-1: the stored value is a framework PasswordHasher<Account> hash, so story 07 / an AAR audit can
        // verify a story-02 credential with a plain PasswordHasher<Account> (one identity tier, one format).
        var hash = _hasher.Hash("shared-format-password");

        var framework = new Microsoft.AspNetCore.Identity.PasswordHasher<Pulse.WebApi.Data.Entities.Account>();
        var subject = new Pulse.WebApi.Data.Entities.Account { Username = "", DisplayName = "", Role = "" };

        framework.VerifyHashedPassword(subject, hash, "shared-format-password")
            .Should().BeOneOf(
                Microsoft.AspNetCore.Identity.PasswordVerificationResult.Success,
                Microsoft.AspNetCore.Identity.PasswordVerificationResult.SuccessRehashNeeded);
    }
}
