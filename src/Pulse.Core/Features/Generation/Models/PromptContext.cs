namespace Pulse.Core.Features.Generation.Models;

/// <summary>
/// Persona type governs behavior (ADP-022): outlets sensationalize within bounds, agencies stay
/// procedural, helpers correct rumors, trolls/bots antagonize. Bad-actor types participate only when
/// the scenario enables them — a gate enforced upstream, not here.
/// </summary>
public enum PersonaType
{
    Resident,
    Outlet,
    Agency,
    Helper,
    Troll,
    Bot,
}

/// <summary>
/// Style parameters that keep a single persona's voice consistent across an exercise (ADP-020),
/// extracted from the COR-020 dossier and refreshed from the persona's real post history.
/// </summary>
public sealed record PersonaStyle
{
    public int AvgLength { get; init; } = 120;
    public double EmojiRate { get; init; }
    public double HashtagRate { get; init; }

    /// <summary>Casing habit: "normal", "lower", or "SHOUTY".</summary>
    public string CapsConvention { get; init; } = "normal";
}

/// <summary>
/// A persona's generation-facing dossier: COR-020 voice notes + style params + a few prior-post
/// exemplars (prior-post conditioning) + audience magnitude (SOC-054). The richer domain model is
/// owned by <c>persona-voice-engine</c>; this is the projection the prompt assembler consumes.
/// </summary>
public sealed record PersonaDossier
{
    public required string Handle { get; init; }
    public required string DisplayName { get; init; }
    public required PersonaType Type { get; init; }
    public string VoiceNotes { get; init; } = string.Empty;
    public PersonaStyle Style { get; init; } = new();

    /// <summary>Audience magnitude band (SOC-054) — shapes amplification reach, informs the model of stature.</summary>
    public int AudienceBand { get; init; }

    /// <summary>2–3 of the persona's own recent posts, used as voice exemplars.</summary>
    public IReadOnlyList<string> RecentPosts { get; init; } = [];
}

/// <summary>Desired emotional mix for a burst (fractions, roughly summing to 1). Bent by the storyline phase.</summary>
public sealed record ToneMix
{
    public double Worry { get; init; }
    public double Anger { get; init; }
    public double Speculation { get; init; }
    public double Gratitude { get; init; }
    public double Skepticism { get; init; }
    public double Calm { get; init; }
}

/// <summary>
/// The generation-facing projection of a storyline (§1.1). The full state machine is owned by
/// <c>storyline-model</c>; the assembler needs only what shapes a burst.
/// </summary>
public sealed record StorylineBrief
{
    public required string Title { get; init; }

    /// <summary>What official action would address this — the silence test (ADP-001).</summary>
    public required string Expectation { get; init; }

    /// <summary>Scenario minutes since any qualifying official response (COR-050/051). Drives escalation.</summary>
    public int MinutesSinceLastOfficialResponse { get; init; }

    /// <summary>Intensity 0–100 (§1.1 canonical scale).</summary>
    public int Intensity { get; init; }

    public string Phase { get; init; } = "ESCALATING";
    public ToneMix ToneMix { get; init; } = new();
    public IReadOnlyList<string> Hashtags { get; init; } = [];
}

/// <summary>
/// An untrusted world/participant post the engine reacts to. Its <see cref="Text"/> is DATA, never
/// instructions (ADP-024) — it enters the prompt only through the fenced world feed.
/// </summary>
public sealed record WorldPost(string AuthorHandle, string Text);

/// <summary>Everything the prompt assembler needs to turn a storyline into one persona-voiced burst.</summary>
public sealed record PromptAssemblyInput
{
    public required Guid ExerciseId { get; init; }

    /// <summary>The fictional world + scenario date/time. Trusted engine context.</summary>
    public required string ExerciseBrief { get; init; }

    public required StorylineBrief Storyline { get; init; }

    /// <summary>The cast eligible to voice this burst (one post each — burst-in-one-call drives diversity, §5.2).</summary>
    public required IReadOnlyList<PersonaDossier> Personas { get; init; }

    /// <summary>Recent world/participant posts relevant to the storyline. Untrusted.</summary>
    public IReadOnlyList<WorldPost> WorldPosts { get; init; } = [];

    public required GenerationTier Tier { get; init; }
}
