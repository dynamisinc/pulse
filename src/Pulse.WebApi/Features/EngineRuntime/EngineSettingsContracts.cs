namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// The staff-only "what is this exercise's engine actually running" read (autonomy-safety story 05): the active
/// generation provider, the governed tier→model/deployment mapping (informational, NEVER editable here), the
/// exercise's autonomy default + safety clamp, and the current tier-policy mode. Returned by
/// <c>GET /api/engine/settings</c> and by both settings <c>POST</c>s, so a mutation's response is always the
/// authoritative full snapshot the caller can render without a follow-up read.
/// </summary>
/// <remarks>
/// STAFF world (COBRA cockpit; XC-002) — no participant surface projects any of this. Every property carries an
/// explicit <see cref="JsonPropertyNameAttribute"/> so the wire shape is fixed independent of serializer config.
/// </remarks>
public sealed class EngineSettingsDto
{
    /// <summary>
    /// The note text every settings response carries (a constant so tests and the panel agree on it).
    /// <para>
    /// EDITED by autonomy-safety story 07 (a deliberate wire + test-fixture change, not an additive-only one):
    /// the runtime provider cut is process memory too, so an operator reading this note has to be told that a
    /// restart returns generation to the startup-configured provider — the same honesty the other two levers get.
    /// </para>
    /// </summary>
    public const string InMemoryNote =
        "Autonomy default, tier-policy mode and the generation-provider cut are held in process memory; a restart "
        + "resets them to suggest / auto / the startup-configured provider.";

    /// <summary>
    /// The STARTUP-CONFIGURED generation provider's name (<c>Fake</c> / <c>AzureOpenAI</c> / <c>ClaudeFoundry</c>)
    /// — read-only, and deliberately UNCHANGED by an active runtime cut. See <see cref="EffectiveProvider"/> for
    /// what is actually serving this exercise's bursts right now.
    /// </summary>
    [JsonPropertyName("provider")]
    public required string Provider { get; init; }

    /// <summary>
    /// The provider actually serving THIS exercise's bursts right now — <c>Fake</c> while a cut is active
    /// (autonomy-safety story 07), otherwise identical to <see cref="Provider"/>. Read this directly: per WR-003
    /// no consumer may re-derive "a cut is active, therefore effectively Fake" by comparing fields, which is
    /// exactly the mislabelled-posture bug class the configured/effective split exists to prevent.
    /// </summary>
    [JsonPropertyName("effectiveProvider")]
    public required string EffectiveProvider { get; init; }

    /// <summary>
    /// Whether a runtime cut to <c>Fake</c> is currently active for this exercise — the lever's own state, so the
    /// console can render the control and its "RUNNING ON: FAKE (cut from …)" label without inferring either from
    /// a field comparison (WR-003).
    /// </summary>
    [JsonPropertyName("providerCutToFake")]
    public required bool ProviderCutToFake { get; init; }

    /// <summary>
    /// Whether the STARTUP-CONFIGURED provider is already <c>Fake</c> (the committed default; every CI run and,
    /// today, UAT) — in which case cutting is an honest no-op rather than a false "I just locked something down"
    /// signal, and restoring has nothing to restore. Reported so the console can say so instead of implying the
    /// lever did something.
    /// </summary>
    [JsonPropertyName("alreadyFake")]
    public required bool AlreadyFake { get; init; }

    /// <summary>
    /// The governed <c>Generation:Tiers:*</c> mapping, ordered by tier key. Informational only: this endpoint
    /// can never change which deployment/model a tier resolves to (NFR-005 / ADP-025 — that would let an
    /// operator route traffic to an unattested endpoint, defeating the startup governance gate).
    /// </summary>
    [JsonPropertyName("tiers")]
    public required IReadOnlyList<EngineTierConfigDto> Tiers { get; init; }

    /// <summary>The exercise's autonomy/safety snapshot — the default level plus the active clamp/degraded reason.</summary>
    [JsonPropertyName("autonomy")]
    public required EngineAutonomyStateDto Autonomy { get; init; }

    /// <summary>The exercise's current tier-policy mode (<c>auto</c> / <c>standard</c> / <c>ambient</c>).</summary>
    [JsonPropertyName("tierPolicyMode")]
    [JsonConverter(typeof(TierPolicyModeJsonConverter))]
    public required TierPolicyMode TierPolicyMode { get; init; }

    /// <summary>
    /// <c>true</c> — the autonomy default and tier-policy mode live in PROCESS MEMORY and are reset by a restart.
    /// Reported honestly rather than solved here (persistence is explicitly out of scope for story 05), so an
    /// operator who restarts the App Service is not surprised by the reset.
    /// </summary>
    [JsonPropertyName("inMemoryState")]
    public required bool InMemoryState { get; init; }

    /// <summary>The human-readable companion to <see cref="InMemoryState"/>, for the settings panel to surface verbatim.</summary>
    [JsonPropertyName("inMemoryStateNote")]
    public required string InMemoryStateNote { get; init; }

