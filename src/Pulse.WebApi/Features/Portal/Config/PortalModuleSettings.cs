namespace Pulse.WebApi.Features.Portal.Config;

using System.Text.Json;
using System.Text.Json.Serialization;
using Pulse.WebApi.Features.Portal.Contracts;

/// <summary>
/// The stored <c>ModulesJson</c> (PC-2: an ordered <c>[{id, enabled}]</c> array) and its two readings (exercise-portal
/// story 03): the participant list (stored order, enabled only) and the staff list (stored order, then any module the
/// row does not name yet, off).
/// </summary>
/// <remarks>
/// The write path validates strictly (<see cref="PortalConfigWriteValidator"/>); the read path is lenient, so a
/// hand-edited row never fails a participant read: an unreadable value reads as the defaults, and an unknown or repeated
/// id is skipped.
/// </remarks>
internal static class PortalModuleSettings
{
    private static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>The settings an exercise without a row gets: <see cref="PortalVocabulary.DefaultModuleOrder"/>, all on.</summary>
    public static IReadOnlyList<PortalModuleSettingDto> Defaults { get; } =
        PortalVocabulary.DefaultModuleOrder.Select(id => new PortalModuleSettingDto { Id = id, Enabled = true }).ToList();

    /// <summary>Serializes settings to the stored <c>ModulesJson</c> shape, in the given order.</summary>
    /// <param name="settings">The settings.</param>
    /// <returns>The JSON array.</returns>
    public static string Serialize(IEnumerable<PortalModuleSettingDto> settings) =>
        JsonSerializer.Serialize(settings.Select(s => new StoredModule(s.Id, s.Enabled)).ToList(), Options);

    /// <summary>
    /// Reads a stored <c>ModulesJson</c>: known ids only, first occurrence wins, in stored order. Null (no row) or an
    /// unreadable value is <see cref="Defaults"/>.
    /// </summary>
    /// <param name="json">The stored value, or null when there is no row.</param>
    /// <returns>The settings, in stored order.</returns>
    public static IReadOnlyList<PortalModuleSettingDto> Read(string? json)
    {
        if (json is null)
        {
            return Defaults;
        }

        List<StoredModule?>? stored;
        try
        {
            stored = JsonSerializer.Deserialize<List<StoredModule?>>(json, Options);
        }
        catch (JsonException)
        {
            return Defaults;
        }

        if (stored is null)
        {
            return Defaults;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        return stored
            .Where(module => module is not null && PortalVocabulary.IsModuleId(module.Id) && seen.Add(module.Id!))
            .Select(module => new PortalModuleSettingDto { Id = module!.Id!, Enabled = module.Enabled })
            .ToList();
    }

    /// <summary>
    /// The staff reading: the stored settings, then every module id the row does not name, off (so a module registered
    /// after the row was written shows up in the console as a toggle rather than vanishing).
    /// </summary>
    /// <param name="stored">The stored settings (<see cref="Read"/>).</param>
    /// <returns>Every module id exactly once.</returns>
    public static IReadOnlyList<PortalModuleSettingDto> Complete(IReadOnlyList<PortalModuleSettingDto> stored)
    {
        var named = stored.Select(s => s.Id).ToHashSet(StringComparer.Ordinal);
        return stored
            .Concat(PortalVocabulary.ModuleIds
                .Where(id => !named.Contains(id))
                .Select(id => new PortalModuleSettingDto { Id = id, Enabled = false }))
            .ToList();
    }

    /// <summary>One stored entry. <c>enabled</c> defaults to true when a hand-edited row omits it.</summary>
    private sealed record StoredModule(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("enabled")] bool Enabled = true);
}
