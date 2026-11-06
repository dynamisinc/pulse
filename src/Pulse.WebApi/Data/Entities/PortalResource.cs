namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One entry on the portal's resources page (exercise-portal PC-2; created by channels-foundation story 01's M1, Q-28):
/// shelters, hotlines, official guidance. Behaviour over it is exercise-portal's.
/// </summary>
/// <remarks><see cref="IExerciseScoped"/> and <see cref="ISoftDeletable"/>; <see cref="Version"/> is the concurrency token.</remarks>
public sealed class PortalResource : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Title"/>.</summary>
    public const int MaxTitleLength = 200;

    /// <summary>Bound of <see cref="Summary"/>.</summary>
    public const int MaxSummaryLength = 600;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The resource title.</summary>
    public required string Title { get; set; }

    /// <summary>A one-line summary.</summary>
    public string? Summary { get; set; }

    /// <summary>The body HTML, sanitized at write.</summary>
    public string? BodyHtml { get; set; }

    /// <summary>An image (a media-library asset), else <c>null</c>.</summary>
    public Guid? MediaAssetId { get; set; }

    /// <summary>Display order within the exercise.</summary>
    public int SortOrder { get; set; }

    /// <summary>Whether participants see the resource.</summary>
    public bool Visible { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>The optimistic-concurrency token every write bumps.</summary>
    public int Version { get; set; }
}
