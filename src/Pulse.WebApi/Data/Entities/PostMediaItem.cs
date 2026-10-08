namespace Pulse.WebApi.Data.Entities;

/// <summary>
/// One media attachment on a <see cref="Post"/> — the ordered join between a post and a
/// <see cref="MediaAsset"/>, carrying the alt text the participant sees. <see cref="IExerciseScoped"/> with its
/// OWN non-nullable <see cref="ExerciseId"/> (DP-2, always equal to the post's), so the central read-side query
/// filter + write-time guard cover this table directly rather than relying on every reader to join through
/// <c>Posts</c> (COR-001).
/// </summary>
/// <remarks>
/// <para>
/// <b>Schema only (demo-polish B1).</b> No navigation properties by design: readers join explicitly, which
/// avoids query-filter / relationship fix-up surprises. Every foreign key is <c>Restrict</c> (XC-010).
/// </para>
/// <para>
/// <b>One item per slot.</b> <c>IX_PostMediaItems_PostId_Order</c> is UNIQUE. The column is named
/// <c>Order</c>, a SQL reserved word: EF brackets it, and any raw SQL must write <c>[Order]</c>.
/// </para>
/// </remarks>
public sealed class PostMediaItem : IExerciseScoped
{
    /// <summary>The schema bound of <see cref="Alt"/>.</summary>
    public const int MaxAltLength = 1000;

    /// <summary>Primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>The owning exercise run (COR-001, DP-2) — equal to the post's. The write-guard rejects <see cref="Guid.Empty"/>.</summary>
    public Guid ExerciseId { get; set; }

    /// <summary>The <see cref="Post"/> this item is attached to (foreign key, <c>Restrict</c>).</summary>
    public Guid PostId { get; set; }

    /// <summary>The attached <see cref="MediaAsset"/> (foreign key, <c>Restrict</c>).</summary>
    public Guid MediaAssetId { get; set; }

    /// <summary>
    /// An optional poster image overriding the asset's own <see cref="MediaAsset.PosterMediaAssetId"/>
    /// (foreign key to <see cref="MediaAsset"/>, <c>Restrict</c>).
    /// </summary>
    public Guid? PosterMediaAssetId { get; set; }

    /// <summary>
    /// The sanitized alt text, 1..<see cref="MaxAltLength"/> characters. Required on every item (NFR-001); it
    /// renders on a participant surface, so every writer must sanitize it at ingest (NFR-004).
    /// </summary>
    public required string Alt { get; set; }

    /// <summary>The 0-based display position within the post. Column <c>[Order]</c> (reserved word).</summary>
    public int Order { get; set; }
}
