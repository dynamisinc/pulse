namespace Pulse.WebApi.Tests.Features.Injects.Import;

using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Injects.Import;
using Xunit;

/// <summary>
/// demo-feedback/03 (AC-2 headers, AC-3 filter, AC-4 mapping, AC-5 row failures, DF-9, DF-11, NFR-004) —
/// <see cref="MselImportPlanner"/>, pure, over tables read from real Cadence-layout CSV.
/// </summary>
public sealed class MselImportPlannerTests
{
    private static readonly Guid FirePersona = Guid.NewGuid();
    private static readonly Guid ResidentPersona = Guid.NewGuid();
    private static readonly Guid Casey = Guid.NewGuid();
    private static readonly Guid PhotoAsset = Guid.NewGuid();
    private static readonly Guid VideoAsset = Guid.NewGuid();

    private static readonly MselImportFacts Facts = new(
        [
            new ImportPersona(FirePersona, "KestrelFire", "Kestrel County Fire"),
            new ImportPersona(ResidentPersona, "@river_rae", "Rae on the River"),
        ],
        [
            new ImportMedia(PhotoAsset, "brown-water.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(Guid.NewGuid(), "brown-water.jpg", MediaKinds.Image, DateTimeOffset.UtcNow.AddDays(-1)),
            new ImportMedia(VideoAsset, "newscast.mp4", MediaKinds.Video, DateTimeOffset.UtcNow),
            new ImportMedia(Guid.NewGuid(), "a.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(Guid.NewGuid(), "b.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(Guid.NewGuid(), "c.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
            new ImportMedia(Guid.NewGuid(), "d.jpg", MediaKinds.Image, DateTimeOffset.UtcNow),
        ],
        [new ImportAssignee(Casey, "Casey Controller")]);

    [Fact]
    public void AHeaderMissingARequiredColumn_IsRefused_NamingWhatIsMissing()
    {
        var table = new MselTable(["inject #", "Title", "from / source"], []);

        var plan = MselImportPlanner.Plan(table, Facts);

        plan.Error.Should().Be("the header row is missing the required column(s): Delivery Method, Description.");
    }

    [Fact]
    public void HeadersMatch_CaseInsensitivelyAndTrimmed_UnknownColumnsIgnored()
    {
        var table = new MselTable(
            ["  INJECT #", "mystery", "delivery method ", "From / Source", "DESCRIPTION"],
            [new MselRow(2, ["9", "?", "Social Media", "@KestrelFire", "hello"])]);

        var plan = MselImportPlanner.Plan(table, Facts);

        plan.Error.Should().BeNull();
        plan.Rows.Should().ContainSingle().Which.Candidate!.Text.Should().Be("hello");
    }

    [Theory]
    [InlineData("Social Media", true)]
    [InlineData(" social ", true)]
    [InlineData("PULSE", true)]
    [InlineData("Social media post (Facebook)", true)]
    [InlineData("Email", false)]
    [InlineData("Phone", false)]
    [InlineData("", false)]
    [InlineData("Pulse check", false)]
    public void TheSocialRule_DF9(string deliveryMethod, bool social)
    {
        MselImportPlanner.IsSocial(deliveryMethod).Should().Be(social);
    }

    [Fact]
    public void NonSocialRows_AreSkippedWithTheReason_AndSocialRowsCounted()
    {
        var plan = Plan(KestrelRows());

        plan.SocialRows.Should().Be(3);
        var skipped = plan.Rows.Where(row => row.FinalStatus == "skipped").Select(row => row.ToFinalReport()).ToList();
        skipped.Select(row => row.Message).Should().Equal(
            "not a social-media inject (Delivery Method: Verbal)",
            "not a social-media inject (Delivery Method: Phone)");
        skipped[0].InjectNumber.Should().Be("1");
        skipped[0].Title.Should().Be("StartEx");
    }

    [Fact]
    public void PlannedMinute_DF11_CountsFromTheEarliestScenarioDayAndTimeOfAnyRow()
    {
        var plan = Plan(KestrelRows());

        plan.Rows.Select(row => row.PlannedMinute).Should().Equal(
            [0, 5, 10, 20, 1470],
            "StartEx (day 1 08:00, a non-social row) is T+0; day 2 08:30 is 24h30m later");
    }

    [Fact]
    public void PlannedMinute_FallsBackToScheduledTime_WhenNoRowHasAScenarioTime_AndIsNullWithNeither()
    {
        var rows = new[]
        {
            new MselRowSpec(1, "a", "x", "09:15", "", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(2, "b", "y", "10:00", "", "", "@KestrelFire", "p", "Social"),
        };
        Plan(rows).Rows.Select(row => row.PlannedMinute).Should().Equal(0, 45);

        var none = new[] { new MselRowSpec(1, "a", "x", "", "", "", "@KestrelFire", "p", "Social") };
        Plan(none).Rows.Single().PlannedMinute.Should().BeNull("no time at all is an unplanned item");
    }

    [Fact]
    public void PlannedMinute_ARowWithoutTheChosenTime_IsUnplanned_AndAnUnreadableTimeWarns()
    {
        var rows = new[]
        {
            new MselRowSpec(1, "a", "x", "08:00", "1", "08:00", "@KestrelFire", "p", "Social"),
            new MselRowSpec(2, "b", "y", "08:00", "1", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(3, "c", "z", "08:00", "1", "half past", "@KestrelFire", "p", "Social"),
        };

        var plan = Plan(rows);

        plan.Rows.Select(row => row.PlannedMinute).Should().Equal(0, null, null);
        plan.Rows[2].ToReport("created", null).Message.Should().Be("Scenario Time 'half past' is not a time of day; left unplanned.");
    }

    [Fact]
    public void Mapping_PersonaByHandleWithTheAtStripped_ThenByExactDisplayName_CaseInsensitive()
    {
        var plan = Plan(KestrelRows());
        var candidates = plan.Rows.Where(row => row.Candidate is not null).ToList();

        candidates.Select(row => row.Candidate!.PersonaId).Should().Equal(FirePersona, ResidentPersona, ResidentPersona);
        candidates.Select(row => row.PersonaHandle).Should().Equal("KestrelFire", "river_rae", "river_rae");
    }

    [Fact]
    public void Mapping_TitleNotesAssigneeTextAndExternalRef()
    {
        var row = Plan(KestrelRows()).Rows[1];

        var candidate = row.Candidate!;
        candidate.ExternalRef.Should().Be("2");
        candidate.Title.Should().Be("Boil water notice");
        candidate.Notes.Should().Be("Beat 1");
        candidate.AssigneeId.Should().Be(Casey);
        candidate.Text.Should().Be("BOIL WATER NOTICE for #Kestrel County zones 3-5.");
        candidate.PlannedMinute.Should().Be(5);
        row.Warnings.Should().BeEmpty();
    }

    [Fact]
    public void Mapping_EveryTextCellIsSanitized_StripNeverEncode()
    {
        var rows = new[]
        {
            new MselRowSpec(
                1,
                "<b>Bold</b> title<script>alert(1)</script>",
                "<img src=x onerror=alert(1)>Water is <i>brown</i>",
                "08:00",
                "1",
                "08:00",
                "<span>@KestrelFire</span>",
                "p",
                "Social",
                Notes: "<script>x</script>note"),
        };

        var candidate = Plan(rows).Rows.Single().Candidate!;

        candidate.Title.Should().NotContain("<").And.NotContain("&lt;");
        candidate.Text.Should().Be("Water is brown");
        candidate.Notes.Should().NotContain("<").And.NotContain("script>");
        candidate.PersonaId.Should().Be(FirePersona);
    }

    [Fact]
    public void Mapping_ABlankTitleFallsBackToInjectNumber_ALongTitleAndNotesAreTruncatedWithAWarning()
    {
        var rows = new[]
        {
            new MselRowSpec(4, "", "x", "", "", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(5, new string('t', 130), "y", "", "", "", "@KestrelFire", "p", "Social", Notes: new string('n', 600)),
        };

        var plan = Plan(rows);

        plan.Rows[0].Candidate!.Title.Should().Be("Inject 4");
        plan.Rows[1].Candidate!.Title.Should().HaveLength(120);
        plan.Rows[1].Candidate!.Notes.Should().HaveLength(500);
        plan.Rows[1].ToReport("created", null).Message
            .Should().Be("Title truncated to 120 characters. Notes truncated to 500 characters.");
    }

    [Fact]
    public void Mapping_AnUnknownResponsibleController_IsAWarningNotAFailure()
    {
        var rows = new[] { new MselRowSpec(1, "a", "x", "", "", "", "@KestrelFire", "p", "Social", Controller: "Pat Nobody") };

        var row = Plan(rows).Rows.Single();

        row.Candidate.Should().NotBeNull();
        row.Candidate!.AssigneeId.Should().BeNull();
        row.Candidate.AssigneeUnmatched.Should().BeTrue();
        row.ToReport("created", null).Message
            .Should().Be("Responsible Controller 'Pat Nobody' is not a staff member of this exercise; left unassigned.");
    }

    [Fact]
    public void Mapping_PulseMediaByFileName_NewestOfTwoSameNamedFilesWins_AltIsTheStem()
    {
        var rows = new[] { new MselRowSpec(1, "a", "x", "", "", "", "@KestrelFire", "p", "Social", PulseMedia: " Brown-Water.JPG ") };

        var media = Plan(rows, pulseMedia: true).Rows.Single().Candidate!.Media;

        media.Should().ContainSingle().Which.Should().Be(new PlannedMedia(PhotoAsset, "Brown-Water"));
    }

    [Theory]
    [InlineData("@nobody", "", "unknown persona 'nobody': no persona in this exercise has that handle or display name.")]
    [InlineData("", "", "From / Source is empty; it must name a persona in this exercise.")]
    [InlineData("@KestrelFire", "missing.jpg", "unknown Pulse Media file 'missing.jpg': no file of that name in this exercise's media library.")]
    [InlineData("@KestrelFire", "a.jpg,b.jpg,c.jpg,d.jpg,brown-water.jpg", "Pulse Media has more than 4 images or more than one video (a post carries up to 4 images or exactly 1 video).")]
    [InlineData("@KestrelFire", "newscast.mp4,newscast.mp4", "Pulse Media has more than 4 images or more than one video (a post carries up to 4 images or exactly 1 video).")]
    [InlineData("@KestrelFire", "newscast.mp4,a.jpg", "Pulse Media has more than 4 images or more than one video (a post carries up to 4 images or exactly 1 video).")]
    public void RowFailures_PersonaAndMedia(string source, string media, string expected)
    {
        var rows = new[] { new MselRowSpec(1, "a", "x", "", "", "", source, "p", "Social", PulseMedia: media) };

        var report = Plan(rows, pulseMedia: true).Rows.Single().ToFinalReport();

        report.Status.Should().Be("failed");
        report.Message.Should().Be(expected);
    }

    [Fact]
    public void RowFailures_EmptyOrOver280TextAfterSanitizing()
    {
        var rows = new[]
        {
            new MselRowSpec(1, "a", "<script>only markup</script>", "", "", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(2, "b", new string('w', 281), "", "", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(3, "c", "<b>" + new string('w', 280) + "</b>", "", "", "", "@KestrelFire", "p", "Social"),
        };

        var plan = Plan(rows);

        plan.Rows[0].ToFinalReport().Message.Should().Be("Description is empty (it is the post text).");
        plan.Rows[1].ToFinalReport().Message.Should().Be("Description is 281 characters after cleaning; a post is at most 280.");
        plan.Rows[2].Candidate.Should().NotBeNull("280 characters after the markup is stripped is exactly the limit");
    }

    [Fact]
    public void RowFailures_ADuplicateInjectNumber_FailsTheLaterRow()
    {
        var rows = new[]
        {
            new MselRowSpec(12, "a", "x", "", "", "", "@KestrelFire", "p", "Social"),
            new MselRowSpec(13, "b", "y", "", "", "", "@KestrelFire", "p", "Phone"),
            new MselRowSpec(12, "c", "z", "", "", "", "@KestrelFire", "p", "Social"),
        };

        var plan = Plan(rows);

        plan.Rows[0].Candidate.Should().NotBeNull();
        var later = plan.Rows[2].ToFinalReport();
        later.Status.Should().Be("failed");
        later.Message.Should().Be("duplicate of row 2");
    }

    [Fact]
    public void Isolation_AHandleOnlyInAnotherExercise_FailsExactlyLikeAnUnknownHandle()
    {
        // The facts are what the service read IN SCOPE; another exercise's persona simply is not in them.
        var otherExercisePersona = "OtherCountyEM";
        var rows = new[]
        {
            new MselRowSpec(1, "a", "x", "", "", "", "@" + otherExercisePersona, "p", "Social"),
            new MselRowSpec(2, "b", "y", "", "", "", "@" + "NeverExisted", "p", "Social"),
        };

        var plan = Plan(rows);

        plan.Rows[0].ToFinalReport().Message!.Replace(otherExercisePersona, "X", StringComparison.Ordinal)
            .Should().Be(plan.Rows[1].ToFinalReport().Message!.Replace("NeverExisted", "X", StringComparison.Ordinal));
    }

    // ---- helpers ----

    private static List<MselRowSpec> KestrelRows() =>
        MselFixture.KestrelRows("KestrelFire", "river_rae", "rae on the river", "Casey Controller");

    private static MselImportPlan Plan(IReadOnlyList<MselRowSpec> rows, bool pulseMedia = false)
    {
        var read = InjectImportService.Read(MselFixture.Csv(rows, pulseMedia: pulseMedia), "msel.csv", "text/csv");
        read.Error.Should().BeNull();
        var plan = MselImportPlanner.Plan(read.Table!, Facts);
        plan.Error.Should().BeNull();
        return plan;
    }
}
