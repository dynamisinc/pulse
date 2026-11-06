namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One media attachment on a <see cref="ContentItem"/> (channels-foundation story 01, FC-2): an inline image or video,
/// or a download-only attachment, referencing a media-library asset.
/// </summary>
/// <remarks>
/// <see cref="IExerciseScoped"/> and <see cref="ISoftDeletable"/>. The item reference is a SAME-EXERCISE composite
/// foreign key; the asset reference is a Restrict foreign key to <c>MediaAssets</c> (house style, as
/// <see cref="PostMediaItem"/>), resolved in scope by the funnel.
/// </remarks>
public sealed class ContentItemMedia : IExerciseScoped, ISoftDeletable
{
    /// <summary>Bound of <see cref="Role"/>.</summary>
    public const int MaxRoleLength = 16;

    /// <summary>Bound of <see cref="Alt"/> (matches <see cref="PostMediaItem.MaxAltLength"/>).</summary>
    public const int MaxAltLength = PostMediaItem.MaxAltLength;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001). Non-nullable; the write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The item, in the same exercise.</summary>
    public Guid ContentItemId { get; set; }

    /// <summary>The media-library asset.</summary>
    public Guid MediaAssetId { get; set; }

    /// <summary>The media role: <c>hero</c> / <c>inline</c> / <c>attachment</c>.</summary>
    public required string Role { get; set; }

    /// <summary>Display order within the item.</summary>
    public int SortOrder { get; set; }

    /// <summary>The alt text (NFR-001), else <c>null</c>.</summary>
    public string? Alt { get; set; }

    /// <inheritdoc />
    public DateTimeOffset? DeletedAt { get; set; }
}
