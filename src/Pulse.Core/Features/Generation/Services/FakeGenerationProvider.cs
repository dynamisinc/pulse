namespace Pulse.Core.Features.Generation.Services;

using System.Diagnostics;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Deterministic, offline generation provider — no network, no credentials, compliant by construction
/// (it never egresses data, so <see cref="GenerationGovernance.InProcess"/> applies). This is the
/// default for local dev, tests, and CI so the whole engine loop runs end-to-end with no live endpoint.
/// It only exercises the seam; real voice quality comes from the tenant-bounded adapters and is proven
/// by the eval harness. The canned lines are intentionally distinct so the downstream diversity metrics
/// (ADP-021) and review queue have non-identical content to work with.
/// </summary>
public sealed class FakeGenerationProvider : IGenerationProvider
{
    public string Name => "Fake";

    public GenerationGovernance Governance => GenerationGovernance.InProcess;

    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        var stopwatch = Stopwatch.StartNew();

        var posts = new List<GeneratedPost>(Math.Max(0, request.PostCount));
        for (var i = 0; i < request.PostCount; i++)
        {
            var handle = $"@sim_{i:00}";
            var text = FakeLines[i % FakeLines.Length];
            var sentiment = Math.Round(-0.6 + ((i % 5) * 0.3), 2);
            posts.Add(new GeneratedPost(handle, text, sentiment, ExtractHashtags(text)));
        }

        stopwatch.Stop();

        var result = new GenerationResult(
            Posts: posts,
            Usage: new GenerationUsage(InputTokens: 0, OutputTokens: 0),
            Latency: stopwatch.Elapsed,
            ProviderName: Name,
            Model: "fake-deterministic");

        return Task.FromResult(result);
    }

    private static string[] ExtractHashtags(string text) =>
        text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(word => word.StartsWith('#'))
            .Select(word => word.TrimEnd('.', '!', '?', ','))
            .ToArray();

    private static readonly string[] FakeLines =
    [
        "anyone else's tap water smell off this morning? #WaterIssues",
        "why is nobody from the county saying anything about this?? been hours now",
        "my neighbor swears it's the treatment plant. no idea if that's true #WaterIssues",
        "the school just told the kids not to drink from the fountains. what is going on",
        "ok everyone please wait for an official statement before we all panic",
    ];
}
