namespace Pulse.WebApi.Tests.Features.Identity.Credentials;

using System;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.Credentials;
using Xunit;

/// <summary>
/// identity-auth-roles/21 AC "Policy (§3.2)" — the NIST SP 800-63B password policy, model-only (no host, no SQL).
/// </summary>
public sealed class PasswordPolicyTests
{
    private static readonly PasswordContext Context = new()
    {
        OrganizationName = "Fairhaven County Emergency Management",
        Email = "jane.doe@fairhaven.example",
        DisplayName = "Jane Marigold",
    };

    [Fact]
    public void AStaffPassword_ShorterThanTwelve_IsTooShort_AndTwelveIsEnough()
    {
        PasswordPolicy.Validate("tulip-orbit", PasswordAudience.Staff, PasswordContext.None)
            .Should().Be(PasswordPolicy.TooShortError, "11 characters is under the staff floor of 12");
        PasswordPolicy.Validate("tulip-orbit7", PasswordAudience.Staff, PasswordContext.None)
            .Should().BeNull("12 characters meets the staff floor");
    }

    [Fact]
    public void AParticipantPassword_HasAnEightCharacterFloor()
    {
        PasswordPolicy.Validate("orbit-7", PasswordAudience.Participant, PasswordContext.None).Should().Be(PasswordPolicy.TooShortError);
        PasswordPolicy.Validate("orbit-7q", PasswordAudience.Participant, PasswordContext.None).Should().BeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AMissingPassword_IsTooShort(string? password) =>
        PasswordPolicy.Validate(password, PasswordAudience.Staff, PasswordContext.None).Should().Be(PasswordPolicy.TooShortError);

    [Fact]
    public void TheCeilingIs128CodePoints()
    {
        PasswordPolicy.Validate(new string('k', 128), PasswordAudience.Staff, PasswordContext.None).Should().BeNull();
        PasswordPolicy.Validate(new string('k', 129), PasswordAudience.Staff, PasswordContext.None).Should().Be(PasswordPolicy.TooLongError);
    }

    [Fact]
    public void LengthIsCountedInCodePoints_NotUtf16Units()
    {
        // 12 emoji are 24 UTF-16 units but 12 characters (800-63B §5.1.1.2), so they meet — and do not double — the floor.
        var twelveEmoji = string.Concat(System.Linq.Enumerable.Repeat("\U0001F525", 12));
        twelveEmoji.Length.Should().Be(24);
        PasswordPolicy.Validate(twelveEmoji, PasswordAudience.Staff, PasswordContext.None).Should().BeNull();

        var elevenEmoji = string.Concat(System.Linq.Enumerable.Repeat("\U0001F525", 11));
        PasswordPolicy.Validate(elevenEmoji, PasswordAudience.Staff, PasswordContext.None).Should().Be(PasswordPolicy.TooShortError);
    }

    [Theory]
    [InlineData("alllowercaseonlyhere")]
    [InlineData("1234567890123")]
    [InlineData("correct horse battery staple")]
    public void ThereAreNoCompositionRules(string password) =>
        PasswordPolicy.Validate(password, PasswordAudience.Staff, PasswordContext.None).Should().BeNull(
            "800-63B §5.1.1.2: no character-class rules — length and the blocklist do the work");

    [Theory]
    [InlineData("password")]
    [InlineData("PASSWORD")]
    [InlineData("qwertyuiop")]
    public void ABlocklistedPassword_IsRefused_CaseInsensitively(string password) =>
        PasswordPolicy.Validate(password, PasswordAudience.Participant, PasswordContext.None).Should().Be(PasswordPolicy.CommonError);

    [Fact]
    public void ALongBlocklistedPassword_IsRefusedForStaffToo()
    {
        // One of the few 12+ character entries in the embedded list.
        PasswordPolicy.Validate("Unbelievable", PasswordAudience.Staff, PasswordContext.None).Should().Be(PasswordPolicy.CommonError);
    }

    [Fact]
    public void TheEmbeddedBlocklist_IsLoaded_AndHoldsTheTop10k()
    {
        PasswordPolicy.BlocklistCount.Should().BeGreaterThan(9_900, "the embedded resource is the top-10k list");
    }

    [Theory]
    [InlineData("Fairhaven-2026-spring")]   // an org-name word
    [InlineData("FAIRHAVENCOUNTYEMERGENCY!")] // the org name, reduced
    [InlineData("my-jane.doe-key-99")]       // the email local part, reduced
    [InlineData("marigold-rocket-launch")]   // a display-name word
    [InlineData("xx JaneMarigold xx")]       // the whole display name
    public void APasswordContainingTheOrgName_EmailLocalPart_OrDisplayName_IsRefused(string password) =>
        PasswordPolicy.Validate(password, PasswordAudience.Staff, Context).Should().Be(PasswordPolicy.PersonalInfoError);

    [Fact]
    public void ShortContextWords_DoNotRefuseUnrelatedPasswords()
    {
        // "EM" (2) and "Jo" (2) are under the 4-character term floor, so a password merely containing "em"/"jo" passes.
        var context = new PasswordContext { OrganizationName = "EM", DisplayName = "Jo Li", Email = "jo@x.example" };
        PasswordPolicy.Validate("remember-jolly-lime", PasswordAudience.Staff, context).Should().BeNull();
    }

    [Fact]
    public void TheErrorCodes_AreSpecific_AndNeverEchoTheMatchedWord()
    {
        var code = PasswordPolicy.Validate("marigold-rocket-launch", PasswordAudience.Staff, Context);
        code.Should().Be("password-contains-personal-info");
        code.Should().NotContainEquivalentOf("marigold", "the code must not disclose what matched");

        new[] { PasswordPolicy.TooShortError, PasswordPolicy.TooLongError, PasswordPolicy.CommonError, PasswordPolicy.PersonalInfoError }
            .Should().OnlyHaveUniqueItems().And.AllSatisfy(c => c.Should().StartWith("password-"));
    }

    [Fact]
    public void TheMinimums_MatchTheSignedOffPolicy()
    {
        PasswordPolicy.MinimumLengthFor(PasswordAudience.Staff).Should().Be(12);
        PasswordPolicy.MinimumLengthFor(PasswordAudience.Participant).Should().Be(8);
        PasswordPolicy.MaximumLength.Should().Be(128);
        var act = () => PasswordPolicy.Validate("whatever-long-enough", PasswordAudience.Staff, null!);
        act.Should().Throw<ArgumentNullException>();
    }
}
