namespace Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// FC-7, named body-sanitization profiles over <c>PostSanitizer</c> (extended by profile, never forked;
/// NFR-004). Implemented by channels-foundation story 04, which ships the built-ins <see cref="Plain"/>,
/// <see cref="RichBasic"/> and <see cref="RichTables"/>.
/// </summary>
/// <remarks>
/// A kind names its profile in <see cref="IContentKindDescriptor.BodyPolicy"/>. A channel may
/// <see cref="Register"/> an ADDITIONAL profile at DI time (news registers <c>article-rich</c>); a descriptor
/// naming an unregistered profile is a startup failure, never a silent fallback (news FU-8, press FU-5).
/// </remarks>
public interface ISanitizerProfileRegistry
{
    /// <summary>Text only: every tag stripped.</summary>
    public const string Plain = "plain";

    /// <summary>p/br/strong/em/ul/ol/li/blockquote/h2–h4 and <c>a[href]</c> with a forced <c>rel</c>.</summary>
    public const string RichBasic = "rich-basic";

    /// <summary><see cref="RichBasic"/> plus table elements (the paste-from-Word survivor set press needs).</summary>
    public const string RichTables = "rich-tables";

    /// <summary>Registers an additional profile. Re-registering an existing name is an error.</summary>
    /// <param name="name">The profile name a descriptor's <c>BodyPolicy</c> refers to.</param>
    /// <param name="profile">The allowlist.</param>
    void Register(string name, SanitizerProfile profile);

    /// <summary>Whether a profile of that name is registered.</summary>
    /// <param name="name">The profile name.</param>
    /// <returns><c>true</c> when registered.</returns>
    bool Contains(string name);

    /// <summary>Sanitizes untrusted HTML with the named profile.</summary>
    /// <param name="name">A registered profile name; an unknown one throws.</param>
    /// <param name="untrustedHtml">The untrusted body.</param>
    /// <returns>The sanitized body.</returns>
    string Sanitize(string name, string untrustedHtml);
}

/// <summary>
/// A sanitizer allowlist: the elements that survive, the attributes each may keep, and the <c>rel</c>
/// forced onto every surviving link. Anything not allowed is stripped (its text kept).
/// </summary>
public sealed record SanitizerProfile
{
    /// <summary>Lowercase element names that survive (e.g. <c>p</c>, <c>strong</c>).</summary>
    public required IReadOnlySet<string> AllowedElements { get; init; }

    /// <summary>Per-element lowercase attribute allowlist (e.g. <c>a</c> → <c>href</c>). Absent = none.</summary>
    public IReadOnlyDictionary<string, IReadOnlySet<string>> AllowedAttributes { get; init; } =
        new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal);

    /// <summary>The <c>rel</c> value forced onto every surviving <c>a</c>.</summary>
    public string ForcedLinkRel { get; init; } = "noopener noreferrer nofollow";

    /// <summary>
    /// The URL schemes a surviving <c>href</c> / <c>src</c> may use; host-relative paths
    /// (<see cref="ChannelVocabulary.IsHostRelativePath"/>) are always allowed. Any other value, including
    /// <c>javascript:</c>, <c>data:</c> and <c>vbscript:</c>, removes the attribute (NFR-004). A profile may narrow this
    /// set; the registry refuses a profile that adds a script-capable scheme.
    /// </summary>
    public IReadOnlySet<string> AllowedUrlSchemes { get; init; } =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "https", "http", "mailto" };
}
