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
/// <b>Strength.</b> 3.6 million combinations (200 × 200 × 90, ~21.8 bits; widened at Gate-1 S-1). That is deliberately
/// a readable word, not a password: the controls that make it tolerable are the per-IP limiter, the one-day life,
/// one-click rotation and the word-before-name verification (story 05 context). The plaintext is returned to staff once and only ever stored as
/// an <c>ISharedCredentialHasher</c> hash of its normalised form.
/// </para>
/// </remarks>
public static class DayWordGenerator
{
    /// <summary>The smallest two-digit suffix (inclusive).</summary>
    public const int MinNumber = 10;

    /// <summary>The largest two-digit suffix (inclusive).</summary>
    public const int MaxNumber = 99;

    /// <summary>The adjective list (first part): 200 words, alphabetical.</summary>
    public static IReadOnlyList<string> Adjectives { get; } =
    [
        "agile", "amber", "ample", "amused", "artful", "avid", "awake", "balmy", "bouncy", "brainy", "brave", "breezy",
        "bright", "brisk", "bubbly", "bumpy", "busy", "calm", "candid", "careful", "caring", "casual", "cheerful",
        "cheery", "chirpy", "classic", "clean", "clever", "cloudy", "comfy", "cool", "cosmic", "crafty", "creamy",
        "crisp", "crunchy", "cuddly", "curious", "curly", "dainty", "dandy", "dapper", "daring", "dazzling", "dreamy",
        "dusty", "eager", "early", "easy", "elegant", "epic", "expert", "famous", "fancy", "fearless", "festive",
        "fizzy", "flashy", "fluffy", "fond", "frank", "fresh", "friendly", "frosty", "funny", "fuzzy", "gentle",
        "giant", "giddy", "gifted", "glad", "gleeful", "glossy", "glowing", "golden", "graceful", "grand", "grassy",
        "handy", "happy", "hardy", "hearty", "helpful", "honest", "hopeful", "humble", "jaunty", "jazzy", "jolly",
        "joyful", "jumbo", "keen", "kind", "kindly", "leafy", "limber", "lively", "lofty", "loyal", "lucid", "lucky",
        "lunar", "lush", "mellow", "mighty", "mild", "minty", "misty", "modest", "mossy", "muddy", "musical", "neat",
        "nifty", "nimble", "noble", "peaceful", "peppy", "perky", "placid", "playful", "plucky", "plush", "polar",
        "polite", "precise", "pretty", "proud", "quick", "quirky", "radiant", "rapid", "ready", "regal", "robust",
        "rocky", "rosy", "royal", "rugged", "rustic", "rusty", "sandy", "savvy", "serene", "shiny", "silky", "silly",
        "silver", "simple", "sleek", "sleepy", "slick", "smart", "smooth", "snappy", "snowy", "snug", "soft", "solar",
        "solid", "speedy", "spicy", "sporty", "spry", "stable", "stately", "steady", "sturdy", "stylish", "subtle",
        "sunlit", "superb", "swift", "tall", "tangy", "tender", "tidy", "tiny", "tough", "tranquil", "trendy",
        "trusty", "tuneful", "upbeat", "useful", "valiant", "velvet", "vibrant", "vital", "vivid", "warm", "wavy",
        "wise", "witty", "worthy", "young", "youthful", "zany", "zesty", "zippy",
    ];

    /// <summary>The noun list (second part): 200 words, alphabetical.</summary>
    public static IReadOnlyList<string> Nouns { get; } =
    [
        "acorn", "almond", "anchor", "apple", "badger", "bagel", "balloon", "bamboo", "banana", "banjo", "basket",
        "beaver", "bench", "bison", "blanket", "bottle", "boulder", "bridge", "broom", "bucket", "buffalo", "bunny",
        "butter", "button", "cabin", "cactus", "camel", "camera", "canary", "candle", "canoe", "canyon", "castle",
        "cedar", "cello", "chair", "cheetah", "cherry", "circus", "clock", "clover", "coconut", "comet", "compass",
        "cookie", "copper", "coral", "cotton", "cougar", "crayon", "cricket", "crown", "crystal", "cupcake", "daisy",
        "diamond", "dolphin", "donkey", "dragon", "drum", "eagle", "falcon", "feather", "finch", "flamingo", "flute",
        "forest", "fountain", "frog", "garden", "garlic", "gecko", "ginger", "giraffe", "globe", "goose", "grape",
        "guitar", "hammock", "hamster", "harp", "helmet", "heron", "hill", "hippo", "honey", "husky", "jacket",
        "jaguar", "jelly", "jungle", "kayak", "kettle", "kite", "kitten", "kiwi", "koala", "ladder", "lake", "lamp",
        "lantern", "lemon", "lily", "lime", "lion", "lizard", "lobster", "lotus", "magnet", "mango", "maple", "marble",
        "meadow", "melon", "mirror", "mitten", "monkey", "muffin", "mushroom", "noodle", "ocean", "olive", "onion",
        "orange", "orca", "orchard", "orchid", "otter", "oyster", "paddle", "pancake", "panda", "panther", "parrot",
        "pasta", "peach", "peacock", "peanut", "pebble", "pelican", "penguin", "pepper", "piano", "pickle", "pigeon",
        "pillow", "planet", "pocket", "pond", "pony", "poppy", "potato", "puffin", "pumpkin", "puppy", "puzzle",
        "quail", "quilt", "rabbit", "raccoon", "raven", "ribbon", "river", "robin", "saddle", "salad", "scarf",
        "scooter", "shell", "sloth", "snail", "sparrow", "spoon", "stone", "stork", "swan", "table", "teapot", "tiger",
        "toast", "tomato", "toucan", "tractor", "trail", "trumpet", "tulip", "tunnel", "turnip", "turtle", "valley",
        "violin", "waffle", "wagon", "walnut", "walrus", "willow", "window", "wombat", "zebra", "zipper",
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
