namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// How generated content ships (E8 architecture §8.1) — the third "decide-stage" input the reaction
/// loop consumes, alongside the storyline model (<i>what to say</i>) and the generation core
/// (<i>how to say it</i>). The level is chosen per exercise and overridable per storyline; it is the
/// thing the generate→review stage routes on.
///
/// <para>The values ascend in <b>autonomy</b> (least → most), so <c>(int)</c> ordering <i>is</i> the
/// autonomy ordering — the safety invariant "controls only ever move autonomy <i>down</i>" (§8.2) is
/// expressed as taking the lower of two levels (see <see cref="AutonomyLevels"/>). Do not reorder.</para>
/// </summary>
public enum AutonomyLevel
{
    /// <summary>
    /// v1. Drafts land in the E7 review queue; nothing publishes without an explicit controller approve.
    /// The safest level and the floor every safety control drops to.
    /// </summary>
    Suggest = 0,

    /// <summary>
    /// v1. Drafts publish after a scenario-time countdown <b>unless a controller vetoes</b> — keeping pace
    /// without constant attention. On countdown expiry with no decision the draft <b>auto-HOLDs</b>, never
    /// auto-sends (D5-014/1.1; see <c>AutoHoldPolicy</c>). Silence is never approval.
    /// </summary>
    DelayedAuto = 1,

    /// <summary>
    /// <b>Reserved for v1.1</b> (the <c>auto-mode</c> feature). Publishes within configured bounds
    /// (rate caps, persona set, intensity ceiling). Present so the enum needs no change when v1.1 lands;
    /// <b>not selectable in v1</b> — <see cref="AutonomyLevels.EnsureSelectable"/> rejects it.
    /// </summary>
    Auto = 2,
}

/// <summary>
/// Helpers over <see cref="AutonomyLevel"/> that keep the §8.2 safety invariants in one place: the
/// "lower of two" used by every safety control, and the v1 selectability gate.
/// </summary>
public static class AutonomyLevels
{
    /// <summary>The safest level — the floor a kill switch or degraded-mode fallback drops to (§8.4).</summary>
    public const AutonomyLevel Floor = AutonomyLevel.Suggest;

    /// <summary>
    /// The <b>lower</b> (less autonomous) of two levels. This is the only combining operation the safety
    /// controls use, so degradation and the kill switch can never <i>raise</i> autonomy (§8.2).
    /// </summary>
    public static AutonomyLevel Lower(AutonomyLevel a, AutonomyLevel b) =>
        (AutonomyLevel)Math.Min((int)a, (int)b);

    /// <summary>True if <paramref name="candidate"/> is strictly more autonomous than <paramref name="current"/>.</summary>
    public static bool IsRaise(AutonomyLevel current, AutonomyLevel candidate) => (int)candidate > (int)current;

    /// <summary>
    /// Guards that <paramref name="level"/> may be selected in v1. <see cref="AutonomyLevel.Auto"/> is
    /// reserved for v1.1 and is rejected — a human cannot set it and automation cannot reach it.
    /// </summary>
    /// <exception cref="NotSupportedException">The level is <see cref="AutonomyLevel.Auto"/>.</exception>
    public static AutonomyLevel EnsureSelectable(AutonomyLevel level)
    {
        if (level == AutonomyLevel.Auto)
        {
            throw new NotSupportedException(
                "Auto autonomy is v1.1 (the auto-mode feature); v1 supports only Suggest and Delayed-auto.");
        }

        return level;
    }
}
