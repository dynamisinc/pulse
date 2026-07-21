namespace Pulse.WebApi.Tests;

using System.Collections.Generic;
using System.IO;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// engine-runtime/04 (NFR-005 Tier-2, NFR-003) — the CI-runnable gate on the <b>live-config surface</b>:
/// the committed <c>appsettings.json</c> default and the governed <c>appsettings.Generation.Example.json</c>
/// example are bound through the real <see cref="ServiceCollectionExtensions.AddEngineGeneration"/> seam.
/// Proves the config <b>fails closed</b> (a real provider without governance keys never wires an HttpClient)
/// and that CI stays on <see cref="FakeGenerationProvider"/> — CI has no key and can never reach a live
/// endpoint. No live egress: resolving a real adapter builds the typed client lazily but never calls out.
/// </summary>
public sealed class ProviderLiveConfigTests
{
    private static readonly string FixtureDir = Path.Combine(AppContext.BaseDirectory, "ConfigFixtures");

    /// <summary>The §3.5 ~10s degraded-mode trip threshold — a call slower than this trips the breaker (NFR-003).</summary>
    private const double DegradedModeTripSeconds = 10.0;

    // Measured p95 latency recorded 2026-07-18 against aif-pulse-uat — see
    // docs/features/engine-generation-infra/MEASURED-RESULTS.md (the MODELED §4 numbers, now measured).
    private const double MeasuredStandardP95Ms = 2655.0;
    private const double MeasuredAmbientP95Ms = 1983.0;

    private static IConfiguration FromFixture(string fileName) =>
        new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(FixtureDir, fileName), optional: false)
            .Build();

    [Fact]
    public void CommittedAppsettings_KeepsFakeProvider_SoCiNeverEgresses()
    {
        // The committed default that CI/tests load. It MUST stay Fake so no CI run selects a live endpoint.
        var services = new ServiceCollection();
        services.AddEngineGeneration(FromFixture("appsettings.json"));

        using var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IGenerationProvider>().Should().BeOfType<FakeGenerationProvider>(
            "the committed appsettings.json default must stay Provider=Fake — CI has no governed endpoint "
            + "and must never reach a live/egressing provider (engine-runtime/04, NFR-005).");
    }

    [Fact]
    public void GovernedExample_SelectsTheLiveAzureOpenAIProvider_WithoutEgress()
    {
        // The governed example config (NOT auto-loaded) selects the live in-tenant provider. Resolving it
        // builds the adapter + typed HttpClient but performs no network call (auth/egress is lazy).
        var services = new ServiceCollection();
        services.AddEngineGeneration(FromFixture("appsettings.Generation.Example.json"));

        using var provider = services.BuildServiceProvider();
        var resolved = provider.GetRequiredService<IGenerationProvider>();

        resolved.Should().BeOfType<AzureOpenAIGenerationProvider>();
        resolved.Governance.TenantBounded.Should().BeTrue("the governed example must pass the NFR-005 gate");
        resolved.Governance.NoTrainingAttested.Should().BeTrue();
        resolved.Governance.Residency.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void GovernedExample_MapsEveryGenerationKeyToItsBicepOutput()
    {
        // AC "config keys match the ai.bicep outputs verbatim": the example's values are exactly the
        // infrastructure/modules/ai.bicep outputs (endpoint / deployment names / model ids / residency).
        var options = FromFixture("appsettings.Generation.Example.json")
            .GetSection(GenerationOptions.SectionName)
            .Get<GenerationOptions>();

        options.Should().NotBeNull();
        options!.Provider.Should().Be("AzureOpenAI");
        options.Endpoint.Should().Be("https://aif-pulse-uat.cognitiveservices.azure.com/", "= ai.bicep output 'endpoint'");
        options.Tiers.Should().ContainKey("Standard").WhoseValue.Deployment.Should().Be("standard", "= ai.bicep 'standardDeploymentName'");
        options.Tiers["Standard"].Model.Should().Be("gpt-5.4", "= ai.bicep 'standardModelName'");
        options.Tiers.Should().ContainKey("Ambient").WhoseValue.Deployment.Should().Be("ambient", "= ai.bicep 'ambientDeploymentName'");
        options.Tiers["Ambient"].Model.Should().Be("gpt-5.4-mini", "= ai.bicep 'ambientModelName'");
        options.Governance.Residency.Should().Be("centralus", "= ai.bicep 'residency' output (the deployment region)");
    }

    [Fact]
    public void GovernedExample_WithGovernanceKeyUnset_FailsClosedAtStartup()
    {
        // NFR-005 fail-closed gate: start from the fully-governed example, then knock out ONE governance
        // attestation. AddEngineGeneration must throw BEFORE any adapter/HttpClient is constructed, so a
        // misconfigured deployment can never egress to an untenanted endpoint.
        var config = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(FixtureDir, "appsettings.Generation.Example.json"), optional: false)
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Generation:Governance:TenantBounded"] = "false",
            })
            .Build();

        var act = () => new ServiceCollection().AddEngineGeneration(config);

        act.Should().Throw<GenerationConfigurationException>()
            .WithMessage("*governance gate*")
            .WithMessage("*tenant-bounded*");
    }

    [Fact]
    public void GovernedExample_TripThreshold_IsTunedToMeasuredP95_AndFlagsIfApproaching()
    {
        // AC (NFR-003): the degraded-mode trip threshold (Resilience.AttemptTimeoutSeconds) is set to the
        // §3.5 ~10s breach point and validated against the MEASURED p95 — comfortably above it, so a call
        // slower than the threshold is a genuine degradation. If a re-measured p95 ever APPROACHES the
        // threshold this test FAILS (flags it) rather than silently accepting it.
        var options = FromFixture("appsettings.Generation.Example.json")
            .GetSection(GenerationOptions.SectionName)
            .Get<GenerationOptions>();

        options.Should().NotBeNull();
        var tripThresholdSeconds = options!.Resilience.AttemptTimeoutSeconds;

        tripThresholdSeconds.Should().Be(DegradedModeTripSeconds,
            "the governed config's per-attempt timeout is the §3.5 ~10s degraded-mode trip threshold (NFR-003)");

        var worstMeasuredP95Seconds = Math.Max(MeasuredStandardP95Ms, MeasuredAmbientP95Ms) / 1000.0;

        // Flag if measured p95 approaches the threshold: it must sit well under it (< 70%), else re-tune.
        worstMeasuredP95Seconds.Should().BeLessThan(tripThresholdSeconds * 0.70,
            "measured p95 ({0}s) must stay well below the {1}s trip threshold — if it approaches, re-tune "
            + "the breaker rather than silently accepting it (MEASURED-RESULTS.md, NFR-003 AC).",
            worstMeasuredP95Seconds,
            tripThresholdSeconds);
    }
}
