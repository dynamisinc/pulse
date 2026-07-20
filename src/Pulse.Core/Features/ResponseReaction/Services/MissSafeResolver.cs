namespace Pulse.Core.Features.ResponseReaction.Services;

using Pulse.Core.Features.ReactionLoop.Models;
using Pulse.Core.Features.ResponseReaction.Models;
using Pulse.Core.Features.Storylines.Models;

/// <summary>
/// The load-bearing safety behavior of response-matching (ADP-002/002a, §7.1, adversarial review D4). It
/// resolves an official <see cref="AddressingCandidate"/> against the active storylines and enforces the
/// <b>miss-safe default</b>: only a genuine match ever addresses a storyline; unmatched official content
/// <b>slows</b> active escalation (never pauses), is <b>never treated as silence</b>, and prompts the
/// controller — so the world never berates a PIO who already answered, and an irrelevant post can't game the
/// engine into calming down.
///
/// <para>Pure and stateless. The "never treated as silence" guarantee is structural: <see cref="Resolve"/>
/// returns <see cref="MatchKind.Matched"/> only for a genuine satisfier, and <see cref="Apply"/> touches the
/// storyline's silence clock <b>only</b> on a match — an unmatched/needs-confirmation resolution leaves it
/// untouched, so the silence timer keeps running.</para>
/// </summary>
public static class MissSafeResolver
{
    /// <summary>
    /// How far escalation is slowed while an unmatched official post is pending (ADP-002a: slow, never
    /// pause). A factor in (0, 1) — never 0, so escalation continues at a reduced rate.
    /// </summary>
    public const double SlowFactor = 0.5;

    /// <summary>
    /// Resolves a candidate against the storylines. An off-platform marker is the identical satisfier
    /// (always a match to its hinted/best storyline). An official post is matched when auto-confirm is opted
    /// in and confidence clears the cutoff; otherwise a plausible suggestion needs the controller's Y/N; a
    /// below-threshold post is unmatched → the miss-safe default. Never returns Matched from a weak signal.
    /// </summary>
    public static MatchResolution Resolve(
        AddressingCandidate candidate,
        IReadOnlyList<Storyline> storylines,
        bool autoConfirmEnabled,
        double threshold = ResponseMatcher.MatchThreshold)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        ArgumentNullException.ThrowIfNull(storylines);

        // Off-platform marker (CTL-026): the identical satisfier — a confirmed match to its storyline.
        if (candidate.Source == AddressingSource.OffPlatformMarker)
        {
            var target = candidate.StorylineHintId
                ?? ResponseMatcher.SuggestBest(candidate.Text, storylines)?.StorylineId;
            return new MatchResolution(MatchKind.Matched, target, 1.0, ViaOffPlatformMarker: true);
        }

        var best = ResponseMatcher.SuggestBest(candidate.Text, storylines);
        if (best is not { } suggestion || suggestion.Confidence < threshold)
        {
            // No plausible storyline — miss-safe: slow, prompt, never silence, never falsely satisfy.
            return new MatchResolution(MatchKind.Unmatched, null, best?.Confidence ?? 0.0, ViaOffPlatformMarker: false);
        }

        // Plausible. Auto-confirm (opted in) short-circuits the prompt; otherwise the controller confirms Y/N.
        var kind = autoConfirmEnabled ? MatchKind.Matched : MatchKind.NeedsConfirmation;
        return new MatchResolution(kind, suggestion.StorylineId, suggestion.Confidence, ViaOffPlatformMarker: false);
    }

    /// <summary>
    /// Applies a resolution to <paramref name="storyline"/>. On a genuine match it records the official
    /// response (resets the silence clock, bends intensity/sentiment down, transitions toward ADDRESSED —
    /// storyline-model) and returns the events. On <b>any other</b> kind it does nothing and returns no
    /// events — the silence clock is untouched, so unmatched content is never treated as silence.
    /// </summary>
    public static IReadOnlyList<IStorylineEvent> Apply(MatchResolution resolution, Storyline storyline, int scenarioMinute)
    {
        ArgumentNullException.ThrowIfNull(resolution);
        ArgumentNullException.ThrowIfNull(storyline);

        if (resolution.IsMatch && resolution.StorylineId == storyline.Id)
        {
            return storyline.RecordMatchedResponse(scenarioMinute, resolution.ViaOffPlatformMarker);
        }

        return [];
    }

    /// <summary>
    /// Slows an active escalation intent while an unmatched official post is pending (ADP-002a): reduces the
    /// burst by <see cref="SlowFactor"/> but <b>never to zero</b> — escalation continues at a reduced rate,
    /// it does not pause. Returns the cooled intent.
    /// </summary>
    public static GenerationIntent Slow(GenerationIntent intent)
    {
        ArgumentNullException.ThrowIfNull(intent);
        var slowed = Math.Max(1, (int)Math.Floor(intent.Count * SlowFactor));
        return intent with { Count = slowed, Personas = [.. intent.Personas.Take(slowed)] };
    }
}
