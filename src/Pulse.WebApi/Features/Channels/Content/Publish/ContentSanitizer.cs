namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Social;

/// <summary>
/// The body sanitizer behind <see cref="ISanitizerProfileRegistry"/> (channels-foundation story 04, NFR-004): rebuilds
/// untrusted HTML from a <see cref="SanitizerProfile"/> allowlist, so the stored <c>BodyHtml</c> contains ONLY markup this
/// class emitted itself.
/// </summary>
/// <remarks>
/// <para>
/// <b>Rebuild, never patch.</b> The input is tokenized once, left to right. An allowlisted element is re-emitted as a
/// fresh, normalized tag carrying only its allowlisted attributes (each value entity-decoded, checked, and re-encoded);
/// every other tag is dropped and its text kept; <c>script</c>/<c>style</c> and the other raw-text or embedding
/// elements are dropped WITH their contents; comments, doctypes and processing instructions are dropped. Text is
/// emitted HTML-safe: a stray <c>&lt;</c> or <c>&gt;</c> is encoded and a bare <c>&amp;</c> that starts no character
/// reference becomes <c>&amp;amp;</c>, so an unclosed opener (<c>&lt;img src=x onerror=…</c>) can never join with later
/// markup. Open elements are closed at the end, so a body can never leak an open <c>&lt;a&gt;</c> into the page.
/// </para>
/// <para>
/// <b>Never script-capable.</b> No event handler (<c>on*</c>) or <c>style</c> attribute is ever emitted, whatever a
/// profile says (the registry refuses such profiles too). A URL attribute survives only as a <c>#fragment</c>, a
/// host-relative path (<see cref="ChannelVocabulary.IsHostRelativePath"/>) or an absolute URL whose scheme is in the
/// profile's <see cref="SanitizerProfile.AllowedUrlSchemes"/>; <c>javascript:</c>, <c>data:</c> and friends (also when
/// entity-encoded or split by control characters) remove the attribute. Every surviving <c>a</c> gets the profile's
/// forced <c>rel</c>.
/// </para>
/// <para>
/// <b>Extends <see cref="PostSanitizer"/>, never forks it.</b> A profile with no allowed elements (the built-in
/// <c>plain</c>) is text only: <see cref="PostSanitizer.Sanitize"/> strips it exactly as it strips a post, and this class
/// then only makes the remaining text HTML-safe. The cost is linear in the input.
/// </para>
/// </remarks>
public static partial class ContentSanitizer
{
    /// <summary>Elements removed together with their contents (raw text, embedding and form elements).</summary>
    internal static readonly IReadOnlySet<string> DroppedWithContent = new HashSet<string>(StringComparer.Ordinal)
    {
        "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "noembed",
        "noframes", "template", "textarea", "title", "xmp", "plaintext", "svg", "math", "select", "head",
    };

    /// <summary>Elements no profile may allow (they load, execute, navigate or restyle the page).</summary>
    internal static readonly IReadOnlySet<string> ForbiddenElements = new HashSet<string>(DroppedWithContent, StringComparer.Ordinal)
    {
        "base", "link", "meta", "form", "input", "button", "option", "html", "body", "dialog", "portal",
    };

    /// <summary>Attributes whose value is a URL, checked against the scheme allowlist.</summary>
    internal static readonly IReadOnlySet<string> UrlAttributes = new HashSet<string>(StringComparer.Ordinal)
    {
        "href", "src", "cite", "poster", "action", "formaction", "background", "longdesc", "srcset", "ping",
    };

    /// <summary>Attributes no profile may allow, beyond the <c>on*</c> family.</summary>
    internal static readonly IReadOnlySet<string> ForbiddenAttributes = new HashSet<string>(StringComparer.Ordinal)
    {
        "style", "srcdoc", "formaction", "action", "srcset", "ping", "xmlns", "is",
    };

    /// <summary>Void elements: emitted without a close tag and never pushed onto the open stack.</summary>
    private static readonly IReadOnlySet<string> VoidElements = new HashSet<string>(StringComparer.Ordinal)
    {
        "br", "hr", "img", "col", "wbr",
    };

    /// <summary>Sanitizes <paramref name="untrustedHtml"/> with <paramref name="profile"/>.</summary>
    /// <param name="untrustedHtml">The untrusted body.</param>
    /// <param name="profile">The allowlist.</param>
    /// <returns>HTML containing only allowlisted markup and HTML-safe text.</returns>
    public static string Sanitize(string untrustedHtml, SanitizerProfile profile)
    {
        ArgumentNullException.ThrowIfNull(untrustedHtml);
        ArgumentNullException.ThrowIfNull(profile);

        // A text-only profile delegates the stripping to the post sanitizer (one stripping rule for posts and plain
        // bodies); what is left is text, made HTML-safe below with an empty allowlist.
        var input = profile.AllowedElements.Count == 0 ? PostSanitizer.Sanitize(untrustedHtml) : untrustedHtml;
        return new Rebuilder(input, profile).Run();
    }

