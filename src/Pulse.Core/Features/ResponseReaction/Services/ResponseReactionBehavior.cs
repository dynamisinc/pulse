namespace Pulse.Core.Features.ResponseReaction.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;

/// <summary>
/// The matched-response reaction (ADP-002, story 01): the decide-stage policy for an
/// <see cref="ReactionTriggerKind.OfficialResponse"/> trigger — the "timely, accurate release calms the
/// crowd" half. It starts from the loop's base composition (<see cref="IntentComposer"/>) and sets a
/// <b>tunable mix</b> that leans to gratitude + follow-up + one skeptic. The storyline's bend toward
/// ADDRESSED is applied separately via <see cref="MissSafeResolver.Apply"/> (storyline-model owns the decay);
/// once addressed, the storyline leaves the unaddressed phases, so silence-escalation stops firing — the
/// hand-off is automatic.
/// </summary>
public sealed class ResponseReactionBehavior : IReactionBehavior
{
    private readonly ToneMix _mix;

    /// <summary>Creates the behavior with an optional tunable tone mix (default: gratitude-heavy, one skeptic).</summary>
    public ResponseReactionBehavior(ToneMix? mix = null) => _mix = mix ?? DefaultMix;

    /// <summary>The default matched-response mix: mostly gratitude + calm follow-up, with one skeptic (§7).</summary>
    public static ToneMix DefaultMix { get; } = new()
    {
        Gratitude = 0.5,
        Calm = 0.3,
        Skepticism = 0.15,
        Worry = 0.05,
    };

    /// <inheritdoc />
    public ReactionTriggerKind Trigger => ReactionTriggerKind.OfficialResponse;

    /// <inheritdoc />
    public GenerationIntent? Decide(ReactionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return IntentComposer.Compose(context) is { } intent ? intent with { ToneMix = _mix } : null;
    }
}
