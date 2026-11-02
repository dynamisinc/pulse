namespace Pulse.WebApi.Features.Portal.Config;

using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.Channels.Outlets;
using Pulse.WebApi.Features.Portal.Contracts;
using Pulse.WebApi.Features.Portal.Data;

/// <summary>
/// The pure, database-free half of <c>PUT /api/portal/config</c> validation (exercise-portal story 03): trims and checks
/// the text fields, the PC-1 layout allowlist, the module list, the PC-1 size limits (through story 01's
/// <see cref="PortalLimits"/>) and the skin overrides (through F03's public <see cref="ISkinOverridesValidator"/>, never a
/// private copy of its allowlist). The logo's exercise and kind need the database, so the service checks them after.
/// </summary>
/// <remarks>
/// <b>The city name is capped so the default masthead fits.</b> The default name is <c>"{CityName} Today"</c> and the
/// masthead limit is <see cref="PortalVocabulary.MastheadNameMaxLength"/> characters, so a city is at most
/// <see cref="MaxCityNameLength"/> characters (code points, as <see cref="PortalLimits"/> counts them).
/// </remarks>
internal static class PortalConfigWriteValidator
{
    /// <summary>The suffix of the templated default masthead name.</summary>
    public const string DefaultNameSuffix = " Today";

    /// <summary>The longest city name, so <c>"{CityName} Today"</c> stays within the masthead limit.</summary>
    public const int MaxCityNameLength = PortalVocabulary.MastheadNameMaxLength - 6;

    /// <summary>
    /// The skin key the portal's overrides are validated under. It is not the tabloid key, so the tabloid-only
    /// <c>clutter</c> tokens are refused, and <c>ext.portal</c> is one of the validator's namespaces.
    /// </summary>
    public const string PortalSkinKey = "portal";

    /// <summary>The ONE message for an unusable logo: unknown, another exercise's, or not an image (no existence leak).</summary>
    public const string LogoNotUsableMessage = "logoMediaId does not name an image in this exercise.";

    /// <summary>Validates a write body.</summary>
    /// <param name="request">The untrusted body (null when it did not bind).</param>
    /// <param name="skinValidator">F03's public FC-3b validator.</param>
    /// <returns>The normalized draft, or every error found.</returns>
    public static PortalConfigParse Parse(PortalConfigWriteRequest? request, ISkinOverridesValidator skinValidator)
    {
        ArgumentNullException.ThrowIfNull(skinValidator);
        if (request is null)
        {
            return PortalConfigParse.Fail(["A config body is required."]);
        }

        var errors = new List<string>();

        // The masthead name's PC-1 limit is PortalLimits' (below); its column (120) holds 60 astral characters.
        var portalName = CheckText(request.PortalName, "portalName", null, PortalConfig.MaxPortalNameLength, errors);
        var cityName = CheckText(request.CityName, "cityName", MaxCityNameLength, PortalConfig.MaxCityNameLength, errors);
        var tagline = CheckText(request.Tagline, "tagline", PortalConfig.MaxTaglineLength, PortalConfig.MaxTaglineLength, errors);

        if (!PortalVocabulary.IsLayoutKey(request.LayoutKey))
        {
            errors.Add($"layoutKey must be one of {string.Join(", ", PortalVocabulary.LayoutKeys)}.");
        }

        Guid? logoMediaId = null;
        if (request.LogoMediaId is { } rawLogo)
        {
            if (Guid.TryParse(rawLogo, out var parsed) && parsed != Guid.Empty)
            {
                logoMediaId = parsed;
            }
            else
            {
                errors.Add(LogoNotUsableMessage);
            }
        }

        var modules = request.Modules ?? [];
        var modulesJson = PortalModuleSettings.Serialize(modules.Where(m => m is not null));
        CheckModules(modules, errors);

        string? skinOverridesJson = null;
        if (request.SkinOverrides is { } overrides)
        {
            skinOverridesJson = overrides.ToJsonString();
            var skin = skinValidator.Validate(PortalSkinKey, overrides);
            errors.AddRange(skin.Errors);
        }

        // PC-1 limits (story 01): the masthead name in code points, both JSON columns in UTF-8 bytes. Reported alongside
        // the shape errors so an oversized module list says it is oversized.
        errors.AddRange(PortalLimits.CheckConfig(portalName, modulesJson, skinOverridesJson).Errors);

        if (errors.Count > 0)
        {
            return PortalConfigParse.Fail(errors);
        }

        return new PortalConfigParse(
            new PortalConfigDraft(
                portalName,
                cityName,
                tagline,
                logoMediaId,
                request.LayoutKey,
                modulesJson,
                skinOverridesJson),
            []);
    }