    /// <summary>Whether <paramref name="value"/> (already entity-decoded) is a URL the profile lets survive.</summary>
    /// <param name="value">The decoded attribute value.</param>
    /// <param name="profile">The profile.</param>
    /// <returns><c>true</c> when it may be kept.</returns>
    internal static bool IsAllowedUrl(string value, SanitizerProfile profile)
    {
        var url = value.Trim();
        if (url.Length == 0 || url.Any(char.IsControl) || url.Contains('\\'))
        {
            return false;
        }

        if (url[0] == '#' || ChannelVocabulary.IsHostRelativePath(url))
        {
            return true;
        }

        var match = SchemePattern().Match(url);
        return match.Success && profile.AllowedUrlSchemes.Contains(match.Groups["scheme"].Value);
    }

    [GeneratedRegex(@"\A(?<scheme>[A-Za-z][A-Za-z0-9+.\-]*):", RegexOptions.CultureInvariant)]
    private static partial Regex SchemePattern();

    [GeneratedRegex(@"\G&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});", RegexOptions.CultureInvariant)]
    private static partial Regex CharacterReference();

    /// <summary>The single left-to-right pass over one input.</summary>
    private sealed class Rebuilder
    {
        private readonly string _input;
        private readonly SanitizerProfile _profile;
        private readonly StringBuilder _output;
        private readonly List<string> _open = [];

        // The last '>' and quote of each kind: a tag or quoted value that starts after them can never close, so it is
        // refused without scanning to the end again (keeps a run of unclosed openers linear).
        private readonly int _lastGreaterThan;
        private readonly int _lastDoubleQuote;
        private readonly int _lastSingleQuote;

        public Rebuilder(string input, SanitizerProfile profile)
        {
            _input = input;
            _profile = profile;
            _output = new StringBuilder(input.Length);
            _lastGreaterThan = input.LastIndexOf('>');
            _lastDoubleQuote = input.LastIndexOf('"');
            _lastSingleQuote = input.LastIndexOf('\'');
        }

        public string Run()
        {
            var index = 0;
            while (index < _input.Length)
            {
                var c = _input[index];
                if (c == '<')
                {
                    index = ReadMarkup(index);
                    continue;
                }

                if (c == '&')
                {
                    var reference = CharacterReference().Match(_input, index);
                    if (reference.Success)
                    {
                        _output.Append(reference.Value);
                        index += reference.Length;
                        continue;
                    }

                    _output.Append("&amp;");
                }
                else if (c == '>')
                {
                    _output.Append("&gt;");
                }
                else if (c != '\0')
                {
                    _output.Append(c);
                }

                index++;
            }

            for (var k = _open.Count - 1; k >= 0; k--)
            {
                _output.Append("</").Append(_open[k]).Append('>');
            }

            return _output.ToString();
        }

        /// <summary>Handles the markup starting at the '&lt;' at <paramref name="index"/>; returns where to continue.</summary>
        private int ReadMarkup(int index)
        {
            var next = index + 1 < _input.Length ? _input[index + 1] : '\0';

            if (string.CompareOrdinal(_input, index, "<!--", 0, 4) == 0)
            {
                var end = _input.IndexOf("-->", index + 4, StringComparison.Ordinal);
                return end < 0 ? _input.Length : end + 3;
            }

            if (next is '!' or '?')
            {
                var end = _input.IndexOf('>', index + 1);
                return end < 0 ? _input.Length : end + 1;
            }

            if (next == '/' && index + 2 < _input.Length && char.IsAsciiLetter(_input[index + 2]))
            {
                var end = _input.IndexOf('>', index + 2);
                if (end < 0)
                {
                    return Literal(index);
                }

                var name = ReadName(index + 2, out _).ToLowerInvariant();
                Close(name);
                return end + 1;
            }

            if (!char.IsAsciiLetter(next))
            {
                return Literal(index);
            }

            var tag = ParseStartTag(index);
            if (tag is null)
            {
                // A start tag that never closes (an unterminated quoted value, or no '>' before the end) runs to the end
                // of the input, exactly as a browser tokenizer drops a tag cut off by EOF. Dropping the remainder (rather
                // than re-scanning from the next '<') also keeps a run of such openers linear.
                return _input.Length;
            }

            if (DroppedWithContent.Contains(tag.Name))
            {
                return SkipElementWithContent(tag.Name, tag.End + 1);
            }

            if (_profile.AllowedElements.Contains(tag.Name) && !ForbiddenElements.Contains(tag.Name))
            {
                Emit(tag);
            }

            return tag.End + 1;
        }

        private int Literal(int index)
        {
            _output.Append("&lt;");
            return index + 1;
        }

