namespace Pulse.WebApi.Tests.Features.Identity.Accounts;

using FluentAssertions;
using Pulse.WebApi.Features.Identity.Accounts;

/// <summary>
/// Unit tests for <see cref="AccountFieldRules"/> (story 02, NFR-004 / XC-002) — pure, plain <c>[Fact]</c>.
/// Proves free-text is STRIPPED on ingest (a stored-XSS defense, COR-007), that the role guard admits only
/// participant-world roles (a participant Account must never carry a staff role), and the password bounds.
/// </summary>
public sealed class AccountFieldRulesTests
{
    [Fact]
    public void TryNormalizeDisplayName_StripsScriptMarkup()
    {
        var ok = AccountFieldRules.TryNormalizeDisplayName("<script>alert(1)</script>Mayor Vance", out var displayName, out _);

        ok.Should().BeTrue();
        displayName.Should().Be("Mayor Vance",
            "markup is STRIPPED on ingest so a stored display name can never execute on any surface (COR-007)");
    }

    [Fact]
    public void TryNormalizeDisplayName_MarkupOnly_IsRejected()
    {
        var ok = AccountFieldRules.TryNormalizeDisplayName("<script>alert(1)</script>", out _, out var error);

        ok.Should().BeFalse("a display name that is ONLY markup becomes empty after stripping and is rejected");
        error.Should().NotBeNull();
    }

    [Fact]
    public void TryNormalizeUsername_StripsMarkupAndTrims()
    {
        var ok = AccountFieldRules.TryNormalizeUsername("  <b>alice</b>  ", out var username, out _);

        ok.Should().BeTrue();
        username.Should().Be("alice", "the handle is trimmed and markup-stripped on ingest");
    }

    [Theory]
    [InlineData("participant", "participant")]
    [InlineData("Participant", "participant")]
    [InlineData("PIO", "pio")]
    [InlineData("  pio  ", "pio")]
    public void TryNormalizeRole_ParticipantWorldRoles_NormalizeToCanonical(string input, string expected)
    {
        var ok = AccountFieldRules.TryNormalizeRole(input, out var role, out _);

        ok.Should().BeTrue();
        role.Should().Be(expected, "a participant-world role is accepted and stored as the canonical frozen token");
    }

    [Theory]
    [InlineData("controller")]
    [InlineData("evaluator")]
    [InlineData("planner")]
    [InlineData("orgAdmin")]
    [InlineData("admin")]
    [InlineData("")]
    public void TryNormalizeRole_NonParticipantRoles_AreRejected(string input)
    {
        var ok = AccountFieldRules.TryNormalizeRole(input, out _, out var error);

        ok.Should().BeFalse(
            "a participant Account mints a participant-kind session, so a staff/org/unknown role must be rejected (XC-002)");
        error.Should().NotBeNull();
    }

    [Fact]
    public void TryValidatePassword_AbsentPassword_IsValidWithNullCredential()
    {
        var ok = AccountFieldRules.TryValidatePassword(null, out var password, out _);

        ok.Should().BeTrue("password is optional — an account may be provisioned before its credential is delivered");
        password.Should().BeNull();
    }

    [Fact]
    public void TryValidatePassword_OversizedPassword_IsRejected()
    {
        var oversized = new string('x', AccountFieldRules.MaxPasswordLength + 1);

        var ok = AccountFieldRules.TryValidatePassword(oversized, out _, out var error);

        ok.Should().BeFalse("an oversized password is rejected (a DoS guard on the slow KDF)");
        error.Should().NotBeNull();
    }
}
