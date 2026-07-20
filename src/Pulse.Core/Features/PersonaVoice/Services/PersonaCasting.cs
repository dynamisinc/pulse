namespace Pulse.Core.Features.PersonaVoice.Services;

using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;

/// <summary>
/// Persona-type behavior + bad-actor gating (ADP-022, E8 architecture §5.2). Two pure concerns:
/// <list type="bullet">
///   <item><b>Behavior guidance</b> — a short, trusted instruction per <see cref="PersonaType"/> that
///   shapes how that persona acts (outlets sensationalize within bounds, agencies stay procedural, helpers
///   correct, trolls antagonize in-world, businesses stay practical). It is folded into the persona's
///   trusted dossier context (never sourced from untrusted world content, NFR-005) and always reasserts the
///   fiction guard so even a troll antagonizes in-world without breaking fiction or turning abusive.</item>
///   <item><b>Bad-actor gating</b> — troll/bot personas participate <i>only</i> when the storyline or
///   scenario enables bad actors; a scenario without an antagonist never spontaneously grows one.</item>
/// </list>
/// </summary>
public static class PersonaCasting
{
    /// <summary>Whether a persona type is a bad actor gated behind scenario enablement (troll / bot).</summary>
    public static bool IsBadActor(PersonaType type) => type is PersonaType.Troll or PersonaType.Bot;

    /// <summary>
    /// The trusted behavior guidance for a persona type (ADP-022). Every line ends inside the fiction — a
    /// troll is provocative <i>in-world</i>; it never breaks fiction, uses slurs, or threatens violence
    /// (ADP-023 is reasserted for the adversarial types).
    /// </summary>
    public static string Guidance(PersonaType type) => type switch
    {
        PersonaType.Resident => "an ordinary local resident reacting personally and informally to what's happening to them and their neighbourhood",
        PersonaType.Outlet => "a local news outlet: report developments in a headline-forward voice and chase the story, sensationalising within bounds but never fabricating facts",
        PersonaType.Agency => "an official-adjacent agency account: measured, procedural, factual, cautious about anything unconfirmed",
        PersonaType.Helper => "a helpful community member: correct rumours, point people to reliable information, calm and reassure without dismissing real concern",
        PersonaType.Troll => "an antagonist stirring the pot in-world: provocative, skeptical, needling officials — but strictly in-character; never break fiction, never use slurs, never threaten violence",
        PersonaType.Bot => "a low-effort automated-looking account: short, repetitive, boosting a line — spammy in-world, but never breaking fiction",
        _ => "a member of the public reacting to the situation",
    };

    /// <summary>
    /// The cast eligible to voice a burst: every candidate except bad actors, which are included only when
    /// <paramref name="badActorsEnabled"/> is set for the storyline/scenario. Order is preserved.
    /// </summary>
    public static IReadOnlyList<PersonaVoiceProfile> EligibleCast(
        IEnumerable<PersonaVoiceProfile> candidates,
        bool badActorsEnabled)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        return [.. candidates.Where(p => badActorsEnabled || !IsBadActor(p.Type))];
    }
}