        /// <summary>Skips to after <c>&lt;/name ...&gt;</c> (case-insensitive), or to the end when there is none.</summary>
        private int SkipElementWithContent(string name, int from)
        {
            var search = from;
            while (true)
            {
                var close = _input.IndexOf("</" + name, search, StringComparison.OrdinalIgnoreCase);
                if (close < 0)
                {
                    return _input.Length;
                }

                var after = close + 2 + name.Length;
                if (after < _input.Length && (char.IsAsciiLetterOrDigit(_input[after]) || _input[after] == '-'))
                {
                    search = after;
                    continue;
                }

                var end = _input.IndexOf('>', after);
                return end < 0 ? _input.Length : end + 1;
            }
        }

        private void Emit(StartTag tag)
        {
            _output.Append('<').Append(tag.Name);

            var allowed = _profile.AllowedAttributes.TryGetValue(tag.Name, out var set) ? set : null;
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (rawName, rawValue) in tag.Attributes)
            {
                var name = rawName.ToLowerInvariant();
                if (allowed is null
                    || !allowed.Contains(name)
                    || name.StartsWith("on", StringComparison.Ordinal)
                    || ForbiddenAttributes.Contains(name)
                    || (tag.Name == "a" && name == "rel")
                    || !seen.Add(name))
                {
                    continue;
                }

                var value = WebUtility.HtmlDecode(rawValue ?? string.Empty);
                if (UrlAttributes.Contains(name))
                {
                    if (!IsAllowedUrl(value, _profile))
                    {
                        continue;
                    }

                    value = value.Trim();
                }

                _output.Append(' ').Append(name).Append("=\"").Append(WebUtility.HtmlEncode(value)).Append('"');
            }

            if (tag.Name == "a" && !string.IsNullOrWhiteSpace(_profile.ForcedLinkRel))
            {
                _output.Append(" rel=\"").Append(WebUtility.HtmlEncode(_profile.ForcedLinkRel)).Append('"');
            }

            _output.Append('>');
            if (!VoidElements.Contains(tag.Name))
            {
                _open.Add(tag.Name);
            }
        }

        /// <summary>Closes <paramref name="name"/> if open (and everything opened inside it); a stray close is dropped.</summary>
        private void Close(string name)
        {
            var at = _open.LastIndexOf(name);
            if (at < 0)
            {
                return;
            }

            for (var k = _open.Count - 1; k >= at; k--)
            {
                _output.Append("</").Append(_open[k]).Append('>');
            }

            _open.RemoveRange(at, _open.Count - at);
        }

        private string ReadName(int from, out int end)
        {
            end = from;
            while (end < _input.Length && (char.IsAsciiLetterOrDigit(_input[end]) || _input[end] is '-' or ':'))
            {
                end++;
            }

            return _input[from..end];
        }

        /// <summary>Parses <c>&lt;name attr=value ...&gt;</c>, or returns <c>null</c> when it never closes.</summary>
        private StartTag? ParseStartTag(int index)
        {
            var name = ReadName(index + 1, out var position).ToLowerInvariant();
            var attributes = new List<(string Name, string? Value)>();

            while (position < _input.Length)
            {
                var c = _input[position];
                if (c == '>')
                {
                    return new StartTag(name, attributes, position);
                }

                if (char.IsWhiteSpace(c) || c == '/')
                {
                    position++;
                    continue;
                }

                var nameStart = position;
                while (position < _input.Length
                       && !char.IsWhiteSpace(_input[position])
                       && _input[position] is not ('>' or '/' or '='))
                {
                    position++;
                }

                if (position == nameStart)
                {
                    // A lone '=' with no name: consume it so the loop always advances.
                    position++;
                    continue;
                }

                var attributeName = _input[nameStart..position];
                while (position < _input.Length && char.IsWhiteSpace(_input[position]))
                {
                    position++;
                }

                if (position >= _input.Length || _input[position] != '=')
                {
                    attributes.Add((attributeName, null));
                    continue;
                }

                position++;
                while (position < _input.Length && char.IsWhiteSpace(_input[position]))
                {
                    position++;
                }

                if (position >= _input.Length)
                {
                    return null;
                }

                string value;
                if (_input[position] is '"' or '\'')
                {
                    var quote = _input[position];
                    if (position >= (quote == '"' ? _lastDoubleQuote : _lastSingleQuote))
                    {
                        return null;
                    }

                    var close = _input.IndexOf(quote, position + 1);
                    if (close < 0)
                    {
                        return null;
                    }

                    value = _input[(position + 1)..close];
                    position = close + 1;
                }
                else
                {
                    var valueStart = position;
                    while (position < _input.Length && !char.IsWhiteSpace(_input[position]) && _input[position] != '>')
                    {
                        position++;
                    }

                    value = _input[valueStart..position];
                }

                attributes.Add((attributeName, value));
            }

            return null;
        }
    }

    private sealed record StartTag(string Name, IReadOnlyList<(string Name, string? Value)> Attributes, int End);
}
