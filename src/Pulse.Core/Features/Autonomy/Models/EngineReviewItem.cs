namespace Pulse.Core.Features.Autonomy.Models;

/// <summary>
/// The disposition of an engine burst in the review flow (E8 architecture §8, ADP-040). This is the
/// contract autonomy-safety <b>produces</b> and the engine-review-cockpit (#34–36) <b>consumes</b>; it is
/// the terminal-action vocabulary the cockpit's queue, NEEDS-YOU bar, and countdown render against.
/// </summary>
public enum DraftDisposition
{
    /// <summary>Suggest: queued for review; nothing publishes without an explicit approve (#34).</summary>
    Queued,

    /// <summary>Delayed-auto: counting down in scenario time; a controller may approve or veto (#35).</summary>
    CountingDown,

    /// <summary>
    /// Auto-HELD on expiry ("timer expired — held for you") — surfaces in NEEDS YOU (#35). The default
    /// terminal action; silence is never approval (D5-014/1.1).
    /// </summary>
    Held,

    /// <summary>Published into the E2 pipeline (approved, edited-then-approved, or swamped-mode auto-send).</summary>
    Published,

    /// <summary>Vetoed by the controller; never published.</summary>
    Vetoed,
}

/// <summary>
/// A single engine burst as the review cockpit sees it (E8 architecture §8, D5-014). One
/// <b>burst = one review decision</b>, not one per post (ADP-040 batch approve) — this is the unit the
/// CTL-034 demand meter counts. Autonomy-safety produces this contract; the cockpit (#34–36) renders and
/// acts on it. Staff-only (XC-002); every field a controller sees is in scenario time (COR-050/051).
///
/// <para>Guard-failing drafts never become a review item — they are auto-re-rolled or dropped before this
/// point (§8.5 pre-filtering), so the cockpit only ever holds decisions worth a controller's attention.</para>
/// </summary>
/// <param name="ExerciseId">The exercise (COR-001).</param>
/// <param name="StorylineId">The storyline the burst voices — the cockpit shows per-item storyline context.</param>
/// <param name="DraftId">Stable identity of the burst.</param>
/// <param name="PostCount">Posts in the burst — informational; the burst is still one decision.</param>
/// <param name="RoutedAtLevel">The effective autonomy level the burst was routed at (Suggest / Delayed-auto).</param>
/// <param name="Disposition">Current disposition in the review flow.</param>
/// <param name="Countdown">The countdown snapshot for a Delayed-auto burst, else null.</param>
public sealed record EngineReviewItem(
    Guid ExerciseId,
    Guid StorylineId,
    Guid DraftId,
    int PostCount,
    AutonomyLevel RoutedAtLevel,
    DraftDisposition Disposition,
    DelayedAutoCountdown? Countdown = null)
{
    /// <summary>
    /// Whether this item currently demands controller attention in the NEEDS-YOU bar — a queued Suggest
    /// item or an auto-HELD item (D5-014/2.1: consistent with the queue's pending count and the demand
    /// meter). Published and vetoed items are resolved and do not.
    /// </summary>
    public bool NeedsController => Disposition is DraftDisposition.Queued or DraftDisposition.Held;
}
