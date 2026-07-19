namespace Pulse.Core.Features.ReactionLoop.Services;

using Pulse.Core.Features.ReactionLoop.Models;

/// <summary>
/// A reactive-behavior policy (E8 architecture §1.2): given a <see cref="ReactionContext"/> for the trigger
/// it handles, it produces the <see cref="GenerationIntent"/> (or null to generate nothing). This is the
/// seam the specific behaviors register against — silence-escalation handles
/// <see cref="ReactionTriggerKind.Inaction"/>, response-reaction handles
/// <see cref="ReactionTriggerKind.OfficialResponse"/>, and so on. A behavior typically starts from
/// <see cref="IntentComposer.Compose"/> and shapes it (tone, count, tier) for its trigger.
/// </summary>
public interface IReactionBehavior
{
    /// <summary>The trigger kind this behavior shapes the intent for.</summary>
    ReactionTriggerKind Trigger { get; }

    /// <summary>Produces the intent for <paramref name="context"/>, or null to generate nothing this tick.</summary>
    GenerationIntent? Decide(ReactionContext context);
}

/// <summary>
/// The decide stage (E8 architecture §1.2, ADP-010/011): routes each observed trigger to the reactive
/// behavior registered for its kind, falling back to the default <see cref="IntentComposer"/> when no
/// behavior is registered. This is the composition point that reads storyline-model (curve/caps/target),
/// the autonomy level (autonomy-safety), and the eligible cast (persona-voice), producing the generation
/// intents the generate stage (blocked on E2/E7) will carry out.
///
/// <para>The behavior registry is the extension point the reactive-behavior features plug into
/// (silence-escalation, response-reaction, amplification, ambient-chatter) — one behavior per trigger kind;
/// the last registration for a kind wins. Not thread-safe: configured at startup, driven by the loop's
/// single-threaded scheduler.</para>
/// </summary>
public sealed class DecideStage
{
    private readonly Dictionary<ReactionTriggerKind, IReactionBehavior> _behaviors = [];

    /// <summary>Registers (or replaces) the behavior for its <see cref="IReactionBehavior.Trigger"/> kind.</summary>
    public DecideStage Register(IReactionBehavior behavior)
    {
        ArgumentNullException.ThrowIfNull(behavior);
        _behaviors[behavior.Trigger] = behavior;
        return this;
    }

    /// <summary>Whether a behavior is registered for <paramref name="trigger"/> (else the default composer runs).</summary>
    public bool HasBehavior(ReactionTriggerKind trigger) => _behaviors.ContainsKey(trigger);

    /// <summary>
    /// Decides the intent for one context: the registered behavior for its trigger, or the default
    /// <see cref="IntentComposer"/>. Null means "generate nothing this tick" (stopped / no cast / throttled).
    /// </summary>
    public GenerationIntent? Decide(ReactionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return _behaviors.TryGetValue(context.Trigger, out var behavior)
            ? behavior.Decide(context)
            : IntentComposer.Compose(context);
    }

    /// <summary>Decides intents for many contexts, dropping the ticks that produce nothing.</summary>
    public IReadOnlyList<GenerationIntent> DecideAll(IEnumerable<ReactionContext> contexts)
    {
        ArgumentNullException.ThrowIfNull(contexts);
        var intents = new List<GenerationIntent>();
        foreach (var context in contexts)
        {
            if (Decide(context) is { } intent)
            {
                intents.Add(intent);
            }
        }

        return intents;
    }
}
