namespace Pulse.Core.Tests.Features.Ambient;

using FluentAssertions;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;

/// <summary>
/// ambient-chatter story 01, AC0 + AC1: the pure policy validation — default off, the governed autonomy gate,
/// caps never above the global engine cap, topics only from the fixed vocabulary, empty allow-lists meaning nothing.
/// </summary>
public class AmbientPolicyValidatorTests
{
    private static AmbientPolicyValidation Validate(
        string? mode = "review",
        int? perMinute = 4,
        int? perHour = 60,
        IReadOnlyList<string>? topics = null,
        IReadOnlyList<string>? personas = null,
        int globalCap = 60,
        bool authorized = false) =>
        AmbientPolicyValidator.Validate(mode, perMinute, perHour, topics, personas, globalCap, authorized);

    [Fact]
    public void TheRestingPolicy_IsOff_WithZeroCapsAndEmptyAllowLists()
    {
        AmbientTierPolicy.Off.Mode.Should().Be(AmbientPolicyMode.Off, "no ambient content until a controller turns it on (AC1)");
        AmbientTierPolicy.Off.MaxPerMinute.Should().Be(0);
        AmbientTierPolicy.Off.MaxPerHour.Should().Be(0);
        AmbientTierPolicy.Off.TopicAllowList.Should().BeEmpty();
        AmbientTierPolicy.Off.PersonaAllowList.Should().BeEmpty();
    }

    [Fact]
    public void Autonomous_WhenNotAuthorized_IsRejected_WithTheGovernanceMessage()
    {
        var result = Validate(mode: "autonomous", authorized: false);

        result.IsValid.Should().BeFalse("autonomous ambient posting merges dark until PROVIDER-GOVERNANCE §8 is amended (AC0)");
        result.Error.Should().Contain("not authorized by PROVIDER-GOVERNANCE §8");
    }

    [Fact]
    public void Autonomous_WhenAuthorized_IsAccepted()
    {
        var result = Validate(mode: "autonomous", authorized: true);

        result.IsValid.Should().BeTrue();
        result.Draft!.Mode.Should().Be(AmbientPolicyMode.Autonomous);
    }

    [Theory]
    [InlineData("off")]
    [InlineData("review")]
    public void OffAndReview_AreAllowed_EvenWhenAutonomyIsNotAuthorized(string mode)
    {
        Validate(mode: mode, authorized: false).IsValid.Should().BeTrue("only autonomous is gated by the §8 flag");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Autonomous")]
    [InlineData("auto")]
    public void AnUnknownMode_IsRejected(string? mode)
    {
        Validate(mode: mode).IsValid.Should().BeFalse("only the three exact literals are accepted, never a silent default");
    }

    [Fact]
    public void MaxPerMinute_AboveTheExercisesGlobalCap_IsRejected()
    {
        var result = Validate(perMinute: 11, globalCap: 10);

        result.IsValid.Should().BeFalse("ambient caps are additional to MaxEnginePostsPerMinute, never larger (AC1)");
        result.Error.Should().Contain("MaxEnginePostsPerMinute");
    }

    [Fact]
    public void MaxPerMinute_EqualToTheGlobalCap_IsAccepted()
    {
        Validate(perMinute: 10, perHour: 10, globalCap: 10).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData(null, 10)]
    [InlineData(-1, 10)]
    [InlineData(1, null)]
    [InlineData(1, -1)]
    public void AMissingOrNegativeCap_IsRejected(int? perMinute, int? perHour)
    {
        Validate(perMinute: perMinute, perHour: perHour).IsValid.Should().BeFalse();
    }

    [Fact]
    public void MaxPerHour_AboveSixtyTimesTheGlobalCap_IsRejected()
    {
        Validate(perMinute: 1, perHour: 601, globalCap: 10).IsValid.Should().BeFalse();
    }

    [Fact]
    public void ATopicOutsideTheFixedVocabulary_IsRejected()
    {
        var result = Validate(topics: ["food", "the water main break"]);

        result.IsValid.Should().BeFalse("topics come only from the fixed server-side vocabulary (AC1)");
        result.Error.Should().Contain("the water main break");
    }

    [Fact]
    public void Vocabulary_IsLowercaseKebab_AndCoversTheFrontendFallback()
    {
        AmbientTopics.Vocabulary.Should().OnlyContain(topic => topic == topic.ToLowerInvariant() && !topic.Contains(' '));
        AmbientTopics.Vocabulary.Should().Contain(["local-color", "traffic-mundane", "food", "sports", "community-events"]);
    }

    [Fact]
    public void MissingAllowLists_AreEmpty_MeaningNothing()
    {
        var result = Validate(topics: null, personas: null);

        result.IsValid.Should().BeTrue();
        result.Draft!.Topics.Should().BeEmpty("an omitted allow-list is empty, never 'everything'");
        result.Draft.PersonaIds.Should().BeEmpty();
    }

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void AnInvalidPersonaId_IsRejected(string raw)
    {
        Validate(personas: [raw]).IsValid.Should().BeFalse();
    }

    [Fact]
    public void DuplicateTopicsAndPersonas_Collapse()
    {
        var persona = Guid.NewGuid().ToString();
        var result = Validate(topics: ["food", "food", "pets"], personas: [persona, persona]);

        result.Draft!.Topics.Should().Equal("food", "pets");
        result.Draft.PersonaIds.Should().ContainSingle();
    }

    [Fact]
    public void ToPolicy_AttributesTheSettingHuman()
    {
        var policy = Validate(topics: ["food"]).Draft!.ToPolicy("controller-7");

        policy.SetBy.Should().Be("controller-7", "the actor on ambient engine events is the controller who set the policy (AC9)");
        policy.TopicAllowList.Should().Equal("food");
    }
}
