namespace Pulse.WebApi.Features.EngineRuntime.Telemetry;

using System.Collections.Generic;
using System.Text.Json.Serialization;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.WebApi.Features.EngineRuntime;

/// <summary>
/// The per-event-type <c>payload</c> SHAPES for the XC-004 engine events (E8 architecture §11). Each is the
/// emit-side contract for the OPAQUE <c>payload</c> object its event carries: the v0 envelope stores
/// <c>payload</c> as <c>nvarchar(max)</c> and never parses it server-side, so these are additive and need no
/// schema migration — they pin the shape E10 metrics + E9's INT-031 stream read. Serialized camelCase (the
/// <see cref="IEngineTelemetryEmitter"/> null-omits absent optional fields, matching the v0 envelope's
/// off-envelope-empty rule). Stories 01/02 populate them; this class only defines them.
/// </summary>
public static class EngineEventPayloads
{
    /// <summary>Payload for <see cref="EngineEventTypes.Observed"/> — the trigger + storyline + scenario minute.</summary>
    public sealed record Observed
    {
        /// <summary>What fired the observation (e.g. <c>inaction-timer</c> / <c>action-seen</c> / <c>world-event</c>).</summary>
        [JsonPropertyName("trigger")]
        public required string Trigger { get; init; }

        /// <summary>The storyline the observation is scoped to.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The scenario minute the observation occurred at (COR-050/051).</summary>
        [JsonPropertyName("scenarioMinute")]
        public required int ScenarioMinute { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.Decided"/> — the generation intent + autonomy + rate-cap state.</summary>
    public sealed record Decided
    {
        /// <summary>The storyline the decision voices.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The persona handles the burst will voice (§5.2 diversity).</summary>
        [JsonPropertyName("personas")]
        public required IReadOnlyList<string> Personas { get; init; }

        /// <summary>The tone mix descriptor for the burst.</summary>
        [JsonPropertyName("toneMix")]
        public string? ToneMix { get; init; }

        /// <summary>How many persona-voiced posts the burst intends to produce.</summary>
        [JsonPropertyName("count")]
        public required int Count { get; init; }

        /// <summary>The effective autonomy level the burst is routed at.</summary>
        [JsonPropertyName("autonomyLevel")]
        [JsonConverter(typeof(AutonomyLevelJsonConverter))]
        public required AutonomyLevel AutonomyLevel { get; init; }

        /// <summary>The rate-cap state at decision time (e.g. <c>ok</c> / <c>throttled</c>).</summary>
        [JsonPropertyName("rateCapState")]
        public string? RateCapState { get; init; }
    }

    /// <summary>Token accounting for a generated burst (mirrors <c>GenerationUsage</c>).</summary>
    public sealed record TokenUsage
    {
        /// <summary>Input tokens consumed.</summary>
        [JsonPropertyName("inputTokens")]
        public required int InputTokens { get; init; }

        /// <summary>Output tokens produced.</summary>
        [JsonPropertyName("outputTokens")]
        public required int OutputTokens { get; init; }

        /// <summary>Cache-read input tokens (0 when not applicable).</summary>
        [JsonPropertyName("cacheReadInputTokens")]
        public int CacheReadInputTokens { get; init; }

        /// <summary>Cache-creation input tokens (0 when not applicable).</summary>
        [JsonPropertyName("cacheCreationInputTokens")]
        public int CacheCreationInputTokens { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.Generated"/> — model/provider, token usage, latency, guard result.</summary>
    public sealed record Generated
    {
        /// <summary>The storyline the burst voices.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The stable draft/burst identity.</summary>
        [JsonPropertyName("draftId")]
        public required string DraftId { get; init; }

        /// <summary>The provider that produced the burst (e.g. <c>AzureOpenAI</c> / <c>Fake</c>).</summary>
        [JsonPropertyName("provider")]
        public required string Provider { get; init; }

        /// <summary>The concrete model/deployment used.</summary>
        [JsonPropertyName("model")]
        public required string Model { get; init; }

        /// <summary>Token accounting for the call.</summary>
        [JsonPropertyName("tokenUsage")]
        public required TokenUsage TokenUsage { get; init; }

        /// <summary>Wall-clock latency of the generation call, in milliseconds.</summary>
        [JsonPropertyName("latencyMs")]
        public required double LatencyMs { get; init; }

        /// <summary>The EngineEval guard result for the burst (e.g. <c>pass</c> / <c>re-roll</c> / <c>drop</c>).</summary>
        [JsonPropertyName("guardResult")]
        public required string GuardResult { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.Reviewed"/> — the review action + acting controller.</summary>
    public sealed record Reviewed
    {
        /// <summary>The storyline the reviewed draft voices.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The stable draft/burst identity reviewed.</summary>
        [JsonPropertyName("draftId")]
        public required string DraftId { get; init; }

        /// <summary>The review action taken (approve / edit / veto / re-roll / hold-on-expiry / auto-send).</summary>
        [JsonPropertyName("action")]
        [JsonConverter(typeof(EngineReviewActionJsonConverter))]
        public required EngineReviewAction Action { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.Published"/> — the published post ref, origin, storyline.</summary>
    public sealed record Published
    {
        /// <summary>The published post's id.</summary>
        [JsonPropertyName("postRef")]
        public required string PostRef { get; init; }

        /// <summary>The publish origin — <c>engine</c> or <c>engine-edited</c> (E8 architecture §11).</summary>
        [JsonPropertyName("origin")]
        public required string Origin { get; init; }

        /// <summary>The storyline the post voices.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>
        /// v1.1 lineage — the rumor this post belongs to (§10). RESERVED slot; null-omitted in v1 so the
        /// rumor model needs no later schema change.
        /// </summary>
        [JsonPropertyName("rumorRef")]
        public string? RumorRef { get; init; }

        /// <summary>
        /// v1.1 lineage — the parent post this one mutated from (§10). RESERVED slot; null-omitted in v1.
        /// </summary>
        [JsonPropertyName("mutationOf")]
        public string? MutationOf { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.Measured"/> — storyline intensity/sentiment delta + amplification.</summary>
    public sealed record Measured
    {
        /// <summary>The storyline measured.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The storyline intensity after the tick.</summary>
        [JsonPropertyName("intensity")]
        public required double Intensity { get; init; }

        /// <summary>The change in storyline sentiment over the tick.</summary>
        [JsonPropertyName("sentimentDelta")]
        public required double SentimentDelta { get; init; }

        /// <summary>The amplification observed (quote/repost reach) over the tick.</summary>
        [JsonPropertyName("amplification")]
        public required double Amplification { get; init; }
    }

    /// <summary>
    /// Payload for <see cref="EngineEventTypes.AutonomyDefaultChanged"/> — the exercise autonomy default's
    /// from→to plus whether a safety clamp is still holding underneath (so the audit shows a raise that was
    /// deliberately NOT effective yet, §8.2: a default change never lifts a kill switch).
    /// </summary>
    public sealed record AutonomyDefaultChanged
    {
        /// <summary>The exercise default level before the change.</summary>
        [JsonPropertyName("fromLevel")]
        [JsonConverter(typeof(AutonomyLevelJsonConverter))]
        public required AutonomyLevel FromLevel { get; init; }

        /// <summary>The exercise default level after the change.</summary>
        [JsonPropertyName("toLevel")]
        [JsonConverter(typeof(AutonomyLevelJsonConverter))]
        public required AutonomyLevel ToLevel { get; init; }

        /// <summary>Whether a safety clamp (kill switch / degraded mode) is still clamping autonomy below the new default.</summary>
        [JsonPropertyName("safetyClampActive")]
        public required bool SafetyClampActive { get; init; }

        /// <summary>The scenario minute the change was made at (COR-050/053).</summary>
        [JsonPropertyName("scenarioMinute")]
        public required int ScenarioMinute { get; init; }
    }

    /// <summary>
    /// Payload for <see cref="EngineEventTypes.TierPolicyChanged"/> — the exercise tier-policy mode's from→to.
    /// Carries only the tier ROLE selection; the governed tier→model/deployment mapping is not settable at
    /// runtime and is therefore never part of this record.
    /// </summary>
    public sealed record TierPolicyChanged
    {
        /// <summary>The tier-policy mode before the change (<c>auto</c> / <c>standard</c> / <c>ambient</c>).</summary>
        [JsonPropertyName("fromMode")]
        [JsonConverter(typeof(TierPolicyModeJsonConverter))]
        public required TierPolicyMode FromMode { get; init; }

        /// <summary>The tier-policy mode after the change.</summary>
        [JsonPropertyName("toMode")]
        [JsonConverter(typeof(TierPolicyModeJsonConverter))]
        public required TierPolicyMode ToMode { get; init; }

        /// <summary>The scenario minute the change was made at (COR-050/053).</summary>
        [JsonPropertyName("scenarioMinute")]
        public required int ScenarioMinute { get; init; }
    }

    /// <summary>
    /// Payload for <see cref="EngineEventTypes.ProviderChanged"/> — the exercise's EFFECTIVE generation
    /// provider's from→to plus WHY it moved (autonomy-safety story 07). Both directions of the egress lever ride
    /// this one shape; <see cref="Reason"/> is the discriminator, so the taxonomy grows by one entry rather than
    /// a cut/restore pair.
    /// </summary>
    /// <remarks>
    /// <b>PENDING #173 ratification</b> (story 07 AC7) — see <see cref="EngineEventTypes.ProviderChanged"/>.
    /// Carries only provider NAMES that were already registered at startup; it can never name an endpoint the
    /// NFR-005 governance gate did not sign off.
    /// </remarks>
    public sealed record ProviderChanged
    {
        /// <summary>The <see cref="Reason"/> literal for a controller cutting generation to <c>Fake</c> (egress stopped).</summary>
        public const string ReasonCut = "cut";

        /// <summary>The <see cref="Reason"/> literal for a controller restoring the startup-configured provider.</summary>
        public const string ReasonRestore = "restore";

        /// <summary>The provider that was serving this exercise's bursts before the change.</summary>
        [JsonPropertyName("fromProvider")]
        public required string FromProvider { get; init; }

        /// <summary>The provider serving this exercise's bursts after the change.</summary>
        [JsonPropertyName("toProvider")]
        public required string ToProvider { get; init; }

        /// <summary>Why it changed — <see cref="ReasonCut"/> or <see cref="ReasonRestore"/>.</summary>
        [JsonPropertyName("reason")]
        public required string Reason { get; init; }

        /// <summary>The scenario minute the change was made at (COR-050/053).</summary>
        [JsonPropertyName("scenarioMinute")]
        public required int ScenarioMinute { get; init; }
    }

    /// <summary>Payload for <see cref="EngineEventTypes.StorylineStateChanged"/> — from→to phase + cause.</summary>
    public sealed record StorylineStateChanged
    {
        /// <summary>The storyline that changed phase.</summary>
        [JsonPropertyName("storyline")]
        public required string Storyline { get; init; }

        /// <summary>The phase moved from.</summary>
        [JsonPropertyName("fromPhase")]
        public required string FromPhase { get; init; }

        /// <summary>The phase moved to.</summary>
        [JsonPropertyName("toPhase")]
        public required string ToPhase { get; init; }

        /// <summary>The cause of the transition (curve / matched response / dial target / off-platform marker).</summary>
        [JsonPropertyName("cause")]
        public required string Cause { get; init; }
    }
}
