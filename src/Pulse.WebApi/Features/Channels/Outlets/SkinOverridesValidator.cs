namespace Pulse.WebApi.Features.Channels.Outlets;

using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Pulse.WebApi.Features.Channels.Contracts;

/// <summary>
/// The FC-7 <see cref="ISkinOverridesValidator"/> (channels-foundation story 03): enforces the FC-3b
/// <c>OutletSkinTokens</c> allowlist on any partial override object, for the outlet registry and for the portal config
/// API (portal 03 / FU-4b), which reuses it as-is.
/// </summary>
/// <remarks>
/// <para>
/// <b>A pure function.</b> No database, no clock, no DI collaborators: the same input always yields the same errors,
/// so any slice may call it (it is registered as a singleton). Every error names its key by a dotted path
/// (<c>skinOverrides.palette.accent</c>), and every error is collected, so one 400 lists everything wrong.
/// </para>
/// <para>
/// <b>Allowlist, not denylist.</b> Only the D3-P2 CAN list is addressable: <c>schemaVersion</c>, <c>type</c>,
/// <c>palette</c>, <c>density</c>, <c>media</c>, <c>breaking</c>, <c>byline</c>, <c>dateline</c>, <c>layout</c>,
/// <c>clutter</c> (the tabloid skin only) and <c>ext.&lt;ns&gt;</c>. Any other key at any level is
/// "not an allowed skin token", which makes the D3-P2 CANNOT list (slot order, scenario-time source, the Pulse
/// embed/link card, the watermark slot, share behaviour, no-comments, the a11y floor, telemetry invisibility)
/// structurally unreachable: no token key addresses any of it.
/// </para>
/// <para>
/// <b>Defence in depth on string values.</b> The client escapes tokens too; the server additionally refuses, in every
/// string value (case-insensitively):
/// </para>
/// <list type="bullet">
///   <item><description><b>CSS-bound strings</b> (<c>type</c>, <c>palette</c>, <c>density</c>, <c>media</c>,
///   <c>ext.&lt;ns&gt;</c>; they end up in CSS custom properties and font stacks): the characters and
///   sequences <c>&lt;</c> <c>&gt;</c> <c>{</c> <c>}</c> <c>;</c> <c>\</c> <c>@</c> <c>/*</c> <c>*/</c> <c>!</c>
///   <c>javascript:</c>, and any CSS function call (<c>name(</c>) other than <see cref="AllowedCssFunctions"/>, which
///   refuses <c>url(</c>, <c>image-set(</c>, <c>-webkit-image-set(</c>, <c>image(</c>, <c>cross-fade(</c>,
///   <c>element(</c>, <c>src(</c>, <c>expression(</c> and the rest. Quotes stay allowed (font stacks need them).
///   </description></item>
///   <item><description><b>Text templates</b> (<c>byline</c>, <c>dateline</c>, <c>breaking</c> and the <c>clutter</c> chips; rendered as text, so
///   <c>{placeholder}</c> braces are allowed): <c>&lt;</c> <c>&gt;</c> <c>;</c> <c>\</c> <c>url(</c>
///   <c>expression(</c> <c>javascript:</c>.</description></item>
///   <item><description><b>Everywhere</b>: control characters and invisible formatting characters (Unicode Cf, Zl,
///   Zp, e.g. U+202E), and strings longer than <see cref="MaxStringLength"/> characters.</description></item>
/// </list>
/// <para>
/// <b>Size cap.</b> The whole object, serialized by <see cref="Serialize"/> (compact, relaxed escaping, so non-Latin
/// text is not inflated into <c>\uXXXX</c> escapes), must be at most <see cref="MaxBytes"/> UTF-8 bytes; over the cap,
/// that is the only error reported. The outlet registry stores exactly this serialization. Relaxed escaping is safe
/// here because <c>&lt;</c> and <c>&gt;</c> are refused in every string anyway.
/// </para>
/// <para>
/// <b>Null means unset.</b> A null overrides object, an empty object and a <c>null</c> token value are all valid.
/// </para>
/// </remarks>
public sealed partial class SkinOverridesValidator : ISkinOverridesValidator
{
    /// <summary>The size cap: the UTF-8 byte length of the compact serialized overrides.</summary>
    public const int MaxBytes = 4096;

