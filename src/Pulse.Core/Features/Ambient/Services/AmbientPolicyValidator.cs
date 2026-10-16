namespace Pulse.Core.Features.Ambient.Services;

using Pulse.Core.Features.Ambient.Models;

/// <summary>
/// The wire literals for <see cref="AmbientPolicyMode"/> (<c>off</c> / <c>review</c> / <c>autonomous</c>) and their
/// strict parse. An explicit hand-maintained map, so a later enum rename can never silently shift a literal.
/// </summary>
public static class AmbientPolicyModes
{
    private static readonly Dictionary<AmbientPolicyMode, string> ToWire = new()
    {
        [AmbientPolicyMode.Off] = "off",
        [AmbientPolicyMode.Review] = "review",
        [AmbientPolicyMode.Autonomous] = "autonomous",
    };

    /// <summary>The exhaustive mode → wire-literal map.</summary>
    public static IReadOnlyDictionary<AmbientPolicyMode, string> Wire => ToWire;

    /// <summary>The wire literal for <paramref name="mode"/> (<c>off</c> for anything unmapped — fail safe).</summary>
    /// <param name="mode">The mode.</param>
    /// <returns>The literal.</returns>
    public static string ToLiteral(AmbientPolicyMode mode) =>
        ToWire.TryGetValue(mode, out var wire) ? wire : ToWire[AmbientPolicyMode.Off];

    /// <summary>Parses a client literal; false for anything outside <c>{off, review, autonomous}</c>.</summary>
    /// <param name="raw">The raw literal (exact, lowercase).</param>
    /// <param name="mode">The parsed mode.</param>
    /// <returns><c>true</c> for a known literal.</returns>
    public static bool TryParse(string? raw, out AmbientPolicyMode mode)
    {
        switch (raw)
        {
            case "off":
                mode = AmbientPolicyMode.Off;
                return true;
            case "review":
                mode = AmbientPolicyMode.Review;
                return true;
            case "autonomous":
                mode = AmbientPolicyMode.Autonomous;
                return true;
            default:
                mode = AmbientPolicyMode.Off;
                return false;
        }
    }
}

/// <summary>
/// The pure, I/O-free half of the ambient-policy validation (ambient-chatter story 01, AC0/AC1). Everything that can
/// be checked without the database is checked here; the one remaining rule — every persona id is a persona of THIS
/// exercise — needs the exercise's persona set and is applied by the caller over <see cref="AmbientPolicyDraft.PersonaIds"/>.
/// </summary>
public static class AmbientPolicyValidator
{
    /// <summary>The 400 message for <c>autonomous</c> while the governed flag is off (AC0). Pinned by test.</summary>
    public const string AutonomousNotAuthorizedMessage =
        "mode 'autonomous' is not authorized by PROVIDER-GOVERNANCE §8 "
        + "(Generation:Governance:AmbientAutonomyAuthorized is false); 'off' and 'review' are allowed.";

    /// <summary>The most persona ids one policy may name (a sanity bound on the request, not a product limit).</summary>
    public const int MaxPersonaAllowListLength = 500;

