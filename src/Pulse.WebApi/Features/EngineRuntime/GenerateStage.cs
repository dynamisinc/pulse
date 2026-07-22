namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pulse.Core.Features.EngineEval;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.PersonaVoice.Services;

/// <summary>
/// The reaction loop's <b>generate</b> stage (E8 architecture §1.2 back-half, §3.4/§8.5) — the missing
/// stage story 01 builds. It is the <i>guard-before-human</i> gate: a decided
/// <see cref="Pulse.Core.Features.ReactionLoop.Models.GenerationIntent"/> is turned into a persona-voiced
/// burst that MUST pass both the <see cref="ContentGuard"/> fiction/injection filter (§9, ADP-023/024) and
/// the <see cref="BurstAcceptancePolicy"/> diversity gate (§5.2) BEFORE it can become a review item. A
/// guard-failing or diversity-failing burst is auto-re-rolled within a bounded number of attempts, then
/// dropped — never surfaced to a controller (§8.5 pre-filtering). Nothing here publishes or persists; it
/// only produces (or drops) a candidate burst.
/// </summary>
/// <remarks>
/// <para>
/// <b>The trust boundary (ADP-024).</b> The prompt is assembled by the built <see cref="IPromptAssembler"/>,
/// which puts trusted engine context in the system prompt and fences all untrusted world/participant text
/// inside the <see cref="WorldFeedFence"/> block — this stage never mixes participant text into the trusted
/// strata. Because the guard runs before any human sees a draft, the release-gating
/// <see cref="InjectionRedTeam"/> suite stays green against whatever provider the host runs (Fake in CI).
/// </para>
/// <para>Stateless (a pure pipeline over the injected provider + assembler) → registered as a singleton.</para>
/// </remarks>
public sealed class GenerateStage
{
    /// <summary>The default bounded re-roll budget before a failing burst is dropped rather than surfaced (§5.2).</summary>
    public const int DefaultMaxAttempts = BurstAcceptancePolicy.DefaultMaxAttempts;

    private readonly IGenerationProvider _provider;
    private readonly IPromptAssembler _promptAssembler;

    /// <summary>Creates the generate stage over the configured generation provider and prompt assembler.</summary>
    /// <param name="provider">The config-selected generation provider (Fake in CI; a governed provider in a deployment).</param>
    /// <param name="promptAssembler">The three-strata prompt assembler that fences untrusted world content.</param>
    public GenerateStage(IGenerationProvider provider, IPromptAssembler promptAssembler)
    {
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(promptAssembler);

        _provider = provider;
        _promptAssembler = promptAssembler;
    }

    /// <summary>
    /// Generates one guard-and-diversity-filtered burst for <paramref name="request"/>. Assembles the prompt,
    /// calls the provider, and inspects each draft with the content guard AND the burst-acceptance diversity
    /// gate; a burst that fails either is re-rolled while attempts remain, then dropped. Returns the accepted
    /// burst (with provider/usage/latency for telemetry) or a <see cref="GenerateDisposition.Dropped"/>
    /// outcome that never reaches a review item.
    /// </summary>
    /// <param name="request">The generation request assembled from the decided intent.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The generate outcome: accepted (with the burst) or dropped (never surfaced).</returns>
    public async Task<GenerateStageResult> GenerateAsync(
        GenerateStageRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var maxAttempts = Math.Max(1, request.MaxAttempts);

        // The per-persona style map drives the conformance half of the diversity gate; the diversity half
        // (cross-persona overlap / distinct-2) runs regardless of whether a handle matches a style.
        var stylesByHandle = BuildStyleMap(request.Personas);

        var assemblyInput = new PromptAssemblyInput
        {
            ExerciseId = request.ExerciseId,
            ExerciseBrief = request.ExerciseBrief,
            Storyline = request.Storyline,
            Personas = request.Personas,
            WorldPosts = request.WorldPosts,
            Tier = request.Tier,
        };

        var generationRequest = _promptAssembler.Assemble(assemblyInput);

        GenerationResult? lastResult = null;
        IReadOnlyList<string> lastFailingChecks = [];

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var result = await _provider.GenerateAsync(generationRequest, cancellationToken);
            lastResult = result;

            var guard = ContentGuard.InspectBurst(result.Posts);
            var diversity = BurstAcceptancePolicy.Evaluate(result.Posts, stylesByHandle);

            if (guard.Clean && diversity.Passed)
            {
                return GenerateStageResult.Accepted(result, attempt);
            }

            lastFailingChecks = BuildFailingChecks(guard, diversity);

            // Bounded re-roll: regenerate while attempts remain, otherwise drop (logged by the caller, never
            // surfaced — §8.5). Mirrors BurstAcceptancePolicy.Decide, widened to also cover a guard failure.
            if (attempt >= maxAttempts)
            {
                break;
            }
        }

        return GenerateStageResult.Dropped(lastResult, maxAttempts, lastFailingChecks);
    }

    /// <summary>Builds the persona-handle → established-style map the conformance check reads.</summary>
    private static Dictionary<string, PersonaStyle> BuildStyleMap(IReadOnlyList<PersonaDossier> personas)
    {
        var map = new Dictionary<string, PersonaStyle>(personas.Count, StringComparer.Ordinal);
        foreach (var persona in personas)
        {
            map[persona.Handle] = persona.Style;
        }

        return map;
    }

    /// <summary>Names the checks a failing burst tripped (guard categories + diversity/conformance) for telemetry/logs.</summary>
    private static List<string> BuildFailingChecks(GuardResult guard, BurstEvaluation diversity)
    {
        var checks = new List<string>();
        if (!guard.Clean)
        {
            foreach (var violation in guard.Violations)
            {
                checks.Add($"guard:{violation.Kind}");
            }
        }

        checks.AddRange(diversity.FailingChecks);
        return checks;
    }
}