    /// <summary>Composes the settings snapshot from the provider names, the governed tier config, and the three per-exercise registries' state.</summary>
    /// <param name="providerName">
    /// The STARTUP-CONFIGURED <see cref="Pulse.Core.Features.Generation.Services.IGenerationProvider.Name"/> — which
    /// the story-07 selector passes through unchanged while a cut is active, by design.
    /// </param>
    /// <param name="providerCutToFake">Whether a runtime cut to <c>Fake</c> is active for this exercise.</param>
    /// <param name="options">The bound <see cref="GenerationOptions"/> (read-only here).</param>
    /// <param name="autonomy">The exercise's autonomy snapshot.</param>
    /// <param name="tierPolicyMode">The exercise's tier-policy mode.</param>
    /// <returns>The staff wire snapshot.</returns>
    /// <remarks>
    /// <see cref="EffectiveProvider"/> and <see cref="AlreadyFake"/> are resolved HERE, once, on the server — the
    /// projection is the right place for that, and it is what lets every consumer read both facts directly
    /// instead of comparing fields (WR-003).
    /// </remarks>
    public static EngineSettingsDto From(
        string providerName,
        bool providerCutToFake,
        GenerationOptions options,
        EngineAutonomyStateDto autonomy,
        TierPolicyMode tierPolicyMode)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(autonomy);

        var configuredIsFake = string.Equals(
            providerName, FakeGenerationProvider.ProviderName, StringComparison.OrdinalIgnoreCase);

        return new EngineSettingsDto
        {
            Provider = providerName,
            EffectiveProvider = providerCutToFake ? FakeGenerationProvider.ProviderName : providerName,
            ProviderCutToFake = providerCutToFake,
            AlreadyFake = configuredIsFake,
            Tiers = options.Tiers
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => EngineTierConfigDto.From(pair.Key, pair.Value))
                .ToList(),
            Autonomy = autonomy,
            TierPolicyMode = tierPolicyMode,
            InMemoryState = true,
            InMemoryStateNote = InMemoryNote,
        };
    }
}

/// <summary>One governed tier→model/deployment binding as reported by <c>GET /api/engine/settings</c> (read-only).</summary>
public sealed class EngineTierConfigDto
{
    /// <summary>The configuration key for the tier role, verbatim (e.g. <c>Standard</c> / <c>Ambient</c>).</summary>
    [JsonPropertyName("tier")]
    public required string Tier { get; init; }

    /// <summary>The underlying model id, for telemetry/cost (e.g. <c>claude-sonnet-5</c>).</summary>
    [JsonPropertyName("model")]
    public required string Model { get; init; }

    /// <summary>The deployment name used in the endpoint path.</summary>
    [JsonPropertyName("deployment")]
    public required string Deployment { get; init; }

    /// <summary>Whether the bound model can run under zero data retention (NFR-005).</summary>
    [JsonPropertyName("zdrCapable")]
    public required bool ZdrCapable { get; init; }

    /// <summary>Projects one configured tier binding to its wire shape.</summary>
    /// <param name="tier">The configuration key for the tier role.</param>
    /// <param name="options">The bound model/deployment options.</param>
    /// <returns>The wire shape.</returns>
    public static EngineTierConfigDto From(string tier, TierModelOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return new EngineTierConfigDto
        {
            Tier = tier,
            Model = options.Model,
            Deployment = options.Deployment,
            ZdrCapable = options.ZdrCapable,
        };
    }
}

/// <summary>
/// The result of an engine-settings read or mutation, mapped to an HTTP status at the endpoint (fail closed) —
/// the same shape as <see cref="EngineAutonomyResult"/>, carrying the full <see cref="EngineSettingsDto"/>.
/// </summary>
public sealed class EngineSettingsResult
{
    private EngineSettingsResult(EngineReviewOutcome outcome, EngineSettingsDto? settings, string? validationError)
    {
        Outcome = outcome;
        Settings = settings;
        ValidationError = validationError;
    }

    /// <summary>Which outcome occurred.</summary>
    public EngineReviewOutcome Outcome { get; }

    /// <summary>The settings snapshot — non-null only on <see cref="EngineReviewOutcome.Ok"/>.</summary>
    public EngineSettingsDto? Settings { get; }

    /// <summary>The validation message — non-null only on <see cref="EngineReviewOutcome.Invalid"/>.</summary>
    public string? ValidationError { get; }

    /// <summary>A successful read/change carrying the resulting snapshot.</summary>
    /// <param name="settings">The resulting settings snapshot.</param>
    /// <returns>The result.</returns>
    public static EngineSettingsResult Ok(EngineSettingsDto settings) => new(EngineReviewOutcome.Ok, settings, null);

    /// <summary>The fail-closed result for an unresolved scope (COR-001) — 401, never a default/unscoped snapshot.</summary>
    /// <returns>The result.</returns>
    public static EngineSettingsResult ScopeUnresolved() => new(EngineReviewOutcome.ScopeUnresolved, null, null);

    /// <summary>A rejected request (400) — an unknown/unselectable level or mode, or a missing acting human.</summary>
    /// <param name="validationError">The validation message.</param>
    /// <returns>The result.</returns>
    public static EngineSettingsResult Invalid(string validationError) =>
        new(EngineReviewOutcome.Invalid, null, validationError);
}
