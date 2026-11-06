namespace Pulse.WebApi.Features.News;

using System.Collections.Frozen;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The <c>article-rich</c> body profile (news story 01, NFR-004): the allowlist an article's <c>bodyHtml</c> is rebuilt
/// from. Registered with F04's <see cref="ISanitizerProfileRegistry"/> at DI time (FU-8); it extends the foundation's
/// <c>PostSanitizer</c>-based engine by profile and never forks it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Survives:</b> <c>p</c>, <c>br</c>, <c>strong</c>, <c>em</c>, <c>h2</c>, <c>h3</c>, <c>ul</c>/<c>ol</c>/<c>li</c>,
/// <c>blockquote</c> (its <c>class</c> only when exactly <c>pull-quote</c>), <c>figure</c> (<c>data-media-id</c>, a GUID)
/// with <c>figcaption</c>, <c>a[href]</c> (http/https/mailto or a host-relative path; <c>rel</c> forced), and the
/// <c>&lt;pulse-post data-id="GUID"&gt;</c> embed placeholder (story 06 renders it).
/// </para>
/// <para>
/// <b>Stripped:</b> everything else, including <c>script</c>/<c>style</c>/<c>iframe</c> (with contents), <c>img</c>
/// (an article's images are media items referenced by <c>figure[data-media-id]</c>), every <c>on*</c> handler, every
/// <c>style</c> attribute, and any <c>javascript:</c>/<c>data:</c> URL. The markup contract the frontend renders (story 06)
/// is written down in <c>Features/News/README.md</c>.
/// </para>
/// </remarks>
public static partial class ArticleBodyProfile
{
    /// <summary>The profile name an article's <see cref="IContentKindDescriptor.BodyPolicy"/> refers to.</summary>
    public const string Name = "article-rich";

    /// <summary>The embedded-post placeholder element (story 06 swaps it for a read-only <c>PostCard</c>).</summary>
    public const string PostEmbedElement = "pulse-post";

    /// <summary>The only class a <c>blockquote</c> may keep.</summary>
    public const string PullQuoteClass = "pull-quote";

    /// <summary>The allowlist.</summary>
    public static SanitizerProfile Profile { get; } = new()
    {
        AllowedElements = new[]
        {
            "p", "br", "strong", "em", "h2", "h3", "ul", "ol", "li", "blockquote", "figure", "figcaption", "a",
            PostEmbedElement,
        }.ToFrozenSet(StringComparer.Ordinal),
        AllowedAttributes = new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            ["a"] = Set("href"),
            ["blockquote"] = Set("class"),
            ["figure"] = Set("data-media-id"),
            [PostEmbedElement] = Set("data-id"),
        },
        AttributeValuePatterns = new Dictionary<string, IReadOnlyDictionary<string, Regex>>(StringComparer.Ordinal)
        {
            ["blockquote"] = new Dictionary<string, Regex>(StringComparer.Ordinal) { ["class"] = PullQuote() },
            ["figure"] = new Dictionary<string, Regex>(StringComparer.Ordinal) { ["data-media-id"] = GuidValue() },
            [PostEmbedElement] = new Dictionary<string, Regex>(StringComparer.Ordinal) { ["data-id"] = GuidValue() },
        },
    };

    private static FrozenSet<string> Set(params string[] values) => values.ToFrozenSet(StringComparer.Ordinal);

    [GeneratedRegex(@"\Apull-quote\z", RegexOptions.CultureInvariant)]
    private static partial Regex PullQuote();

    [GeneratedRegex(@"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z", RegexOptions.CultureInvariant)]
    private static partial Regex GuidValue();
}