/// <summary>
/// The input to <see cref="GenerateStage.GenerateAsync"/> — everything needed to assemble one burst's prompt
/// from a decided intent plus the bounded re-roll budget.
/// </summary>
public sealed record GenerateStageRequest
{
    /// <summary>The exercise this burst belongs to (COR-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The fictional world + scenario brief (trusted engine context for the system prompt).</summary>
    public required string ExerciseBrief { get; init; }

    /// <summary>The generation-facing projection of the storyline being advanced.</summary>
    public required StorylineBrief Storyline { get; init; }

    /// <summary>The eligible cast to voice the burst — one post each (burst-in-one-call diversity, §5.2).</summary>
    public required IReadOnlyList<PersonaDossier> Personas { get; init; }

    /// <summary>Recent world/participant posts to react to. Untrusted — fenced by the assembler (ADP-024).</summary>
    public IReadOnlyList<WorldPost> WorldPosts { get; init; } = [];

    /// <summary>The model tier for this burst (Standard for storyline-critical reactions; Ambient for lulls).</summary>
    public required GenerationTier Tier { get; init; }

    /// <summary>The bounded re-roll budget before a failing burst is dropped (defaults to <see cref="GenerateStage.DefaultMaxAttempts"/>).</summary>
    public int MaxAttempts { get; init; } = GenerateStage.DefaultMaxAttempts;
}

/// <summary>Whether the generate stage produced a surfaceable burst or dropped it after exhausting re-rolls.</summary>
public enum GenerateDisposition
{
    /// <summary>The burst passed the content guard AND the diversity gate — eligible to become a review item.</summary>
    Accepted,

    /// <summary>The burst failed the guard or diversity after the bounded re-rolls — dropped, never surfaced (§8.5).</summary>
    Dropped,
}

/// <summary>
/// The outcome of <see cref="GenerateStage.GenerateAsync"/>. An <see cref="GenerateDisposition.Accepted"/>
/// result carries the guard-clean burst plus the provider/model/usage/latency the <c>engine.generated</c>
/// telemetry reports; a <see cref="GenerateDisposition.Dropped"/> result carries the failing checks for the
/// log and never yields posts.
/// </summary>
public sealed class GenerateStageResult
{
    private GenerateStageResult(
        GenerateDisposition disposition,
        IReadOnlyList<GeneratedPost> posts,
        GenerationResult? generation,
        int attempts,
        IReadOnlyList<string> failingChecks)
    {
        Disposition = disposition;
        Posts = posts;
        Generation = generation;
        Attempts = attempts;
        FailingChecks = failingChecks;
    }

    /// <summary>Whether the burst was accepted or dropped.</summary>
    public GenerateDisposition Disposition { get; }

    /// <summary>The accepted, guard-clean burst posts (empty when dropped).</summary>
    public IReadOnlyList<GeneratedPost> Posts { get; }

    /// <summary>The underlying generation result (provider/model/usage/latency); may be non-null even when dropped.</summary>
    public GenerationResult? Generation { get; }

    /// <summary>How many provider attempts were made (1 when accepted first try; up to the re-roll budget).</summary>
    public int Attempts { get; }

    /// <summary>The named checks a dropped burst tripped (empty when accepted) — for telemetry/logging, never surfaced.</summary>
    public IReadOnlyList<string> FailingChecks { get; }

    /// <summary>The XC-004 <c>guardResult</c> literal for the <c>engine.generated</c> event (<c>pass</c> / <c>drop</c>).</summary>
    public string GuardResult => Disposition == GenerateDisposition.Accepted ? "pass" : "drop";

    /// <summary>An accepted burst.</summary>
    /// <param name="generation">The generation result whose posts passed both gates.</param>
    /// <param name="attempts">The attempt number the burst was accepted on.</param>
    /// <returns>An <see cref="GenerateDisposition.Accepted"/> result.</returns>
    public static GenerateStageResult Accepted(GenerationResult generation, int attempts)
    {
        ArgumentNullException.ThrowIfNull(generation);
        return new GenerateStageResult(GenerateDisposition.Accepted, generation.Posts, generation, attempts, []);
    }

    /// <summary>A dropped burst — never surfaced to a controller (§8.5).</summary>
    /// <param name="generation">The last generation result (may be null if the provider produced nothing).</param>
    /// <param name="attempts">How many attempts were exhausted.</param>
    /// <param name="failingChecks">The checks the final attempt tripped.</param>
    /// <returns>A <see cref="GenerateDisposition.Dropped"/> result.</returns>
    public static GenerateStageResult Dropped(
        GenerationResult? generation,
        int attempts,
        IReadOnlyList<string> failingChecks)
    {
        ArgumentNullException.ThrowIfNull(failingChecks);
        return new GenerateStageResult(GenerateDisposition.Dropped, [], generation, attempts, failingChecks);
    }
}
