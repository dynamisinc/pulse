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
///
/// <para>Each burst's lead line is chosen by rotating <see cref="FakeLines"/> from a per-request OFFSET
/// derived from a stable hash of <see cref="GenerationRequest.SystemPrompt"/>. The prompt assembler encodes
/// minutes-since-official-response / phase / tone into the system prompt, so as the storyline advances the
/// prompt changes and the burst's lead line changes reaction-to-reaction — the fake output tracks the story
/// instead of repeating the same line every burst. The hash is a hand-rolled FNV-1a (NOT
/// <see cref="object.GetHashCode"/>, which is randomized per process), so the provider stays deterministic
/// and stateless: the same prompt always yields the same output, as befits a registered singleton.</para>
/// </summary>
public sealed class FakeGenerationProvider : IGenerationProvider
{
    /// <summary>
    /// The <see cref="IGenerationProvider.Name"/> / <c>Generation:Provider</c> discriminator for the offline
    /// provider — the single source of truth for the literal that the tier-binding rule and story 07's
    /// cut/effective-provider projection both compare against.
    /// </summary>
    public const string ProviderName = "Fake";

    public string Name => ProviderName;

    public GenerationGovernance Governance => GenerationGovernance.InProcess;

    public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        var stopwatch = Stopwatch.StartNew();

        // Rotate the canned lines by a prompt-derived offset so a burst leads with a different line as the
        // storyline advances (the prompt changes), while staying deterministic for a given prompt.
        var offset = RotationOffset(request.SystemPrompt);

        var posts = new List<GeneratedPost>(Math.Max(0, request.PostCount));
        for (var i = 0; i < request.PostCount; i++)
        {
            var handle = $"@sim_{i:00}";
            var text = FakeLines[(offset + i) % FakeLines.Length];
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

    /// <summary>
    /// The per-request rotation offset into <see cref="FakeLines"/>, derived from a stable FNV-1a hash of the
    /// system prompt so the same prompt always maps to the same lead line (determinism) while a changed prompt
    /// (the storyline advancing) rotates to a different one. A null/empty/whitespace prompt collapses to 0.
    /// </summary>
    private static int RotationOffset(string? systemPrompt) =>
        string.IsNullOrWhiteSpace(systemPrompt)
            ? 0
            : (int)(StableHash(systemPrompt) % (uint)FakeLines.Length);

    /// <summary>
    /// A tiny stable FNV-1a (32-bit) hash over the prompt's characters — deterministic across processes,
    /// unlike <see cref="string.GetHashCode()"/> (randomized per run), so tests and replay are reproducible.
    /// </summary>
    private static uint StableHash(string text)
    {
        const uint offsetBasis = 2166136261;
        const uint prime = 16777619;

        var hash = offsetBasis;
        foreach (var ch in text)
        {
            hash ^= ch;
            hash *= prime;
        }

        return hash;
    }

    private static readonly string[] FakeLines =
    [
        "anyone else's tap water smell off this morning? #WaterIssues",
        "why is nobody from the county saying anything about this?? been hours now",
        "my neighbor swears it's the treatment plant. no idea if that's true #WaterIssues",
        "the school just told the kids not to drink from the fountains. what is going on",
        "ok everyone please wait for an official statement before we all panic",
        "boil-advisory rumors going around but i can't find anything official #WaterIssues",
        "just filled a glass and it's cloudy. is anyone else's water coming out like this?",
        "heard crews are working on a broken main over on 5th st — that explain the taste?",
        "reminder: stick to bottled water until public health actually says something",
        "the store on main is already sold out of bottled water, this is getting real",
    ];
}
