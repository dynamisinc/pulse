namespace Pulse.Core.Features.PersonaVoice.Models;

using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The engine's owned model of a persona's voice (E8 architecture §5.1, ADP-020). The generation core's
/// <see cref="PersonaDossier"/> is the <i>projection</i> of this the prompt assembler consumes; this
/// feature owns the richer state and the logic that keeps one persona sounding like the same person all
/// exercise: the authored COR-020 voice notes, the seed style extracted at seed time, the persona type
/// and audience band, and — the consistency engine — the persona's own accumulating post history.
///
/// <para>Exercise-scoped (COR-001 / XC-001): <see cref="PostHistory"/> is <b>this exercise's</b> content
/// only. Prior-post conditioning never reaches across exercises — no cross-exercise history leaks
/// (NFR-005 / XC-001). Staff/backend; no participant surface.</para>
/// </summary>
public sealed record PersonaVoiceProfile
{
    /// <summary>The exercise this profile belongs to. All conditioning stays within it (XC-001).</summary>
    public required Guid ExerciseId { get; init; }

    /// <summary>The persona's handle, e.g. "@rivertownmom".</summary>
    public required string Handle { get; init; }

    /// <summary>Display name shown on the participant surface.</summary>
    public required string DisplayName { get; init; }

    /// <summary>Persona type — governs behavior (ADP-022, story 03).</summary>
    public required PersonaType Type { get; init; }

    /// <summary>Authored COR-020 voice/personality notes (the human-written character brief).</summary>
    public string VoiceNotes { get; init; } = string.Empty;

    /// <summary>
    /// Style params extracted from the dossier at <b>seed</b> time — the cold-start voice before the
    /// persona has posted anything this exercise. Refreshed from <see cref="PostHistory"/> as it accrues.
    /// </summary>
    public PersonaStyle SeedStyle { get; init; } = new();

    /// <summary>Audience magnitude band (SOC-054) — stature + amplification reach.</summary>
    public int AudienceBand { get; init; }

    /// <summary>
    /// The persona's own posts <b>this exercise</b>, oldest → newest. Drives style refresh and prior-post
    /// exemplars (ADP-020). Empty on a cold start — the seed style + dossier alone then carry the voice.
    /// </summary>
    public IReadOnlyList<string> PostHistory { get; init; } = [];
}
