namespace Pulse.WebApi.Features.Weather.Zones;

using Microsoft.EntityFrameworkCore;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Weather.Contracts;

/// <summary>
/// <see cref="IWeatherZoneCatalog"/> over F01's <see cref="WeatherZone"/> (weather-source story 02; the interface is story
/// 01's). Scoped: every query runs through the <see cref="PulseDbContext"/> central exercise filter, so it answers for the
/// RESOLVED exercise only, and an unset scope sees no zone at all (fail closed: nothing can be authored).
/// </summary>
/// <remarks>
/// Slugs are compared ORDINALLY in memory after the query: the database collation is case-insensitive, and FC-1 slugs are
/// lowercase, so <c>North-County</c> must not pass as <c>north-county</c>.
/// </remarks>
public sealed class WeatherZoneCatalog : IWeatherZoneCatalog
{
    private readonly PulseDbContext _dbContext;

    /// <summary>Creates the catalog.</summary>
    /// <param name="dbContext">The exercise-scoped persistence context.</param>
    public WeatherZoneCatalog(PulseDbContext dbContext)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        _dbContext = dbContext;
    }

    /// <inheritdoc />
    public Task<bool> HasAnyAsync(CancellationToken cancellationToken = default) =>
        _dbContext.WeatherZones.AsNoTracking().AnyAsync(cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlySet<string>> ExistAsync(
        IReadOnlyCollection<string> slugs,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(slugs);
        var wanted = slugs.ToHashSet(StringComparer.Ordinal);
        if (wanted.Count == 0)
        {
            return new HashSet<string>(StringComparer.Ordinal);
        }

        var found = (await LookupAsync(_dbContext.WeatherZones, wanted, cancellationToken))
            .Select(zone => zone.Slug)
            .ToHashSet(StringComparer.Ordinal);
        wanted.ExceptWith(found);
        return wanted;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<WeatherZoneRef>> ResolveAsync(
        IReadOnlyCollection<string> slugs,
        bool includeDeleted,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(slugs);
        var wanted = slugs.ToHashSet(StringComparer.Ordinal);
        if (wanted.Count == 0)
        {
            return [];
        }

        var source = includeDeleted ? _dbContext.IncludingSoftDeleted<WeatherZone>() : _dbContext.WeatherZones;
        var bySlug = (await LookupAsync(source, wanted, cancellationToken))
            .ToDictionary(zone => zone.Slug, zone => zone.Name, StringComparer.Ordinal);

        var resolved = new List<WeatherZoneRef>(bySlug.Count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var slug in slugs)
        {
            if (seen.Add(slug) && bySlug.TryGetValue(slug, out var name))
            {
                resolved.Add(new WeatherZoneRef(slug, name));
            }
        }

        return resolved;
    }

    private static async Task<List<(string Slug, string Name)>> LookupAsync(
        IQueryable<WeatherZone> source,
        IReadOnlySet<string> slugs,
        CancellationToken cancellationToken)
    {
        var candidates = slugs.ToList();
        var rows = await source
            .AsNoTracking()
            .Where(zone => candidates.Contains(zone.Slug))
            .Select(zone => new { zone.Slug, zone.Name })
            .ToListAsync(cancellationToken);
        return rows.Where(row => slugs.Contains(row.Slug)).Select(row => (row.Slug, row.Name)).ToList();
    }
}
