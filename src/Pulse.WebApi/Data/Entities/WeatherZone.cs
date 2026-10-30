namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One named weather location (weather-source zone model, WX-004; created by channels-foundation story 01's M1, Q-28).
/// Zones are labels, not geometry: products and forecasts reference them by <see cref="Slug"/>. Behaviour over it is
/// weather-source story 02's.
/// </summary>
/// <remarks>
/// <see cref="IExerciseScoped"/> and <see cref="ISoftDeletable"/>; <see cref="Version"/> is the concurrency token. The slug
/// stays reserved after a soft delete (the unique index is unfiltered) so historic products keep resolving their zone.
/// </remarks>
public sealed class WeatherZone : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Slug"/>: FC-1 slugs are <c>[a-z0-9-]{1,80}</c>.</summary>
    public const int MaxSlugLength = 80;

    /// <summary>Bound of <see cref="Name"/>.</summary>
    public const int MaxNameLength = 120;

    /// <summary>Bound of <see cref="Kind"/>.</summary>
    public const int MaxKindLength = 16;

    /// <summary>Bound of <see cref="Description"/>.</summary>
    public const int MaxDescriptionLength = 500;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The zone slug; unique per exercise.</summary>
    public required string Slug { get; set; }

    /// <summary>The display name.</summary>
    public required string Name { get; set; }

    /// <summary>The zone kind: <c>county</c> / <c>city</c> / <c>region</c> / <c>custom</c>.</summary>
    public required string Kind { get; set; }

    /// <summary>Optional staff description.</summary>
    public string? Description { get; set; }

    /// <summary>Display order.</summary>
    public int SortOrder { get; set; }

    /// <summary>The site's initial selection (exactly one per exercise, enforced by the zone service).</summary>
    public bool IsDefault { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps.</summary>
    public int Version { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
