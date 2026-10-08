namespace Pulse.WebApi.Features.Social;

using System.Globalization;

/// <summary>
/// Server-side free-text sanitizer for the post ingest path (NFR-004) — the server-side counterpart of the frontend
/// <c>features/social/services/sanitize.ts</c>. It guards against STORED XSS: a caller types/pastes raw
/// HTML (<c>&lt;script&gt;…&lt;/script&gt;</c>, <c>&lt;img onerror=…&gt;</c>, a
/// <c>&lt;a href="javascript:…"&gt;</c>) that some later surface renders.
/// </summary>
/// <remarks>
/// <para>
/// <b>Strip, never encode.</b> Like <c>sanitize.ts</c> (see its lines ~41-45), this STRIPS markup and
/// deliberately does NOT HTML-entity-encode: the participant render path is a React text node
/// (<c>{post.text}</c>) that already escapes <c>&amp; &lt; &gt; " '</c> at render, so entity-encoding here
/// would DOUBLE-encode ordinary text (<c>don't</c> → <c>don&amp;#39;t</c>) and break the fiction — the
/// cardinal rule. Stripping keeps the author's literal <c>&amp; " '</c> and stray <c>&lt;</c>/<c>&gt;</c>
/// while removing anything that could parse as executable markup in a non-React consumer too (an AAR export,
/// a console replay), so a stored script can execute NOWHERE (NFR-004).
/// </para>
/// <para>
/// A pure static function with no dependencies — it needs no DI registration; each ingest boundary calls it
/// directly.
/// </para>
/// </remarks>
public static class PostSanitizer
{
    /// <summary>The element names whose CONTENTS are removed with them (the highest-risk vectors).</summary>
    private static readonly string[] BlockElementNames = ["script", "style"];

    /// <summary>The longest block element name ("script").</summary>
    private const int MaxBlockNameLength = 6;

    /// <summary>
    /// Strips HTML markup from <paramref name="input"/> so the stored text can never parse as executable
    /// markup, while preserving the author's literal characters. A stored <c>&lt;script&gt;…&lt;/script&gt;</c>
    /// or <c>&lt;style&gt;…&lt;/style&gt;</c> is removed with its contents; any other tag
    /// (<c>&lt;</c>, an optional <c>/</c>, an ASCII letter, anything but <c>&gt;</c>, then <c>&gt;</c>) is removed
    /// and its surrounding text kept.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Strip-until-stable, in ONE linear pass (Wave 1b DoS fix).</b> Removing a tag can REBUILD one out of the
    /// pieces around it: <c>&lt;&lt;b&gt;img src=x onerror=…&gt;</c> loses <c>&lt;b&gt;</c> and becomes
    /// <c>&lt;img src=x onerror=…&gt;</c> (demo-polish BP, Gate-1 M-2). The previous implementation re-ran two
    /// regexes until a pass removed nothing — one pass per nesting level, plus a lazy block regex that rescanned
    /// to the end for every unclosed <c>&lt;script&gt;</c> — which is quadratic (2.4 s of CPU for 32 KB of
    /// <c>&lt;&lt;&lt;…b&gt;b&gt;b&gt;</c>, reachable by any participant).
    /// </para>
    /// <para>
    /// This version reaches a stable result directly. The output is built like a stack, and each <c>&gt;</c> is
    /// resolved against the <c>&lt;</c> still pending after the last surviving <c>&gt;</c>. As in the old passes,
    /// a <c>&lt;script&gt;</c>/<c>&lt;style&gt;</c> opener with a matching close tag later in the input wins first
    /// (the leftmost one; the block is removed with its contents). Otherwise the LEFTMOST pending <c>&lt;</c> that
    /// the CURRENT output turns into a tag opener closes here, and the tag is removed by truncation — so a
    /// <c>&lt;</c> left behind by a removal is judged against the characters that follow it AFTER the removal,
    /// exactly as a rebuilt tag is seen on a later pass. A <c>&gt;</c> that closes nothing is the author's literal
    /// character and settles every pending <c>&lt;</c> (no tag body contains <c>&gt;</c>). The "not an opener"
    /// checks are cached and only the few <c>&lt;</c> just before a truncation point are re-checked, and each
    /// close tag is searched for once, so the whole pass is linear in the input.
    /// </para>
    /// <para>
    /// <b>The guarantee:</b> the output contains no <c>&lt;/?[a-zA-Z][^&gt;]*&gt;</c> sequence at all, so nothing in
    /// it can parse as a tag, and sanitizing it again (with this or the old regexes) changes nothing. For ordinary
    /// text and well-formed markup the output is identical to the old repeat-until-stable regexes; only for
    /// pathological overlapping fragments can it differ, and then it never leaves a tag behind.
    /// </para>
    /// </remarks>
    /// <param name="input">The raw text to sanitize.</param>
    /// <returns>The stripped, inert plain text (never entity-encoded).</returns>
    public static string Sanitize(string input)
    {
        ArgumentNullException.ThrowIfNull(input);

        // No '<' → no tag and no block can exist: the text is returned as is.
        return input.Contains('<', StringComparison.Ordinal) ? new TagStripper(input).Run() : input;
    }

