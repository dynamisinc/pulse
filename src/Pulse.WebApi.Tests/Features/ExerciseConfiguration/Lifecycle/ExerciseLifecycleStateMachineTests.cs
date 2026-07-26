namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Lifecycle;

using System.Linq;
using FluentAssertions;
using Pulse.WebApi.Features.ExerciseConfiguration.Lifecycle;
using Xunit;

/// <summary>
/// The pure state-machine suite (COR-032) — the vocabulary, the allowed transitions, the legacy mapping, the
/// participant-access rule and the per-state behaviour hooks. No database, no HTTP, so these are plain
/// <see cref="FactAttribute"/>s outside <c>MsSqlCollection</c> and run on any machine.
/// </summary>
public sealed class ExerciseLifecycleStateMachineTests
{
    /// <summary>AC1: the authoritative literals, verbatim and in lifecycle order — no coined variant.</summary>
    [Fact]
    public void All_IsExactlyTheSixAuthoritativeCor032Literals_InOrder()
    {
        ExerciseLifecycleStates.All.Should().Equal(
            ["build", "staged", "live", "paused", "completed", "archived"],
            "implementation.md's 'Lifecycle string literals' are authoritative — lowercase, and 'completed', never 'complete'");
    }

    /// <summary>AC1: nothing in the slice coins a second vocabulary or a cased variant.</summary>
    [Theory]
    [InlineData("Build")]
    [InlineData("in_progress")]
    [InlineData("ended")]
    [InlineData("Live")]
    public void TryParse_NeverEmitsACoinedOrCasedVariant(string raw)
    {
        ExerciseLifecycleStates.TryParse(raw, out var parsed);

        parsed.Should().BeOneOf(
            [null, .. ExerciseLifecycleStates.All],
            "a parsed state is always one of the six canonical lowercase literals, or nothing");
    }

    /// <summary>AC1 / the transition period: the legacy four fold onto implementation.md's mapping table.</summary>
    [Theory]
    [InlineData("scheduled", "build")]
    [InlineData("active", "live")]
    [InlineData("complete", "completed")]
    [InlineData("archived", "archived")]
    public void TryParse_MapsTheLegacyVocabulary_PerTheAuthoritativeTable(string legacy, string expected)
    {
        ExerciseLifecycleStates.TryParse(legacy, out var parsed).Should().BeTrue();
        parsed.Should().Be(expected, "the legacy four stay readable through the transition, deliberately");
    }

    /// <summary>An unknown literal never parses — the fail-closed direction.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("running")]
    public void TryParse_RejectsAnUnknownLiteral(string? raw)
    {
        ExerciseLifecycleStates.TryParse(raw, out var parsed).Should().BeFalse();
        parsed.Should().BeNull();
    }

    /// <summary>AC2: exactly COR-032's chain, plus the resume edge the chain's own semantics require.</summary>
    [Theory]
    [InlineData("build", "staged")]
    [InlineData("staged", "live")]
    [InlineData("live", "paused")]
    [InlineData("live", "completed")]
    [InlineData("paused", "live")]
    [InlineData("paused", "completed")]
    [InlineData("completed", "archived")]
    public void IsTransitionAllowed_AllowsTheCor032Chain(string from, string to) =>
        ExerciseLifecycleStates.IsTransitionAllowed(from, to).Should().BeTrue(
            "'{0}' -> '{1}' is on COR-032's Build->Staged->Live->Paused->Completed->Archived chain", from, to);

    /// <summary>AC2: everything off the chain is refused (the endpoint maps this to 409).</summary>
    [Theory]
    [InlineData("build", "live")]
    [InlineData("build", "completed")]
    [InlineData("build", "archived")]
    [InlineData("staged", "build")]
    [InlineData("staged", "paused")]
    [InlineData("staged", "completed")]
    [InlineData("live", "staged")]
    [InlineData("live", "archived")]
    [InlineData("paused", "staged")]
    [InlineData("completed", "live")]
    [InlineData("completed", "paused")]
    [InlineData("archived", "completed")]
    [InlineData("archived", "live")]
    [InlineData("archived", "build")]
    public void IsTransitionAllowed_RefusesEverythingOffTheChain(string from, string to) =>
        ExerciseLifecycleStates.IsTransitionAllowed(from, to).Should().BeFalse(
            "un-staging, shortcuts and reopening a closed run are not COR-032 transitions");

    /// <summary>AC2: a self-transition is not a silent no-op success — it is a 409.</summary>
    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("live")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    public void IsTransitionAllowed_RefusesASelfTransition(string state) =>
        ExerciseLifecycleStates.IsTransitionAllowed(state, state).Should().BeFalse(
            "a client asking to move '{0}' -> '{0}' believes the world is in a state it is not", state);

    /// <summary>Archived is terminal: nothing leaves it.</summary>
    [Fact]
    public void AllowedTransitionsFrom_Archived_IsEmpty_AndArchivedIsTerminal()
    {
        ExerciseLifecycleStates.AllowedTransitionsFrom("archived").Should().BeEmpty();
        ExerciseLifecycleStates.BehaviourOf("archived").IsTerminal.Should().BeTrue();
    }

