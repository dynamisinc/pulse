namespace Pulse.Core.Tests.Features.Generation;

using System.Globalization;
using Azure.Identity;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.EngineEval;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Xunit.Abstractions;

/// <summary>
/// The E8 provider comparison (architecture §3.1): runs the SAME bursts through both the Azure OpenAI
/// and the Claude-on-Foundry providers and reports a side-by-side of measured p50/p95 latency, token
/// profile, estimated cost, guard-clean rate, and voice-diversity metrics — reusing the identical
/// <see cref="ContentGuard"/> + <see cref="VoiceMetrics"/> gates per provider (provider is a config
/// swap). The choice of default provider is data-driven off these numbers, never from preference.
///
/// Opt-in via <c>PULSE_LIVE_FOUNDRY=1</c> (an az-cli login holding <c>Cognitive Services OpenAI User</c>
/// for the OpenAI surface AND <c>Cognitive Services User</c> for the Claude surface). Each provider runs
/// best-effort: if one endpoint is unreachable (e.g. Claude not provisioned yet) its rows report the
/// error and the other provider still measures, so the harness is usable incrementally. Feeds
/// <c>docs/features/engine-generation-infra/PROVIDER-COMPARISON.md</c>.
/// </summary>
public sealed class ProviderComparisonTests
{
    private const string EnableFlag = "PULSE_LIVE_FOUNDRY";
    private const string OpenAIEndpoint = "https://aif-pulse-uat.cognitiveservices.azure.com/";
    private const string ClaudeEndpoint = "https://aif-pulse-uat.services.ai.azure.com/";
    private const int Iterations = 5;

    private readonly ITestOutputHelper _output;

    public ProviderComparisonTests(ITestOutputHelper output) => _output = output;

    // Per-MTok list pricing ($/1M tokens), confirmed 2026-07-18 (Global Standard list rates). The
    // Sonnet-5 introductory discount ($2/$10 through 2026-08-31) and the DataZoneStandard/US premium
    // (~1.1x) are applied in the write-up narrative, not baked in here, so these stay the plain list rates.
    private sealed record TierPricing(double InPerMTok, double OutPerMTok);

    private sealed record TierSpec(string Deployment, string Model, TierPricing Pricing);

    private sealed record ProviderSpec(
        string Name,
        string Endpoint,
        TierSpec Standard,
        TierSpec Ambient,
        // Token accounting differs by provider: Azure OpenAI's InputTokens INCLUDES cached tokens (cache
        // read is a subset), while Anthropic's InputTokens EXCLUDES both cache-read and cache-creation
        // tokens (reported separately). The cost math + the displayed total-input normalise for this.
        bool InputExcludesCache,
        Func<HttpClient, GenerationOptions, IGenerationProvider> Factory);

    private static ProviderSpec[] Providers() =>
    [
        new ProviderSpec(
            "AzureOpenAI",
            OpenAIEndpoint,
            new TierSpec("standard", "gpt-5.4", new TierPricing(2.50, 15.00)),
            new TierSpec("ambient", "gpt-5.4-mini", new TierPricing(0.75, 4.50)),
            InputExcludesCache: false,
            (http, opts) => new AzureOpenAIGenerationProvider(http, new AzureCliCredential(), Options.Create(opts), GenerationGovernance.InProcess)),

        new ProviderSpec(
            "ClaudeFoundry",
            ClaudeEndpoint,
            new TierSpec("claude-sonnet-5", "claude-sonnet-5", new TierPricing(3.00, 15.00)),
            new TierSpec("claude-haiku-4-5", "claude-haiku-4-5", new TierPricing(1.00, 5.00)),
            InputExcludesCache: true,
            (http, opts) => new ClaudeFoundryGenerationProvider(http, new AzureCliCredential(), Options.Create(opts), GenerationGovernance.InProcess)),
    ];

    // Provider-aware cost model. Cache-read bills at 0.1x input; cache-creation (Anthropic only) at 1.25x.
    // For OpenAI, InputTokens already includes cache reads, so fresh = In - CacheRead; for Anthropic,
    // InputTokens is already fresh and the cache tokens are additive.
    private static double CostPerBurst(TierRun run, TierPricing price, bool inputExcludesCache)
    {
        var freshInput = inputExcludesCache ? run.AvgIn : run.AvgIn - run.AvgCacheRead;
        return ((freshInput * price.InPerMTok)
            + (run.AvgCacheRead * price.InPerMTok * 0.1)
            + (run.AvgCacheCreate * price.InPerMTok * 1.25)
            + (run.AvgOut * price.OutPerMTok)) / 1_000_000.0;
    }