    /// <summary>Whether <paramref name="c"/> can follow <c>&lt;</c> or <c>&lt;/</c> to start a tag.</summary>
    private static bool IsTagNameStart(char c) => char.IsAsciiLetter(c);

    /// <summary>A regex <c>\w</c> character (letters, digits, non-spacing marks, connector punctuation), for <c>\b</c>.</summary>
    private static bool IsWordChar(char c) =>
        char.IsLetterOrDigit(c)
        || CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.NonSpacingMark or UnicodeCategory.ConnectorPunctuation
        || c is '‌' or '‍';

    /// <summary>ASCII case-insensitive equality of <paramref name="c"/> with the lower-case letter <paramref name="lower"/>.</summary>
    private static bool EqualsIgnoreAsciiCase(char c, char lower) =>
        c == lower || (char.IsAsciiLetter(c) && (c | 0x20) == lower);

    /// <summary>The single-pass, stack-shaped stripper over one input.</summary>
    private sealed class TagStripper
    {
        private readonly string _input;
        private readonly char[] _output;

        /// <summary>Positions in <see cref="_output"/> of every '&lt;' after the last surviving '&gt;', ascending.</summary>
        private readonly List<int> _pending = [];

        /// <summary>One close-tag search cursor per block element name (parallel to <see cref="BlockElementNames"/>).</summary>
        private readonly CloseTagCursor[] _closeCursors;

        private int _length;

        /// <summary>How many leading <see cref="_pending"/> entries are known NOT to open a tag (cached checks).</summary>
        private int _knownNotOpeners;

        /// <summary>How many leading <see cref="_pending"/> entries are known NOT to open a removable block.</summary>
        private int _knownNotBlocks;

        public TagStripper(string input)
        {
            _input = input;
            _output = new char[input.Length];
            _closeCursors = BlockElementNames.Select(name => new CloseTagCursor(input, name)).ToArray();
        }

        public string Run()
        {
            for (var index = 0; index < _input.Length; index++)
            {
                var c = _input[index];
                if (c != '>')
                {
                    if (c == '<')
                    {
                        _pending.Add(_length);
                    }

                    _output[_length++] = c;
                    continue;
                }

                // Blocks first, as the old passes did: a pending <script>/<style> opener that this '>' completes, with
                // a matching close tag later in the input, is removed together with everything up to that close tag.
                var blockStart = FindBlockStart(index + 1, out var closeEnd);
                if (blockStart >= 0)
                {
                    Truncate(blockStart);
                    index = closeEnd - 1;
                    continue;
                }

                var tagStart = FindTagStart();
                if (tagStart < 0)
                {
                    // A '>' that closes no tag is the author's literal character. No tag can span it, so every
                    // pending '<' before it is settled for good.
                    _output[_length++] = '>';
                    _pending.Clear();
                    _knownNotOpeners = 0;
                    _knownNotBlocks = 0;
                    continue;
                }

                // A complete tag: _output[tagStart.._length) plus this '>'.
                Truncate(tagStart);
            }

            return new string(_output, 0, _length);
        }

        /// <summary>The leftmost pending '&lt;' that the current output turns into a tag opener, or -1.</summary>
        private int FindTagStart()
        {
            for (var k = _knownNotOpeners; k < _pending.Count; k++)
            {
                var position = _pending[k];
                var next = position + 1;
                if (next >= _length)
                {
                    // The '<' is the last character: its follower is this '>', so it opens nothing now — but a later
                    // character could still make it an opener, so it is not cached. Nothing pends after it.
                    return -1;
                }

                var follower = _output[next];
                if (IsTagNameStart(follower))
                {
                    return position;
                }

                if (follower == '/')
                {
                    if (next + 1 >= _length)
                    {
                        return -1;
                    }

                    if (IsTagNameStart(_output[next + 1]))
                    {
                        return position;
                    }
                }

                // Settled as "not an opener" until a truncation changes the characters right after it.
                if (k == _knownNotOpeners)
                {
                    _knownNotOpeners++;
                }
            }

            return -1;
        }

