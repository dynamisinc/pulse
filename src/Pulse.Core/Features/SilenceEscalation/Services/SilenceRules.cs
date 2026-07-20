namespace Pulse.Core.Features.SilenceEscalation.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.ReactionLoop.Models;

/// <summary>
/// The ADP-001 silence semantics on top of the reaction loop's observe stage (E8 architecture §7). Two pure
/// pieces: what counts as a <b>qualifying response</b> (which satisfies the silence timer), and the
/// escalation <b>tone</b> as silence runs on. The timer + trigger themselves live in
/// <c>ReactionLoop.ObserveStage</c> (scenario time, freeze/time-jump); this feature defines the meaning
/// layered on top.
/// </summary>
public static class SilenceRules
{
    /// <summary>
    /// Whether an addressing observation is a <b>qualifying response</b> that satisfies the silence timer.
    /// An off-platform marker (CTL-026) always qualifies; an on-platform official post qualifies <b>only</b>
    /// when it is <i>matched</i> to the storyline (response-reaction decides the match). <b>Unmatched</b>
    /// official content is never a qualifying response — it is never treated as silence-satisfying (ADP-002a);
    /// the miss-safe default slows escalation and prompts the controller instead.
    /// </summary>
    public static bool IsQualifyingResponse(AddressingSource source, bool matched) =>
        source == AddressingSource.OffPlatformMarker || matched;

    /// <summary>
    /// The escalation tone mix for a storyline that has been silent for <paramref name="minutesSilent"/>
    /// scenario minutes against a <paramref name="windowMin"/> window (§4 "the vacuum fills"). Just past the
    /// window the crowd is mostly worried; the longer the silence runs the more it shifts toward speculation
    /// and anger ("why is nobody saying anything?"), and calm/gratitude stay at zero. Monotonic: a later,
    /// longer silence yields visibly more speculation + anger than an earlier one.
    /// </summary>
    public static ToneMix EscalationTone(int minutesSilent, int windowMin)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(minutesSilent);
        ArgumentOutOfRangeException.ThrowIfNegative(windowMin);

        var overshoot = Math.Max(0, minutesSilent - windowMin);
        // 0 at the window, ramping to 1 by ~2x the window (or immediately if the window is 0).
        var t = windowMin > 0 ? Math.Min(1.0, overshoot / (double)windowMin) : 1.0;

        // Raw weights: worry cools as speculation + anger climb with the silence.
        var worry = 0.5 - (0.2 * t);
        var speculation = 0.2 + (0.2 * t);
        var anger = 0.1 + (0.3 * t);
        const double skepticism = 0.1;

        // Normalise to sum to 1 (consistent with StorylineBriefProjection.ToneMixFor), so prompt-tone
        // emphasis reads the same regardless of silence duration — only the proportions shift.
        var total = worry + speculation + anger + skepticism;
        return new ToneMix
        {
            Worry = worry / total,
            Speculation = speculation / total,
            Anger = anger / total,
            Skepticism = skepticism / total,
            Gratitude = 0.0,
            Calm = 0.0,
        };
    }
}