    /// <summary>
    /// Validates a requested policy. Rejects (never clamps): an unknown mode; <c>autonomous</c> when
    /// <paramref name="autonomyAuthorized"/> is false; a missing or negative cap; <c>maxPerMinute</c> above
    /// <paramref name="maxEnginePostsPerMinute"/>; <c>maxPerHour</c> above 60 × that global cap; a topic outside
    /// <see cref="AmbientTopics.Vocabulary"/>; a persona id that is not a GUID. Missing allow-lists are EMPTY
    /// (nothing allowed). Duplicates collapse, first occurrence kept.
    /// </summary>
    /// <param name="mode">The requested mode literal.</param>
    /// <param name="maxPerMinute">The requested per-minute cap.</param>
    /// <param name="maxPerHour">The requested per-hour cap.</param>
    /// <param name="topicAllowList">The requested topic keys, or <c>null</c> (= none).</param>
    /// <param name="personaAllowList">The requested persona ids as strings, or <c>null</c> (= none).</param>
    /// <param name="maxEnginePostsPerMinute">The exercise's global engine cap (ADP-011).</param>
    /// <param name="autonomyAuthorized">The governed <c>Generation:Governance:AmbientAutonomyAuthorized</c> flag.</param>
    /// <returns>The validated draft, or the validation error.</returns>
    public static AmbientPolicyValidation Validate(
        string? mode,
        int? maxPerMinute,
        int? maxPerHour,
        IReadOnlyList<string>? topicAllowList,
        IReadOnlyList<string>? personaAllowList,
        int maxEnginePostsPerMinute,
        bool autonomyAuthorized)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxEnginePostsPerMinute, 1);

        if (!AmbientPolicyModes.TryParse(mode, out var parsedMode))
        {
            return AmbientPolicyValidation.Invalid("mode must be one of 'off', 'review' or 'autonomous'.");
        }

        if (parsedMode == AmbientPolicyMode.Autonomous && !autonomyAuthorized)
        {
            return AmbientPolicyValidation.Invalid(AutonomousNotAuthorizedMessage);
        }

        if (maxPerMinute is not { } perMinute || perMinute < 0)
        {
            return AmbientPolicyValidation.Invalid("maxPerMinute is required and must be 0 or more.");
        }

        if (perMinute > maxEnginePostsPerMinute)
        {
            return AmbientPolicyValidation.Invalid(
                $"maxPerMinute ({perMinute}) may not exceed this exercise's MaxEnginePostsPerMinute ({maxEnginePostsPerMinute}).");
        }

        var hourCeiling = maxEnginePostsPerMinute * 60;
        if (maxPerHour is not { } perHour || perHour < 0)
        {
            return AmbientPolicyValidation.Invalid("maxPerHour is required and must be 0 or more.");
        }

        if (perHour > hourCeiling)
        {
            return AmbientPolicyValidation.Invalid(
                $"maxPerHour ({perHour}) may not exceed 60 x MaxEnginePostsPerMinute ({hourCeiling}).");
        }

        var topics = new List<string>();
        foreach (var topic in topicAllowList ?? [])
        {
            if (!AmbientTopics.IsKnown(topic))
            {
                return AmbientPolicyValidation.Invalid(
                    $"topic '{topic}' is not in the ambient vocabulary ({string.Join(", ", AmbientTopics.Vocabulary)}).");
            }

            if (!topics.Contains(topic, StringComparer.Ordinal))
            {
                topics.Add(topic);
            }
        }

        var personas = new List<Guid>();
        var rawPersonas = personaAllowList ?? [];
        if (rawPersonas.Count > MaxPersonaAllowListLength)
        {
            return AmbientPolicyValidation.Invalid(
                $"personaAllowList may name at most {MaxPersonaAllowListLength} personas.");
        }

        foreach (var raw in rawPersonas)
        {
            if (!Guid.TryParse(raw, out var personaId) || personaId == Guid.Empty)
            {
                return AmbientPolicyValidation.Invalid($"persona '{raw}' is not a valid persona id.");
            }

            if (!personas.Contains(personaId))
            {
                personas.Add(personaId);
            }
        }

        return AmbientPolicyValidation.Valid(new AmbientPolicyDraft(parsedMode, perMinute, perHour, topics, personas));
    }
}

/// <summary>A policy that passed <see cref="AmbientPolicyValidator.Validate"/>; persona membership still to check.</summary>
/// <param name="Mode">The parsed mode.</param>
/// <param name="MaxPerMinute">The per-minute cap.</param>
/// <param name="MaxPerHour">The per-hour cap.</param>
/// <param name="Topics">The de-duplicated topic keys (all in the vocabulary).</param>
/// <param name="PersonaIds">The de-duplicated persona ids (still to be checked against THIS exercise).</param>
public sealed record AmbientPolicyDraft(
    AmbientPolicyMode Mode,
    int MaxPerMinute,
    int MaxPerHour,
    IReadOnlyList<string> Topics,
    IReadOnlyList<Guid> PersonaIds)
{
    /// <summary>Builds the immutable policy, attributed to <paramref name="setBy"/> (COR-018).</summary>
    /// <param name="setBy">The controller setting it.</param>
    /// <returns>The policy.</returns>
    public AmbientTierPolicy ToPolicy(string setBy) => new()
    {
        Mode = Mode,
        MaxPerMinute = MaxPerMinute,
        MaxPerHour = MaxPerHour,
        TopicAllowList = Topics,
        PersonaAllowList = PersonaIds,
        SetBy = setBy,
    };
}

/// <summary>The outcome of <see cref="AmbientPolicyValidator.Validate"/>.</summary>
public sealed class AmbientPolicyValidation
{
    private AmbientPolicyValidation(AmbientPolicyDraft? draft, string? error)
    {
        Draft = draft;
        Error = error;
    }

    /// <summary>The validated draft, or <c>null</c> when invalid.</summary>
    public AmbientPolicyDraft? Draft { get; }

    /// <summary>The validation message, or <c>null</c> when valid.</summary>
    public string? Error { get; }

    /// <summary>Whether the request passed.</summary>
    public bool IsValid => Draft is not null;

    /// <summary>A valid result.</summary>
    /// <param name="draft">The draft.</param>
    /// <returns>The result.</returns>
    public static AmbientPolicyValidation Valid(AmbientPolicyDraft draft) => new(draft, null);

    /// <summary>An invalid result (400).</summary>
    /// <param name="error">The message.</param>
    /// <returns>The result.</returns>
    public static AmbientPolicyValidation Invalid(string error) => new(null, error);
}
