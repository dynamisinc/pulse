namespace Pulse.Core.Features.ResponseReaction.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ReactionLoop.Services;
using Pulse.Core.Features.Storylines.Services;

/// <summary>
/// The matched-response reaction (ADP-002, story 01): the decide-stage policy for an
/// <see cref="ReactionTriggerKind.OfficialResponse"/> trigger — the "timely, accurate release calms the
/// crowd" half. It starts from the loop's base composition (<see cref="IntentComposer"/>) and sets a
/// <b>tunable mix</b> that leans to gratitude + follow-up + one skeptic, voiced as a <b>burst</b> of
/// <see cref="DefaultBurstSize"/> personas so the mix has room to show. The storyline's bend toward
/// ADDRESSED is applied separately via <see cref="MissSafeResolver.Apply"/> (storyline-model owns the decay);
/// once addressed, the storyline leaves the unaddressed phases, so silence-escalation stops firing — the
/// hand-off is automatic.
/// </summary>
public sealed class ResponseReactionBehavior : IReactionBehavior
{
    /// <summary>
    /// The default number of voices in a matched-response burst: enough to carry the mix (gratitude, a
    /// follow-up question, one skeptic). Bounded by the eligible cast and the per-minute cap (ADP-011).
    /// </summary>
    public const int DefaultBurstSize = 3;

    private readonly ToneMix _mix;
    private readonly int _burstSize;

    /// <summary>Creates the behavior with an optional tunable tone mix (default: gratitude-heavy, one skeptic) and burst size.</summary>
    /// <param name="mix">The reaction's tone mix; <see cref="DefaultMix"/> when omitted.</param>
    /// <param name="burstSize">How many voices a matched response draws, at least 1; <see cref="DefaultBurstSize"/> when omitted.</param>
    public ResponseReactionBehavior(ToneMix? mix = null, int burstSize = DefaultBurstSize)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(burstSize, 1);
        _mix = mix ?? DefaultMix;
        _burstSize = burstSize;
    }

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

        // The base composition carries the gates: a stopped engine, an empty cast, an exhausted per-minute cap
        // or a dial target asking for calm all produce nothing here too.
        if (IntentComposer.Compose(context) is not { } intent)
        {
            return null;
        }

        // A matched response draws a BURST, not a single reply. The base composer sizes by phase, and a
        // matched storyline has just moved to Addressed, which sizes to one voice — too few to carry the mix.
        // Size it to the burst, still bounded by the cast and the per-minute cap, never below the composer's.
        var desired = Math.Min(_burstSize, context.EligiblePersonas.Count);
        var allowed = RateGovernance.WithinCap(context.RateConfig, context.PostsThisMinute, desired).Allowed;
        var count = Math.Max(intent.Count, allowed);

        return intent with
        {
            ToneMix = _mix,
            Count = count,
            Personas = [.. context.EligiblePersonas.Take(count)],
        };
    }
}
