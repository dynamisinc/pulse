namespace Pulse.Core.Features.Generation.Models;

/// <summary>
/// A provider-neutral generation request — the transport shape only. Story 01 owns this seam, not the
/// content: prompt assembly (story 02) fills <see cref="SystemPrompt"/> with trusted engine context,
/// and the isolation boundary (story 03) fills <see cref="WorldFeed"/> with untrusted, already-fenced
/// world/participant content. Keeping these as opaque strings is deliberate — the provider transports
/// them; it never re-interprets the trust boundary (ADP-024).
/// </summary>
public sealed record GenerationRequest
{
    /// <summary>The exercise this burst belongs to. Generation is always exercise-scoped (COR-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>Which model tier to use for this burst (story 04 picks it from the generation intent).</summary>
    public required GenerationTier Tier { get; init; }

    /// <summary>How many persona-voiced posts this burst should produce (one call, N personas — §5.2 diversity).</summary>
    public required int PostCount { get; init; }

    /// <summary>Trusted engine context (the system prompt), assembled by story 02. Never contains participant text.</summary>
    public required string SystemPrompt { get; init; }

    /// <summary>
    /// UNTRUSTED world/participant content, already fenced and role-tagged by story 03. Data, never
    /// instructions (ADP-024). Empty for an ambient burst with no world context.
    /// </summary>
    public string WorldFeed { get; init; } = string.Empty;

    /// <summary>Optional output-token ceiling for the burst.</summary>
    public int? MaxOutputTokens { get; init; }
}

/// <summary>One generated post, attributable to a persona (XC-005). Its engine origin is captured for
/// telemetry/E10 but is never participant-visible (SOC-003).</summary>
public sealed record GeneratedPost(
    string PersonaHandle,
    string Text,
    double Sentiment,
    IReadOnlyList<string> Hashtags);

/// <summary>Token accounting for one generation call, used by the cost model (story 06 / eval harness).</summary>
public sealed record GenerationUsage(
    int InputTokens,
    int OutputTokens,
    int CacheReadInputTokens = 0,
    int CacheCreationInputTokens = 0);

/// <summary>The result of one burst: the posts plus the usage/latency/provenance the telemetry + cost model consume.</summary>
public sealed record GenerationResult(
    IReadOnlyList<GeneratedPost> Posts,
    GenerationUsage Usage,
    TimeSpan Latency,
    string ProviderName,
    string Model);

/// <summary>
/// Model tier by role — deliberately vendor-neutral. Story 04 maps each role to a concrete deployment
/// per provider and picks the tier from the generation intent.
/// </summary>
public enum GenerationTier
{
    /// <summary>Storyline-critical reactions (silence escalation, response reaction, rumor content):
    /// top voice quality. Sonnet-tier / GPT-4.1-class.</summary>
    Standard,

    /// <summary>Ambient chatter + bulk amplification voicing — the world staying alive during lulls.
    /// Haiku-tier / mini. This is the bulk of volume.</summary>
    Ambient,
}
