namespace Pulse.Core.Features.Ambient.Models;

/// <summary>
/// The FIXED server-side topic vocabulary ambient chatter may be seeded from (ambient-chatter story 01, AC1). A
/// controller chooses a subset per exercise; nothing outside this list is ever accepted, so a topic seed can never be
/// free text a caller typed (ADP-024: the seed reaches the trusted prompt, so it must be server-authored).
/// </summary>
/// <remarks>
/// Every entry is ordinary everyday life — deliberately nothing about weather, utilities, emergencies, officials or
/// any incident, so an ambient post reads as background, never as storyline content. Adding an entry is a reviewed
/// code change, never configuration.
/// </remarks>
public static class AmbientTopics
{
    /// <summary>Neighbourhood colour: local landmarks, small talk, what people are up to today.</summary>
    public const string LocalColor = "local-color";

    /// <summary>Everyday commuting gripes that have nothing to do with any incident.</summary>
    public const string TrafficMundane = "traffic-mundane";

    /// <summary>Food: cooking, restaurants, the bakery, the food truck.</summary>
    public const string Food = "food";

    /// <summary>Local and school sports.</summary>
    public const string Sports = "sports";

    /// <summary>Community events: markets, fundraisers, library programmes.</summary>
    public const string CommunityEvents = "community-events";

    /// <summary>Pets and animals.</summary>
    public const string Pets = "pets";

    /// <summary>Local businesses: openings, sales, favourite shops.</summary>
    public const string LocalBusiness = "local-business";

    /// <summary>Family and school life.</summary>
    public const string FamilySchool = "family-school";

    private static readonly Dictionary<string, string> Seeds = new(StringComparer.Ordinal)
    {
        [LocalColor] = "everyday neighbourhood life and small talk",
        [TrafficMundane] = "ordinary commuting and parking gripes",
        [Food] = "cooking, restaurants and local food spots",
        [Sports] = "local and school sports",
        [CommunityEvents] = "community markets, fundraisers and library programmes",
        [Pets] = "pets and animals",
        [LocalBusiness] = "local shops and businesses",
        [FamilySchool] = "family and school life",
    };

    /// <summary>The whole vocabulary, in a stable order (the order a settings panel lists them in).</summary>
    public static IReadOnlyList<string> Vocabulary { get; } =
    [
        LocalColor,
        TrafficMundane,
        Food,
        Sports,
        CommunityEvents,
        Pets,
        LocalBusiness,
        FamilySchool,
    ];

    /// <summary>Whether <paramref name="topic"/> is exactly one of the vocabulary keys (ordinal, lowercase).</summary>
    /// <param name="topic">The candidate key.</param>
    /// <returns><c>true</c> for a known key.</returns>
    public static bool IsKnown(string? topic) => topic is not null && Seeds.ContainsKey(topic);

    /// <summary>
    /// The server-authored phrase a topic key seeds the prompt with. Throws for an unknown key: a seed outside the
    /// vocabulary must never reach generation.
    /// </summary>
    /// <param name="topic">A vocabulary key.</param>
    /// <returns>The seed phrase.</returns>
    /// <exception cref="ArgumentException">The key is not in the vocabulary.</exception>
    public static string SeedPhrase(string topic) =>
        topic is not null && Seeds.TryGetValue(topic, out var phrase)
            ? phrase
            : throw new ArgumentException($"'{topic}' is not an ambient topic.", nameof(topic));
}
