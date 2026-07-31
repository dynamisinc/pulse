namespace Pulse.WebApi.Features.EngineRuntime.Usage;

using System.Collections.Generic;

/// <summary>
/// The CONFIG-SOURCED per-model price table for the AI-usage cost view (engine-telemetry-tuning story 03,
/// AC3). Bound from the <c>Generation:Pricing</c> configuration section — never a hardcoded <c>switch</c> on
/// provider/model literals: Foundry deployments in this repo use
/// <c>versionUpgradeOption: 'OnceNewDefaultVersionAvailable'</c> (<c>infrastructure/modules/ai.bicep</c>) and
/// are therefore NOT version-pinned, so the price for a given model NAME can drift under the deployment with
/// no accompanying code change.
/// </summary>
/// <remarks>
/// <para>
/// <b>Deliberately its OWN options class, not a property on <c>GenerationOptions</c>.</b>
/// <c>AddEngineGeneration</c> runs a fail-closed NFR-005 <i>startup governance gate</i> over
/// <c>GenerationOptions</c>; growing that bound object with pricing data would entangle spend figures with a
/// gate that must keep failing closed on governance grounds only. The section lives UNDER <c>Generation</c>
/// purely so the operator-facing config shape stays in one family (<c>Generation:Provider</c>,
/// <c>Generation:Tiers:*</c>, <c>Generation:Pricing:*</c>) — <c>GenerationOptions</c> has no <c>Pricing</c>
/// property, so the extra keys are simply not bound by it.
/// </para>
/// <para>
/// <b>Absent config is "unpriced", never <c>$0</c>.</b> An empty/missing section binds to an empty
/// <see cref="Providers"/> map, which makes every observed model report the explicit <c>priced: false</c>
/// state on the wire (see <c>EngineUsageModelCostDto</c>) rather than a silently-wrong zero cost. Populating
/// the real $/token figures for a live provider is config data entry performed in the deployed environment,
/// deliberately NOT a committed code change (story 03, Out of Scope).
/// </para>
/// </remarks>
public sealed class EngineUsagePricingOptions
{
    /// <summary>The configuration section these options bind from: <c>Generation:Pricing</c>.</summary>
    public const string SectionName = "Generation:Pricing";

    /// <summary>
    /// The currency every rate below is expressed in, echoed on the wire so the panel never has to assume one.
    /// Purely a LABEL — nothing here converts between currencies.
    /// </summary>
    public string Currency { get; set; } = "USD";

    /// <summary>
    /// Provider name (<c>Fake</c> / <c>AzureOpenAI</c> / <c>ClaudeFoundry</c>) → model id → that model's
    /// rates. Keyed by provider AND model because the same model name under two providers can price
    /// differently, and because an <c>engine.generated</c> event records both. Get-only, populated by the
    /// configuration binder (the same shape <c>GenerationOptions.Tiers</c> uses).
    /// </summary>
    public Dictionary<string, Dictionary<string, EngineModelPriceOptions>> Providers { get; } = [];
}

/// <summary>
/// One model's token rates, in currency units per MILLION tokens (the unit every current provider publishes
/// its price list in, which keeps the configured figures human-checkable against that list).
/// </summary>
/// <remarks>
/// The four categories are configured — and costed — SEPARATELY because they price differently; nothing here
/// or in the rollup ever sums them into one "tokens" number. A category left unset is <c>0</c>, which is why
/// the rollup echoes the applied rates back on the wire: a zero cache-read cost is then visibly a zero RATE,
/// not an unexplained zero.
/// </remarks>
public sealed class EngineModelPriceOptions
{
    /// <summary>Cost per 1,000,000 input (prompt) tokens.</summary>
    public decimal InputPer1MTokens { get; set; }

    /// <summary>Cost per 1,000,000 output (completion) tokens.</summary>
    public decimal OutputPer1MTokens { get; set; }

    /// <summary>Cost per 1,000,000 cache-READ input tokens (typically a fraction of the input rate).</summary>
    public decimal CacheReadPer1MTokens { get; set; }

    /// <summary>Cost per 1,000,000 cache-CREATION input tokens (typically a premium over the input rate).</summary>
    public decimal CacheCreationPer1MTokens { get; set; }
}
