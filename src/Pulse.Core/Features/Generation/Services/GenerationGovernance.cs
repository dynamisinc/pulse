namespace Pulse.Core.Features.Generation.Services;

using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The validated, immutable governance posture of a generation provider (NFR-005 / ADP-025):
/// tenant-bounded, contractual no-training, documented residency, and retention posture. Surfaced on
/// <see cref="IGenerationProvider.Governance"/> for the security questionnaire (NFR-006).
/// </summary>
public sealed record GenerationGovernance(
    bool TenantBounded,
    bool NoTrainingAttested,
    string Residency,
    RetentionPosture Retention)
{
    /// <summary>
    /// A local, in-process provider that never egresses data — compliant by construction (no endpoint,
    /// no retention, nothing to attest against a third party).
    /// </summary>
    public static GenerationGovernance InProcess { get; } = new(
        TenantBounded: true,
        NoTrainingAttested: true,
        Residency: "in-process (no egress)",
        Retention: RetentionPosture.ZeroDataRetention);

    /// <summary>
    /// Validates a configured provider's governance and returns the attested posture, or throws
    /// <see cref="GenerationConfigurationException"/> with a clear, actionable message listing every
    /// violation. This is a deployment gate (NFR-005): a provider that cannot be confirmed
    /// tenant-bounded / no-training / documented-residency is rejected here, never silently used. When
    /// the deployment targets zero data retention, a tier whose model cannot honor ZDR is also rejected
    /// (rather than quietly downgrading the posture).
    /// </summary>
    public static GenerationGovernance Validate(GenerationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var g = options.Governance;
        var provider = options.Provider;
        var errors = new List<string>();

        if (!g.TenantBounded)
        {
            errors.Add($"provider '{provider}' is not marked tenant-bounded — generation must run against a tenant-bounded endpoint (NFR-005).");
        }

        if (!g.NoTrainingAttested)
        {
            errors.Add($"provider '{provider}' has no contractual no-training attestation (NFR-005 / ADP-025).");
        }

        if (string.IsNullOrWhiteSpace(g.Residency))
        {
            errors.Add($"provider '{provider}' has no documented data residency (NFR-005).");
        }

        if (g.Retention == RetentionPosture.ZeroDataRetention)
        {
            foreach (var (tier, model) in options.Tiers)
            {
                if (!model.ZdrCapable)
                {
                    errors.Add(
                        $"tier '{tier}' model '{model.Model}' cannot honor zero-data-retention, but the deployment " +
                        "targets ZDR — choose a ZDR-capable model or change the retention posture (NFR-005).");
                }
            }
        }

        if (errors.Count > 0)
        {
            var detail = string.Join($"{Environment.NewLine}  - ", errors);
            throw new GenerationConfigurationException(
                $"Generation provider '{provider}' failed the governance gate:{Environment.NewLine}  - {detail}");
        }

        return new GenerationGovernance(g.TenantBounded, g.NoTrainingAttested, g.Residency!.Trim(), g.Retention);
    }
}

/// <summary>
/// Thrown when a generation provider's configuration is invalid or fails the NFR-005 governance gate.
/// A clear, actionable configuration error — never a silent fallthrough to an ungoverned endpoint.
/// </summary>
public sealed class GenerationConfigurationException : Exception
{
    public GenerationConfigurationException()
    {
    }

    public GenerationConfigurationException(string message)
        : base(message)
    {
    }

    public GenerationConfigurationException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
