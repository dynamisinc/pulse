namespace Pulse.Core.Features.PersonaVoice.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;

/// <summary>
/// Voice consistency (ADP-020, E8 architecture §5.1): turns a <see cref="PersonaVoiceProfile"/> into the
/// generation-facing <see cref="PersonaDossier"/> the prompt assembler consumes, so the same persona
/// carries the same voice every burst. Three moves: <b>refresh style</b> from the persona's own accruing
/// post history (the voice tracks how it has actually been writing, not just the seed dossier),
/// <b>select 2–3 recent posts</b> as exemplars (prior-post conditioning), and <b>fold the persona-type
/// behavior guidance</b> into the trusted voice notes (ADP-022). Cold start (no history) falls back to the
/// seed style and dossier alone — gracefully, never an error. Pure; exercise-scoped (XC-001).
/// </summary>
public static class VoiceProfileBuilder
{
    /// <summary>Default number of prior-post exemplars carried into the prompt (architecture §5.1: 2–3).</summary>
    public const int DefaultExemplarCount = 3;

    /// <summary>
    /// The style params to condition on: extracted from the persona's actual post history when it has any,
    /// else the seed style (cold start). This is what makes the voice track the exercise, not just the brief.
    /// </summary>
    public static PersonaStyle RefreshStyle(PersonaVoiceProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        return StyleAnalysis.Extract(profile.PostHistory) ?? profile.SeedStyle;
    }

    /// <summary>
    /// The most recent <paramref name="max"/> posts as voice exemplars (newest last in history → taken from
    /// the tail). Empty when the persona has no history — the cold-start case.
    /// </summary>
    public static IReadOnlyList<string> SelectExemplars(PersonaVoiceProfile profile, int max = DefaultExemplarCount)
    {
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentOutOfRangeException.ThrowIfNegative(max);

        var posts = profile.PostHistory.Where(p => !string.IsNullOrWhiteSpace(p)).ToList();
        if (posts.Count <= max)
        {
            return posts;
        }

        return posts.GetRange(posts.Count - max, max);
    }

    /// <summary>
    /// Projects the profile to the generation-facing <see cref="PersonaDossier"/>: refreshed style +
    /// prior-post exemplars + voice notes prefixed with the persona-type behavior guidance (ADP-022). The
    /// guidance lands in the <b>trusted</b> dossier context, never from untrusted world content (NFR-005).
    /// </summary>
    public static PersonaDossier ToDossier(
        PersonaVoiceProfile profile,
        int exemplarCount = DefaultExemplarCount,
        bool includeTypeGuidance = true)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var voiceNotes = profile.VoiceNotes.Trim();
        if (includeTypeGuidance)
        {
            var guidance = PersonaCasting.Guidance(profile.Type);
            voiceNotes = string.IsNullOrEmpty(voiceNotes) ? guidance : $"{guidance}. {voiceNotes}";
        }

        return new PersonaDossier
        {
            Handle = profile.Handle,
            DisplayName = profile.DisplayName,
            Type = profile.Type,
            VoiceNotes = voiceNotes,
            Style = RefreshStyle(profile),
            AudienceBand = profile.AudienceBand,
            RecentPosts = SelectExemplars(profile, exemplarCount),
        };
    }
}
