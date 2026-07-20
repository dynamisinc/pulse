namespace Pulse.Core.Features.ReactionLoop.Models;

using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Everything the decide stage (and a registered reactive behavior) needs to turn one observed trigger into
/// a <see cref="GenerationIntent"/> for one storyline (§1.2): the storyline state (curve/caps/target live on
/// it), the trigger kind, the safety-resolved autonomy, the eligible cast (bad-actor-gated upstream by
/// persona-voice), the rate-governance snapshot, and the scenario minute. For a response trigger the
/// addressing candidate is carried too. Pure input — a behavior reads it and returns an intent; it mutates
/// nothing.
/// </summary>
public sealed record ReactionContext
{
    /// <summary>The storyline being reacted to (its curve, rate config, and dial target are read from it).</summary>
    public required Storyline Storyline { get; init; }

    /// <summary>What triggered this reaction.</summary>
    public required ReactionTriggerKind Trigger { get; init; }

    /// <summary>The safety-resolved autonomy for this storyline (autonomy-safety). If stopped, no intent is produced.</summary>
    public required EffectiveAutonomy Autonomy { get; init; }

    /// <summary>The eligible personas to voice the burst — one post each (persona-voice applied the bad-actor gate).</summary>
    public required IReadOnlyList<PersonaDossier> EligiblePersonas { get; init; }

    /// <summary>The per-exercise rate config (ADP-011) governing the burst size + quiet floor.</summary>
    public required RateGovernanceConfig RateConfig { get; init; }

    /// <summary>Engine posts already published this scenario minute (the loop's per-minute counter).</summary>
    public int PostsThisMinute { get; init; }

    /// <summary>Scenario minute (COR-050/051).</summary>
    public required int ScenarioMinute { get; init; }

    /// <summary>For an <see cref="ReactionTriggerKind.OfficialResponse"/> trigger, the candidate being reacted to; else null.</summary>
    public AddressingCandidate? Addressing { get; init; }
}
