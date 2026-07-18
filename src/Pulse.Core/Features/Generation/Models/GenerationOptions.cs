namespace Pulse.Core.Features.Generation.Models;

/// <summary>
/// Staff/backend-only configuration for the adaptive content engine's generation provider (XC-002 —
/// never participant-visible). Bound from the "Generation" configuration section. The
/// <see cref="Provider"/> discriminator selects the concrete adapter per deployment; the choice is
/// data-driven (ranked by the eval harness on measured voice fidelity), never from preference.
/// </summary>
public sealed class GenerationOptions
{
    public const string SectionName = "Generation";

    /// <summary>
    /// Provider discriminator: "Fake" (dev/offline, no egress), "AzureOpenAI" (in-tenant default),
    /// "ClaudeFoundry" (quality-preferred where approved). Adapters for the real providers are
    /// tenant-bounded (NFR-005).
    /// </summary>
    public string Provider { get; set; } = "Fake";

    /// <summary>Tenant-bounded endpoint URI. Unused by the Fake provider.</summary>
    public string? Endpoint { get; set; }

    /// <summary>Provider API version (Azure OpenAI data plane). gpt-5-tier models require a recent version.</summary>
    public string ApiVersion { get; set; } = "2025-04-01-preview";

    /// <summary>The governance posture the deployment attests to (NFR-005 / ADP-025). Gated at startup.</summary>
    public GovernanceOptions Governance { get; set; } = new();

    /// <summary>
    /// Tier -> concrete model/deployment. Keys map to <see cref="GenerationTier"/> roles
    /// ("Standard", "Ambient"). Model tiering + selection is finalized in story 04.
    /// </summary>
    public Dictionary<string, TierModelOptions> Tiers { get; } = new();

    /// <summary>Circuit-breaker / retry tuning for the provider (NFR-003 / ADP-042, story 05).</summary>
    public ResilienceOptions Resilience { get; } = new();
}

/// <summary>
/// The attested data-governance posture for a generation deployment (NFR-005 / ADP-025). Every field
/// is a deployment gate: a provider that cannot be confirmed tenant-bounded, under contractual
/// no-training terms, with documented residency is rejected at startup — never silently used.
/// </summary>
public sealed class GovernanceOptions
{
    /// <summary>The endpoint is bounded to the customer/Dynamis tenant (no shared/public inference).</summary>
    public bool TenantBounded { get; set; }

    /// <summary>Contractual attestation that customer data is not used to train the model.</summary>
    public bool NoTrainingAttested { get; set; }

    /// <summary>Documented data residency (e.g. an Azure region such as "centralus").</summary>
    public string? Residency { get; set; }

    /// <summary>Retention posture. Zero-data-retention is a config target (NFR-005).</summary>
    public RetentionPosture Retention { get; set; } = RetentionPosture.Unspecified;
}

/// <summary>A concrete model/deployment bound to a <see cref="GenerationTier"/>.</summary>
public sealed class TierModelOptions
{
    /// <summary>Underlying model id, for telemetry/cost (e.g. "gpt-5.4", "claude-sonnet-5").</summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>Azure deployment name used in the endpoint path (e.g. "standard", "ambient").</summary>
    public string Deployment { get; set; } = string.Empty;

    /// <summary>Whether this model can run under zero-data-retention. Checked when the deployment targets ZDR.</summary>
    public bool ZdrCapable { get; set; } = true;
}

/// <summary>Data-retention posture of a generation deployment.</summary>
public enum RetentionPosture
{
    /// <summary>Not explicitly declared — standard retention under the no-training contract.</summary>
    Unspecified,

    /// <summary>Zero data retention: no prompt/completion is persisted by the provider.</summary>
    ZeroDataRetention,

    /// <summary>Data is retained per the documented retention window (still tenant-bounded, no-training).</summary>
    Retained,
}

/// <summary>
/// Circuit-breaker / retry tuning for the generation provider (NFR-003 / ADP-042). Defaults are
/// conservative placeholders; the story-06 measured p95 sets the real degraded-mode trip thresholds.
/// </summary>
public sealed class ResilienceOptions
{
    /// <summary>Retry attempts for transient failures (5xx / 408 / network), on top of the first try.</summary>
    public int MaxRetries { get; set; } = 2;

    /// <summary>Failure ratio within the sampling window that opens the circuit (0.0–1.0).</summary>
    public double CircuitBreakerFailureRatio { get; set; } = 0.5;

    /// <summary>Minimum calls in the sampling window before the breaker can open.</summary>
    public int CircuitBreakerMinimumThroughput { get; set; } = 10;

    /// <summary>Rolling window over which the failure ratio is evaluated.</summary>
    public double CircuitBreakerSamplingSeconds { get; set; } = 30;

    /// <summary>How long the circuit stays open (degraded) before probing recovery.</summary>
    public double CircuitBreakerBreakSeconds { get; set; } = 15;

    /// <summary>Per-attempt timeout. The load-bearing SLO (§4.3): a breach trips degraded mode.</summary>
    public double AttemptTimeoutSeconds { get; set; } = 30;
}
