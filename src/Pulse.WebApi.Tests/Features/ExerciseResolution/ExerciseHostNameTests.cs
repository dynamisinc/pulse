namespace Pulse.WebApi.Tests.Features.ExerciseResolution;

using FluentAssertions;
using Pulse.WebApi.Features.ExerciseResolution;

/// <summary>
/// Story <c>exercise-isolation/08</c> (host → exercise resolution, Tier-2) — the NFR-004 host-validation
/// unit. Proves <see cref="ExerciseHostName.TryNormalize"/> accepts well-formed hostnames (lower-casing and
/// trimming them) and rejects everything that must never reach a lookup: absent/empty, over-length, and
/// injection-shaped values (ports, IPv6 literals, paths, embedded <c>@</c>/<c>:</c>/whitespace, and a
/// smuggled trailing newline). Plain <c>[Fact]</c>/<c>[Theory]</c> — no database, so these run everywhere.
/// </summary>
public class ExerciseHostNameTests
{
    [Theory]
    [InlineData("atl-cie.example.com", "atl-cie.example.com")]
    [InlineData("cascade.example.org", "cascade.example.org")]
    [InlineData("localhost", "localhost")]
    [InlineData("a.b.c.d.example.com", "a.b.c.d.example.com")]
    [InlineData("ATL-CIE.EXAMPLE.COM", "atl-cie.example.com")]    // case-normalized to lower
    [InlineData("  atl-cie.example.com  ", "atl-cie.example.com")] // surrounding spaces trimmed
    [InlineData("atl-cie.example.com\n", "atl-cie.example.com")]   // trailing control whitespace trimmed to a clean host
    [InlineData("host-with-digits-123.example.com", "host-with-digits-123.example.com")]
    public void TryNormalize_AcceptsWellFormedHost_NormalizedToLowerTrimmed(string raw, string expected)
    {
        var ok = ExerciseHostName.TryNormalize(raw, out var normalized);

        ok.Should().BeTrue("a well-formed hostname is safe to use in a host → exercise lookup");
        normalized.Should().Be(expected, "the host is trimmed and lower-cased for a deterministic match");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TryNormalize_RejectsAbsentHost(string? raw)
    {
        var ok = ExerciseHostName.TryNormalize(raw, out var normalized);

        ok.Should().BeFalse("an absent Host header leaves the scope unresolved (fail closed)");
        normalized.Should().BeEmpty();
    }

    [Theory]
    [InlineData("atl-cie.example.com:443")]        // port must not be present (HostString.Host excludes it)
    [InlineData("[::1]")]                            // IPv6 literal
    [InlineData("exercise host.example.com")]        // embedded whitespace
    [InlineData("host@evil.example.com")]            // userinfo / injection
    [InlineData("host/../../etc/passwd")]            // path traversal shape
    [InlineData("host_underscore.example.com")]      // underscore is not a valid DNS label char
    [InlineData("-leading-hyphen.example.com")]      // label may not start with a hyphen
    [InlineData("trailing-hyphen-.example.com")]     // label may not end with a hyphen
    [InlineData("double..dot.example.com")]          // empty label
    [InlineData(".leading.dot.example.com")]         // leading dot
    [InlineData("trailing.dot.example.com.")]        // trailing dot
    [InlineData("evil.example.com\nhost: other")]    // embedded newline / header smuggling (not merely trailing)
    public void TryNormalize_RejectsMalformedOrHostileHost(string raw)
    {
        var ok = ExerciseHostName.TryNormalize(raw, out var normalized);

        ok.Should().BeFalse("a malformed/hostile host must never be used to build a query (NFR-004)");
        normalized.Should().BeEmpty();
    }

    [Fact]
    public void TryNormalize_RejectsOverLengthHost()
    {
        // 254 chars > the 253 DNS maximum.
        var tooLong = string.Join('.', Enumerable.Repeat("abcdefghij", 26)) + ".com"; // > 253
        tooLong.Length.Should().BeGreaterThan(253);

        var ok = ExerciseHostName.TryNormalize(tooLong, out var normalized);

        ok.Should().BeFalse("an over-length host is rejected");
        normalized.Should().BeEmpty();
    }
}
