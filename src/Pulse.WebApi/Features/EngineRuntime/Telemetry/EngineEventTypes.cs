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