    /// <summary>The longest scalar token string.</summary>
    public const int MaxStringLength = 200;

    /// <summary>The most entries <c>clutter</c> (and any <c>ext</c> string array) may hold.</summary>
    public const int MaxArrayItems = 20;

    /// <summary>The longest <c>clutter</c> entry.</summary>
    public const int MaxClutterItemLength = 80;

    /// <summary>The tabloid skin's key: the only skin allowed <c>clutter</c> and <c>layout.homeLead: "clutter"</c> (D3-P2).</summary>
    public const string TabloidSkinKey = "the-scoop";

    /// <summary>The only supported <c>schemaVersion</c>.</summary>
    public const int SchemaVersion = 1;

    private const string Root = "skinOverrides";

    private const string CssBreakoutList = "< > { } ; \\ @ /* */ ! javascript:";
    private const string TextTemplateBreakoutList = "< > ; \\ url( expression( javascript:";

    private static readonly string[] CssBreakouts = ["<", ">", "{", "}", ";", "\\", "@", "/*", "*/", "!", "javascript:"];

    // Text-template groups render as text, never as CSS, so their formats may use {placeholder} syntax
    // ("By {name}"). Every other group feeds CSS custom properties and keeps the full CSS rules.
    private static readonly string[] TextTemplateBreakouts = ["<", ">", ";", "\\", "url(", "expression(", "javascript:"];

    private static readonly JsonSerializerOptions CompactRelaxed = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>The only CSS functions a CSS-bound token may call (case-insensitive).</summary>
    public static IReadOnlyList<string> AllowedCssFunctions { get; } = ["rgb", "rgba", "hsl", "hsla", "var", "calc", "min", "max", "clamp"];

    private static readonly HashSet<string> TextTemplateGroups = new(StringComparer.Ordinal) { "breaking", "byline", "dateline" };

    /// <summary>The <c>ext.&lt;ns&gt;</c> channel namespaces (FC-3b, FC-8a <c>registerSkinExtension</c>).</summary>
    public static IReadOnlyList<string> ExtNamespaces { get; } = ["news", "press", "weather", "portal"];

    /// <summary>The allowed <c>layout.homeLead</c> values.</summary>
    public static IReadOnlyList<string> HomeLeadValues { get; } = ["video-lead", "text-lead", "list-lead", "clutter"];