    /// <summary>
    /// The masthead name participants see: <c>PortalName</c>, else <c>"{CityName} Today"</c>, else the neutral
    /// <c>"Local Today"</c> (Q-E3-1; never the exercise name, which would leak the exercise into the fiction).
    /// </summary>
    /// <param name="portalName">The stored portal name, or null.</param>
    /// <param name="cityName">The stored city name, or null.</param>
    /// <returns>The resolved name.</returns>
    public static string ResolveName(string? portalName, string? cityName) =>
        !string.IsNullOrWhiteSpace(portalName) ? portalName.Trim()
        : !string.IsNullOrWhiteSpace(cityName) ? cityName.Trim() + DefaultNameSuffix
        : "Local" + DefaultNameSuffix;

    /// <summary>
    /// Trims; blank is null; refuses control/invisible characters and text over <paramref name="maxCharacters"/> code
    /// points (null: checked elsewhere) or over its column, <paramref name="columnLength"/> UTF-16 units.
    /// </summary>
    private static string? CheckText(string? value, string field, int? maxCharacters, int columnLength, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        if (OutletText.HasControlOrInvisible(trimmed))
        {
            errors.Add($"{field} contains control or invisible characters.");
        }

        var length = trimmed.EnumerateRunes().Count();
        if (maxCharacters is { } max && length > max)
        {
            errors.Add($"{field} is {length} characters; the limit is {max}.");
        }
        else if (trimmed.Length > columnLength)
        {
            errors.Add($"{field} is too long to store; shorten it.");
        }

        return trimmed;
    }

    private static void CheckModules(IReadOnlyList<PortalModuleSettingDto?> modules, List<string> errors)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var module in modules)
        {
            if (module is null || !PortalVocabulary.IsModuleId(module.Id))
            {
                errors.Add($"modules may only name {string.Join(", ", PortalVocabulary.ModuleIds)}.");
                return;
            }

            if (!seen.Add(module.Id))
            {
                errors.Add($"modules names '{module.Id}' more than once.");
                return;
            }
        }
    }

}

/// <summary>A validated, normalized write: what the row will hold.</summary>
/// <param name="PortalName">The trimmed portal name, or null for the default.</param>
/// <param name="CityName">The trimmed city name, or null.</param>
/// <param name="Tagline">The trimmed tagline, or null.</param>
/// <param name="LogoMediaId">The logo asset id (not yet checked against the exercise), or null.</param>
/// <param name="LayoutKey">A PC-1 layout key.</param>
/// <param name="ModulesJson">The ordered module settings, as stored.</param>
/// <param name="SkinOverridesJson">The validated overrides, or null.</param>
internal sealed record PortalConfigDraft(
    string? PortalName,
    string? CityName,
    string? Tagline,
    Guid? LogoMediaId,
    string LayoutKey,
    string ModulesJson,
    string? SkinOverridesJson);

/// <summary>The result of <see cref="PortalConfigWriteValidator.Parse"/>.</summary>
/// <param name="Draft">The draft, when valid.</param>
/// <param name="Errors">Every error, when not.</param>
internal sealed record PortalConfigParse(PortalConfigDraft? Draft, IReadOnlyList<string> Errors)
{
    public static PortalConfigParse Fail(IReadOnlyList<string> errors) => new(null, errors);
}
