namespace Pulse.Core.Features.PersonaVoice.Services;

using System.Globalization;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// Pure, deterministic text-style heuristics shared by voice extraction (<see cref="VoiceProfileBuilder"/>)
/// and the conformance check (<see cref="StyleConformance"/>): emoji-per-post, hashtags-per-post, average
/// length, and caps convention. Heuristics, not linguistics — good enough to keep a persona recognisably
/// itself and to catch a post that drifts off its established voice (ADP-020, §5.1). No I/O; identical in
/// the pre-review gate and in CI regression.
/// </summary>
internal static class StyleAnalysis
{
    /// <summary>Casing labels, matching <see cref="PersonaStyle.CapsConvention"/>.</summary>
    internal const string Normal = "normal";
    internal const string Lower = "lower";
    internal const string Shouty = "SHOUTY";

    /// <summary>Emoji count in one post (a heuristic over common emoji Unicode ranges).</summary>
    public static int EmojiCount(string text)
    {
        var count = 0;
        foreach (var rune in text.EnumerateRunes())
        {
            if (IsEmoji(rune.Value))
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>Hashtag count in one post — a '#' immediately followed by a letter or digit.</summary>
    public static int HashtagCount(string text)
    {
        var count = 0;
        for (var i = 0; i < text.Length - 1; i++)
        {
            if (text[i] == '#' && (char.IsLetterOrDigit(text[i + 1])))
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>Classifies one post's casing: SHOUTY (mostly caps), lower (no caps), or normal.</summary>
    public static string CapsOf(string text)
    {
        var upper = 0;
        var letters = 0;
        foreach (var ch in text)
        {
            if (char.IsLetter(ch))
            {
                letters++;
                if (char.IsUpper(ch))
                {
                    upper++;
                }
            }
        }

        if (letters < 4)
        {
            return Normal; // too short to judge
        }

        var upperRatio = (double)upper / letters;
        if (upperRatio > 0.6)
        {
            return Shouty;
        }

        return upper == 0 ? Lower : Normal;
    }

    /// <summary>
    /// Extracts style params over a set of posts (avg length, avg emoji/post, avg hashtags/post, and the
    /// dominant caps convention). Returns null when there are no posts to measure — the caller falls back
    /// to the seed style (cold start).
    /// </summary>
    public static PersonaStyle? Extract(IReadOnlyList<string> posts)
    {
        var measured = posts.Where(p => !string.IsNullOrWhiteSpace(p)).ToList();
        if (measured.Count == 0)
        {
            return null;
        }

        var avgLength = (int)Math.Round(measured.Average(p => p.Length));
        var emojiRate = measured.Average(p => (double)EmojiCount(p));
        var hashtagRate = measured.Average(p => (double)HashtagCount(p));

        // Dominant caps convention: the most common per-post classification, ties → normal.
        var caps = measured.GroupBy(CapsOf)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key == Normal ? 0 : 1)
            .First().Key;

        return new PersonaStyle
        {
            AvgLength = avgLength,
            EmojiRate = Math.Round(emojiRate, 2),
            HashtagRate = Math.Round(hashtagRate, 2),
            CapsConvention = caps,
        };
    }

    private static bool IsEmoji(int cp) =>
        cp is (>= 0x1F000 and <= 0x1FAFF) // astral emoji (emoticons, symbols, pictographs, supplemental)
            or (>= 0x2600 and <= 0x27BF)  // misc symbols + dingbats
            or (>= 0x2B00 and <= 0x2BFF)  // misc symbols and arrows
            or (>= 0x2300 and <= 0x23FF); // misc technical (⏰ ⌛ …)

    /// <summary>Formats a per-post rate for messages, invariant.</summary>
    public static string Rate(double value) => value.ToString("0.0", CultureInfo.InvariantCulture);
}
