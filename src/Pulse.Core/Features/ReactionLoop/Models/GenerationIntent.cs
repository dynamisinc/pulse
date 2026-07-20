namespace Pulse.Core.Features.ReactionLoop.Models;

using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;

/// <summary>What triggered a reaction — the shape the reactive behaviors register against (§1.2).</summary>
public enum ReactionTriggerKind
{
    /// <summary>A storyline's silence window elapsed (ADP-001) — silence-escalation shapes the intent.</summary>
    Inaction,

    /// <summary>An official response/off-platform marker was observed (ADP-002) — response-reaction shapes it.</summary>
    OfficialResponse,

    /// <summary>Content selected to spread (ADP-004) — amplification-engine shapes it.</summary>
    Amplification,

    /// <summary>The world is below the believable-activity floor (ADP-005/011) — ambient-chatter fills it.</summary>
    AmbientFloor,
}

/// <summary>
/// The decide stage's output (§1.2, ADP-010/011): a fully-formed intent to generate one burst — which
/// storyline, which personas (one post each — the burst-in-one-call diversity model), the target tone mix,
/// how many posts, at what tier — annotated with the autonomy level so the review stage routes correctly
/// and the trigger that produced it (for telemetry <c>engine.decided</c>). The generate stage (blocked on
/// E2/E7) turns this into a guard-filtered, persona-voiced burst; nothing here calls a provider.
/// </summary>
public sealed record GenerationIntent
{
    /// <summary>The storyline this burst advances.</summary>
    public required Guid StorylineId { get; init; }

    /// <summary>The exercise (COR-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>What triggered this intent (drives the behavior policy + telemetry).</summary>
    public required ReactionTriggerKind Trigger { get; init; }

    /// <summary>The eligible cast to voice the burst — one post each (bad-actor-gated upstream by persona-voice).</summary>
    public required IReadOnlyList<PersonaDossier> Personas { get; init; }

    /// <summary>The desired emotional mix, phase/sentiment-derived from the storyline (StorylineBrief.ToneMix).</summary>
    public required ToneMix ToneMix { get; init; }

    /// <summary>
    /// How many posts to request — one per persona, cap-bounded (ADP-011). Always ≥ 1 in a produced intent:
    /// when the cap leaves no room (throttled), the engine stops (stopped), or no cast is eligible, no intent
    /// is produced at all (a <c>null</c> from <c>IntentComposer</c>/<c>DecideStage</c>), never a 0-count one.
    /// </summary>
    public required int Count { get; init; }

    /// <summary>The model tier (Standard for storyline-critical reactions; Ambient for lulls/bulk).</summary>
    public required GenerationTier Tier { get; init; }

    /// <summary>The effective autonomy level the burst routes at (Suggest / Delayed-auto) — from autonomy-safety.</summary>
    public required AutonomyLevel AutonomyLevel { get; init; }
}