        /// <summary>
        /// The leftmost pending '&lt;' that opens a script/style block (<c>&lt;script\b…&gt;</c>, case-insensitive,
        /// completed by the current '&gt;') whose close tag appears in the input at or after
        /// <paramref name="from"/>, or -1. <paramref name="closeEnd"/> is the end of that close tag.
        /// </summary>
        private int FindBlockStart(int from, out int closeEnd)
        {
            closeEnd = -1;
            for (var k = _knownNotBlocks; k < _pending.Count; k++)
            {
                var position = _pending[k];
                var block = BlockNameAt(position, out var determined);
                if (block >= 0 && _closeCursors[block].TryFindFrom(from, out closeEnd))
                {
                    return position;
                }

                // A name that does not match is settled until a truncation changes the characters after it; so is a
                // block whose close tag no longer exists ahead (the input only moves forward). A '<' too close to the
                // end to decide is re-checked next time.
                if (determined && k == _knownNotBlocks)
                {
                    _knownNotBlocks++;
                }
            }

            return -1;
        }

        /// <summary>
        /// The index into <see cref="BlockElementNames"/> when the '&lt;' at <paramref name="position"/> is followed by
        /// that name and a word boundary (the boundary may be the current '&gt;'), else -1.
        /// <paramref name="determined"/> is <c>false</c> when the output is still too short after it to rule a name out.
        /// </summary>
        private int BlockNameAt(int position, out bool determined)
        {
            determined = true;
            for (var block = 0; block < BlockElementNames.Length; block++)
            {
                var name = BlockElementNames[block];
                var afterName = position + 1 + name.Length;
                var available = Math.Min(name.Length, _length - position - 1);

                var matches = true;
                for (var offset = 0; offset < available && matches; offset++)
                {
                    matches = EqualsIgnoreAsciiCase(_output[position + 1 + offset], name[offset]);
                }

                if (!matches)
                {
                    continue;
                }

                if (afterName > _length)
                {
                    // A prefix of the name runs into the current '>': not a block now, but later characters could
                    // still complete it after a truncation, so this answer is not cached.
                    determined = false;
                    continue;
                }

                // \b after the name: the tag ends there (the '>' follows) or a non-word character follows.
                if (afterName == _length || !IsWordChar(_output[afterName]))
                {
                    return block;
                }
            }

            return -1;
        }

        /// <summary>Removes everything from <paramref name="tagStart"/> on, and re-opens the checks it invalidates.</summary>
        private void Truncate(int tagStart)
        {
            _length = tagStart;
            while (_pending.Count > 0 && _pending[^1] >= tagStart)
            {
                _pending.RemoveAt(_pending.Count - 1);
            }

            // A '<' (or "</") just before the cut is followed by NEW characters from now on, so its cached
            // "not an opener" no longer holds; for a block, a '<' up to a name and a boundary away. Everything earlier
            // is untouched.
            _knownNotOpeners = Math.Min(_knownNotOpeners, _pending.Count);
            while (_knownNotOpeners > 0 && _pending[_knownNotOpeners - 1] >= tagStart - 2)
            {
                _knownNotOpeners--;
            }

            _knownNotBlocks = Math.Min(_knownNotBlocks, _pending.Count);
            while (_knownNotBlocks > 0 && _pending[_knownNotBlocks - 1] >= tagStart - MaxBlockNameLength - 1)
            {
                _knownNotBlocks--;
            }
        }
    }

    /// <summary>
    /// Finds <c>&lt;/name\s*&gt;</c> (case-insensitive) in the input at or after a position that only ever moves
    /// forward, remembering the last answer, so all searches for one name cost one pass over the input in total.
    /// </summary>
    private sealed class CloseTagCursor
    {
        private readonly string _input;
        private readonly string _name;
        private int _scannedTo;
        private int _foundStart = -1;
        private int _foundEnd = -1;

        public CloseTagCursor(string input, string name)
        {
            _input = input;
            _name = name;
        }

        /// <summary>The end (exclusive) of the first close tag that starts at or after <paramref name="from"/>.</summary>
        public bool TryFindFrom(int from, out int end)
        {
            if (_foundStart >= from)
            {
                end = _foundEnd;
                return true;
            }

            for (var start = Math.Max(from, _scannedTo); start < _input.Length; start++)
            {
                if (TryMatchAt(start, out end))
                {
                    _foundStart = start;
                    _foundEnd = end;
                    _scannedTo = start;
                    return true;
                }
            }

            _scannedTo = _input.Length;
            end = -1;
            return false;
        }

        private bool TryMatchAt(int start, out int end)
        {
            end = -1;
            if (start + 2 + _name.Length > _input.Length || _input[start] != '<' || _input[start + 1] != '/')
            {
                return false;
            }

            var position = start + 2;
            for (var offset = 0; offset < _name.Length; offset++, position++)
            {
                if (!EqualsIgnoreAsciiCase(_input[position], _name[offset]))
                {
                    return false;
                }
            }

            while (position < _input.Length && char.IsWhiteSpace(_input[position]))
            {
                position++;
            }

            if (position < _input.Length && _input[position] == '>')
            {
                end = position + 1;
                return true;
            }

            return false;
        }
    }
}
