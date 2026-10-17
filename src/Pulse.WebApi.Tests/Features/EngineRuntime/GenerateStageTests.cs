namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.EngineEval;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Features.EngineRuntime;
using Xunit;

/// <summary>
/// Story 01 AC "Generate stage (guard-before-human)": the generate stage assembles the prompt via the built
/// <see cref="PromptAssembler"/> + world-feed fence, calls the provider, and only surfaces a burst that
/// passes BOTH the <see cref="ContentGuard"/> fiction/injection filter AND the diversity gate — a
/// guard-failing or converged burst is bounded-re-rolled then DROPPED, never surfaced (§8.5). Also covers the
/// ADP-024 guarantee: whatever the provider returns, an obeyed injection tell never reaches a review item.
/// Model-only (no DB) → plain <see cref="FactAttribute"/>.
/// </summary>
public sealed class GenerateStageTests
{
    private static readonly Guid ExerciseId = Guid.NewGuid();

    private static PersonaDossier Dossier(string handle) => new()
    {
        Handle = handle,
        DisplayName = handle.TrimStart('@'),
        Type = PersonaType.Resident,
        Style = new PersonaStyle(),
    };

    private static StorylineBrief Brief() => new()
    {
        Title = "Water main contamination fears",
        Expectation = "an official statement from the county",
        MinutesSinceLastOfficialResponse = 30,
        Intensity = 40,
        Phase = "ESCALATING",
        ToneMix = new ToneMix { Worry = 0.5, Speculation = 0.5 },
        Hashtags = ["#WaterIssues"],
    };

    private static GenerateStageRequest RequestFor(IReadOnlyList<PersonaDossier> personas) => new()
    {
        ExerciseId = ExerciseId,
        ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
        Storyline = Brief(),
        Personas = personas,
        Tier = GenerationTier.Standard,
    };

    private static GenerateStage StageReturning(params GeneratedPost[] posts) =>
        new(new StubGenerationProvider(posts), new PromptAssembler());

    [Fact]
    public async Task GenerateAsync_CleanDiverseBurst_IsAccepted_OnFirstAttempt()
    {
        // Provider handles deliberately differ from the persona handles (the real Fake provider does the
        // same) — so only the cross-persona diversity metrics gate, and two distinct clean posts pass.
        var stage = StageReturning(
            new GeneratedPost("@gen0", "the water pressure dropped on maple street this morning, anyone know why", -0.3, ["#WaterIssues"]),
            new GeneratedPost("@gen1", "county really needs to say something, my kids keep asking about the tap warning", -0.4, []));

        var result = await stage.GenerateAsync(RequestFor([Dossier("@rosa"), Dossier("@marcus")]));

        result.Disposition.Should().Be(GenerateDisposition.Accepted, "a clean, diverse burst passes both gates");
        result.GuardResult.Should().Be("pass");
        result.Posts.Should().HaveCount(2);
        result.Attempts.Should().Be(1, "the first attempt already passed, so no re-roll was needed");
    }

