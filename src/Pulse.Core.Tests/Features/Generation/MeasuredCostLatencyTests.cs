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
/// Story 06 — the live measured cost/latency pass that replaces the throwaway spike's MODELED numbers
/// (spikes/e8-generation-loop/FINDINGS.md) with measured ones. Opt-in via <c>PULSE_LIVE_FOUNDRY=1</c>
/// (az-cli login with Cognitive Services OpenAI User). Runs several bursts per tier against
/// aif-pulse-uat, then reports measured p50/p95 latency, token profile, prompt-cache behavior, an
/// estimated cost envelope, and the voice/guard pass rates. It also seeds the degraded-mode trip
/// threshold (story 05) from the measured p95 rather than the placeholder.
/// </summary>
public sealed class MeasuredCostLatencyTests
{
    private const string EnableFlag = "PULSE_LIVE_FOUNDRY";
    private const string Endpoint = "https://aif-pulse-uat.cognitiveservices.azure.com/";
    private const int Iterations = 5;

    // Analog per-MTok pricing (Sonnet/Haiku tiers, from the spike) — gpt-5.4 Azure rates still to confirm.
    private const double StandardInPrice = 3.0;
    private const double StandardOutPrice = 15.0;
    private const double AmbientInPrice = 1.0;
    private const double AmbientOutPrice = 5.0;

    private readonly ITestOutputHelper _output;

    public MeasuredCostLatencyTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public async Task Live_MeasuresLatencyAndCostPerTier()
    {
        if (Environment.GetEnvironmentVariable(EnableFlag) != "1")
        {
            _output.WriteLine($"skipped — set {EnableFlag}=1 to run the measured pass live.");
            return;
        }

        var options = new GenerationOptions { Provider = "AzureOpenAI", Endpoint = Endpoint, ApiVersion = "2025-04-01-preview" };
        options.Tiers["Standard"] = new TierModelOptions { Deployment = "standard", Model = "gpt-5.4" };
        options.Tiers["Ambient"] = new TierModelOptions { Deployment = "ambient", Model = "gpt-5.4-mini" };

        using var http = new HttpClient { BaseAddress = new Uri(Endpoint) };
        var provider = new AzureOpenAIGenerationProvider(http, new AzureCliCredential(), Options.Create(options), GenerationGovernance.InProcess);
        var assembler = new PromptAssembler();

        _output.WriteLine($"tier      | p50 ms | p95 ms | in tok | out tok | cached | guardOK | divOK | ~$/burst | ~$/exercise-hr (25/min)");
        _output.WriteLine(new string('-', 108));

        foreach (var (tier, inPrice, outPrice) in new[]
                 {
                     (GenerationTier.Standard, StandardInPrice, StandardOutPrice),
                     (GenerationTier.Ambient, AmbientInPrice, AmbientOutPrice),
                 })
        {
            var latencies = new List<double>();
            var inTokens = new List<int>();
            var outTokens = new List<int>();
            var cached = new List<int>();
            var guardOk = 0;
            var divOk = 0;

            for (var i = 0; i < Iterations; i++)
            {
                // Stable cast/brief (cacheable prefix) + a changing storyline state per iteration.
                var request = assembler.Assemble(BuildInput(tier, minutesSilent: 20 + (i * 10)));
                var result = await provider.GenerateAsync(request);

                latencies.Add(result.Latency.TotalMilliseconds);
                inTokens.Add(result.Usage.InputTokens);
                outTokens.Add(result.Usage.OutputTokens);
                cached.Add(result.Usage.CacheReadInputTokens);
                if (ContentGuard.InspectBurst(result.Posts).Clean) { guardOk++; }
                if (VoiceMetrics.Evaluate(result.Posts).Passed) { divOk++; }
            }

            var p50 = Percentile(latencies, 0.50);
            var p95 = Percentile(latencies, 0.95);
            var avgIn = (int)inTokens.Average();
            var avgOut = (int)outTokens.Average();
            var avgCached = (int)cached.Average();
            var costPerBurst = (((avgIn - avgCached) * inPrice) + (avgCached * inPrice * 0.1) + (avgOut * outPrice)) / 1_000_000.0;

            // A nominal active-storyline hour at ~25 generated posts/min ≈ 375 bursts of ~4 posts.
            var costPerHour = costPerBurst * (25.0 * 60.0 / 4.0);

            _output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                $"{tier,-9} | {p50,6:0} | {p95,6:0} | {avgIn,6} | {avgOut,7} | {avgCached,6} | {guardOk}/{Iterations,-5} | {divOk}/{Iterations,-3} | {costPerBurst,8:0.0000} | {costPerHour,0:0.00}"));

            // Sanity: generation stays off the participant hot path — a burst must be well under the p95 SLO ceiling.
            p95.Should().BeLessThan(10_000, "generation p95 must sit inside the human-review loop (§4.3)");
        }
    }

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.OrderBy(v => v).ToList();
        var index = (int)Math.Ceiling(percentile * sorted.Count) - 1;
        return sorted[Math.Clamp(index, 0, sorted.Count - 1)];
    }

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
