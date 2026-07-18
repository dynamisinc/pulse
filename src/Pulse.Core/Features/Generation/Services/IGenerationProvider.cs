namespace Pulse.Core.Features.Generation.Services;

using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The swappable generation seam (NFR-005, story 01) — the same pattern as Cadence's config-driven
/// email/blob providers. The reaction loop calls this interface, never a vendor SDK directly, so the
/// concrete provider (Azure OpenAI in-tenant, Claude via Foundry/Bedrock/Vertex, ...) is chosen per
/// deployment without touching upstream code. Which concrete provider ships is decided by the eval
/// harness on measured voice fidelity plus the customer's approved-provider list — never from preference.
/// </summary>
public interface IGenerationProvider
{
    /// <summary>Provider discriminator (matches <see cref="GenerationOptions.Provider"/>) — used in telemetry.</summary>
    string Name { get; }

    /// <summary>
    /// The validated, attested governance posture (NFR-005 / ADP-025). Surfaced so the security
    /// questionnaire (NFR-006) can read the tenant-bounded / no-training / residency / retention facts
    /// off the running provider rather than trusting documentation.
    /// </summary>
    GenerationGovernance Governance { get; }

    /// <summary>
    /// Generate one burst of persona-voiced posts. Generation is off the participant hot path (§4.3):
    /// output lands in the E7 review queue or a Delayed-auto countdown, never synchronously into a feed,
    /// so seconds of latency are invisible to participants.
    /// </summary>
    Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default);
}
