namespace Pulse.Core.Features.Storylines.Services;

using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The continuous sentiment computation (ADP-012, §6.2). Sentiment (−1…+1) blends three explainable
/// components so it is defensible in a hotwash: <b>engine state</b> (phase + intensity — a hot, rising
/// concern reads negative), <b>reaction signals</b> (SOC-031, weighted by how many reactions informed
/// them), and an optional <b>light content pass</b>. Exercise-wide sentiment is the intensity-weighted
/// aggregate of the active storylines (louder concerns dominate the mood). Pure and deterministic.
/// </summary>
public static class SentimentModel
{
    /// <summary>Weight of the engine-state baseline in the blend.</summary>
    public const double EngineWeight = 0.5;

    /// <summary>Full weight of the reaction component once it has enough samples to trust.</summary>
    public const double ReactionWeight = 0.35;

    /// <summary>Weight of the optional content-analysis component.</summary>
    public const double ContentWeight = 0.15;

    /// <summary>Reaction sample count at (and above) which the reaction component is fully trusted.</summary>
    public const int ReactionConfidenceSamples = 20;

    /// <summary>
    /// Computes a storyline's sentiment from its engine state and this tick's signals. With no reaction or
    /// content signal, sentiment is the engine-state baseline alone.
    /// </summary>
    public static double Compute(
        StorylinePhase phase,
        int intensity,
        IReactionSignal? reactions = null,
        double? contentSentiment = null)
    {
        var engine = EngineBaseline(phase, intensity);

        var weightedSum = EngineWeight * engine;
        var weightTotal = EngineWeight;

        if (reactions is not null && reactions.SampleCount > 0)
        {
            var confidence = Math.Min(1.0, reactions.SampleCount / (double)ReactionConfidenceSamples);
            var w = ReactionWeight * confidence;
            weightedSum += w * Math.Clamp(reactions.NetSentiment, -1.0, 1.0);
            weightTotal += w;
        }

        if (contentSentiment is { } content)
        {
            weightedSum += ContentWeight * Math.Clamp(content, -1.0, 1.0);
            weightTotal += ContentWeight;
        }

        return Math.Clamp(weightedSum / weightTotal, -1.0, 1.0);
    }

    /// <summary>
    /// The engine-state contribution to sentiment: a hot, unaddressed concern reads negative in proportion
    /// to intensity; an addressed/decaying concern recovers toward neutral-positive as intensity falls; a
    /// dormant/seeded concern is neutral.
    /// </summary>
    public static double EngineBaseline(StorylinePhase phase, int intensity)
    {
        var scaled = Math.Clamp(intensity, Storyline.MinIntensity, Storyline.MaxIntensity) / 100.0;

        return phase switch
        {
            StorylinePhase.Escalating or StorylinePhase.Peak => -scaled,
            StorylinePhase.Addressed or StorylinePhase.Decaying or StorylinePhase.Resolved => 0.3 * (1.0 - scaled),
            _ => 0.0,
        };
    }

    /// <summary>
    /// Exercise-wide sentiment (ADP-012): the intensity-weighted mean of the storylines' sentiment, so a
    /// loud concern moves the exercise mood more than a quiet one. Returns 0 when there is nothing to weigh.
    /// </summary>
    public static double Aggregate(IEnumerable<Storyline> storylines)
    {
        ArgumentNullException.ThrowIfNull(storylines);

        double weightedSum = 0;
        long weightTotal = 0;

        foreach (var storyline in storylines)
        {
            var weight = storyline.Intensity;
            weightedSum += weight * storyline.Sentiment;
            weightTotal += weight;
        }

        return weightTotal == 0 ? 0.0 : Math.Clamp(weightedSum / weightTotal, -1.0, 1.0);
    }
}
