namespace Pulse.Core.Features.Generation.Services;

using System.Net;
using System.Text;
using Pulse.Core.Features.Generation.Models;

/// <summary>
/// The structural layer of the ADP-024 isolation boundary (§3.4, layer 1). Renders untrusted
/// world/participant posts into a single fenced, role-tagged block that the system prompt names as
/// data-never-instructions. Each post carries its author handle; all content is HTML-encoded and
/// whitespace-collapsed so a crafted post cannot forge the fence (<c>&lt;/world_feed&gt;</c>), inject a
/// fake <c>&lt;post&gt;</c> turn boundary, or break out of the attribute — the encode neutralises every
/// <c>&lt;</c>, <c>&gt;</c>, <c>&amp;</c>, and quote before it reaches the model.
/// </summary>
public static class WorldFeedFence
{
    public const string OpenTag = "<world_feed>";
    public const string CloseTag = "</world_feed>";

    /// <summary>Placeholder used when a burst has no relevant world activity (ambient generation).</summary>
    public const string Empty = OpenTag + "\n(* no recent world activity *)\n" + CloseTag;

    public static string Fence(IReadOnlyList<WorldPost> posts)
    {
        ArgumentNullException.ThrowIfNull(posts);
        if (posts.Count == 0)
        {
            return Empty;
        }

        var sb = new StringBuilder();
        sb.Append(OpenTag).Append('\n');
        foreach (var post in posts)
        {
            var handle = WebUtility.HtmlEncode(post.AuthorHandle ?? string.Empty);
            var text = CollapseWhitespace(WebUtility.HtmlEncode(post.Text ?? string.Empty));
            sb.Append("<post author=\"").Append(handle).Append("\">").Append(text).Append("</post>").Append('\n');
        }

        sb.Append(CloseTag);
        return sb.ToString();
    }

    private static string CollapseWhitespace(string value)
    {
        var sb = new StringBuilder(value.Length);
        var lastWasSpace = false;
        foreach (var ch in value)
        {
            if (char.IsWhiteSpace(ch))
            {
                if (!lastWasSpace)
                {
                    sb.Append(' ');
                }

                lastWasSpace = true;
            }
            else
            {
                sb.Append(ch);
                lastWasSpace = false;
            }
        }

        return sb.ToString().Trim();
    }
}