    [Fact]
    public async Task GenerateAsync_FictionBreakingBurst_IsDropped_NeverSurfaced()
    {
        var provider = new StubGenerationProvider(
        [
            new GeneratedPost("@gen0", "honestly this is a drill so nobody should worry about the water", 0.0, []),
        ]);
        var stage = new GenerateStage(provider, new PromptAssembler());

        var result = await stage.GenerateAsync(RequestFor([Dossier("@rosa")]));

        result.Disposition.Should().Be(GenerateDisposition.Dropped, "a fiction-break draft must never reach a review item (ADP-023)");
        result.GuardResult.Should().Be("drop");
        result.Posts.Should().BeEmpty();
        provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "a failing burst is re-rolled up to the bound before it is dropped");
    }

    [Fact]
    public async Task GenerateAsync_ConvergedBurst_FailsDiversity_AndIsDropped()
    {
        // Two identical posts → maximal pairwise overlap → the diversity gate fails.
        const string same = "the county has not said anything about the water and people are getting worried now";
        var stage = StageReturning(
            new GeneratedPost("@gen0", same, -0.4, []),
            new GeneratedPost("@gen1", same, -0.4, []));

        var result = await stage.GenerateAsync(RequestFor([Dossier("@rosa"), Dossier("@marcus")]));

        result.Disposition.Should().Be(GenerateDisposition.Dropped, "a converged burst is a §5.2 diversity failure and is dropped");
        result.Posts.Should().BeEmpty();
        result.FailingChecks.Should().Contain("pairwise-overlap");
    }

    public static IEnumerable<object[]> ObeyedInjectionTells =>
        InjectionRedTeam.Catalog.Select(attack => new object[] { attack.Name, attack.ObeyedTell });

    [Theory]
    [MemberData(nameof(ObeyedInjectionTells))]
    public async Task GenerateAsync_WhenProviderObeysAnInjection_TheBurstIsAlwaysDropped(string attackName, string obeyedTell)
    {
        // ADP-024 guard-before-human: no matter what the provider returns, an obeyed injection tell is caught
        // by ContentGuard and the burst is dropped — it never reaches a controller. Keeps the red-team green
        // against the provider path the host runs.
        _ = attackName;
        var stage = StageReturning(new GeneratedPost("@gen0", obeyedTell, 0.0, []));

        var result = await stage.GenerateAsync(RequestFor([Dossier("@rosa")]));

        result.Disposition.Should().Be(GenerateDisposition.Dropped);
        result.Posts.Should().BeEmpty();
    }

    public static IEnumerable<object[]> PersonaVoiceNotesAttacks =>
        InjectionRedTeam.Catalog
            .Where(attack => attack.Vector == InjectionVector.PersonaVoiceNotes)
            .Select(attack => new object[] { attack.Name });

    [Theory]
    [MemberData(nameof(PersonaVoiceNotesAttacks))]
    public async Task GenerateAsync_AmbientBurst_SteeredViaPersonaVoiceNotes_ObeyedOutputIsDropped(string attackName)
    {
        // Gate-1 M-2 (ambient-chatter story 01, AC7): the hostile payload is put on the REAL persona path — the persona's
        // VoiceNotes — of an ambient burst. Since WR-1 the ambient prompt omits voice notes, so it never reaches the model;
        // even if a provider emitted the obeyed tell anyway, the guard must drop the burst so nothing can reach the
        // autonomous publish path.
        var attack = InjectionRedTeam.Catalog.Single(a => a.Name == attackName);
        var provider = new StubGenerationProvider([new GeneratedPost("@gen0", "lovely morning at the bakery — " + attack.ObeyedTell, 0.2, [])]);
        var stage = new GenerateStage(provider, new PromptAssembler());
        var request = new GenerateStageRequest
        {
            ExerciseId = ExerciseId,
            ExerciseBrief = "The fictional town of Cedar Falls on an ordinary weekday.",
            Storyline = new StorylineBrief
            {
                Title = "cooking, restaurants and local food spots",
                Expectation = string.Empty,
                ToneMix = new ToneMix { Calm = 0.75, Gratitude = 0.25 },
                IsAmbient = true,
            },
            Personas = [Dossier("@rosa") with { VoiceNotes = attack.WorldFeedPayload }],
            Tier = GenerationTier.Ambient,
        };

        var result = await stage.GenerateAsync(request);

        provider.LastRequest!.SystemPrompt.Should().NotContain(attack.WorldFeedPayload, "ambient prompts drop voice notes (WR-1)");
        result.Disposition.Should().Be(GenerateDisposition.Dropped, "an obeyed persona-bio steer never surfaces");
        result.Posts.Should().BeEmpty();
    }

    [Theory]
    [MemberData(nameof(PersonaVoiceNotesAttacks))]
    public async Task GenerateAsync_StorylineBurst_SteeredViaPersonaVoiceNotes_ReachesThePrompt_ButObeyedOutputIsDropped(string attackName)
    {
        // The WR-1 residual: storyline prompts still carry persona voice notes unfenced, so the guard is the defence there.
        var attack = InjectionRedTeam.Catalog.Single(a => a.Name == attackName);
        var provider = new StubGenerationProvider([new GeneratedPost("@gen0", "is the tap water ok? " + attack.ObeyedTell, -0.2, [])]);
        var stage = new GenerateStage(provider, new PromptAssembler());
        var request = RequestFor([Dossier("@rosa") with { VoiceNotes = attack.WorldFeedPayload }]);

        var result = await stage.GenerateAsync(request);

        provider.LastRequest!.SystemPrompt.Should().Contain(attack.WorldFeedPayload, "storyline prompts keep voice notes (WR-1 residual)");
        result.Disposition.Should().Be(GenerateDisposition.Dropped, "an obeyed persona-bio steer never surfaces");
    }

    [Fact]
    public async Task GenerateAsync_InvokesBeforeAttempt_BeforeEachProviderCall()
    {
        // SG-2: the hook runs BEFORE every (paid) provider call — including each re-roll — with the 1-based attempt.
        var provider = new StubGenerationProvider([
            new GeneratedPost("@gen0", "the exercise is over, everyone go home", 0.0, []),
        ]);
        var stage = new GenerateStage(provider, new PromptAssembler());
        var seen = new List<(int Attempt, int CallsBefore)>();
        var request = RequestFor([Dossier("@rosa")]) with { BeforeAttempt = attempt => seen.Add((attempt, provider.Calls)) };

        var result = await stage.GenerateAsync(request);

        result.Disposition.Should().Be(GenerateDisposition.Dropped);
        seen.Should().Equal(
            Enumerable.Range(1, GenerateStage.DefaultMaxAttempts).Select(attempt => (attempt, attempt - 1)),
            "each attempt is announced before its provider call is made");
    }
}