    /// <summary>A legacy row transitions exactly as its canonical equivalent does.</summary>
    [Fact]
    public void IsTransitionAllowed_TreatsALegacyRowAsItsCanonicalEquivalent()
    {
        ExerciseLifecycleStates.IsTransitionAllowed("active", "paused").Should().BeTrue(
            "'active' folds onto 'live', from which 'paused' is allowed");
        ExerciseLifecycleStates.IsTransitionAllowed("scheduled", "staged").Should().BeTrue(
            "'scheduled' folds onto 'build', from which 'staged' is allowed");
        ExerciseLifecycleStates.IsTransitionAllowed("complete", "archived").Should().BeTrue(
            "'complete' folds onto 'completed', from which 'archived' is allowed");
    }

    /// <summary>An unknown state has no edges at all — fail closed.</summary>
    [Fact]
    public void AllowedTransitionsFrom_AnUnknownState_IsEmpty()
    {
        ExerciseLifecycleStates.AllowedTransitionsFrom("running").Should().BeEmpty();
        ExerciseLifecycleStates.IsTransitionAllowed("running", "live").Should().BeFalse();
    }

    /// <summary>
    /// AC3: the refusal set is exactly <c>build</c> / <c>completed</c> / <c>archived</c>. <c>paused</c> stays
    /// accessible so the holding page can render (AC6).
    /// </summary>
    [Theory]
    [InlineData("staged", true)]
    [InlineData("live", true)]
    [InlineData("paused", true)]
    [InlineData("build", false)]
    [InlineData("completed", false)]
    [InlineData("archived", false)]
    public void IsParticipantAccessible_MatchesCor032(string state, bool accessible) =>
        ExerciseLifecycleStates.IsParticipantAccessible(state).Should().Be(
            accessible, "COR-032: participants access Staged and Live (and Paused, to see the holding page)");

    /// <summary>AC3, fail closed: an unrecognized status admits nobody.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("running")]
    public void IsParticipantAccessible_FailsClosedOnAnUnknownState(string? state) =>
        ExerciseLifecycleStates.IsParticipantAccessible(state).Should().BeFalse(
            "a typo in the status column must blank the participant world, never open an unknown one");

    /// <summary>A legacy row's accessibility follows its canonical mapping, not its spelling.</summary>
    [Theory]
    [InlineData("active", true)]
    [InlineData("scheduled", false)]
    [InlineData("complete", false)]
    public void IsParticipantAccessible_FollowsTheLegacyMapping(string legacy, bool accessible) =>
        ExerciseLifecycleStates.IsParticipantAccessible(legacy).Should().Be(
            accessible, "'scheduled' maps to 'build' per implementation.md's table — not to 'staged'");

    /// <summary>AC7: Staged runs the ambient world but neither the clock nor scheduled scenario content.</summary>
    [Fact]
    public void BehaviourOf_Staged_OpensParticipantAccessButHoldsTheClockAndScenarioContent()
    {
        var behaviour = ExerciseLifecycleStates.BehaviourOf("staged");

        behaviour.ParticipantAccessOpen.Should().BeTrue("Staged opens participant access (COR-032)");
        behaviour.AmbientWorldRuns.Should().BeTrue("Staged runs the ambient world");
        behaviour.ClockRuns.Should().BeFalse("the clock starts at StartEx, not at Staged (COR-050)");
        behaviour.ScenarioContentFires.Should().BeFalse("scheduled scenario content is held until Live");
        behaviour.IsTerminal.Should().BeFalse();
    }

    /// <summary>AC7: Live is the only state where the clock runs and scenario content fires.</summary>
    [Fact]
    public void BehaviourOf_Live_IsTheOnlyStateThatRunsTheClockAndFiresScenarioContent()
    {
        ExerciseLifecycleStates.All
            .Where(s => ExerciseLifecycleStates.BehaviourOf(s).ClockRuns)
            .Should().ContainSingle().Which.Should().Be("live");

        ExerciseLifecycleStates.All
            .Where(s => ExerciseLifecycleStates.BehaviourOf(s).ScenarioContentFires)
            .Should().ContainSingle().Which.Should().Be("live");
    }

    /// <summary>AC7: Build/Completed/Archived run nothing and admit nobody.</summary>
    [Theory]
    [InlineData("build")]
    [InlineData("completed")]
    [InlineData("archived")]
    public void BehaviourOf_TheClosedStates_RunNothingAndAdmitNobody(string state)
    {
        var behaviour = ExerciseLifecycleStates.BehaviourOf(state);

        behaviour.ParticipantAccessOpen.Should().BeFalse();
        behaviour.ParticipantWritesAccepted.Should().BeFalse();
        behaviour.AmbientWorldRuns.Should().BeFalse();
        behaviour.ClockRuns.Should().BeFalse();
        behaviour.ScenarioContentFires.Should().BeFalse();
    }

    /// <summary>AC7: Paused still serves participants (the holding page) but advances nothing.</summary>
    [Fact]
    public void BehaviourOf_Paused_ServesParticipantsButAdvancesNothing()
    {
        var behaviour = ExerciseLifecycleStates.BehaviourOf("paused");

        behaviour.ParticipantAccessOpen.Should().BeTrue("the holding page has to reach the participant");
        behaviour.ParticipantWritesAccepted.Should().BeFalse();
        behaviour.ClockRuns.Should().BeFalse();
        behaviour.AmbientWorldRuns.Should().BeFalse();
    }

    /// <summary>AC7, fail closed: an unknown state's behaviour is the fully-closed set.</summary>
    [Fact]
    public void BehaviourOf_AnUnknownState_IsTheFullyClosedSet() =>
        ExerciseLifecycleStates.BehaviourOf("running").Should().Be(ExerciseLifecycleBehaviour.Closed);
}
