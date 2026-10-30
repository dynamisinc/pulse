namespace Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// The exercise's weather zones as the payload validators see them (story 01 owns the interface; story 02 implements it over
/// the <c>WeatherZone</c> entity). A scoped service: every call answers for the RESOLVED exercise only (COR-001), never one
/// named by a caller.
/// </summary>
/// <remarks>
/// When no implementation is registered (before story 02 lands) the weather descriptors fail closed: a product or forecast
/// cannot be written, because no zone can be proven to exist.
/// </remarks>
public interface IWeatherZoneCatalog
{
    /// <summary>Whether the resolved exercise has at least one live (not soft-deleted) zone.</summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns><c>false</c> means no weather item can be authored yet (validation error <c>no_zones</c>).</returns>
    Task<bool> HasAnyAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns the slugs that are NOT a live zone of the resolved exercise.</summary>
    /// <param name="slugs">The candidate slugs.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The missing slugs (ordinal); empty when every slug exists.</returns>
    Task<IReadOnlySet<string>> ExistAsync(IReadOnlyCollection<string> slugs, CancellationToken cancellationToken = default);

    /// <summary>Resolves slugs to zone names, for rendering.</summary>
    /// <param name="slugs">The slugs.</param>
    /// <param name="includeDeleted">
    /// <c>true</c> also resolves soft-deleted zones, so a historic product keeps naming a zone deleted after it was published.
    /// </param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>One entry per slug that resolves, in input order.</returns>
    Task<IReadOnlyList<WeatherZoneRef>> ResolveAsync(
        IReadOnlyCollection<string> slugs, bool includeDeleted, CancellationToken cancellationToken = default);
}

/// <summary>A zone as a product names it.</summary>
/// <param name="Slug">The zone slug.</param>
/// <param name="Name">The display name.</param>
public sealed record WeatherZoneRef(string Slug, string Name);
