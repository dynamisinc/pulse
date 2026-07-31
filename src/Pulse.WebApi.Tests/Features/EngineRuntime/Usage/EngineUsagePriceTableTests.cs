namespace Pulse.WebApi.Tests.Features.EngineRuntime.Usage;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Features.EngineRuntime.Usage;
using Xunit;

/// <summary>
/// Unit tests for the CONFIG-SOURCED price table (engine-telemetry-tuning story 03a, story 03 AC3): that the
/// documented <c>Generation:Pricing</c> key shape really binds, that the committed <c>appsettings.json</c>
/// section is that shape, and that an absent/empty section degrades to UNPRICED rather than crashing or
/// pricing everything at zero. Plain <see cref="FactAttribute"/>s — configuration binding needs no database.
/// </summary>
public sealed class EngineUsagePriceTableTests
{
    private static EngineUsagePricingOptions Bind(IEnumerable<KeyValuePair<string, string?>> values)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var options = new EngineUsagePricingOptions();
        configuration.GetSection(EngineUsagePricingOptions.SectionName).Bind(options);
        return options;
    }

    [Fact]
    public void TheDocumentedKeyShape_BindsProviderAndModelRates()
    {
        var options = Bind(new Dictionary<string, string?>
        {
            ["Generation:Pricing:Currency"] = "USD",
            ["Generation:Pricing:Providers:AzureOpenAI:gpt-5.4:InputPer1MTokens"] = "2.50",
            ["Generation:Pricing:Providers:AzureOpenAI:gpt-5.4:OutputPer1MTokens"] = "10.00",
            ["Generation:Pricing:Providers:AzureOpenAI:gpt-5.4:CacheReadPer1MTokens"] = "0.25",
            ["Generation:Pricing:Providers:AzureOpenAI:gpt-5.4:CacheCreationPer1MTokens"] = "3.125",
        });

        var table = EngineUsagePriceTable.FromOptions(options);

        table.Currency.Should().Be("USD");
        table.TryGetRates("AzureOpenAI", "gpt-5.4", out var rates).Should().BeTrue(
            "this is the key shape appsettings.json documents and the deployed environment supplies as "
            + "Generation__Pricing__Providers__… app settings");
        rates!.InputPer1MTokens.Should().Be(2.50m);
        rates.OutputPer1MTokens.Should().Be(10.00m);
        rates.CacheReadPer1MTokens.Should().Be(0.25m);
        rates.CacheCreationPer1MTokens.Should().Be(3.125m);
    }

    [Fact]
    public void Lookup_IsCaseInsensitiveOnBothProviderAndModel()
    {
        var options = Bind(new Dictionary<string, string?>
        {
            ["Generation:Pricing:Providers:azureopenai:GPT-5.4:InputPer1MTokens"] = "2.50",
        });

        EngineUsagePriceTable.FromOptions(options)
            .TryGetRates("AzureOpenAI", "gpt-5.4", out var rates).Should().BeTrue(
                "the config side is hand-authored (and env-var keys are case-insensitive) while the event side "
                + "records whatever casing the adapter reported — a case-sensitive match would silently "
                + "degrade a priced model to 'unpriced'");
        rates!.InputPer1MTokens.Should().Be(2.50m);
    }

    [Fact]
    public void AnAbsentSection_BindsToAnEmptyTable_SoEveryModelIsUnpricedRatherThanFree()
    {
        var options = Bind(new Dictionary<string, string?> { ["Generation:Provider"] = "Fake" });

        var table = EngineUsagePriceTable.FromOptions(options);

        table.EntryCount.Should().Be(0);
        table.TryGetRates("AzureOpenAI", "gpt-5.4", out var rates).Should().BeFalse(
            "an unconfigured price table must degrade to the explicit 'unpriced' state — never crash, and "
            + "never a $0 that reads as free (story 03 AC3)");
        rates.Should().BeNull();
        table.Currency.Should().Be("USD", "the currency label falls back rather than binding to an empty string");
    }

    [Fact]
    public void Empty_PricesNothing()
    {
        EngineUsagePriceTable.Empty.EntryCount.Should().Be(0);
        EngineUsagePriceTable.Empty.TryGetRates("Fake", "fake-deterministic", out _).Should().BeFalse();
    }

    [Fact]
    public void TryGetRates_WithNoProviderOrModel_IsUnpriced()
    {
        var table = EngineUsagePriceTable.FromOptions(Bind(new Dictionary<string, string?>
        {
            ["Generation:Pricing:Providers:Fake:fake-deterministic:InputPer1MTokens"] = "0",
        }));

        table.TryGetRates(null, "fake-deterministic", out _).Should().BeFalse();
        table.TryGetRates("Fake", null, out _).Should().BeFalse();
        table.TryGetRates(string.Empty, string.Empty, out _).Should().BeFalse();
    }

    // ---- the committed default -------------------------------------------------------------------

    /// <summary>
    /// The committed <c>appsettings.json</c> is the file the host and CI actually load, so the shape is pinned
    /// against the REAL file (the same copied artifact <c>ProviderLiveConfigTests</c> validates) rather than a
    /// hand-written fixture that could drift from it. Two things are asserted: the <c>Fake</c> entry exists (so
    /// the priced path is exercised by the committed default, and pre-flip UAT reads an honest $0 rather than
    /// "unpriced"), and NO live provider is priced here — real $/token figures are deployment config data
    /// entry, deliberately not committed (story 03, Out of Scope).
    /// </summary>
    [Fact]
    public void CommittedAppsettings_PricesFakeAtZero_AndPricesNoLiveProvider()
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(
                Path.Combine(AppContext.BaseDirectory, "ConfigFixtures", "appsettings.json"),
                optional: false)
            .Build();

        var options = new EngineUsagePricingOptions();
        configuration.GetSection(EngineUsagePricingOptions.SectionName).Bind(options);
        var table = EngineUsagePriceTable.FromOptions(options);

        table.TryGetRates(FakeGenerationProvider.ProviderName, "fake-deterministic", out var fake).Should().BeTrue(
            "the committed default runs the Fake provider, whose zero cost is a FACT (no egress, 0 tokens by "
            + "construction) — so it is priced, not unpriced");
        fake!.InputPer1MTokens.Should().Be(0m);
        fake.OutputPer1MTokens.Should().Be(0m);

        table.TryGetRates("AzureOpenAI", "gpt-5.4", out _).Should().BeFalse(
            "no live-provider price is committed: Foundry deployments are not version-pinned, so a committed "
            + "figure would silently go stale — populating them is deployment config data entry");
        table.TryGetRates("ClaudeFoundry", "claude-sonnet-5", out _).Should().BeFalse();
    }

    /// <summary>
    /// The hazard this options class exists to avoid, pinned: the pricing keys live UNDER
    /// <c>Generation</c> for operator-facing tidiness, but they must NOT reach
    /// <see cref="GenerationOptions"/> — <c>AddEngineGeneration</c> runs a fail-closed NFR-005 startup
    /// governance gate over that object, and spend data has no business inside it.
    /// </summary>
    [Fact]
    public void ThePricingSection_IsNotBoundByGenerationOptions_SoTheGovernanceGateIsUntouched()
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(
                Path.Combine(AppContext.BaseDirectory, "ConfigFixtures", "appsettings.json"),
                optional: false)
            .Build();

        var generation = configuration.GetSection(GenerationOptions.SectionName).Get<GenerationOptions>();

        generation.Should().NotBeNull("the committed Generation section must still bind cleanly");
        typeof(GenerationOptions).GetProperties().Select(p => p.Name).Should().NotContain(
            "Pricing",
            "pricing is a SEPARATE options class on purpose — growing the governance-gated GenerationOptions "
            + "with spend data would entangle it with a startup gate that must fail closed on governance "
            + "grounds only (NFR-005)");
        generation!.Provider.Should().Be(
            FakeGenerationProvider.ProviderName,
            "and adding the pricing keys must not have disturbed the committed Fake default");
    }
}
