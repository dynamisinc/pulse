namespace Pulse.WebApi.Features.Channels.Content.Publish;

using System.Collections.Concurrent;
using System.Collections.Frozen;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The singleton <see cref="ISanitizerProfileRegistry"/> (channels-foundation story 04): the built-in profiles
/// <see cref="ISanitizerProfileRegistry.Plain"/>, <see cref="ISanitizerProfileRegistry.RichBasic"/> and
/// <see cref="ISanitizerProfileRegistry.RichTables"/>, plus any profile a channel adds at DI time with
/// <see cref="ContentPublishServiceCollectionExtensions.AddSanitizerProfile"/> (news <c>article-rich</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>A profile can never be script-capable.</b> <see cref="Register"/> refuses a profile that allows a forbidden element
/// (<c>script</c>, <c>iframe</c>, <c>form</c>, ... — <see cref="ContentSanitizer.ForbiddenElements"/>), an event handler
/// (<c>on*</c>) or <c>style</c> attribute, or a URL scheme beyond <c>http</c>/<c>https</c>/<c>mailto</c>/<c>tel</c>
/// (so <c>javascript:</c>, <c>data:</c> and <c>vbscript:</c> can never be allowed). Re-registering a name is an error.
/// </para>
/// <para>
/// <b>Unknown names fail loudly.</b> <see cref="Sanitize"/> throws for an unregistered name, and the
/// <see cref="ContentKindStartupCheck"/> fails host start when a registered kind descriptor names one (news FU-8, press FU-5):
/// never a silent fallback to a looser or stricter profile.
/// </para>
/// </remarks>
public sealed partial class SanitizerProfileRegistry : ISanitizerProfileRegistry
{
    /// <summary>The only URL schemes a profile may allow.</summary>
    private static readonly FrozenSet<string> PermittedSchemes =
        new[] { "http", "https", "mailto", "tel" }.ToFrozenSet(StringComparer.OrdinalIgnoreCase);

    private readonly ConcurrentDictionary<string, SanitizerProfile> _profiles = new(StringComparer.Ordinal);

    /// <summary>Creates the registry with the built-ins and every DI-time registration.</summary>
    /// <param name="registrations">Profiles channels added with <c>AddSanitizerProfile</c>; possibly none.</param>
    public SanitizerProfileRegistry(IEnumerable<SanitizerProfileRegistration>? registrations = null)
    {
        Register(ISanitizerProfileRegistry.Plain, BuiltInProfiles.Plain);
        Register(ISanitizerProfileRegistry.RichBasic, BuiltInProfiles.RichBasic);
        Register(ISanitizerProfileRegistry.RichTables, BuiltInProfiles.RichTables);

        foreach (var registration in registrations ?? [])
        {
            Register(registration.Name, registration.Profile);
        }
    }

    /// <inheritdoc />
    public void Register(string name, SanitizerProfile profile)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(profile);

        if (!ProfileName().IsMatch(name))
        {
            throw new ArgumentException($"'{name}' is not a valid sanitizer profile name ([a-z0-9-]{{1,64}}).", nameof(name));
        }

        Validate(name, profile);

        if (!_profiles.TryAdd(name, profile))
        {
            throw new InvalidOperationException($"The sanitizer profile '{name}' is already registered.");
        }
    }

    /// <inheritdoc />
    public bool Contains(string name) => name is not null && _profiles.ContainsKey(name);

    /// <inheritdoc />
    public string Sanitize(string name, string untrustedHtml)
    {
        ArgumentNullException.ThrowIfNull(untrustedHtml);

        if (name is null || !_profiles.TryGetValue(name, out var profile))
        {
            throw new InvalidOperationException($"No sanitizer profile named '{name}' is registered.");
        }

        return ContentSanitizer.Sanitize(untrustedHtml, profile);
    }

    private static void Validate(string name, SanitizerProfile profile)
    {
        foreach (var element in profile.AllowedElements)
        {
            if (!TagName().IsMatch(element) || ContentSanitizer.ForbiddenElements.Contains(element))
            {
                throw new ArgumentException($"Sanitizer profile '{name}' may not allow the element '{element}'.", nameof(profile));
            }
        }

        foreach (var (element, attributes) in profile.AllowedAttributes)
        {
            if (!profile.AllowedElements.Contains(element))
            {
                throw new ArgumentException(
                    $"Sanitizer profile '{name}' lists attributes for '{element}', which it does not allow.", nameof(profile));
            }

            foreach (var attribute in attributes)
            {
                if (!TagName().IsMatch(attribute)
                    || attribute.StartsWith("on", StringComparison.Ordinal)
                    || ContentSanitizer.ForbiddenAttributes.Contains(attribute))
                {
                    throw new ArgumentException(
                        $"Sanitizer profile '{name}' may not allow the attribute '{attribute}' (on '{element}').", nameof(profile));
                }
            }
        }

        foreach (var scheme in profile.AllowedUrlSchemes)
        {
            if (!PermittedSchemes.Contains(scheme))
            {
                throw new ArgumentException(
                    $"Sanitizer profile '{name}' may not allow the URL scheme '{scheme}' (NFR-004).", nameof(profile));
            }
        }

        if (profile.ForcedLinkRel.Any(c => !(char.IsAsciiLetterLower(c) || c == ' ')))
        {
            throw new ArgumentException($"Sanitizer profile '{name}' has an invalid forced rel.", nameof(profile));
        }
    }

    [GeneratedRegex(@"\A[a-z0-9-]{1,64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ProfileName();

    [GeneratedRegex(@"\A[a-z][a-z0-9-]{0,31}\z", RegexOptions.CultureInvariant)]
    private static partial Regex TagName();
}

/// <summary>A profile a channel registers at DI time (<c>AddSanitizerProfile</c>); the registry consumes them all.</summary>
/// <param name="Name">The profile name a descriptor's <c>BodyPolicy</c> refers to.</param>
/// <param name="Profile">The allowlist.</param>
public sealed record SanitizerProfileRegistration(string Name, SanitizerProfile Profile);

/// <summary>The three built-in profiles FC-7 names.</summary>
public static class BuiltInProfiles
{
    private static readonly string[] RichBasicElements =
        ["p", "br", "strong", "em", "ul", "ol", "li", "blockquote", "h2", "h3", "h4", "a"];

    private static readonly string[] TableElements = ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td"];

    /// <summary>Text only: every tag stripped.</summary>
    public static SanitizerProfile Plain { get; } = new()
    {
        AllowedElements = FrozenSet<string>.Empty,
    };

    /// <summary>p/br/strong/em/ul/ol/li/blockquote/h2–h4 and <c>a[href]</c> with the forced <c>rel</c>.</summary>
    public static SanitizerProfile RichBasic { get; } = new()
    {
        AllowedElements = RichBasicElements.ToFrozenSet(StringComparer.Ordinal),
        AllowedAttributes = new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            ["a"] = new[] { "href" }.ToFrozenSet(StringComparer.Ordinal),
        },
    };

    /// <summary><see cref="RichBasic"/> plus table elements (the paste-from-Word survivor set press needs).</summary>
    public static SanitizerProfile RichTables { get; } = new()
    {
        AllowedElements = RichBasicElements.Concat(TableElements).ToFrozenSet(StringComparer.Ordinal),
        AllowedAttributes = new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            ["a"] = new[] { "href" }.ToFrozenSet(StringComparer.Ordinal),
            ["th"] = new[] { "colspan", "rowspan", "scope" }.ToFrozenSet(StringComparer.Ordinal),
            ["td"] = new[] { "colspan", "rowspan" }.ToFrozenSet(StringComparer.Ordinal),
        },
    };
}
