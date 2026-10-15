namespace Pulse.WebApi.Tests.Features.Identity.LinkEmail;

using System.Linq;
using System.Text.RegularExpressions;
using FluentAssertions;
using Pulse.WebApi.Features.Identity.LinkEmail;

/// <summary>
/// easy-login/13 (content security, NFR-004): the personal-link email is minimal and inert. The subject is
/// "Your sign-in link for {exercise name}"; the HTML carries the HTML-ENCODED name, the join link, the sign-in name and
/// one sentence of instruction, and nothing a mail client would fetch (no image, style sheet, script or other URL); the
/// plain text and the subject are stripped of control characters, so a hostile name can neither inject markup nor fold
/// a header. Pure: runs on every machine.
/// </summary>
public sealed partial class LinkEmailComposerTests
{
    private const string Url = "https://pulse-uat.cobrasoftware.com/join/AbCdEfGhIjKlMnOpQrSt_-";

    [Fact]
    public void TheMessage_HasTheSubject_TheLink_TheSignInName_AndOneInstruction()
    {
        var message = LinkEmailComposer.Compose("jane@example.org", "Coastal Surge 2026", "Jane Smith", "jsmith", Url);

        message.RecipientAddress.Should().Be("jane@example.org");
        message.Subject.Should().Be("Your sign-in link for Coastal Surge 2026");

        message.HtmlBody.Should().Contain("Hello Jane Smith,")
            .And.Contain($"<a href=\"{Url}\">{Url}</a>")
            .And.Contain("<strong>jsmith</strong>")
            .And.Contain(LinkEmailComposer.Instruction);
        message.PlainTextBody.Should().Be(string.Join(
            "\n",
            "Hello Jane Smith,",
            string.Empty,
            LinkEmailComposer.Instruction,
            string.Empty,
            Url,
            string.Empty,
            $"{LinkEmailComposer.SignInNameLabel} jsmith"));

        Sentences(LinkEmailComposer.Instruction).Should().Be(1, "the AC asks for ONE plain sentence of instruction");
    }

    [Fact]
    public void AHostileName_IsHtmlEncoded_AndCannotInjectMarkup()
    {
        const string hostile = "<script>alert('x')</script><img src=https://evil.example/p.gif onerror=x()>\"&";

        var message = LinkEmailComposer.Compose("jane@example.org", "Exercise", hostile, "jsmith", Url);

        message.HtmlBody.Should().NotContain("<script").And.NotContain("<img").And.NotContain("onerror=x()>")
            .And.NotContain("evil.example/p.gif\"");
        message.HtmlBody.Should().Contain("&lt;script&gt;").And.Contain("&lt;img");
        TagNames(message.HtmlBody).Should().BeSubsetOf(
            ["!DOCTYPE", "html", "head", "meta", "title", "body", "p", "a", "strong"],
            "the template's own tags are the only tags; the name became text");
    }

    [Fact]
    public void TheHtml_FetchesNothing_AndLinksOnlyToTheJoinUrl()
    {
        var message = LinkEmailComposer.Compose("jane@example.org", "Exercise", "Jane", "jsmith", Url);

        message.HtmlBody.Should().NotContainAny("<img", "<script", "<link", "<style", "<iframe", "<form", "src=", "url(", "background");
        Urls(message.HtmlBody).Distinct().Should().Equal([Url], "the join link is the only URL: no remote content, no tracking pixel");
        Urls(message.PlainTextBody).Should().Equal([Url]);
    }

    [Theory]
    [InlineData("Jane\r\nBcc: victim@example.org", "Jane Bcc: victim@example.org")]
    [InlineData("Jane\tSmith\u0000", "Jane Smith")]
    [InlineData("\u202EhtimS enaJ", "htimS enaJ")]
    [InlineData("Jane\u2028Smith", "Jane Smith")]
    [InlineData("  Jane   Smith  ", "Jane Smith")]
    public void ControlAndFormatCharacters_AreStripped_FromThePlainTextAndTheSubject(string raw, string expected)
    {
        var message = LinkEmailComposer.Compose("jane@example.org", raw, raw, "jsmith", Url);

        message.Subject.Should().Be(LinkEmailComposer.SubjectPrefix + expected);
        message.PlainTextBody.Split('\n')[0].Should().Be($"Hello {expected},");
        message.Subject.Any(c => char.IsControl(c)).Should().BeFalse("a CR/LF in a subject would fold the header");
        message.HtmlBody.Should().NotContain("\r").And.NotContain("\u0000").And.NotContain("\u202E");
    }

    [Fact]
    public void ABlankName_GreetsWithoutOne_AndABlankExerciseName_StillGivesASubject()
    {
        var message = LinkEmailComposer.Compose("jane@example.org", " \r\n ", "\u0007", "jsmith", Url);

        message.Subject.Should().Be(LinkEmailComposer.SubjectWithoutExerciseName);
        message.PlainTextBody.Should().StartWith("Hello,\n");
        message.HtmlBody.Should().Contain("<p>Hello,</p>");
    }

    [Fact]
    public void ALongExerciseName_IsBoundedInTheSubject_WithoutSplittingASurrogatePair()
    {
        var name = new string('a', LinkEmailComposer.MaxSubjectExerciseNameLength - 1) + "\U0001F600" + "tail";

        var subject = LinkEmailComposer.Subject(name);

        subject.Length.Should().BeLessThanOrEqualTo(LinkEmailComposer.SubjectPrefix.Length + LinkEmailComposer.MaxSubjectExerciseNameLength);
        char.IsHighSurrogate(subject[^1]).Should().BeFalse("a lone high surrogate is not valid text");
    }

    [Fact]
    public void TheMessage_NeverPrintsItself()
    {
        var message = LinkEmailComposer.Compose("jane@example.org", "Exercise", "Jane", "jsmith", Url);

        message.ToString().Should().NotContain("jane@example.org").And.NotContain(Url).And.NotContain("Jane");
    }

    [Theory]
    [InlineData("jane@example.org", true)]
    [InlineData("DoNotReply@00000000-0000-0000-0000-000000000000.azurecomm.net", true)]
    [InlineData("Jane <jane@example.org>", false)]
    [InlineData("jane@example.org\r\nBcc: x@example.org", false)]
    [InlineData("jane@example.org, x@example.org", false)]
    [InlineData(" jane@example.org", false)]
    [InlineData("jane", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyASingleBareMailbox_IsDeliverable(string? address, bool deliverable)
    {
        LinkEmailAddresses.IsDeliverable(address).Should().Be(deliverable);
    }

    private static int Sentences(string text) => SentenceEnd().Matches(text).Count;

    private static string[] TagNames(string html) =>
        TagName().Matches(html).Select(m => m.Groups[1].Value).Distinct().ToArray();

    private static string[] Urls(string text) =>
        UrlPattern().Matches(text).Select(m => m.Value).ToArray();

    [GeneratedRegex(@"[.!?](\s|$)")]
    private static partial Regex SentenceEnd();

    [GeneratedRegex(@"<\s*/?\s*(!?[A-Za-z]+)")]
    private static partial Regex TagName();

    [GeneratedRegex(@"https?://[^\s""<>]+")]
    private static partial Regex UrlPattern();
}
