namespace Pulse.WebApi.Features.Portal.Data;

using System.Text;
using Pulse.WebApi.Data.Entities;

/// <summary>
/// The PC-1 portal limits (exercise-portal story 01): a masthead name of at most 60 characters, a <c>ModulesJson</c> /
/// <c>SkinOverridesJson</c> of at most 4 KB each, and at most 25 live resources per exercise. The config and resources
/// services (stories 03/04) and the setup surface's API (16) call these before writing, so an over-cap input is refused
/// with a readable reason instead of failing at the database.
/// </summary>
/// <remarks>
/// <para>
/// <b>What a "character" and a "KB" are.</b> The masthead limit counts Unicode code points (<see cref="Rune"/>s), so an
/// emoji is one character, not two UTF-16 units; F01 sized the <c>PortalName</c> column (120) for 60 astral characters.
/// The JSON limits count UTF-8 bytes of the stored string, the same unit the FC-3b skin validator's 4 KB cap uses.
/// </para>
/// <para>
/// <b>Limits only.</b> Shape checks (that <c>ModulesJson</c> parses and names known modules, that the skin overrides
/// stay inside the FC-3b allowlist) belong to story 03 and F03's <c>ISkinOverridesValidator</c>.
/// </para>
/// </remarks>
public static class PortalLimits
{
    /// <summary>The longest masthead name, in characters (code points).</summary>
    public const int MaxMastheadNameLength = 60;

    /// <summary>The largest <c>ModulesJson</c> or <c>SkinOverridesJson</c>, in UTF-8 bytes (4 KB).</summary>
    public const int MaxJsonBytes = 4096;

    /// <summary>The most live (not deleted) resources one exercise may have.</summary>
    public const int MaxResources = 25;

    /// <summary>Checks a config row's limited fields.</summary>
    /// <param name="config">The row about to be written.</param>
    /// <returns>The result; each error names the field and the limit.</returns>
    public static PortalLimitsResult CheckConfig(PortalConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        return CheckConfig(config.PortalName, config.ModulesJson, config.SkinOverridesJson);
    }

    /// <summary>Checks the limited config fields before they are written.</summary>
    /// <param name="portalName">The masthead name, or null for the default.</param>
    /// <param name="modulesJson">The ordered module list JSON.</param>
    /// <param name="skinOverridesJson">The skin overrides JSON, or null.</param>
    /// <returns>The result; each error names the field and the limit.</returns>
    public static PortalLimitsResult CheckConfig(string? portalName, string? modulesJson, string? skinOverridesJson)
    {
        var errors = new List<string>();

        if (portalName is not null)
        {
            var length = CountCharacters(portalName);
            if (length > MaxMastheadNameLength)
            {
                errors.Add(
                    $"The masthead name is {length} characters; the limit is {MaxMastheadNameLength}.");
            }
        }

        AddJsonSizeError(errors, "module list", modulesJson);
        AddJsonSizeError(errors, "skin overrides", skinOverridesJson);

        return errors.Count == 0 ? PortalLimitsResult.Valid : new PortalLimitsResult(errors);
    }

    /// <summary>Checks that adding resources keeps the exercise within <see cref="MaxResources"/>.</summary>
    /// <param name="liveCount">The exercise's live resources now (deleted rows do not count).</param>
    /// <param name="adding">How many are about to be added.</param>
    /// <returns>The result.</returns>
    public static PortalLimitsResult CheckResourceCount(int liveCount, int adding = 1)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(liveCount);
        ArgumentOutOfRangeException.ThrowIfNegative(adding);

        return liveCount + adding <= MaxResources
            ? PortalLimitsResult.Valid
            : new PortalLimitsResult(
            [
                $"The portal already has {liveCount} resources; adding {adding} would exceed the limit of {MaxResources}.",
            ]);
    }

    /// <summary>Counts code points, so a surrogate pair is one character.</summary>
    private static int CountCharacters(string value) => value.EnumerateRunes().Count();

    private static void AddJsonSizeError(List<string> errors, string label, string? json)
    {
        if (json is null)
        {
            return;
        }

        var bytes = Encoding.UTF8.GetByteCount(json);
        if (bytes > MaxJsonBytes)
        {
            errors.Add($"The {label} is {bytes} bytes; the limit is {MaxJsonBytes} bytes (4 KB).");
        }
    }
}

/// <summary>The result of a <see cref="PortalLimits"/> check.</summary>
/// <param name="Errors">One readable message per limit exceeded; empty when the input is within every limit.</param>
public sealed record PortalLimitsResult(IReadOnlyList<string> Errors)
{
    /// <summary>A result with no errors.</summary>
    public static PortalLimitsResult Valid { get; } = new([]);

    /// <summary>Whether the input is within every limit.</summary>
    public bool IsValid => Errors.Count == 0;
}
