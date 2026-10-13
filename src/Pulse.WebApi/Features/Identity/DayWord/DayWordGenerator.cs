namespace Pulse.WebApi.Features.Identity.DayWord;

using System.Globalization;
using System.Security.Cryptography;

/// <summary>
/// Generates the day word staff get when they do not type one (easy-login story 05, EL-9): <c>adjective-noun-NN</c>,
/// lower-case (e.g. <c>brisk-otter-42</c>), drawn from two curated lists of short, common words that are read aloud
/// to a room and typed on a phone. Modelled on <c>SharedCredentialPasswordGenerator</c>: every draw uses
/// <see cref="RandomNumberGenerator.GetInt32(int, int)"/> (cryptographically secure, unbiased), never
/// <see cref="Random"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Curated for the room.</b> Every word is lower-case ASCII letters only (so the normalised form is simply the word
/// without its hyphens), at least four letters, spelled the same in US and UK English, and not a common homophone
/// (no <c>blue/blew</c>, <c>bear/bare</c>, <c>sail/sale</c>). Nothing alarming is on either list: a word overheard in
/// an emergency-management exercise must never sound like an inject (no <c>fire</c>, <c>flood</c>, <c>storm</c>). The
/// number is 10 to 99, so it is always two spoken digits and never starts with "oh".
/// </para>
/// <para>
/// <b>Strength.</b> About 230,000 combinations (50 × 51 × 90, ~17.8 bits). That is deliberately a readable word, not a
/// password: the controls that make it tolerable are the per-IP limiter, the one-day life, one-click rotation and the
/// word-before-name verification (story 05 context). The plaintext is returned to staff once and only ever stored as
/// an <c>ISharedCredentialHasher</c> hash of its normalised form.
/// </para>
/// </remarks>
public static class DayWordGenerator
{
    /// <summary>The smallest two-digit suffix (inclusive).</summary>
    public const int MinNumber = 10;

    /// <summary>The largest two-digit suffix (inclusive).</summary>
    public const int MaxNumber = 99;

    /// <summary>The adjective list (first part).</summary>
    public static IReadOnlyList<string> Adjectives { get; } =
    [
        "amber", "brave", "breezy", "bright", "brisk", "calm", "cheerful", "clever", "crisp", "dapper",
        "eager", "early", "fancy", "frosty", "gentle", "giant", "glad", "golden", "grand", "happy",
        "jolly", "jumbo", "kind", "lively", "lucky", "mighty", "misty", "modest", "nimble", "noble",
        "plucky", "polite", "proud", "quick", "rapid", "rosy", "rustic", "sandy", "silver", "smooth",
        "snowy", "spry", "steady", "sturdy", "swift", "tidy", "upbeat", "vivid", "witty", "zesty",
    ];

    /// <summary>The noun list (second part).</summary>
    public static IReadOnlyList<string> Nouns { get; } =
    [
        "acorn", "anchor", "apple", "badger", "banjo", "beacon", "bison", "button", "cactus", "camel",
        "candle", "canyon", "cedar", "comet", "compass", "copper", "cricket", "dolphin", "falcon", "garden",
        "ginger", "hammock", "jacket", "kettle", "lantern", "lemon", "magnet", "maple", "meadow", "mitten",
        "muffin", "orchard", "otter", "panda", "parrot", "pebble", "pepper", "piano", "pickle", "pillow",
        "pocket", "rabbit", "ribbon", "saddle", "tiger", "tulip", "turtle", "violin", "walnut", "wombat",
        "zebra",
    ];

    /// <summary>Produces a fresh <c>adjective-noun-NN</c> word. The caller hashes it and shows the plaintext once.</summary>
    /// <returns>A new word, e.g. <c>brisk-otter-42</c>.</returns>
    public static string Generate()
    {
        var adjective = Adjectives[RandomNumberGenerator.GetInt32(Adjectives.Count)];
        var noun = Nouns[RandomNumberGenerator.GetInt32(Nouns.Count)];
        var number = RandomNumberGenerator.GetInt32(MinNumber, MaxNumber + 1);

        return adjective + "-" + noun + "-" + number.ToString(CultureInfo.InvariantCulture);
    }
}
