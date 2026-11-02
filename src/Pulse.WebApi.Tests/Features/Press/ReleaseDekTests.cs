namespace Pulse.WebApi.Tests.Features.Press;

using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.Press.Contracts;
using Pulse.WebApi.Features.Press.Kind;

/// <summary>Press story 01 (#738), R-P1: a release's dek is never empty and never longer than 160 characters.</summary>
public sealed class ReleaseDekTests
{
    private const string Headline = "Shelters open at three high schools";
    private const string Org = "Fulton County EM";

    [Fact]
    public void ABody_GivesItsFirstSentence()
    {
        ReleaseDek.Derive(Headline, "<p>Three shelters opened at noon. Bring medications and ID.</p>", Org)
            .Should().Be("Three shelters opened at noon.");
    }

    [Fact]
    public void PlainTextBody_AndEntities_Work()
    {
        ReleaseDek.Derive(Headline, "Roads &amp; bridges are closed! Stay home.", Org).Should().Be("Roads & bridges are closed!");
    }

    [Fact]
    public void AHeadlineOnlyRelease_IsANewsReleaseFromTheOrg()
    {
        ReleaseDek.Derive(Headline, null, Org).Should().Be("News release from Fulton County EM");
        ReleaseDek.Derive(Headline, "   ", Org).Should().Be("News release from Fulton County EM");
    }

    [Fact]
    public void AnHtmlOnlyBody_FallsBackToTheOrg()
    {
        ReleaseDek.Derive(Headline, "<p><br></p><table><tr><td></td></tr></table><ul><li> </li></ul>", Org)
            .Should().Be("News release from Fulton County EM");
    }

    [Fact]
    public void ABodyStartingWithAListOrTable_UsesTheFirstProseSentence()
    {
        const string List = "<ul><li>Lincoln High</li><li>Grady High</li></ul><p>Shelters opened at noon. More soon.</p>";
        const string Table = "<table><tr><th>Site</th><th>Status</th></tr><tr><td>Lincoln</td><td>Open</td></tr></table>"
            + "<p>Shelters opened at noon.</p>";

        ReleaseDek.Derive(Headline, List, Org).Should().Be("Shelters opened at noon.");
        ReleaseDek.Derive(Headline, Table, Org).Should().Be("Shelters opened at noon.");
    }

    [Fact]
    public void AListOnlyBody_UsesTheFirstItem_AndATableOnlyBodyFallsBack()
    {
        ReleaseDek.Derive(Headline, "<ol><li>Go to Lincoln High.</li><li>Bring ID.</li></ol>", Org).Should().Be("Go to Lincoln High.");
        ReleaseDek.Derive(Headline, "<table><tr><td>Lincoln</td><td>Open</td></tr></table>", Org)
            .Should().Be("News release from Fulton County EM");
    }

    [Fact]
    public void ALongSentence_IsCutAtAWholeWord_WithinTheCap()
    {
        var sentence = string.Join(' ', Enumerable.Repeat("evacuation", 30)) + ".";

        var dek = ReleaseDek.Derive(Headline, $"<p>{sentence}</p>", Org);

        dek.Length.Should().BeLessThanOrEqualTo(PressVocabulary.DekMaxLength);
        dek.Should().EndWith("evacuation…");
    }

    [Fact]
    public void NoOrgName_FallsBackToTheHeadline_ThenToAGenericDek()
    {
        ReleaseDek.Derive(Headline, null, " ").Should().Be(Headline);
        ReleaseDek.Derive(null, null, null).Should().Be("News release");
    }

    [Fact]
    public void Abbreviations_DoNotEndTheSentence()
    {
        ReleaseDek.Derive(Headline, "<p>Dr. Lee said the U.S. Route 9 shelters are open. Bring ID.</p>", Org)
            .Should().Be("Dr. Lee said the U.S. Route 9 shelters are open.");
        ReleaseDek.Derive(Headline, "<p>U.S. officials opened shelters at noon today. More soon.</p>", Org)
            .Should().Be("U.S. officials opened shelters at noon today.");
    }

    [Fact]
    public void EncodedMarkup_NeverBecomesMarkupInTheDek()
    {
        ReleaseDek.Derive(Headline, "<p>&lt;script&gt;alert(1)&lt;/script&gt;Shelters are now open at noon.</p>", Org)
            .Should().NotContain("<").And.Contain("Shelters are now open");
    }

    [Fact]
    public void ACut_NeverSplitsASurrogatePair()
    {
        var dek = ReleaseDek.Derive(Headline, new string('x', 158) + "😀😀😀", Org);

        dek.Length.Should().BeLessThanOrEqualTo(PressVocabulary.DekMaxLength);
        char.IsHighSurrogate(dek[^2]).Should().BeFalse();
    }

    [Fact]
    public void ScriptContent_IsNeverTheDek()
    {
        ReleaseDek.Derive(Headline, "<script>alert(1)</script><p>Shelters opened.</p>", Org).Should().Be("Shelters opened.");
    }
}
