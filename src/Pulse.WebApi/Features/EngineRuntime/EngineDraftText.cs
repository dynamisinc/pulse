namespace Pulse.WebApi.Features.EngineRuntime;

using System;
using System.Globalization;
using System.Text;
using Pulse.WebApi.Features.Social;

/// <summary>
/// Bounds GENERATED draft text to what the single post-ingest funnel will accept (Wave 3 Gate-2 M-1), so a
/// long-winded model can never produce a review item whose publish is refused. Applied once, where the reaction
/// loop turns a generated burst into a review item; a human edit is never passed through here (an over-long edit
/// is refused with a 400 instead, never silently cut).
/// </summary>
/// <remarks>
/// <para>
/// Ingest refuses text whose SANITIZED length exceeds <see cref="PostIngestService.TextLengthCeiling"/> (and raw
/// text over <see cref="PostIngestService.MaxRawTextLength"/>). Model output that fits both is kept verbatim, as
/// before: ingest sanitizes it on publish. Output that does not fit is sanitized here, cut, and given a trailing
/// ellipsis, so the length that ingest measures is the length bounded here.
/// </para>
/// <para>
/// The cut never splits a user-perceived character: it falls on an extended grapheme cluster boundary
/// (<see cref="StringInfo"/>), so a surrogate pair, an emoji ZWJ sequence or a base letter with its combining
/// marks stays whole. It prefers the last word break within <see cref="WordBreakWindow"/> characters of the
/// limit. A single cluster longer than the whole budget (pathological combining-mark runs) falls back to the last
/// whole code point, which still never leaves a lone surrogate.
/// </para>
/// </remarks>
public static class EngineDraftText
{
    /// <summary>The marker appended to a cut draft (U+2026 HORIZONTAL ELLIPSIS, one UTF-16 code unit).</summary>
    public const string Ellipsis = "…";

    /// <summary>How far back from the limit a word break is preferred over a mid-word cut, in UTF-16 code units.</summary>
    public const int WordBreakWindow = 200;

    /// <summary>
    /// Returns <paramref name="text"/> unchanged when ingest would accept it, otherwise a sanitized, cut copy whose
    /// length (sanitized again by ingest, which changes nothing) is at most
    /// <see cref="PostIngestService.TextLengthCeiling"/> and which ends with <see cref="Ellipsis"/>.
    /// </summary>
    /// <param name="text">The generated draft text.</param>
    /// <returns>Text that the post-ingest funnel accepts on length.</returns>
    public static string FitToCeiling(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        // The common case: the model kept to a short post. Keep it verbatim (ingest sanitizes on publish). The raw
        // length is checked first; within that, the sanitizer is linear and cheap.
        if (text.Length <= PostIngestService.MaxRawTextLength
            && PostSanitizer.Sanitize(text).Length <= PostIngestService.TextLengthCeiling)
        {
            return text;
        }

        // Measure on what ingest would store. The sanitizer only removes characters, so this is no longer than the
        // input, and it is a fixed point: ingest's own pass over the result below changes nothing.
        var sanitized = PostSanitizer.Sanitize(text);
        if (sanitized.Length <= PostIngestService.TextLengthCeiling)
        {
            // Over the RAW cap only (mostly markup): the stripped text already fits.
            return sanitized;
        }

        var budget = PostIngestService.TextLengthCeiling - Ellipsis.Length;
        var cut = CutIndex(sanitized, budget);
        var head = sanitized[..cut].TrimEnd();

        // A prefix of tag-free text plus an ellipsis is still tag-free, so this pass is a no-op in practice; it is
        // kept so the bound below holds whatever the sanitizer's rules become. It can only shorten the text.
        return PostSanitizer.Sanitize(head + Ellipsis);
    }

    /// <summary>
    /// The index to cut <paramref name="text"/> at so the head is at most <paramref name="budget"/> code units: the
    /// last word break within <see cref="WordBreakWindow"/> of the limit, else the last grapheme boundary, else (one
    /// cluster longer than the budget) the last code point boundary.
    /// </summary>
    private static int CutIndex(string text, int budget)
    {
        var lastBoundary = 0;
        var lastWordBreak = -1;
        var index = 0;
        while (index < text.Length)
        {
            var length = StringInfo.GetNextTextElementLength(text, index);
            if (index + length > budget)
            {
                // The cluster starting here does not fit; `index` is a boundary that does.
                lastBoundary = index;
                if (char.IsWhiteSpace(text[index]))
                {
                    lastWordBreak = index;
                }

                break;
            }

            if (char.IsWhiteSpace(text[index]))
            {
                lastWordBreak = index;
            }

            index += length;
            lastBoundary = index;
        }

        if (lastWordBreak > 0 && lastWordBreak >= lastBoundary - WordBreakWindow)
        {
            return lastWordBreak;
        }

        return lastBoundary > 0 ? lastBoundary : LastRuneBoundary(text, budget);
    }

    /// <summary>The last code point boundary at or before <paramref name="budget"/> — never between a surrogate pair.</summary>
    private static int LastRuneBoundary(string text, int budget)
    {
        var index = 0;
        while (index < text.Length)
        {
            // A lone surrogate already in the input decodes as invalid and is consumed as one unit.
            _ = Rune.DecodeFromUtf16(text.AsSpan(index), out _, out var consumed);
            if (index + consumed > budget)
            {
                break;
            }

            index += consumed;
        }

        return index;
    }
}
