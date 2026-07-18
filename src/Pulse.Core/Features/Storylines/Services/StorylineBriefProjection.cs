namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// Projects a <see cref="Storyline"/> to the generation-facing <see cref="StorylineBrief"/> (§1.1 / §3.3).
/// The prompt assembler (engine-generation-infra, on main) needs only what shapes a burst — title,
/// expectation, minutes-since-response, intensity, phase, tone mix, hashtags — so the storyline aggregate
/// stays free of any generation-layer coupling; that dependency lives here, one-way, in the projection.
/// The tone mix is bent by the storyline phase (§ ToneMix) and nudged by its current sentiment.
/// </summary>
public static class StorylineBriefProjection
{
    /// <summary>How strongly sentiment nudges the tone mix (±1.0 sentiment scales the matching tones ×1.5).</summary>
    public const double SentimentNudge = 0.5;

    /// <summary>Builds the generation-facing projection of the storyline's current state.</summary>
    public static StorylineBrief ToBrief(this Storyline storyline)
    {
        ArgumentNullException.ThrowIfNull(storyline);

        return new StorylineBrief
        {
            Title = storyline.Title,
            Expectation = storyline.Expectation,
            MinutesSinceLastOfficialResponse = storyline.MinutesSinceLastOfficialResponse,
            Intensity = storyline.Intensity,
            Phase = PhaseLabel(storyline.Phase),
            ToneMix = ToneMixFor(storyline.Phase, storyline.Sentiment),
            Hashtags = storyline.Hashtags,
        };
    }

    /// <summary>The uppercase phase label the prompt uses (e.g. <c>ESCALATING</c>).</summary>
    public static string PhaseLabel(StorylinePhase phase) => phase.ToString().ToUpperInvariant();

    /// <summary>
    /// The desired emotional mix for a burst, bent by phase and nudged by sentiment. A hot escalating
    /// concern skews worry/anger/speculation; an addressed one skews gratitude/calm (keeping one skeptic,
    /// §7.1). Fractions always sum to 1.
    /// </summary>
    public static ToneMix ToneMixFor(StorylinePhase phase, double sentiment)
    {
        // Base mix per phase: (worry, anger, speculation, gratitude, skepticism, calm), each summing to 1.
        var (worry, anger, speculation, gratitude, skepticism, calm) = phase switch
        {
            StorylinePhase.Escalating => (0.30, 0.20, 0.35, 0.00, 0.10, 0.05),
            StorylinePhase.Peak => (0.28, 0.37, 0.25, 0.00, 0.07, 0.03),
            StorylinePhase.Addressed => (0.15, 0.05, 0.10, 0.40, 0.15, 0.15),
            StorylinePhase.Decaying => (0.10, 0.02, 0.08, 0.30, 0.10, 0.40),
            StorylinePhase.Resolved => (0.05, 0.00, 0.05, 0.20, 0.05, 0.65),
            StorylinePhase.Seeded => (0.20, 0.05, 0.30, 0.00, 0.10, 0.35),
            _ => (0.10, 0.00, 0.10, 0.00, 0.00, 0.80), // Dormant: calm-heavy, rarely voiced.
        };

        var s = Math.Clamp(sentiment, -1.0, 1.0);
        var negativeFactor = 1.0 + (SentimentNudge * Math.Max(0.0, -s)); // s<0 amplifies worry/anger
        var positiveFactor = 1.0 + (SentimentNudge * Math.Max(0.0, s));  // s>0 amplifies gratitude/calm

        worry *= negativeFactor;
        anger *= negativeFactor;
        gratitude *= positiveFactor;
        calm *= positiveFactor;

        var total = worry + anger + speculation + gratitude + skepticism + calm;

        return new ToneMix
        {
            Worry = worry / total,
            Anger = anger / total,
            Speculation = speculation / total,
            Gratitude = gratitude / total,
            Skepticism = skepticism / total,
            Calm = calm / total,
        };
    }
}
