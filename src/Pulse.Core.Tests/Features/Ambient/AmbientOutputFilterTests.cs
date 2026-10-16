namespace Pulse.Core.Tests.Features.Ambient;

using FluentAssertions;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// ambient-chatter story 01, orchestrator review W-3 / S-2: the output-side "never storyline" check. A pure,
/// deterministic function: fixed incident terms, the active storylines' hashtags and title keywords, and a
/// non-negative sentiment floor.
/// </summary>
public class AmbientOutputFilterTests
{
    private static GeneratedPost Post(string text, double sentiment = 0.3, params string[] hashtags) =>
        new("@p0", text, sentiment, hashtags);

    [Fact]
    public void ACleanEverydayBurst_Passes()
    {
        var failing = AmbientOutputFilter.Inspect(
            [Post("new bakery on main does a great cardamom bun"), Post("soccer team won in overtime", 0.0)],
            AmbientOutputFilter.BuildExclusions(["#WaterIssues"], ["Water main fears"]));

        failing.Should().BeEmpty("nothing here names the incident and both sentiments are calm or warm");
    }

    [Theory]
    [InlineData("Is this an EMERGENCY or not")]
    [InlineData("they said evacuation is coming")]
    [InlineData("power outage on my block again")]
    [InlineData("heard about the contaminated pond")]
    [InlineData("boil-water notice for the east side")]
    [InlineData("boil   water before drinking")]
    [InlineData("officials said the plant is fine")]
    [InlineData("we were told to shelter-in-place")]
    [InlineData("got a weather alert this morning")]
    [InlineData("a warning issued for tonight")]
    [InlineData("a hazmat truck on 5th")]
    [InlineData("so many evacuees at the school")]
    [InlineData("power outages on my block again")]
    public void AFixedIncidentTerm_Fails(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], []).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Fact]
    public void TheActiveStorylineHashtag_Fails_InTextOrInTheHashtagList_WithOrWithoutTheHash()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions(["#WaterIssues"], []);

        AmbientOutputFilter.Inspect([Post("lovely day #waterissues")], exclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("lovely day", 0.3, "#WaterIssues")], exclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("talking about waterissues again")], exclusions).Should().NotBeEmpty();
    }

    [Fact]
    public void AStorylineTitleKeyword_Fails_ButShortAndStopWordsAreNotKeywords()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions([], ["Water-main fears near the treatment plant"]);

        exclusions.Should().Contain(["water", "fears", "treatment", "plant"]);
        exclusions.Should().NotContain(["main", "near", "the"], "stop words and words under four letters are not a signal");
        AmbientOutputFilter.Inspect([Post("watered the garden at dawn")], exclusions)
            .Should().Equal([AmbientOutputFilter.IncidentTermCheck], "false positives are accepted: dropping chatter is free");
    }

    // ---- Gate-1 W-A: word-boundary matching, no substring false positives ---------------------------

    private static readonly IReadOnlyList<string> WaterExclusions =
        AmbientOutputFilter.BuildExclusions(["#FairhavenWater"], ["Water main contamination fears"]);

    private static readonly IReadOnlyList<string> StormExclusions =
        AmbientOutputFilter.BuildExclusions(["#Fire", "#StormWatch"], ["Storm knocks out power"]);

    [Theory]
    [InlineData("best watermelon of the summer at the farmers market")]
    [InlineData("new cafe on the waterfront opened today")]
    [InlineData("spoiler alert: the home team won in overtime")]
    [InlineData("fair warning, the cardamom buns sell out by nine")]
    [InlineData("the officials missed a call in the third inning")]
    [InlineData("we adopted a dog from the animal shelter")]
    [InlineData("loved the #FairhavenWaterfront sunset photos")]
    public void WaterStoryline_EverydayWordsThatOnlyContainATerm_Pass(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], WaterExclusions)
            .Should().BeEmpty("a term inside a longer word, or an everyday phrase, is not the incident (W-A)");
    }

    [Theory]
    [InlineData("the team had a great brainstorm session")]
    [InlineData("what a powerful choir performance")]
    [InlineData("fireworks over the lake tonight")]
    [InlineData("fireworks tonight", "#Fireworks")]
    public void StormStoryline_EverydayWordsThatOnlyContainATerm_Pass(string text, string? hashtag = null)
    {
        var post = hashtag is null ? Post(text) : Post(text, 0.3, hashtag);

        AmbientOutputFilter.Inspect([post], StormExclusions)
            .Should().BeEmpty("brainstorm/powerful/fireworks only contain storm/power/fire (W-A)");
    }

    [Theory]
    [InlineData("is the water safe to drink")]
    [InlineData("the waters look murky")]
    [InlineData("boil water notice for the east side")]
    [InlineData("anyone following #FairhavenWater")]
    [InlineData("fairhavenwater is trending")]
    [InlineData("evacuation order for the river road")]
    [InlineData("heard the pond was contaminated")]
    public void WaterStoryline_TruePositives_StillFail(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], WaterExclusions).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Fact]
    public void WaterStoryline_TheStorylineHashtagInTheHashtagList_Fails_WithOrWithoutTheHash()
    {
        AmbientOutputFilter.Inspect([Post("lovely day", 0.3, "#FairhavenWater")], WaterExclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("lovely day", 0.3, "fairhaven_water")], WaterExclusions).Should().NotBeEmpty();
    }

    [Theory]
    [InlineData("the storm is almost here")]
    [InlineData("still no power on elm street")]
    [InlineData("the power went out again")]
    [InlineData("a fire near the ridge #fire")]
    [InlineData("the fires look closer")]
    [InlineData("following #StormWatch tonight")]
    public void StormStoryline_TruePositives_StillFail(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], StormExclusions).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Fact]
    public void AGenericTitleWord_StillDropsAnOnIncidentEverydayUse_ByDesign()
    {
        AmbientOutputFilter.Inspect([Post("poured a glass of water after my run")], WaterExclusions)
            .Should().Equal([AmbientOutputFilter.IncidentTermCheck], "whole-word 'water' is on-incident vocabulary for this exercise");
    }

    [Theory]
    [InlineData(-0.11)]
    [InlineData(-0.6)]
    [InlineData(double.NaN)]
    public void ANegativeSentiment_Fails(double sentiment)
    {
        AmbientOutputFilter.Inspect([Post("nice walk today", 0.5), Post("long line at the cafe", sentiment)], [])
            .Should().Equal(AmbientOutputFilter.SentimentCheck);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(0.0)]
    [InlineData(0.9)]
    public void CalmOrWarmSentiment_Passes(double sentiment)
    {
        AmbientOutputFilter.Inspect([Post("nice walk today", sentiment)], []).Should().BeEmpty();
    }

    [Fact]
    public void BothChecks_AreReportedOnce_AndTheVerdictIsDeterministic()
    {
        IReadOnlyList<GeneratedPost> burst = [Post("evacuation!", -0.5), Post("hazmat", -0.9)];

        var first = AmbientOutputFilter.Inspect(burst, []);
        var second = AmbientOutputFilter.Inspect(burst, []);

        first.Should().Equal(AmbientOutputFilter.IncidentTermCheck, AmbientOutputFilter.SentimentCheck);
        second.Should().Equal(first);
    }

    [Fact]
    public async Task TheFakeProvider_AmbientBurst_PassesTheFilter_WhileItsStorylineBurstWouldNot()
    {
        var fake = new FakeGenerationProvider();
        var request = new GenerationRequest
        {
            ExerciseId = Guid.NewGuid(),
            Tier = GenerationTier.Ambient,
            PostCount = 10,
            SystemPrompt = "ambient",
            IsAmbient = true,
        };

        var ambient = await fake.GenerateAsync(request);
        var storyline = await fake.GenerateAsync(request with { IsAmbient = false });

        AmbientOutputFilter.Inspect(ambient.Posts, []).Should().BeEmpty("the offline Fake emits everyday small talk for ambient");
        AmbientOutputFilter.Inspect(storyline.Posts, []).Should().NotBeEmpty("its incident lines are exactly what the filter exists for");
    }

    // ---- WR-3: four-letter title keywords, widened fixed vocabulary -----------------------------------

    [Theory]
    [InlineData("Gas leak on Elm", "leak")]
    [InlineData("Brush fire near the ridge", "fire")]
    [InlineData("Boil notice for the east side", "boil")]
    public void AFourLetterTitleWord_IsNowAKeyword(string title, string keyword)
    {
        AmbientOutputFilter.BuildExclusions([], [title]).Should().Contain(keyword, "MinTitleKeywordLength is 4 (WR-3)");
    }

    [Fact]
    public void FourLetterFunctionWords_AndGenericNouns_AreNotKeywords()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions([], ["News from the city with more over that main town area"]);

        exclusions.Should().BeEmpty("four-letter function words and generic place/report nouns are stop words");
    }

    [Theory]
    [InlineData("smoke from the wildfire is everywhere")]
    [InlineData("two firefighters on our street")]
    [InlineData("the creek flooded the underpass")]
    [InlineData("pretty sure there is a leak somewhere")]
    [InlineData("heard an explosion downtown")]
    [InlineData("the storm is rolling in")]
    [InlineData("tornado sirens again")]
    [InlineData("hurricane prep at the store")]
    [InlineData("felt that earthquake?")]
    [InlineData("they quarantined the building")]
    [InlineData("an outbreak at the school")]
    [InlineData("school lockdown this morning")]
    [InlineData("reports of casualties")]
    [InlineData("there is a house fire on oak")]
    [InlineData("brush fire up the ridge")]
    [InlineData("the fire department just went by")]
    [InlineData("smells like a gas leak")]
    [InlineData("a chemical spill on the highway")]
    [InlineData("oil spill at the marina")]
    [InlineData("toxic fumes near the plant")]
    [InlineData("reports of an active shooter")]
    [InlineData("shots fired near the park")]
    [InlineData("power is out on my block")]
    [InlineData("the power out here is annoying")]
    [InlineData("missing person flyer at the cafe")]
    public void AWidenedFixedIncidentTerm_Fails(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], []).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Theory]
    [InlineData("time to fire up the grill for the weekend")]
    [InlineData("our striker is on fire this season")]
    [InlineData("fireworks over the lake tonight")]
    [InlineData("the new stadium floodlights look great")]
    [InlineData("gas prices dropped a little this week")]
    [InlineData("she is shooting 40 percent from three this year")]
    [InlineData("best three point shooter in the league")]
    [InlineData("spilled my coffee all over the counter")]
    [InlineData("this chili is exploding with flavor")]
    [InlineData("the crowd exploded after the goal")]
    [InlineData("our point guard is back from a sports injury")]
    [InlineData("chemical-free shampoo for the dog")]
    [InlineData("what a lights out performance by the band")]
    [InlineData("great brainstorm session at the library")]
    public void EverydaySportsFoodAndPetsPhrases_Pass_UnderTheWidenedVocabulary(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], [])
            .Should().BeEmpty("phrase-only terms keep everyday sports/food/pets speech out of the fixed vocabulary (WR-3)");
    }

    // ---- SG-1: Unicode folding, incident emoji, hashtag digit runs ------------------------------------

    [Theory]
    [InlineData("is the w\u200Bater ok today")]     // zero-width space
    [InlineData("is the w\u200Dater ok today")]     // zero-width joiner
    [InlineData("is the wa\u00ADter ok today")]     // soft hyphen
    [InlineData("is the \uFF37\uFF21\uFF34\uFF25\uFF32 ok today")] // fullwidth WATER
    public void ObfuscatedStorylineKeyword_IsFoldedAndFails(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], WaterExclusions).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Theory]
    [InlineData("contaminación del agua")]
    [InlineData("évacuation du quartier")]
    [InlineData("EMERGÉNCIA na cidade")]
    public void Diacritics_AreFolded_SoTheStemsStillHit(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], []).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Theory]
    [InlineData("lovely morning \U0001F6B1")]
    [InlineData("hmm \u2623\uFE0F")]
    [InlineData("hmm \u2622")]
    [InlineData("on my way \U0001F6A8")]
    [InlineData("careful out there \u26A0\uFE0F")]
    public void AnIncidentEmoji_Fails_WithOrWithoutTheVariationSelector(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], []).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Fact]
    public void AnIncidentEmoji_InTheHashtagList_Fails_ButAWaterDroplet_Passes()
    {
        AmbientOutputFilter.Inspect([Post("lovely morning", 0.3, "\U0001F6A8")], []).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("watered the tomatoes \U0001F4A7 so green")], [])
            .Should().BeEmpty("the droplet is common in innocuous posts and is deliberately not an incident emoji");
    }

    [Theory]
    [InlineData("anyone following #FairhavenWater2")]
    [InlineData("anyone following #FairhavenWater2026")]
    public void AStorylineHashtag_WithATrailingDigitRun_Fails(string text)
    {
        var exclusions = AmbientOutputFilter.BuildExclusions(["#FairhavenWater"], []);

        AmbientOutputFilter.Inspect([Post(text)], exclusions).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
        AmbientOutputFilter.Inspect([Post("lovely day", 0.3, "#FairhavenWater2")], exclusions).Should().NotBeEmpty();
    }

    [Fact]
    public void AStorylineHashtag_ThatItselfEndsInDigits_StillMatchesExactly()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions(["#Storm2026"], []);

        AmbientOutputFilter.Inspect([Post("following #Storm2026 tonight")], exclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("following #FairhavenFair2026 tonight")], exclusions).Should().BeEmpty();
    }

    [Fact]
    public void Fold_AppliesNfkc_StripsFormatAndMarks_AndLowerCases()
    {
        AmbientOutputFilter.Fold("\uFF37a\u200Bter Contaminación ☣\uFE0F").Should().Be("water contaminacion ☣");
    }
}
