namespace Pulse.WebApi.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;

/// <summary>
/// The immutable, lookup-ready form of the config-sourced price table (<see cref="EngineUsagePricingOptions"/>)
/// that <see cref="EngineUsageAggregator"/> costs against. A plain in-memory value: no configuration,
/// dependency-injection, EF or clock types appear anywhere in its surface, so the aggregation stays a pure
/// function of its inputs.
/// </summary>
/// <remarks>
/// Lookups are case-INSENSITIVE on both provider and model. Configuration keys are case-insensitive by
/// construction (a JSON key and its <c>Generation__Pricing__…</c> environment-variable equivalent may differ in
/// casing), while an <c>engine.generated</c> event records whatever casing the provider adapter reported — so a
/// case-sensitive match here would silently degrade a priced model to "unpriced", the exact honest-looking-but-
/// wrong reading this table exists to avoid.
/// </remarks>
public sealed class EngineUsagePriceTable
{
    private readonly Dictionary<string, Dictionary<string, EngineModelRates>> _providers;

    private EngineUsagePriceTable(
        string currency,
        Dictionary<string, Dictionary<string, EngineModelRates>> providers)
    {
        Currency = currency;
        _providers = providers;
    }

    /// <summary>An entirely unconfigured table — every model looked up in it is <b>unpriced</b>.</summary>
    public static EngineUsagePriceTable Empty { get; } = new(
        "USD",
        new Dictionary<string, Dictionary<string, EngineModelRates>>(StringComparer.OrdinalIgnoreCase));

    /// <summary>The currency label the configured rates are expressed in.</summary>
    public string Currency { get; }

    /// <summary>How many (provider, model) pairs carry rates. Zero means every model reports as unpriced.</summary>
    public int EntryCount
    {
        get
        {
            var count = 0;
            foreach (var models in _providers.Values)
            {
                count += models.Count;
            }

            return count;
        }
    }

    /// <summary>Projects the bound configuration options into the lookup table.</summary>
    /// <param name="options">The bound <c>Generation:Pricing</c> options (may be entirely empty).</param>
    /// <returns>The immutable table. An empty/absent section yields a table in which every model is unpriced.</returns>
    public static EngineUsagePriceTable FromOptions(EngineUsagePricingOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var providers = new Dictionary<string, Dictionary<string, EngineModelRates>>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var (providerName, models) in options.Providers)
        {
            if (string.IsNullOrWhiteSpace(providerName) || models is null)
            {
                continue;
            }

            var rates = new Dictionary<string, EngineModelRates>(StringComparer.OrdinalIgnoreCase);
            foreach (var (modelName, price) in models)
            {
                if (string.IsNullOrWhiteSpace(modelName) || price is null)
                {
                    continue;
                }

                rates[modelName] = new EngineModelRates(
                    price.InputPer1MTokens,
                    price.OutputPer1MTokens,
                    price.CacheReadPer1MTokens,
                    price.CacheCreationPer1MTokens);
            }

            providers[providerName] = rates;
        }

        var currency = string.IsNullOrWhiteSpace(options.Currency) ? "USD" : options.Currency;
        return new EngineUsagePriceTable(currency, providers);
    }

    /// <summary>Looks up one model's rates.</summary>
    /// <param name="provider">The provider name recorded on the <c>engine.generated</c> event.</param>
    /// <param name="model">The model id recorded on the <c>engine.generated</c> event.</param>
    /// <param name="rates">The configured rates when found; otherwise <c>null</c>.</param>
    /// <returns><c>true</c> when the pair is priced; <c>false</c> means UNPRICED (never "priced at zero").</returns>
    public bool TryGetRates(string? provider, string? model, out EngineModelRates? rates)
    {
        rates = null;

        if (string.IsNullOrEmpty(provider) || string.IsNullOrEmpty(model))
        {
            return false;
        }

        return _providers.TryGetValue(provider, out var models)
            && models.TryGetValue(model, out rates);
    }
}

/// <summary>
/// One model's four token rates, in currency units per 1,000,000 tokens. Kept as four separate rates —
/// never a single blended number — because the categories genuinely price differently.
/// </summary>
/// <param name="InputPer1MTokens">Cost per 1,000,000 input (prompt) tokens.</param>
/// <param name="OutputPer1MTokens">Cost per 1,000,000 output (completion) tokens.</param>
/// <param name="CacheReadPer1MTokens">Cost per 1,000,000 cache-read input tokens.</param>
/// <param name="CacheCreationPer1MTokens">Cost per 1,000,000 cache-creation input tokens.</param>
public sealed record EngineModelRates(
    decimal InputPer1MTokens,
    decimal OutputPer1MTokens,
    decimal CacheReadPer1MTokens,
    decimal CacheCreationPer1MTokens);
