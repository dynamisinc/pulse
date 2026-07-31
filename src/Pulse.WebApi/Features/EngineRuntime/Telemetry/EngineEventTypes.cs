namespace Pulse.WebApi.Features.EngineRuntime.Telemetry;

/// <summary>
/// The canonical XC-004 <c>eventType</c> name constants for the engine loop (E8 architecture §11, #173).
/// These are ADDITIVE to the locked v0 telemetry envelope — <c>TelemetryEvent.EventType</c> is an OPEN
/// string, so these are new vocabulary, NOT a schema fork ("a schema mistake is a cross-phase migration",
/// adversarial review D2). Every engine loop stage/action (story 01) and the controller review action
/// (story 02) emits one of these against the unchanged v0 envelope.
/// </summary>
/// <remarks>
/// <para>
/// <b>This type is the engine event-type TAXONOMY OF RECORD</b> (<c>engine-telemetry-tuning/01</c>, #173).
/// Every engine <c>eventType</c> that can appear in the telemetry log is named here — whichever tier wrote
/// it. That deliberately includes the ones added later by other E8 features, the ops-seed event that builds
/// its own envelope, and <see cref="AutonomyChanged"/>, which only the FRONTEND emits (via
/// <c>POST /api/telemetry</c>; no server path writes it). Naming a client-emitted type in a server-side class
/// is intentional: E10 metrics and E9's INT-031 stream need one complete list to read, not a server-only
/// subset plus a set of private literals scattered across feature slices and the web client. <c>EngineEventTaxonomyTests</c> pins the complete set by
/// reflection: adding a constant without updating that pin fails the build's test gate, and adding a private
/// literal somewhere else instead is what the pin exists to discourage.
/// </para>
/// <para>
/// <b>Additive forever, migration-free.</b> The v0 envelope stores <c>payload</c> as <c>nvarchar(max)</c> and
/// never parses it server-side, and <c>eventType</c> is an open string with no allowlist
/// (<c>TelemetryEnvelopeRules</c> validates only conditional attribution, never the type name). So a new
/// engine event type — or a v1.1 <see cref="Rumor"/> one — needs no EF migration, ever.
/// </para>
/// </remarks>
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
    /// <b>RATIFIED</b> by <c>engine-telemetry-tuning/01</c> (#173, this taxonomy of record), discharging story
    /// 07's AC8: the name <c>engine.provider_changed</c> and the single-event + <c>reason</c>-discriminator
    /// payload shape are accepted AS BUILT — one event type per settings-style posture change, matching the
    /// <see cref="AutonomyDefaultChanged"/> / <see cref="TierPolicyChanged"/> pair it sits beside, and a
    /// from→to payload matching theirs. No rename, so nothing already emitting has to change.
    /// </para>
    /// </summary>
    public const string ProviderChanged = "engine.provider_changed";

    /// <summary>
    /// <c>engine.content_seeded</c> — the guarded ops seed registered an exercise's persona cast + canned
    /// storyline with the reaction loop (<c>engine-content-seed/03</c>, issue #324). Emitted server-side with
    /// <c>actor.kind:'system'</c> on the <c>system</c> channel, NOT on the loop's <c>social</c> channel: it is
    /// an operator action that makes the engine run, not an engine action inside the fiction. Named here
    /// because #173 owns the engine vocabulary of record even for the events other slices emit.
    /// </summary>
    public const string ContentSeeded = "engine.content_seeded";

    /// <summary>
    /// <c>engine.autonomy_changed</c> — a controller changed autonomy from the cockpit.
    /// <para>
    /// <b>CLIENT-emitted, by design.</b> This one is written by the frontend
    /// (<c>features/controller/engine/hooks/useEngineControl.ts</c>) through the <c>POST /api/telemetry</c>
    /// sink; no server path emits it. It is named here so the taxonomy of record is COMPLETE — an E10/E9
    /// consumer reading this class sees every engine event type that can appear in the log, whichever tier
    /// wrote it. Distinct from <see cref="AutonomyDefaultChanged"/>, which is the server-side, server-timed
    /// record of a change to the exercise DEFAULT; the two coexist and neither replaces the other.
    /// </para>
    /// </summary>
    public const string AutonomyChanged = "engine.autonomy_changed";

    /// <summary>
    /// The v1.1 rumor-lineage event family (E8 architecture §10/§11). RESERVED now so the rumor model
    /// (<c>rumor-model</c>, v1.1) needs no envelope migration when it lands — these names + the
    /// <c>rumorRef</c>/<c>mutationOf</c> lineage fields (see <see cref="EngineEventPayloads"/>) are already
    /// part of the locked additive taxonomy. NOT emitted in v1.
    /// <para>
    /// The reservation is enforced, not merely commented: <c>EngineEventTaxonomyTests</c> pins these five
    /// names and pins that the family is EXACTLY these five, so the v1.1 <c>rumor-model</c> feature inherits a
    /// vocabulary it cannot silently rename, and a sixth lineage event is a deliberate, reviewed addition.
    /// Reserving the names costs nothing at v1 (no emitter, no column, no migration — <c>eventType</c> is an
    /// open string) and is the whole point of the architecture §14 schema-now note.
    /// </para>
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
