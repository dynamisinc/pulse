namespace Pulse.Core.Features.SilenceEscalation.Services;

using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;

/// <summary>
/// The escalating-content behavior (ADP-001 / ADP-010, story 02): the decide-stage policy for an
/// <see cref="ReactionTriggerKind.Inaction"/> trigger. It starts from the loop's base composition
/// (<see cref="IntentComposer"/> — curve/target/cap/autonomy) and shapes the tone toward escalating anxiety
/// and speculation sized by how long the storyline has been silent, so successive unaddressed bursts read
/// as visibly more anxious/speculative — the "vacuum fills" arc. Registered against
/// <see cref="DecideStage"/> for the Inaction trigger.
///
/// <para>Pure: it does not generate or publish (that's the blocked generate stage) — it produces the intent
/// the loop will carry out. Intensity itself climbs in storyline-model's curve; this shapes the burst.</para>
/// </summary>
public sealed class SilenceEscalationBehavior : IReactionBehavior
{
    /// <inheritdoc />
    public ReactionTriggerKind Trigger => ReactionTriggerKind.Inaction;

    /// <inheritdoc />
    public GenerationIntent? Decide(ReactionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // Base composition applies autonomy/cap/target gating; if it declines (stopped / throttled / no
        // cast) there is nothing to escalate this tick.
        if (IntentComposer.Compose(context) is not { } intent)
        {
            return null;
        }

        var storyline = context.Storyline;
        return intent with
        {
            ToneMix = SilenceRules.EscalationTone(storyline.MinutesSinceLastOfficialResponse, storyline.ResponseWindowMin),
        };
    }
}
