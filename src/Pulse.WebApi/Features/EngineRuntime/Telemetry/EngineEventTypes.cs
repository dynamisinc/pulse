namespace Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The canonical XC-004 <c>eventType</c> name constants for the engine loop (E8 architecture §11, #173).
/// These are ADDITIVE to the locked v0 telemetry envelope — <c>TelemetryEvent.EventType</c> is an OPEN
/// string, so these are new vocabulary, NOT a schema fork ("a schema mistake is a cross-phase migration",
/// adversarial review D2). Every engine loop stage/action (story 01) and the controller review action
/// (story 02) emits one of these against the unchanged v0 envelope.
/// </summary>
public static class EngineEventTypes
{
    /// <summary><c>engine.observed</c> — a trigger fired (inaction timer / action seen / world event) for a storyline.</summary>
    public const string Observed = "engine.observed";

    /// <summary><c>engine.decided</c> — the decide stage chose a generation intent (personas, tone mix, count), autonomy level, and rate-cap state.</summary>
    public const string Decided = "engine.decided";

    /// <summary><c>engine.generated</c> — a burst of drafts was produced (model/provider, token usage, latency, guard result).</summary>
    public const string Generated = "engine.generated";

    /// <summary><c>engine.reviewed</c> — a controller (or the auto-HOLD tick) acted on a review item (see <see cref="EngineReviewAction"/>).</summary>
    public const string Reviewed = "engine.reviewed";

    /// <summary><c>engine.published</c> — a draft published as an ordinary post (post ref, origin, storyline).</summary>
    public const string Published = "engine.published";

    /// <summary><c>engine.measured</c> — the measure stage recorded a storyline intensity/sentiment delta and amplification.</summary>
    public const string Measured = "engine.measured";

    /// <summary><c>storyline.state_changed</c> — a storyline moved phase (from→to, cause).</summary>
    public const string StorylineStateChanged = "storyline.state_changed";

    /// <summary>
    /// <c>engine.autonomy_default_changed</c> — a controller changed the exercise's AUTONOMY DEFAULT at runtime
    /// (autonomy-safety story 05). Additive vocabulary, reviewer-approved: the autonomy state itself is process
    /// memory, so this event is the only record of the change that survives a restart. Distinct from the
    /// frontend's own <c>engine.autonomy_changed</c> emit (<c>useEngineControl.ts</c>), which continues
    /// unchanged — this is the server-side, server-timed companion, not a replacement.
    /// </summary>
    public const string AutonomyDefaultChanged = "engine.autonomy_default_changed";

    /// <summary>
    /// <c>engine.tier_policy_changed</c> — a controller changed the exercise's MODEL-TIER POLICY mode
    /// (<c>auto</c> / <c>standard</c> / <c>ambient</c>) at runtime (autonomy-safety story 05). Records only the
    /// tier ROLE selection; the governed tier→deployment mapping is never settable at runtime (NFR-005).
    /// </summary>
    public const string TierPolicyChanged = "engine.tier_policy_changed";

    /// <summary>
    /// <c>engine.provider_changed</c> — the exercise's EFFECTIVE generation provider changed at runtime
    /// (autonomy-safety story 07): a controller cut generation to <c>Fake</c> to stop egress, or restored it to
    /// the startup-configured provider. ONE extensible event type carries both directions via the payload's
    /// <c>reason</c> discriminator (<see cref="EngineEventPayloads.ProviderChanged.ReasonCut"/> /
    /// <see cref="EngineEventPayloads.ProviderChanged.ReasonRestore"/>) rather than a cut/restore PAIR — a
    /// smaller taxonomy footprint, and the from→to pair already says which way it went.
    /// <para>
    /// This event is the only durable record of the change (the cut state itself is process memory), and it is
    /// emitted SERVER-side on both directions — deliberately not repeating the kill-switch gap where frontend
    /// emission is the sole audit trail.
    /// </para>
    /// <para>
    /// <b>PENDING RATIFICATION.</b> The engine event vocabulary is owned by
    /// <c>engine-telemetry-tuning/01-engine-event-types.md</c> (#173); story 07's AC8 requires this name and
    /// payload shape to be aligned with that story before either is finalized. It is additive to the unchanged
    /// v0 envelope (<c>eventType</c> is an OPEN string), so ratification can rename it without a migration.
    /// </para>
    /// </summary>
    public const string ProviderChanged = "engine.provider_changed";

    /// <summary>
    /// The v1.1 rumor-lineage event family (E8 architecture §10/§11). RESERVED now so the rumor model
    /// (<c>rumor-model</c>, v1.1) needs no envelope migration when it lands — these names + the
    /// <c>rumorRef</c>/<c>mutationOf</c> lineage fields (see <see cref="EngineEventPayloads"/>) are already
    /// part of the locked additive taxonomy. NOT emitted in v1.
    /// </summary>
    public static class Rumor
    {
        /// <summary><c>rumor.seeded</c> — a rumor claim was seeded (v1.1, reserved).</summary>
        public const string Seeded = "rumor.seeded";

        /// <summary><c>rumor.mutated</c> — a rumor variant mutated from a parent (v1.1, reserved).</summary>
        public const string Mutated = "rumor.mutated";

        /// <summary><c>rumor.spread</c> — a rumor spread via quote/repost amplification (v1.1, reserved).</summary>
        public const string Spread = "rumor.spread";

        /// <summary><c>rumor.countered</c> — official content countered the rumor (v1.1, reserved).</summary>
        public const string Countered = "rumor.countered";

        /// <summary><c>rumor.killed</c> — the rumor decayed to dead (v1.1, reserved).</summary>
        public const string Killed = "rumor.killed";
    }
}
