namespace Pulse.Core.Tests.Features.PersonaVoice;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.PersonaVoice.Services;

public class VoiceProfileBuilderTests
{
    private static PersonaVoiceProfile Profile(
        PersonaType type = PersonaType.Resident,
        string voiceNotes = "anxious mom, short posts",
        PersonaStyle? seed = null,
        params string[] history) =>
        new()
        {
            ExerciseId = Guid.NewGuid(),
            Handle = "@rivertownmom",
            DisplayName = "Rivertown Mom",
            Type = type,
            VoiceNotes = voiceNotes,
            SeedStyle = seed ?? new PersonaStyle { AvgLength = 90 },
            AudienceBand = 2,
            PostHistory = history,
        };

    [Fact]
    public void RefreshStyle_FromPostHistory_TracksActualWriting()
    {
        var profile = Profile(
            seed: new PersonaStyle { AvgLength = 300, EmojiRate = 0, HashtagRate = 0 },
            history: ["ugh again?? 😡😡 #maplestreet", "still no water 😡 #maplestreet"]);

        var style = VoiceProfileBuilder.RefreshStyle(profile);

        style.EmojiRate.Should().BeGreaterThan(0, "the persona actually uses emoji");
        style.HashtagRate.Should().BeGreaterThan(0);
        style.AvgLength.Should().BeLessThan(300, "measured posts are far shorter than the seed guess");
    }

    [Fact]
    public void RefreshStyle_ColdStart_FallsBackToSeed()
    {
        var seed = new PersonaStyle { AvgLength = 90, EmojiRate = 1 };
        var profile = Profile(seed: seed); // no history

        VoiceProfileBuilder.RefreshStyle(profile).Should().Be(seed);
    }

    [Fact]
    public void SelectExemplars_TakesTheMostRecent_UpToMax()
    {
        var profile = Profile(history: ["p1", "p2", "p3", "p4", "p5"]);

        VoiceProfileBuilder.SelectExemplars(profile, max: 3).Should().Equal("p3", "p4", "p5");
    }

    [Fact]
    public void SelectExemplars_ColdStart_IsEmpty_NoError()
    {
        VoiceProfileBuilder.SelectExemplars(Profile()).Should().BeEmpty();
    }

    [Fact]
    public void ToDossier_CarriesVoiceNotes_Style_Exemplars_AndTypeGuidance()
    {
        var profile = Profile(type: PersonaType.Outlet, voiceNotes: "breaking-news cadence",
            history: ["Developing: water main break reported downtown."]);

        var dossier = VoiceProfileBuilder.ToDossier(profile);

        dossier.Handle.Should().Be("@rivertownmom");
        dossier.Type.Should().Be(PersonaType.Outlet);
        dossier.VoiceNotes.Should().Contain("breaking-news cadence");
        dossier.VoiceNotes.Should().Contain("news outlet", "type guidance is folded into the trusted voice notes (ADP-022)");
        dossier.RecentPosts.Should().ContainSingle();
    }

    [Fact]
    public void ToDossier_WithNullVoiceNotes_DoesNotThrow_AndStillCarriesTypeGuidance()
    {
        // A materialized profile (JSON/db) could carry null VoiceNotes despite the non-null default.
        var profile = new PersonaVoiceProfile
        {
            ExerciseId = Guid.NewGuid(),
            Handle = "@a",
            DisplayName = "A",
            Type = PersonaType.Agency,
            VoiceNotes = null!,
        };

        var dossier = VoiceProfileBuilder.ToDossier(profile);

        dossier.VoiceNotes.Should().Contain("procedural", "type guidance still applies with no authored notes");
    }

    [Fact]
    public void ToDossier_FeedsThePromptAssembler_OneCallForNPersonas()
    {
        // The burst-in-one-call diversity model (ADP-021/§5.2): N eligible personas → PostCount N.
        var personas = new[]
        {
            VoiceProfileBuilder.ToDossier(Profile()),
            VoiceProfileBuilder.ToDossier(Profile() with { Handle = "@second" }),
        };

        var request = new PromptAssembler().Assemble(new PromptAssemblyInput
        {
            ExerciseId = Guid.NewGuid(),
            ExerciseBrief = "Rivertown, day 2 of a water emergency.",
            Storyline = new StorylineBrief { Title = "Water fears", Expectation = "County advisory" },
            Personas = personas,
            Tier = GenerationTier.Standard,
        });

        request.PostCount.Should().Be(2);
    }
}