    /// <summary>The scalar token groups and their allowed keys (each value a string or a number).</summary>
    private static readonly Dictionary<string, string[]> ScalarGroups = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["type"] = ["mastheadFamily", "hedFamily", "dekFamily", "bodyFamily", "kickerFamily", "hedCase"],
        ["palette"] = ["accent", "link", "bg", "surface", "text", "rule", "breaking"],
        ["density"] = ["spacingScale", "ruleWeight", "radius"],
        ["media"] = ["cropAggression", "captionStyle", "playerTint"],
        ["breaking"] = ["style", "vocabulary"],
        ["byline"] = ["format"],
        ["dateline"] = ["format"],
    };

    /// <inheritdoc />
    public SkinOverridesValidationResult Validate(string skinKey, JsonObject? skinOverrides)
    {
        if (skinOverrides is null)
        {
            return SkinOverridesValidationResult.Valid;
        }

        if (Encoding.UTF8.GetByteCount(Serialize(skinOverrides)) > MaxBytes)
        {
            return new SkinOverridesValidationResult([$"{Root} exceeds the 4 KB cap."]);
        }

        var errors = new List<string>();
        var isTabloid = string.Equals(skinKey, TabloidSkinKey, StringComparison.Ordinal);

        foreach (var (key, value) in skinOverrides)
        {
            var path = $"{Root}.{key}";
            switch (key)
            {
                case "schemaVersion":
                    ValidateSchemaVersion(path, value, errors);
                    break;
                case "layout":
                    ValidateLayout(path, value, isTabloid, errors);
                    break;
                case "clutter":
                    ValidateClutter(path, value, isTabloid, errors);
                    break;
                case "ext":
                    ValidateExt(path, value, errors);
                    break;
                default:
                    if (ScalarGroups.TryGetValue(key, out var allowed))
                    {
                        ValidateScalarGroup(path, value, allowed, TextTemplateGroups.Contains(key), errors);
                    }
                    else
                    {
                        errors.Add(NotAllowed(path));
                    }

                    break;
            }
        }

        return errors.Count == 0 ? SkinOverridesValidationResult.Valid : new SkinOverridesValidationResult(errors);
    }

    /// <summary>
    /// The one serialization of an overrides object: compact JSON with relaxed escaping. The 4 KB cap is measured on it,
    /// and the outlet registry stores it.
    /// </summary>
    /// <param name="skinOverrides">The overrides.</param>
    /// <returns>The compact JSON.</returns>
    public static string Serialize(JsonObject skinOverrides)
    {
        ArgumentNullException.ThrowIfNull(skinOverrides);
        return skinOverrides.ToJsonString(CompactRelaxed);
    }

    private static void ValidateSchemaVersion(string path, JsonNode? value, List<string> errors)
    {
        if (value is null)
        {
            return;
        }

        if (value.GetValueKind() != JsonValueKind.Number
            || !value.AsValue().TryGetValue<int>(out var version)
            || version != SchemaVersion)
        {
            errors.Add($"{path} must be {SchemaVersion}.");
        }
    }

    private static void ValidateScalarGroup(string path, JsonNode? value, string[] allowed, bool isTextTemplate, List<string> errors)
    {
        if (value is null)
        {
            return;
        }

        if (value is not JsonObject group)
        {
            errors.Add($"{path} must be an object.");
            return;
        }

        foreach (var (key, token) in group)
        {
            var tokenPath = $"{path}.{key}";
            if (!allowed.Contains(key, StringComparer.Ordinal))
            {
                errors.Add(NotAllowed(tokenPath));
                continue;
            }

            switch (token?.GetValueKind())
            {
                case null or JsonValueKind.Null or JsonValueKind.Number:
                    break;
                case JsonValueKind.String:
                    ValidateString(tokenPath, token!.GetValue<string>(), MaxStringLength, errors, isTextTemplate);
                    break;
                default:
                    errors.Add($"{tokenPath} must be a string or a number.");
                    break;
            }
        }
    }

    private static void ValidateLayout(string path, JsonNode? value, bool isTabloid, List<string> errors)
    {
        if (value is null)
        {
            return;
        }

        if (value is not JsonObject layout)
        {
            errors.Add($"{path} must be an object.");
            return;
        }

        foreach (var (key, token) in layout)
        {
            var tokenPath = $"{path}.{key}";
            var kind = token?.GetValueKind() ?? JsonValueKind.Null;
            switch (key)
            {
                case "rail":
                    if (kind is not (JsonValueKind.Null or JsonValueKind.True or JsonValueKind.False))
                    {
                        errors.Add($"{tokenPath} must be a boolean.");
                    }

                    break;
                case "homeLead":
                    if (kind == JsonValueKind.Null)
                    {
                        break;
                    }

                    var homeLead = kind == JsonValueKind.String ? token!.GetValue<string>() : null;
                    if (homeLead is null || !HomeLeadValues.Contains(homeLead, StringComparer.Ordinal))
                    {
                        errors.Add($"{tokenPath} must be one of {string.Join(", ", HomeLeadValues)}.");
                    }
                    else if (homeLead == "clutter" && !isTabloid)
                    {
                        errors.Add($"{tokenPath} 'clutter' is only allowed for the tabloid skin ('{TabloidSkinKey}').");
                    }

                    break;
                default:
                    errors.Add(NotAllowed(tokenPath));
                    break;
            }
        }
    }

    private static void ValidateClutter(string path, JsonNode? value, bool isTabloid, List<string> errors)
    {
        if (value is null)
        {
            return;
        }

        if (!isTabloid)
        {
            errors.Add($"{path} is only allowed for the tabloid skin ('{TabloidSkinKey}').");
            return;
        }

        // Clutter items are tabloid chip TEXT ("SHOCKING!"), rendered as text, never as CSS: text-template rules.
        ValidateStringArray(path, value, MaxClutterItemLength, errors, isTextTemplate: true);
    }

    private static void ValidateExt(string path, JsonNode? value, List<string> errors)
    {
        if (value is null)
        {
            return;
        }

        if (value is not JsonObject ext)
        {
            errors.Add($"{path} must be an object.");
            return;
        }

        foreach (var (ns, block) in ext)
        {
            var nsPath = $"{path}.{ns}";
            if (!ExtNamespaces.Contains(ns, StringComparer.Ordinal))
            {
                errors.Add($"{nsPath} is not an allowed namespace ({string.Join(", ", ExtNamespaces)}).");
                continue;
            }

            if (block is null)
            {
                continue;
            }

            if (block is not JsonObject flat)
            {
                errors.Add($"{nsPath} must be an object.");
                continue;
            }

            foreach (var (key, token) in flat)
            {
                var tokenPath = $"{nsPath}.{key}";
                if (!ExtKeyPattern().IsMatch(key))
                {
                    errors.Add($"{tokenPath} is not a valid token name.");
                    continue;
                }

                switch (token?.GetValueKind())
                {
                    case null or JsonValueKind.Null or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False:
                        break;
                    case JsonValueKind.String:
                        ValidateString(tokenPath, token!.GetValue<string>(), MaxStringLength, errors);
                        break;
                    case JsonValueKind.Array:
                        ValidateStringArray(tokenPath, token!, MaxStringLength, errors);
                        break;
                    default:
                        errors.Add($"{tokenPath} must be a string, number, boolean or string array.");
                        break;
                }
            }
        }
    }

    private static void ValidateStringArray(string path, JsonNode value, int maxItemLength, List<string> errors, bool isTextTemplate = false)
    {
        if (value is not JsonArray array)
        {
            errors.Add($"{path} must be an array of strings.");
            return;
        }

        if (array.Count > MaxArrayItems)
        {
            errors.Add($"{path} may hold at most {MaxArrayItems} items.");
        }

        for (var index = 0; index < array.Count; index++)
        {
            var item = array[index];
            var itemPath = $"{path}[{index}]";
            if (item?.GetValueKind() != JsonValueKind.String)
            {
                errors.Add($"{itemPath} must be a string.");
                continue;
            }

            ValidateString(itemPath, item!.GetValue<string>(), maxItemLength, errors, isTextTemplate);
        }
    }

    private static void ValidateString(string path, string value, int maxLength, List<string> errors, bool isTextTemplate = false)
    {
        if (value.Length > maxLength)
        {
            errors.Add($"{path} is longer than {maxLength} characters.");
        }

        if (OutletText.HasControlOrInvisible(value))
        {
            errors.Add($"{path} contains a control or invisible formatting character.");
        }

        if (isTextTemplate)
        {
            if (TextTemplateBreakouts.Any(breakout => value.Contains(breakout, StringComparison.OrdinalIgnoreCase)))
            {
                errors.Add($"{path} contains a disallowed character or sequence ({TextTemplateBreakoutList}).");
            }

            return;
        }

        if (CssBreakouts.Any(breakout => value.Contains(breakout, StringComparison.OrdinalIgnoreCase)))
        {
            errors.Add($"{path} contains a disallowed character or sequence ({CssBreakoutList}).");
            return;
        }

        foreach (Match call in CssFunctionCall().Matches(value))
        {
            var name = call.Groups["name"].Value;
            if (!AllowedCssFunctions.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                errors.Add(
                    $"{path} contains a disallowed character or sequence: the CSS function '{name}(' "
                    + $"(only {string.Join(", ", AllowedCssFunctions)} are allowed).");
                return;
            }
        }
    }

    private static string NotAllowed(string path) => $"{path} is not an allowed skin token.";

    [GeneratedRegex(@"\A[A-Za-z][A-Za-z0-9_-]{0,63}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ExtKeyPattern();

    // Any identifier-like run directly before "(" (whitespace allowed); CSS idents may contain digits, '_' and '-'.
    [GeneratedRegex(@"(?<name>[A-Za-z_-][A-Za-z0-9_-]*)\s*\(", RegexOptions.CultureInvariant)]
    private static partial Regex CssFunctionCall();
}
