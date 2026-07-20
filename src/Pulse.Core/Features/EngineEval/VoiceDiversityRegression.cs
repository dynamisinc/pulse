namespace Pulse.Core.Features.EngineEval;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.PersonaVoice.Services;

/// <summary>
/// One labeled burst in the voice-diversity regression corpus (ADP-021, §5.3/§12.1): a burst, the per-persona
/// styles to check conformance against, and whether the believable+diverse gate is expected to pass it.
/// </summary>
public sealed record VoiceDiversityCase(
    string Name,
    IReadOnlyList<GeneratedPost> Burst,
    IReadOnlyDictionary<string, PersonaStyle> Styles,
    bool ExpectedPass);

/// <summary>The result of scoring one case: the gate's evaluation and whether it matched the expectation.</summary>
public sealed record VoiceDiversityRegressionResult(VoiceDiversityCase Case, BurstEvaluation Evaluation)
{
    /// <summary>True when the gate's pass/fail matched the case's expected outcome (a regression is a mismatch).</summary>
    public bool AsExpected => Evaluation.Passed == Case.ExpectedPass;
}

/// <summary>
/// A human believability spot-check panel result (ADP-021, §5.3/§12.1) — recorded during tuning to keep the
/// automated proxies honest. The proxies must track the humans (<see cref="VoiceDiversityRegression.ProxyTracksHumans"/>).
/// </summary>
public sealed record HumanSpotCheck(int SampleSize, double BelievabilityPassRate);

/// <summary>
/// The voice-diversity &amp; fidelity regression gate (ADP-021, §12.1). It runs the <b>same</b> pure
/// believable+diverse metric as the pre-review re-roll gate — <see cref="BurstAcceptancePolicy.Evaluate"/>
/// over <see cref="VoiceMetrics"/> + <see cref="StyleConformance"/> — as automated regression over a corpus
/// of labeled bursts, so a prompt/model change that quietly flattens the crowd voice is surfaced as a
/// failure. One implementation, two call sites (§5.3 AC): the loop's gate and this regression share it.
///
/// <para>The corpus is maintained (like the injection red-team): a clean/diverse burst must pass, a
/// blended/converged one must fail, an off-voice one must fail — so the gate is a real gate, not decoration.
/// A periodic human spot-check panel (<see cref="HumanSpotCheck"/>) keeps the automated proxies honest;
/// <see cref="ProxyTracksHumans"/> checks the proxy pass-rate tracks the panel within tolerance. Reports are
/// staff/tuning-facing (XC-002); no participant exposure.</para>
/// </summary>
public static class VoiceDiversityRegression
{
    /// <summary>The standing regression corpus: at least one expected-pass and expected-fail case per failure mode.</summary>
    public static IReadOnlyList<VoiceDiversityCase> Corpus { get; } = BuildCorpus();

    /// <summary>Scores one case with the shared believable+diverse gate.</summary>
    public static VoiceDiversityRegressionResult Run(VoiceDiversityCase testCase)
    {
        ArgumentNullException.ThrowIfNull(testCase);
        var evaluation = BurstAcceptancePolicy.Evaluate(testCase.Burst, testCase.Styles);
        return new VoiceDiversityRegressionResult(testCase, evaluation);
    }

    /// <summary>Runs the whole corpus. A regression is any result where <see cref="VoiceDiversityRegressionResult.AsExpected"/> is false.</summary>
    public static IReadOnlyList<VoiceDiversityRegressionResult> RunAll() => [.. Corpus.Select(Run)];

    /// <summary>
    /// Whether the automated proxy pass-rate tracks a human spot-check panel within
    /// <paramref name="tolerance"/> (§5.3: the proxies must approximate the humans). If they diverge, the
    /// thresholds need re-tuning — the automated gate has drifted from the ground truth.
    /// </summary>
    public static bool ProxyTracksHumans(double proxyPassRate, HumanSpotCheck panel, double tolerance = 0.2)
    {
        ArgumentNullException.ThrowIfNull(panel);
        ThrowIfNotRate(proxyPassRate, nameof(proxyPassRate));
        ThrowIfNotRate(panel.BelievabilityPassRate, $"{nameof(panel)}.{nameof(HumanSpotCheck.BelievabilityPassRate)}");
        if (double.IsNaN(tolerance) || tolerance < 0.0)
        {
            throw new ArgumentOutOfRangeException(nameof(tolerance), tolerance, "Tolerance must be a non-negative number.");
        }

        return Math.Abs(proxyPassRate - panel.BelievabilityPassRate) <= tolerance;
    }

    private static void ThrowIfNotRate(double value, string name)
    {
        if (double.IsNaN(value) || value < 0.0 || value > 1.0)
        {
            throw new ArgumentOutOfRangeException(name, value, "A pass rate must be within [0, 1].");
        }
    }

    private static IReadOnlyList<VoiceDiversityCase> BuildCorpus()
    {
        var noStyles = new Dictionary<string, PersonaStyle>();

        // Clean: three distinct voices — must pass.
        var clean = new VoiceDiversityCase("clean/diverse-voices",
        [
            Post("@mom", "third day without safe tap water on maple street and my kids keep asking me why"),
            Post("@news", "Developing: county officials have not addressed reports of discoloured water downtown."),
            Post("@skeptic", "funny how the boil-advisory rumour travels faster than any confirmation from anyone official"),
        ], noStyles, ExpectedPass: true);

        // Blended: one authorial voice — must fail on pairwise overlap.
        var blended = new VoiceDiversityCase("blended/one-authorial-voice",
        [
            Post("@a", "the water situation is really concerning and officials need to respond right now"),
            Post("@b", "the water situation is really concerning and officials need to respond right now please"),
            Post("@c", "the water situation is really concerning and officials should respond right now"),
        ], noStyles, ExpectedPass: false);

        // Off-voice: diverse burst, but @mom drifted far off her terse established style — must fail conformance.
        var offVoice = new VoiceDiversityCase("off-voice/persona-drift",
            clean.Burst,
            new Dictionary<string, PersonaStyle> { ["@mom"] = new() { AvgLength = 12, EmojiRate = 0, HashtagRate = 0, CapsConvention = "lower" } },
            ExpectedPass: false);

        return [clean, blended, offVoice];
    }

    private static GeneratedPost Post(string handle, string text) => new(handle, text, 0.0, []);
}