    // Total input tokens processed, normalised so the column is apples-to-apples across providers.
    private static int TotalInput(TierRun run, bool inputExcludesCache) =>
        inputExcludesCache ? run.AvgIn + run.AvgCacheRead + run.AvgCacheCreate : run.AvgIn;

    [Fact]
    public async Task Live_ComparesProvidersOnIdenticalBursts()
    {
        if (Environment.GetEnvironmentVariable(EnableFlag) != "1")
        {
            _output.WriteLine($"skipped — set {EnableFlag}=1 (az login with Cognitive Services OpenAI User + Cognitive Services User) to run the comparison live.");
            return;
        }

        var assembler = new PromptAssembler();

        _output.WriteLine("provider      | tier     | model             | p50 ms | p95 ms | in tok | out tok | cached | guardOK | divOK | ovlp | ~$/burst | ~$/exercise-hr");
        _output.WriteLine(new string('-', 132));

        var anyCompleted = false;
        var samples = new List<string>();

        foreach (var spec in Providers())
        {
            var options = new GenerationOptions { Provider = spec.Name, Endpoint = spec.Endpoint };
            options.Tiers["Standard"] = new TierModelOptions { Deployment = spec.Standard.Deployment, Model = spec.Standard.Model };
            options.Tiers["Ambient"] = new TierModelOptions { Deployment = spec.Ambient.Deployment, Model = spec.Ambient.Model };

            using var http = new HttpClient { BaseAddress = new Uri(spec.Endpoint), Timeout = TimeSpan.FromSeconds(60) };
            var provider = spec.Factory(http, options);

            foreach (var (tier, tierSpec) in new[]
                     {
                         (GenerationTier.Standard, spec.Standard),
                         (GenerationTier.Ambient, spec.Ambient),
                     })
            {
                TierRun run;
                try
                {
                    run = await MeasureTierAsync(provider, assembler, tier);
                }
                catch (Exception ex) when (ex is GenerationProviderException or GenerationConfigurationException or HttpRequestException or TaskCanceledException)
                {
                    _output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                        $"{spec.Name,-13} | {tier,-8} | {tierSpec.Model,-17} | ERROR: {Truncate(ex.Message, 70)}"));
                    continue;
                }

                anyCompleted = true;
                var costPerBurst = CostPerBurst(run, tierSpec.Pricing, spec.InputExcludesCache);
                var costPerHour = costPerBurst * (25.0 * 60.0 / 4.0); // ~375 four-post bursts / active-storyline hour
                var totalIn = TotalInput(run, spec.InputExcludesCache);

                _output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"{spec.Name,-13} | {tier,-8} | {tierSpec.Model,-17} | {run.P50,6:0} | {run.P95,6:0} | {totalIn,6} | {run.AvgOut,7} | {run.AvgCacheRead,6} | {run.GuardOk}/{Iterations,-5} | {run.DivOk}/{Iterations,-3} | {run.AvgOverlap,4:0.00} | {costPerBurst,8:0.0000} | {costPerHour,0:0.00}"));

                if (tier == GenerationTier.Standard && run.FirstBurst.Count > 0)
                {
                    samples.Add($"--- {spec.Name} / Standard ({tierSpec.Model}) sample burst ---");
                    samples.AddRange(run.FirstBurst.Select(post => $"  {post.PersonaHandle}: {post.Text}  [sentiment {post.Sentiment:0.0}]"));
                }

                run.P95.Should().BeLessThan(10_000, $"{spec.Name}/{tier} generation p95 must sit inside the human-review loop (§4.3)");
            }
        }

        _output.WriteLine(string.Empty);
        foreach (var line in samples)
        {
            _output.WriteLine(line);
        }

        anyCompleted.Should().BeTrue("at least one provider must complete a tier for the comparison to be meaningful");
    }

    private sealed record TierRun(
        double P50,
        double P95,
        int AvgIn,
        int AvgOut,
        int AvgCacheRead,
        int AvgCacheCreate,
        int GuardOk,
        int DivOk,
        double AvgOverlap,
        IReadOnlyList<GeneratedPost> FirstBurst);

    private static async Task<TierRun> MeasureTierAsync(IGenerationProvider provider, IPromptAssembler assembler, GenerationTier tier)
    {
        var latencies = new List<double>();
        var inTokens = new List<int>();
        var outTokens = new List<int>();
        var cacheRead = new List<int>();
        var cacheCreate = new List<int>();
        var overlaps = new List<double>();
        var guardOk = 0;
        var divOk = 0;
        IReadOnlyList<GeneratedPost> firstBurst = [];

        for (var i = 0; i < Iterations; i++)
        {
            // Identical input sequence to the single-provider measured pass, so the two providers are
            // compared on the same bursts: a stable cast/brief (cacheable prefix) + a changing storyline
            // state per iteration.
            var request = assembler.Assemble(BuildInput(tier, minutesSilent: 20 + (i * 10)));
            var result = await provider.GenerateAsync(request);

            latencies.Add(result.Latency.TotalMilliseconds);
            inTokens.Add(result.Usage.InputTokens);
            outTokens.Add(result.Usage.OutputTokens);
            cacheRead.Add(result.Usage.CacheReadInputTokens);
            cacheCreate.Add(result.Usage.CacheCreationInputTokens);
            overlaps.Add(VoiceMetrics.MaxPairwiseOverlap(result.Posts).MaxOverlap);
            if (ContentGuard.InspectBurst(result.Posts).Clean) { guardOk++; }
            if (VoiceMetrics.Evaluate(result.Posts).Passed) { divOk++; }
            if (i == 0) { firstBurst = result.Posts; }
        }

        return new TierRun(
            Percentile(latencies, 0.50),
            Percentile(latencies, 0.95),
            (int)inTokens.Average(),
            (int)outTokens.Average(),
            (int)cacheRead.Average(),
            (int)cacheCreate.Average(),
            guardOk,
            divOk,
            overlaps.Average(),
            firstBurst);
    }

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.OrderBy(v => v).ToList();
        var index = (int)Math.Ceiling(percentile * sorted.Count) - 1;
        return sorted[Math.Clamp(index, 0, sorted.Count - 1)];
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : string.Concat(value.AsSpan(0, max), "…");

    private static PromptAssemblyInput BuildInput(GenerationTier tier, int minutesSilent) => new()
    {
        ExerciseId = Guid.NewGuid(),
        ExerciseBrief = "Fictional town of Rivermead (pop. ~40,000). Scenario time: Day 1, morning. A tap-water concern is spreading online.",
        Storyline = new StorylineBrief
        {
            Title = "Tap water discoloration and odor",
            Expectation = "The county Water Authority has not confirmed whether the tap water is safe to drink.",
            MinutesSinceLastOfficialResponse = minutesSilent,
            Intensity = 40 + minutesSilent,
            Phase = "ESCALATING",
            Hashtags = ["#WaterIssues"],
            ToneMix = new ToneMix { Worry = 0.5, Speculation = 0.3, Anger = 0.2 },
        },
        Personas =
        [
            new PersonaDossier { Handle = "@ana_m", DisplayName = "Ana Morales", Type = PersonaType.Resident, VoiceNotes = "anxious parent, short sentences, one emoji", Style = new PersonaStyle { AvgLength = 90, EmojiRate = 0.5, HashtagRate = 0.5 } },
            new PersonaDossier { Handle = "@rivermead_dispatch", DisplayName = "Rivermead Dispatch", Type = PersonaType.Outlet, VoiceNotes = "local news, terse factual headlines, no emoji", Style = new PersonaStyle { AvgLength = 140 } },
            new PersonaDossier { Handle = "@neighbor_pat", DisplayName = "Pat", Type = PersonaType.Helper, VoiceNotes = "calm, corrects rumors, cites official sources", Style = new PersonaStyle { AvgLength = 120 } },
            new PersonaDossier { Handle = "@joe_rivers", DisplayName = "Joe", Type = PersonaType.Resident, VoiceNotes = "gruff, skeptical of authorities, no hashtags", Style = new PersonaStyle { AvgLength = 100 } },
        ],
        WorldPosts = [new WorldPost("@participant_pio", "We are aware of reports about water quality and are looking into it.")],
        Tier = tier,
    };
}
