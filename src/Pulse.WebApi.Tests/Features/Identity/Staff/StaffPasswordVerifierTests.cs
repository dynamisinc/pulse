namespace Pulse.WebApi.Tests.Features.Identity.Staff;

using System.Collections.Generic;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Identity.Providers;
using Xunit;

/// <summary>
/// #660 S-1 — the dummy hash a padded verification runs against is made BY the injected hasher, so it carries that
/// hasher's configured format and iteration count: a dummy costs exactly what a real verification costs.
/// </summary>
public sealed class StaffPasswordVerifierTests
{
    [Fact]
    public void PadTo_VerifiesAgainstADummyHashMadeByTheInjectedHasher_WithItsIterationCount()
    {
        // A non-default iteration count, so a dummy made by any OTHER (default) hasher would be detectably different.
        var hasher = new RecordingPasswordHasher(iterations: 12_345);
        var verifier = new StaffPasswordVerifier(hasher);

        verifier.PadTo(3, "a password");

        verifier.SlowVerifications.Should().Be(3);
        hasher.Hashed.Should().ContainSingle("the dummy hash is derived once, from the injected hasher");
        hasher.Verified.Should().HaveCount(3).And.AllBeEquivalentTo(hasher.Hashed[0], "every dummy runs against that hash");
        IterationCount(hasher.Verified[0]).Should().Be(12_345, "the dummy carries the configured work factor");
    }

    [Fact]
    public void PadTo_IsANoOp_OnceTheTargetIsReached()
    {
        var hasher = new RecordingPasswordHasher(iterations: 1_000);
        var verifier = new StaffPasswordVerifier(hasher);

        verifier.PadTo(0, "a password");

        hasher.Verified.Should().BeEmpty();
        hasher.Hashed.Should().BeEmpty("no dummy hash is even needed");
    }

    /// <summary>The PBKDF2 iteration count of an Identity V3 hash (big-endian uint at bytes 5..8).</summary>
    private static int IterationCount(string hash)
    {
        var bytes = System.Convert.FromBase64String(hash);
        bytes[0].Should().Be(0x01, "an Identity V3 hash");
        return (bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8];
    }

    private sealed class RecordingPasswordHasher(int iterations) : IPasswordHasher<Person>
    {
        private readonly PasswordHasher<Person> _inner = new(Options.Create(new PasswordHasherOptions { IterationCount = iterations }));

        public List<string> Hashed { get; } = [];

        public List<string> Verified { get; } = [];

        public string HashPassword(Person user, string password)
        {
            var hash = _inner.HashPassword(user, password);
            Hashed.Add(hash);
            return hash;
        }

        public PasswordVerificationResult VerifyHashedPassword(Person user, string hashedPassword, string providedPassword)
        {
            Verified.Add(hashedPassword);
            return _inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }
    }
}
